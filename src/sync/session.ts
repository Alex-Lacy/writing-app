// One sync between two devices. The host (showing the code) works out what to do, shows it, and
// on Apply sends the guest what it needs. Both sides save a snapshot first, so Undo can put
// everything back.
import { repo, type BackupData } from '../db/db';
import { uid } from '../lib/id';
import { init, selectChat, useStore } from '../store/store';
import type { Link } from './link';
import { hashUnit, loadUnits, manifestOf, mergeStories, plan, type Manifest, type PlanItem, type StoryUnit, type Unit } from './units';

export interface Me { deviceId: string; deviceName: string }

export async function me(): Promise<Me> {
  let deviceId = await repo.kvGet<string>('deviceId');
  if (!deviceId) {
    deviceId = uid();
    await repo.kvPut('deviceId', deviceId);
  }
  const ua = navigator.userAgent;
  const kind = /iPhone|Android.+Mobile/.test(ua) ? 'Phone' : /iPad|Android/.test(ua) ? 'Tablet' : 'Computer';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return { deviceId, deviceName: `${kind} (${browser})` };
}

const baseKey = (peer: string) => `syncBase:${peer}`;

/** A device this one has synced with by code: they can sync again with a button, through the relay. */
export interface Pair { peerId: string; peerName: string; secret: string; pairedAt: number; lastSync?: number }
export const listPairs = async () => (await repo.kvGet<Pair[]>('syncPairs')) ?? [];
export async function savePair(p: Pair) {
  const all = (await listPairs()).filter((x) => x.peerId !== p.peerId);
  await repo.kvPut('syncPairs', [...all, p]);
  pairsChanged();
}
export async function forgetPair(peerId: string) {
  await repo.kvPut('syncPairs', (await listPairs()).filter((x) => x.peerId !== peerId));
  pairsChanged();
}
export async function touchPair(peerId: string) {
  const all = await listPairs();
  await repo.kvPut('syncPairs', all.map((x) => (x.peerId === peerId ? { ...x, lastSync: Date.now() } : x)));
  pairsChanged();
}
const pairListeners = new Set<() => void>();
export const onPairsChanged = (f: () => void) => (pairListeners.add(f), () => void pairListeners.delete(f));
const pairsChanged = () => pairListeners.forEach((f) => f());

async function localManifest(): Promise<{ units: Unit[]; manifest: Manifest }> {
  const m = await me();
  const units = await loadUnits();
  const gone = (await repo.kvGet<Record<string, number>>('syncGone')) ?? {};
  return { units, manifest: await manifestOf(units, m.deviceId, m.deviceName, gone) };
}

type Wire =
  | { type: 'hello'; manifest: Manifest }
  | { type: 'get'; ids: string[] }
  | { type: 'units'; units: Unit[] }
  | { type: 'apply'; put: Unit[]; del: { id: string; kind: Unit['kind'] }[]; counts: Counts }
  | { type: 'applied' }
  | { type: 'final'; manifest: Manifest }
  | { type: 'cancel' };
const is = (t: Wire['type']) => (m: unknown) => (m as Wire).type === t;

/** A conflict's choice: keep this device's version, the other's, or both (the other's as a copy). */
export type Choice = 'here' | 'there' | 'both';

export interface Review {
  peer: string;
  /** Plan items after checking "changed on both" ones; conflicts need a choice. */
  items: (PlanItem & { merged?: Unit })[];
}

/** Host: swaps lists with the guest and works out the plan. */
export async function hostReview(link: Link): Promise<Review & { here: Unit[]; there: Map<string, Unit>; remote: Manifest }> {
  const { units, manifest } = await localManifest();
  const helloP = link.next<Extract<Wire, { type: 'hello' }>>(is('hello'));
  await link.send({ type: 'hello', manifest } satisfies Wire);
  const remote = (await helloP).manifest;
  const base = (await repo.kvGet<Record<string, string>>(baseKey(remote.deviceId))) ?? {};
  const items: Review['items'] = plan(manifest, remote, base);
  // Fetch what we may take, and both sides of anything changed on both.
  const want = items.filter((x) => x.there && (x.step === 'take' || x.step === 'check' || x.step === 'conflict')).map((x) => x.id);
  const there = new Map<string, Unit>();
  if (want.length) {
    const p = link.next<Extract<Wire, { type: 'units' }>>(is('units'), 300_000);
    await link.send({ type: 'get', ids: want } satisfies Wire);
    for (const u of (await p).units) there.set(u.id, u);
  }
  for (const x of items) {
    if (x.step !== 'check') continue;
    const a = units.find((u) => u.id === x.id);
    const b = there.get(x.id);
    const merged = a?.kind === 'story' && b?.kind === 'story' ? mergeStories(a, b) : undefined;
    if (!merged) {
      x.step = 'conflict';
      continue;
    }
    // One side only added messages: the longer one goes to both.
    const h = await hashUnit(merged);
    x.merged = merged;
    x.step = h === x.here?.hash ? 'give' : 'take';
    x.why = 'new messages on one device only';
  }
  return { peer: remote.deviceName, items, here: units, there, remote };
}

/** A copy of a unit with new ids, so both versions can be kept. */
export function copyOf(u: Unit, from: string): Unit {
  if (u.kind === 'book') return { ...u, id: uid(), book: { ...u.book, id: uid(), name: `${u.book.name} (${from})` } };
  const chatId = uid();
  const bookId = u.book ? uid() : undefined;
  const ids = new Map(u.messages.map((m) => [m.id, uid()]));
  const s: StoryUnit = {
    kind: 'story',
    id: chatId,
    chat: {
      ...u.chat,
      id: chatId,
      title: `${u.chat.title} (${from})`,
      codexId: bookId,
      summary: u.chat.summary?.map((p) => ({ ...p, id: uid(), messageIds: p.messageIds.map((x) => ids.get(x) ?? x) })),
      checkedUpTo: u.chat.checkedUpTo && ids.get(u.chat.checkedUpTo),
      proofChecked: undefined,
    },
    messages: u.messages.map((m) => ({ ...m, id: ids.get(m.id)!, chatId })),
    book: u.book && { ...u.book, id: bookId!, chatId },
    threads: u.threads.map((t) => ({ ...t, id: uid(), chatId })),
  };
  return s;
}

async function snapshot() {
  await repo.kvPut('syncSnapshot', { at: Date.now(), data: await repo.exportAll() });
}

/** Puts back everything as it was before the last sync on this device. */
export async function undoLastSync() {
  const snap = await repo.kvGet<{ at: number; data: BackupData }>('syncSnapshot');
  if (!snap) return false;
  await repo.restoreStories(snap.data);
  await repo.kvPut('syncSnapshot', undefined);
  await reload();
  return true;
}
export const lastSnapshotAt = async () => (await repo.kvGet<{ at: number }>('syncSnapshot'))?.at;

async function writeUnits(put: Unit[], del: { id: string; kind: Unit['kind'] }[]) {
  // Story numbers (#1, #2…) are per device: a story keeps its number here, a new one gets the next.
  const chats = await repo.all('chats');
  let top = Math.max(0, ...chats.map((c) => c.num ?? 0));
  for (const u of put) {
    if (u.kind === 'story') {
      const mine = chats.find((c) => c.id === u.id);
      await repo.replaceStory({ ...u, chat: { ...u.chat, num: mine?.num ?? ++top } });
    }
    else await repo.put('codex', u.book);
  }
  for (const d of del) {
    if (d.kind === 'story') await repo.deleteChat(d.id);
    else await repo.del('codex', d.id);
  }
}

async function reload() {
  const { currentChatId: cur, settingsOpen } = useStore.getState();
  await init(true);
  useStore.setState({ settingsOpen }); // a reload isn't a first run
  const chats = useStore.getState().chats;
  const pick = chats.find((c) => c.id === cur) ?? chats[0];
  if (pick) await selectChat(pick.id, true);
}

/** Host: carries out the plan on both devices. `only` limits it to one story. */
export async function hostApply(link: Link, r: Awaited<ReturnType<typeof hostReview>>, choices: Record<string, Choice>, only?: string): Promise<string> {
  const putHere: Unit[] = [];
  const delHere: { id: string; kind: Unit['kind'] }[] = [];
  const putThere: Unit[] = [];
  const delThere: { id: string; kind: Unit['kind'] }[] = [];
  const local = (id: string) => r.here.find((u) => u.id === id);
  for (const x of r.items) {
    if (only && x.id !== only) continue;
    const mine = local(x.id);
    const theirs = r.there.get(x.id);
    const step = x.step === 'conflict' ? choices[x.id] : x.step;
    if (!step) continue;
    if (x.merged) {
      // Merged from both: the same result goes to both devices.
      putHere.push(x.merged);
      putThere.push(x.merged);
    } else if (step === 'take' || (step === 'there' && theirs)) putHere.push(theirs!);
    else if (step === 'give' || (step === 'here' && mine)) putThere.push(mine!);
    else if (step === 'delete-here' || (step === 'there' && !theirs)) delHere.push({ id: x.id, kind: x.kind });
    else if (step === 'delete-there' || (step === 'here' && !mine)) delThere.push({ id: x.id, kind: x.kind });
    else if (step === 'both') {
      if (mine && theirs) {
        // This device's version keeps the id; the other's becomes a copy, on both devices.
        const copy = copyOf(theirs, `from ${r.peer.split(' ')[0].toLowerCase()}`);
        putHere.push(copy);
        putThere.push(mine, copy);
      } else if (theirs) putHere.push(theirs); // deleted here, changed there: keep it
      else if (mine) putThere.push(mine);
    }
  }
  const counts: Counts = { took: putHere.length, deleted: delHere.length, gave: putThere.length, removed: delThere.length };
  await snapshot();
  await writeUnits(putHere, delHere);
  const done = link.next(is('applied'), 300_000);
  await link.send({ type: 'apply', put: putThere, del: delThere, counts } satisfies Wire);
  await done;
  await finish(link, r.remote.deviceId);
  await reload();
  return describe(counts);
}

/** How many items each side took, from this device's point of view. */
export interface Counts { took: number; deleted: number; gave: number; removed: number }

function describe(c: Counts) {
  const n = (k: number) => `${k} stor${k === 1 ? 'y or book' : 'ies or books'}`;
  const parts = [
    c.took && `${n(c.took)} updated on this device`,
    c.deleted && `${c.deleted} deleted on this device`,
    c.gave && `${n(c.gave)} sent to the other device`,
    c.removed && `${c.removed} deleted on the other device`,
  ].filter(Boolean);
  return parts.length ? `Done: ${parts.join(', ')}.` : 'Nothing to change: both devices already match.';
}

/** Both sides: swap fresh lists and remember what now matches, as the base for next time. */
async function finish(link: Link, peer: string) {
  const { manifest } = await localManifest();
  const p = link.next<Extract<Wire, { type: 'final' }>>(is('final'));
  await link.send({ type: 'final', manifest } satisfies Wire);
  const remote = (await p).manifest;
  const base = (await repo.kvGet<Record<string, string>>(baseKey(peer))) ?? {};
  const theirs = new Map(remote.items.map((x) => [x.id, x.hash]));
  for (const x of manifest.items) if (theirs.get(x.id) === x.hash) base[x.id] = x.hash;
  for (const id of Object.keys(base)) if (!theirs.has(id) && !manifest.items.some((x) => x.id === id)) delete base[id];
  await repo.kvPut(baseKey(peer), base);
}

/** Guest: answers the host until the sync is done. Resolves with the summary. */
export async function guestServe(link: Link, onStatus: (s: string) => void, onPeer?: (id: string, name: string) => void): Promise<string> {
  const { units, manifest } = await localManifest();
  const hello = link.next<Extract<Wire, { type: 'hello' }>>(is('hello'));
  await link.send({ type: 'hello', manifest } satisfies Wire);
  const host = (await hello).manifest;
  onPeer?.(host.deviceId, host.deviceName);
  onStatus(`Connected to ${host.deviceName}. Review and apply the sync there.`);
  return new Promise((res, rej) => {
    link.onClose = () => rej(new Error('The other device closed the connection.'));
    link.listen((m) => ['get', 'apply', 'cancel'].includes((m as Wire).type), async (raw) => {
      const m = raw as Wire;
      try {
        if (m.type === 'get') await link.send({ type: 'units', units: units.filter((u) => m.ids.includes(u.id)) } satisfies Wire);
        else if (m.type === 'cancel') rej(new Error('Cancelled on the other device.'));
        else if (m.type === 'apply') {
          onStatus('Applying…');
          await snapshot();
          await writeUnits(m.put, m.del);
          await link.send({ type: 'applied' } satisfies Wire);
          await finish(link, host.deviceId);
          await reload();
          res(describe({ took: m.counts.gave, deleted: m.counts.removed, gave: m.counts.took, removed: m.counts.deleted }));
        }
      } catch (e) {
        rej(e as Error);
      }
    });
  });
}

export async function hostCancel(link: Link) {
  await link.send({ type: 'cancel' } satisfies Wire).catch(() => {});
}
