// A direct, encrypted link between two of your devices. Stories travel over a WebRTC data
// channel (device to device, encrypted by the browser). To find each other, the two devices swap
// one connection note each through ntfy.sh, a free public message relay: the note holds network
// addresses only, never stories, and is itself encrypted with a key from the pairing code, which
// only your two devices know. No server of ours is involved.

export const SIGNAL_DEFAULT = 'https://ntfy.sh';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

/** A new pairing code, like "K7QM-9XA3-FT". */
export function newCode(): string {
  const r = crypto.getRandomValues(new Uint8Array(10));
  const s = [...r].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
export const cleanCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

async function digest(text: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keysFor(code: string) {
  const c = cleanCode(code);
  const topic = `wstudio-${hex(await digest(`topic:${c}`)).slice(0, 28)}`;
  const key = await crypto.subtle.importKey('raw', await digest(`key:${c}`), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { topic, key };
}

async function squeeze(text: string): Promise<Uint8Array> {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function unsqueeze(b: Uint8Array): Promise<string> {
  const s = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(s).text();
}

async function seal(key: CryptoKey, v: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, (await squeeze(JSON.stringify(v))) as BufferSource));
  return `${b64(iv)}.${b64(data)}`;
}
async function open<T>(key: CryptoKey, s: string): Promise<T | undefined> {
  try {
    const [iv, data] = s.split('.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(data));
    return JSON.parse(await unsqueeze(new Uint8Array(plain))) as T;
  } catch {
    return undefined; // not ours, or tampered with
  }
}

interface Note { from: 'host' | 'guest'; type: 'offer' | 'answer'; sdp: string; at: number }

/** Waits until the browser has found its network addresses (or 4 seconds), so one note is enough. */
function gathered(pc: RTCPeerConnection) {
  return new Promise<void>((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    const t = setTimeout(res, 4000);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        res();
      }
    });
  });
}

/** A message link over a data channel; long messages are split into pieces and joined again. */
export class Link {
  private parts = new Map<string, string[]>();
  /** Messages nobody has asked for yet (so one that arrives early isn't lost). */
  private inbox: unknown[] = [];
  private waiters: { match: (m: unknown) => boolean; res: (m: unknown) => void }[] = [];
  private listener?: { match: (m: unknown) => boolean; h: (m: unknown) => void };
  onClose?: () => void;
  private ch: RTCDataChannel;
  private pc: RTCPeerConnection;
  constructor(ch: RTCDataChannel, pc: RTCPeerConnection) {
    this.ch = ch;
    this.pc = pc;
    ch.onmessage = (e) => this.receive(String(e.data));
    ch.onclose = () => this.onClose?.();
  }
  private receive(raw: string) {
    const f = JSON.parse(raw) as { id: string; i: number; n: number; d: string };
    const list = this.parts.get(f.id) ?? [];
    list[f.i] = f.d;
    this.parts.set(f.id, list);
    if (list.filter((x) => x !== undefined).length === f.n) {
      this.parts.delete(f.id);
      this.inbox.push(JSON.parse(list.join('')));
      this.deliver();
    }
  }
  private deliver() {
    this.inbox = this.inbox.filter((m) => {
      const w = this.waiters.find((x) => x.match(m));
      if (w) {
        this.waiters = this.waiters.filter((x) => x !== w);
        w.res(m);
        return false;
      }
      if (this.listener?.match(m)) {
        this.listener.h(m);
        return false;
      }
      return true;
    });
  }
  /** Messages passing `match` that no `next` is waiting for. Others stay queued. */
  listen(match: (m: unknown) => boolean, h: (m: unknown) => void) {
    this.listener = { match, h };
    this.deliver();
  }
  /** Resolves with the next message that passes `match`. */
  next<T>(match: (m: unknown) => boolean, ms = 120_000): Promise<T> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('The other device stopped answering.')), ms);
      this.waiters.push({ match, res: (m) => { clearTimeout(t); res(m as T); } });
      this.deliver();
    });
  }
  async send(m: unknown) {
    const text = JSON.stringify(m);
    const id = Math.random().toString(36).slice(2);
    const size = 16_000;
    const n = Math.max(1, Math.ceil(text.length / size));
    for (let i = 0; i < n; i++) {
      // Don't flood the channel's buffer with big stories.
      while (this.ch.bufferedAmount > 1_000_000) await new Promise((r) => setTimeout(r, 20));
      this.ch.send(JSON.stringify({ id, i, n, d: text.slice(i * size, (i + 1) * size) }));
    }
  }
  close() {
    this.ch.close();
    this.pc.close();
  }
}

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

/**
 * Connects to the other device that has the same code. The host (the device showing the code)
 * posts an offer and waits; the guest (the one typing or scanning it) answers.
 */
export async function connect(code: string, role: 'host' | 'guest', o: { signal?: AbortSignal; relay?: string; onStatus?: (s: string) => void } = {}): Promise<Link> {
  const relay = (o.relay || SIGNAL_DEFAULT).replace(/\/$/, '');
  const { topic, key } = await keysFor(code);
  const pc = new RTCPeerConnection(ICE);
  const post = async (n: Note) => {
    const r = await fetch(`${relay}/${topic}`, { method: 'POST', body: await seal(key, n), signal: o.signal });
    if (!r.ok) throw new Error(`The pairing relay answered ${r.status}.`);
  };
  // Notes from the other device, including ones posted before we started listening.
  const notes: Note[] = [];
  let wake: (() => void) | undefined;
  const es = new EventSource(`${relay}/${topic}/sse?since=10m`);
  es.onmessage = async (e) => {
    const msg = JSON.parse(e.data) as { message?: string };
    const n = msg.message ? await open<Note>(key, msg.message) : undefined;
    if (n && n.from !== role) {
      notes.push(n);
      wake?.();
    }
  };
  const nextNote = async (type: Note['type']) => {
    for (;;) {
      if (o.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const n = [...notes].reverse().find((x) => x.type === type);
      if (n) return n;
      await new Promise<void>((r) => {
        wake = r;
        setTimeout(r, 1000);
      });
    }
  };
  try {
    let ch: RTCDataChannel;
    if (role === 'host') {
      ch = pc.createDataChannel('sync', { ordered: true });
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      o.onStatus?.('Waiting for the other device…');
      await post({ from: 'host', type: 'offer', sdp: pc.localDescription!.sdp, at: Date.now() });
      const a = await nextNote('answer');
      o.onStatus?.('Connecting…');
      await pc.setRemoteDescription({ type: 'answer', sdp: a.sdp });
    } else {
      o.onStatus?.('Looking for the other device…');
      const offer = await nextNote('offer');
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      o.onStatus?.('Connecting…');
      await post({ from: 'guest', type: 'answer', sdp: pc.localDescription!.sdp, at: Date.now() });
      ch = await new Promise<RTCDataChannel>((res) => (pc.ondatachannel = (e) => res(e.channel)));
    }
    await new Promise<void>((res, rej) => {
      if (ch.readyState === 'open') return res();
      const t = setTimeout(() => rej(new Error("Couldn't connect the two devices. Check they're on the same Wi-Fi and try again.")), 30_000);
      ch.onopen = () => {
        clearTimeout(t);
        res();
      };
      o.signal?.addEventListener('abort', () => rej(new DOMException('Cancelled', 'AbortError')));
    });
    return new Link(ch, pc);
  } catch (e) {
    pc.close();
    throw e;
  } finally {
    es.close();
  }
}
