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

export const PIPE_DEFAULT = 'https://ppng.io';

/**
 * The fallback when two devices can't reach each other directly: messages stream through a
 * "piping server" (an open-source relay that passes a request body straight to whoever is
 * waiting for it, storing nothing). Every message is encrypted with the pairing code's key first,
 * so the relay only ever sees scrambled bytes.
 */
export class RelayChannel {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  bufferedAmount = 0;
  private queue: string[] = [];
  private sending = false;
  private stop = new AbortController();
  private url: (dir: 'host' | 'guest', n: number) => string;
  private key: CryptoKey;
  private role: 'host' | 'guest';
  private sent = 0;
  constructor(base: string, topic: string, key: CryptoKey, role: 'host' | 'guest') {
    this.url = (dir, n) => `${base.replace(/\/$/, '')}/${topic}-${dir}-${n}`;
    this.key = key;
    this.role = role;
    void this.receive();
  }
  send(data: string) {
    this.queue.push(data);
    this.bufferedAmount += data.length;
    void this.flush();
  }
  private async flush() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length && !this.stop.signal.aborted) {
        const data = this.queue[0];
        const body = await seal(this.key, data);
        await retry(() => fetch(this.url(this.role, this.sent), { method: 'POST', body, signal: this.stop.signal }), this.stop.signal);
        this.queue.shift();
        this.sent++;
        this.bufferedAmount -= data.length;
      }
    } catch {
      this.end();
    } finally {
      this.sending = false;
    }
  }
  private async receive() {
    const from = this.role === 'host' ? 'guest' : 'host';
    try {
      for (let n = 0; !this.stop.signal.aborted; n++) {
        const r = await retry(() => fetch(this.url(from, n), { signal: this.stop.signal }), this.stop.signal, Infinity); // waits as long as it takes
        const data = await open<string>(this.key, await r.text());
        if (data === undefined) throw new Error('Unreadable message');
        this.onmessage?.({ data });
      }
    } catch {
      this.end();
    }
  }
  private end() {
    if (this.stop.signal.aborted) return;
    this.stop.abort();
    this.onclose?.();
  }
  close() {
    this.stop.abort();
  }
}

/** A request that waits for the other side, retried if the relay drops it while waiting. */
async function retry(go: () => Promise<Response>, signal: AbortSignal, tries = 6) {
  for (let i = 1; ; i++) {
    try {
      const r = await go();
      if (r.ok) return r;
      if (r.status < 500 || i >= tries) throw new Error(`The relay answered ${r.status}.`);
    } catch (e) {
      if (signal.aborted || i >= tries || !(e instanceof TypeError)) throw e;
    }
    await new Promise((res) => setTimeout(res, Math.min(5000, 1000 * i)));
  }
}

/** A message link over a data channel; long messages are split into pieces and joined again. */
export class Link {
  private parts = new Map<string, string[]>();
  /** Messages nobody has asked for yet (so one that arrives early isn't lost). */
  private inbox: unknown[] = [];
  private waiters: { match: (m: unknown) => boolean; res: (m: unknown) => void; rej: (e: Error) => void }[] = [];
  private closed = false;
  private listener?: { match: (m: unknown) => boolean; h: (m: unknown) => void };
  onClose?: () => void;
  private ch: RTCDataChannel | RelayChannel;
  private pc?: RTCPeerConnection;
  private size: number;
  /** Through the relay rather than direct. */
  readonly relayed: boolean;
  constructor(ch: RTCDataChannel | RelayChannel, pc?: RTCPeerConnection) {
    this.ch = ch;
    this.pc = pc;
    this.relayed = !pc;
    // Each relayed message is its own web request, so send big pieces.
    this.size = pc ? 16_000 : 2_000_000;
    ch.onmessage = (e: { data: unknown }) => this.receive(String(e.data));
    ch.onclose = () => this.ended();
    // A direct connection can drop without the channel saying so for a long while.
    pc?.addEventListener('iceconnectionstatechange', () => ['failed', 'closed'].includes(pc.iceConnectionState) && this.ended());
  }
  /** The other side went away: whatever was waiting for it fails instead of waiting forever. */
  private ended() {
    if (this.closed) return;
    this.closed = true;
    const w = this.waiters;
    this.waiters = [];
    w.forEach((x) => x.rej(new Error('The connection to the other device was lost. Start the sync again on both devices.')));
    this.onClose?.();
  }
  private receive(raw: string) {
    let f: { id: string; i: number; n: number; d: string };
    try {
      f = JSON.parse(raw);
    } catch {
      return; // a late handshake word ("ready", "hello"), not a message
    }
    if (!f || typeof f !== 'object' || typeof f.id !== 'string') return;
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
      if (this.closed) return rej(new Error('The connection to the other device was lost. Start the sync again on both devices.'));
      const t = setTimeout(() => rej(new Error('The other device stopped answering.')), ms);
      this.waiters.push({ match, res: (m) => { clearTimeout(t); res(m as T); }, rej: (e) => { clearTimeout(t); rej(e); } });
      this.deliver();
    });
  }
  async send(m: unknown) {
    const text = JSON.stringify(m);
    const id = Math.random().toString(36).slice(2);
    const size = this.size;
    const n = Math.max(1, Math.ceil(text.length / size));
    for (let i = 0; i < n; i++) {
      // Don't flood the channel's buffer with big stories.
      while (this.ch.bufferedAmount > 1_000_000) await new Promise((r) => setTimeout(r, 20));
      this.ch.send(JSON.stringify({ id, i, n, d: text.slice(i * size, (i + 1) * size) }));
    }
  }
  close() {
    this.ch.close();
    this.pc?.close();
  }
}

/** Public address finders (STUN). They see only that a device asked; nothing passes through them. */
const STUN = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];

export interface Turn {
  urls: string;
  username?: string;
  credential?: string;
}

/** Couldn't connect, with what each side could offer, in plain words, for the error screen. */
export class ConnectError extends Error {
  details: string;
  noLocal: boolean;
  constructor(message: string, details: string, noLocal = false) {
    super(message);
    this.details = details;
    this.noLocal = noLocal;
  }
}

interface Cand { type: string; address: string }
function candidates(sdp: string, extra: string[] = []): Cand[] {
  return [...sdp.split(/\r?\n/), ...extra]
    .map((l) => l.replace(/^a=/, '').match(/^candidate:\S+ \d+ \S+ \d+ (\S+) \d+ typ (\w+)/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ address: m[1], type: m[2] }));
}

function describe(c: Cand[]) {
  const host = c.filter((x) => x.type === 'host');
  const parts = [
    host.length ? (host.every((x) => x.address.endsWith('.local')) ? 'local address (hidden name)' : 'local address') : 'no local address',
    c.some((x) => x.type === 'srflx' || x.type === 'prflx') ? 'internet address' : 'no internet address',
  ];
  if (c.some((x) => x.type === 'relay')) parts.push('relay');
  return parts.join(', ');
}

/** Plain-language guess at why two devices couldn't reach each other. */
export function diagnose(mine: Cand[], theirs: Cand[], state: string, role: 'host' | 'guest') {
  const other = role === 'host' ? 'Phone or other device' : 'Other device';
  const pub = (c: Cand[]) => new Set(c.filter((x) => x.type === 'srflx').map((x) => x.address));
  const a = pub(mine), b = pub(theirs);
  const lines = [`This device: ${describe(mine)}.`, `${other}: ${describe(theirs)}.`, `Connection check: ${state}.`];
  let hint = '';
  if (a.size && b.size && ![...a].some((x) => b.has(x)))
    hint = "The two devices are reaching the internet from different addresses, so they're probably not on the same network (a phone on mobile data, a VPN, or a guest Wi-Fi). Put both on the same Wi-Fi and turn off any VPN.";
  else if (!mine.some((x) => x.type === 'host'))
    hint = "This device didn't share its Wi-Fi address (iPhones and some browsers keep it private unless the page may use the camera), so the two could only meet through the router, which many routers don't allow. Use \"Share Wi-Fi address\" below, then sync again.";
  else if (!theirs.some((x) => x.type === 'host'))
    hint = "The other device didn't share its Wi-Fi address (iPhones and some browsers keep it private unless the page may use the camera). On that device, use \"Share Wi-Fi address\" on its error screen, then sync again.";
  else
    hint = "Both devices are on the same network but couldn't reach each other directly. Some routers block devices from talking to each other (often called AP or client isolation, common on guest and mesh networks). Try another Wi-Fi or a phone hotspot, or turn on the relay under Advanced.";
  return { hint, details: lines.join('\n'), noLocal: !mine.some((x) => x.type === 'host') };
}

/**
 * Connects to the other device that has the same code. The host (the device showing the code)
 * posts an offer and waits; the guest (the one typing or scanning it) answers.
 */
export async function connect(code: string, role: 'host' | 'guest', o: { signal?: AbortSignal; relay?: string; turn?: Turn; pipe?: string | false; onStatus?: (s: string) => void } = {}): Promise<Link> {
  const relay = (o.relay || SIGNAL_DEFAULT).replace(/\/$/, '');
  const { topic, key } = await keysFor(code);
  const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN }, ...(o.turn?.urls ? [o.turn] : [])] });
  const found: string[] = [];
  pc.addEventListener('icecandidate', (e) => e.candidate && found.push(e.candidate.candidate));
  let remoteSdp = '';
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
    let ch: RTCDataChannel | undefined;
    const incoming = new Promise<RTCDataChannel>((res) => (pc.ondatachannel = (e) => res(e.channel)));
    if (role === 'host') {
      ch = pc.createDataChannel('sync', { ordered: true });
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      o.onStatus?.('Waiting for the other device…');
      await post({ from: 'host', type: 'offer', sdp: pc.localDescription!.sdp, at: Date.now() });
      const a = await nextNote('answer');
      o.onStatus?.('Connecting…');
      remoteSdp = a.sdp;
      await pc.setRemoteDescription({ type: 'answer', sdp: a.sdp });
    } else {
      o.onStatus?.('Looking for the other device…');
      const offer = await nextNote('offer');
      remoteSdp = offer.sdp;
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      o.onStatus?.('Connecting…');
      await post({ from: 'guest', type: 'answer', sdp: pc.localDescription!.sdp, at: Date.now() });
    }
    let opened: RTCDataChannel;
    try {
      opened = await new Promise<RTCDataChannel>((res, rej) => {
        const ready = (c: RTCDataChannel) => {
          if (c.readyState === 'open') {
            clearTimeout(t);
            return res(c);
          }
          c.onopen = () => {
            clearTimeout(t);
            res(c);
          };
        };
        const states: string[] = [];
        const give = async () => {
          let pairs = '';
          try {
            let tried = 0, answered = 0;
            (await pc.getStats()).forEach((r: { type: string; state?: string; responsesReceived?: number }) => {
              if (r.type !== 'candidate-pair') return;
              tried++;
              if (r.state === 'succeeded' || (r.responsesReceived ?? 0) > 0) answered++;
            });
            pairs = `\nAddress pairs tried: ${tried}, answered: ${answered}.`;
          } catch {
            /* no stats: leave it out */
          }
          const d = diagnose(candidates(pc.localDescription?.sdp ?? '', found), candidates(remoteSdp), states.join(' → ') || pc.iceConnectionState, role);
          rej(new ConnectError(`Couldn't connect the two devices. ${d.hint}`, d.details + pairs, d.noLocal));
        };
        const t = setTimeout(() => void give(), 30_000);
        pc.addEventListener('iceconnectionstatechange', () => {
          states.push(pc.iceConnectionState);
          if (pc.iceConnectionState === 'failed') {
            clearTimeout(t);
            void give();
          }
        });
        if (ch) ready(ch);
        else void incoming.then(ready);
        o.signal?.addEventListener('abort', () => rej(new DOMException('Cancelled', 'AbortError')));
      });
      // Both sides must see the connection before either goes on: a channel can open on one
      // side only, which left one device "comparing stories" forever while the other gave up.
      // The guest says "ready"; the host answers "go" and only then do both go on. If either
      // word doesn't arrive, both fall back to the relay together.
      const both = await new Promise<boolean>((res) => {
        const t = setTimeout(() => res(false), 15_000);
        const say = (w: string) => {
          try {
            opened.send(w);
          } catch {
            clearTimeout(t);
            res(false);
          }
        };
        opened.onmessage = (m) => {
          if (role === 'host' && m.data === 'ready') {
            say('go');
            clearTimeout(t);
            res(true);
          } else if (role === 'guest' && m.data === 'go') {
            clearTimeout(t);
            res(true);
          }
        };
        opened.onclose = () => (clearTimeout(t), res(false));
        if (role === 'guest') say('ready');
      });
      opened.onmessage = null;
      opened.onclose = null;
      if (!both) throw new ConnectError("Couldn't connect the two devices: the connection only opened on one side.", `Connection check: ${pc.iceConnectionState}.`);
    } catch (e) {
      if (!(e instanceof ConnectError) || o.pipe === false) throw e;
      // Couldn't reach each other directly: go through the relay instead, still encrypted.
      pc.close();
      o.onStatus?.("A direct connection didn't work, so connecting through the relay…");
      const rc = new RelayChannel(o.pipe || PIPE_DEFAULT, topic, key, role);
      try {
        await new Promise<void>((res, rej) => {
          const t = setTimeout(() => rej(new Error('timeout')), 60_000);
          rc.onmessage = (m) => m.data === 'hello' && (clearTimeout(t), res());
          rc.onclose = () => rej(new Error('closed'));
          o.signal?.addEventListener('abort', () => rej(new DOMException('Cancelled', 'AbortError')));
          rc.send('hello');
        });
      } catch (err) {
        rc.close();
        if ((err as Error).name === 'AbortError') throw err;
        const why = (err as Error).message === 'timeout'
          ? 'Relay: reachable, but the other device never joined it within a minute. Reload the app on both devices (so both run the same version) and try again.'
          : `Relay: ${(err as Error).message === 'closed' ? "couldn't reach it (blocked or offline?)" : (err as Error).message}.`;
        throw new ConnectError(`${e.message} The relay didn't work either.`, `${e.details}\n${why}`, e.noLocal);
      }
      return new Link(rc);
    }
    return new Link(opened, pc);
  } catch (e) {
    pc.close();
    throw e;
  } finally {
    es.close();
  }
}

/**
 * Browsers that hide this device's Wi-Fi address (Safari above all) share it once the page has
 * camera permission. Asks for it and stops the camera straight away; nothing is recorded.
 */
export async function shareLocalAddress() {
  const s = await navigator.mediaDevices.getUserMedia({ video: true });
  s.getTracks().forEach((t) => t.stop());
}

// ---------- paired devices: sync through the relay at the press of a button ----------
// Once two devices have synced with a code, they keep that code as a shared secret. Later, one
// "knocks" on the other through the relay (the other must have the app open and listens for
// knocks while it is), and the two sync through the relay, everything encrypted with the secret.

const knockUrl = (base: string, topic: string, to: string) => `${base.replace(/\/$/, '')}/${topic}-knock-${to}`;

/** Asks a paired device to sync. Resolves with the session id once it has heard the knock. */
export async function knock(secret: string, me: string, peer: string, o: { pipe?: string; signal?: AbortSignal; waitMs?: number } = {}): Promise<string> {
  const { topic, key } = await keysFor(secret);
  const session = Math.random().toString(36).slice(2, 12);
  const stop = new AbortController();
  const t = setTimeout(() => stop.abort(), o.waitMs ?? 20_000);
  o.signal?.addEventListener('abort', () => stop.abort());
  try {
    const r = await fetch(knockUrl(o.pipe || PIPE_DEFAULT, topic, peer), { method: 'POST', body: await seal(key, { from: me, at: Date.now(), session }), signal: stop.signal });
    if (!r.ok) throw new Error(`The relay answered ${r.status}.`);
    return session;
  } catch (e) {
    if (o.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (stop.signal.aborted) throw new Error("The other device didn't answer. Open Writing Studio there (it listens while it's open) and try again.");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/** Listens for a knock from a paired device, as long as `signal` allows. Resolves with the session id. */
export async function waitForKnock(secret: string, me: string, peer: string, o: { pipe?: string; signal: AbortSignal }): Promise<string> {
  const { topic, key } = await keysFor(secret);
  for (let wait = 2000; !o.signal.aborted; ) {
    const began = Date.now();
    try {
      const r = await fetch(knockUrl(o.pipe || PIPE_DEFAULT, topic, me), { signal: o.signal });
      if (r.ok) {
        const k = await open<{ from: string; at: number; session: string }>(key, await r.text());
        if (k && k.from === peer && Math.abs(Date.now() - k.at) < 120_000 && /^[a-z0-9]{4,20}$/.test(k.session)) return k.session;
        wait = 2000;
        continue;
      }
    } catch {
      /* relay unreachable or the request timed out: try again shortly */
    }
    if (o.signal.aborted) break;
    // A wait that ran long and was then cut (proxies end idle requests) isn't a failure: listen again now.
    if (Date.now() - began > 15_000) wait = 1000;
    await new Promise((res) => setTimeout(res, wait));
    wait = Math.min(60_000, wait * 2);
  }
  throw new DOMException('Stopped', 'AbortError');
}

/** The relay link for one paired sync session. */
export async function connectPaired(secret: string, session: string, role: 'host' | 'guest', o: { pipe?: string; signal?: AbortSignal } = {}): Promise<Link> {
  const { topic, key } = await keysFor(secret);
  const rc = new RelayChannel(o.pipe || PIPE_DEFAULT, `${topic}-${session}`, key, role);
  try {
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error("Couldn't reach the other device through the relay.")), 60_000);
      rc.onmessage = (m) => m.data === 'hello' && (clearTimeout(t), res());
      rc.onclose = () => rej(new Error('The relay closed the connection.'));
      o.signal?.addEventListener('abort', () => rej(new DOMException('Cancelled', 'AbortError')));
      rc.send('hello');
    });
  } catch (e) {
    rc.close();
    throw e;
  }
  return new Link(rc);
}
