// Sync data: what gets compared and moved between two devices. A "unit" is a story (the chat,
// its messages, its own Codex book and Helper conversations) or a shared Codex book. Each side
// remembers, per other device, the fingerprint each unit had when they last agreed (the "base"),
// so a change on one side is told apart from changes on both (a real conflict).
import { normalizeChat, repo } from '../db/db';
import type { Chat, CodexBook, HelperDef, HelperThread, Message, StyleModule } from '../types';

export interface StoryUnit { kind: 'story'; id: string; chat: Chat; messages: Message[]; book?: CodexBook; threads: HelperThread[] }
export interface BookUnit { kind: 'book'; id: string; book: CodexBook }
/** A Library style module or custom Helper (kept in settings on each device). */
export interface StyleUnit { kind: 'style'; id: string; item: StyleModule }
export interface HelperUnit { kind: 'helper'; id: string; item: HelperDef }
export type Unit = StoryUnit | BookUnit | StyleUnit | HelperUnit;
/** Where each Library kind lives in settings. */
export const LIB_LIST = { style: 'styles', helper: 'helpers' } as const;

export interface ManifestItem { id: string; kind: Unit['kind']; title: string; hash: string; updatedAt: number; words?: number }
export interface Manifest { deviceId: string; deviceName: string; items: ManifestItem[]; /** Deleted here: id -> when. */ gone: Record<string, number> }

/** Per-device bookkeeping that shouldn't count as a change. */
const LOCAL_CHAT_FIELDS = ['updatedAt', 'proofChecked', 'wordsSinceCheck', 'checkedUpTo', 'num'] as const;

/** JSON with keys sorted, so the same data gives the same text on every device. */
export function stableStringify(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

export async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** The part of a unit that matters for sync, with device-only fields left out. */
export function syncView(u: Unit): unknown {
  const book = (b?: CodexBook) => b && { ...b, updatedAt: undefined };
  if (u.kind === 'book') return { kind: 'book', book: book(u.book) };
  if (u.kind === 'style' || u.kind === 'helper') return { kind: u.kind, item: u.item };
  const chat: Record<string, unknown> = { ...normalizeChat(structuredClone(u.chat)) };
  for (const k of LOCAL_CHAT_FIELDS) delete chat[k];
  return {
    kind: 'story',
    chat,
    messages: [...u.messages].sort((a, b) => a.order - b.order),
    book: book(u.book),
    threads: [...u.threads].sort((a, b) => a.id.localeCompare(b.id)).map((t) => ({ ...t, updatedAt: undefined })),
  };
}

export const hashUnit = (u: Unit) => sha(stableStringify(syncView(u)));

const wordsOf = (msgs: Message[]) => msgs.reduce((n, m) => n + (m.swipes[m.activeSwipe]?.content.match(/\S+/g)?.length ?? 0), 0);

/** Everything on this device that can sync. */
export async function loadUnits(): Promise<Unit[]> {
  const chats = await repo.all('chats');
  const books = await repo.all('codex');
  const out: Unit[] = [];
  for (const c of chats) {
    out.push({ kind: 'story', id: c.id, chat: c, messages: await repo.messages(c.id), book: books.find((b) => b.id === c.codexId), threads: await repo.byChat('helperThreads', c.id) });
  }
  for (const b of books) if (!b.chatId) out.push({ kind: 'book', id: b.id, book: b });
  const settings = await repo.getSettings();
  for (const m of settings?.styles ?? []) out.push({ kind: 'style', id: m.id, item: m });
  for (const h of settings?.helpers ?? []) out.push({ kind: 'helper', id: h.id, item: h });
  return out;
}

export async function manifestOf(units: Unit[], deviceId: string, deviceName: string, gone: Record<string, number>): Promise<Manifest> {
  const items = await Promise.all(
    units.map(async (u) => ({
      id: u.id,
      kind: u.kind,
      title: u.kind === 'story' ? `#${u.chat.num} ${u.chat.title}` : u.kind === 'book' ? `Codex: ${u.book.name}` : `${u.kind === 'style' ? 'Style module' : 'Helper'}: ${u.item.name}`,
      hash: await hashUnit(u),
      updatedAt: u.kind === 'story' ? u.chat.updatedAt : u.kind === 'book' ? u.book.updatedAt : 0,
      words: u.kind === 'story' ? wordsOf(u.messages) : undefined,
    })),
  );
  return { deviceId, deviceName, items, gone };
}

// ---------- Planning ----------

export type Step =
  /** Only the other device changed it (or only it has it): copy it here. */
  | 'take'
  /** Only this device changed it: copy it there. */
  | 'give'
  /** Deleted here since the last sync and unchanged there: delete it there too. */
  | 'delete-there'
  /** Deleted there and unchanged here: delete it here. */
  | 'delete-here'
  /** Changed on both: one side only added messages, so take the longer one (decided once both are fetched). */
  | 'check'
  | 'conflict';

export interface PlanItem { id: string; kind: Unit['kind']; title: string; step: Step; here?: ManifestItem; there?: ManifestItem; why: string }

/**
 * What to do with each unit. `base` is the fingerprint each unit had when these two devices last
 * agreed (empty the first time). Units that match are left out.
 */
export function plan(here: Manifest, there: Manifest, base: Record<string, string>): PlanItem[] {
  const out: PlanItem[] = [];
  const mine = new Map(here.items.map((x) => [x.id, x]));
  const theirs = new Map(there.items.map((x) => [x.id, x]));
  for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
    const h = mine.get(id);
    const t = theirs.get(id);
    const b = base[id];
    const title = (h ?? t)!.title;
    const kind = (h ?? t)!.kind;
    const item = (step: Step, why: string) => out.push({ id, kind, title, step, here: h, there: t, why });
    if (h && t) {
      if (h.hash === t.hash) continue;
      if (b === h.hash) item('take', 'changed on the other device');
      else if (b === t.hash) item('give', 'changed on this device');
      else item('check', b ? 'changed on both devices' : 'different on each device');
    } else if (t) {
      // Only there: new there, or deleted here since the last sync.
      if (here.gone[id] && b) item(b === t.hash ? 'delete-there' : 'conflict', b === t.hash ? 'deleted on this device' : 'deleted here but changed there');
      else if (!here.gone[id]) item('take', 'new on the other device');
    } else if (h) {
      if (there.gone[id] && b) item(b === h.hash ? 'delete-here' : 'conflict', b === h.hash ? 'deleted on the other device' : 'deleted there but changed here');
      else if (!there.gone[id]) item('give', 'new on this device');
    }
  }
  return out;
}

/**
 * Two versions of a story that both changed: if one only adds messages to the other (and nothing
 * else differs), the longer one wins with nothing lost. Otherwise undefined: a real conflict.
 */
export function mergeStories(a: StoryUnit, b: StoryUnit): StoryUnit | undefined {
  const sv = (u: StoryUnit) => syncView(u) as { chat: unknown; book: unknown; messages: Message[]; threads: HelperThread[] };
  const x = sv(a);
  const y = sv(b);
  if (stableStringify(x.chat) !== stableStringify(y.chat) || stableStringify(x.book) !== stableStringify(y.book)) return undefined;
  const [short, long] = x.messages.length <= y.messages.length ? [a, b] : [b, a];
  const longById = new Map(long.messages.map((m) => [m.id, stableStringify(m)]));
  if (!short.messages.every((m) => longById.get(m.id) === stableStringify(m))) return undefined;
  // Helper conversations: per conversation, the one with more messages (they only grow).
  const threads = new Map<string, HelperThread>();
  for (const t of [...short.threads, ...long.threads]) {
    const cur = threads.get(t.id);
    if (!cur || t.messages.length > cur.messages.length) threads.set(t.id, t);
  }
  return { ...long, chat: { ...long.chat, updatedAt: Math.max(a.chat.updatedAt, b.chat.updatedAt) }, threads: [...threads.values()] };
}

// ---------- Deletions ----------

/** Remembers a deletion, so the next sync removes it on the other device instead of bringing it back. */
export async function noteGone(id: string) {
  const gone = (await repo.kvGet<Record<string, number>>('syncGone')) ?? {};
  gone[id] = Date.now();
  // Old entries are dropped after 90 days.
  for (const [k, at] of Object.entries(gone)) if (Date.now() - at > 90 * 864e5) delete gone[k];
  await repo.kvPut('syncGone', gone);
}
