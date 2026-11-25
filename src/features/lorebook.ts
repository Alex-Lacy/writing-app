// Lorebook import: NovelAI .lorebook (or a .scenario's lorebook) and SillyTavern / character-card
// world info, read straight into the Codex with no AI involved. "Tidy" is a separate, optional
// pass that proposes clean-ups as ordinary suggestion cards.
import { runJob, parseJson } from '../ai/jobs';
import { putBook, newEntry, ownBook } from '../store/codexStore';
import { addSuggestions } from '../store/suggestions';
import { updateChat, useStore } from '../store/store';
import { uid } from '../lib/id';
import type { Chat, CodexBook, CodexEntry } from '../types';
import { toSuggestions, type Proposal } from './updates';

export interface ImportedEntry {
  entry: CodexEntry;
  /** NovelAI category (or SillyTavern group), shown in the preview only. */
  category: string;
  /** Switched off in the file (entry or its category). Unticked in the preview. */
  off: boolean;
}

export interface ParsedLorebook {
  format: 'NovelAI' | 'SillyTavern' | 'Character card' | 'Lorebook';
  entries: ImportedEntry[];
}

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []);

/** A file the direct importer can't read. The panel offers to extract entries from it instead. */
export class NotALorebook extends Error {}

/** Reads a lorebook file's JSON. Throws NotALorebook for anything it can't find entries in. */
export function parseLorebook(raw: string): ParsedLorebook {
  let j: Obj;
  try {
    j = JSON.parse(raw) as Obj;
  } catch {
    throw new NotALorebook("This file isn't JSON, so it can't be read as a lorebook. Image (.png) cards aren't supported.");
  }
  const found = known(j);
  if (found?.entries.some((x) => x.entry.text)) return found;
  const any = anyShape(j);
  if (any.length) return { format: 'Lorebook', entries: any };
  throw new NotALorebook("Couldn't find lorebook entries in this file.");
}

function known(root: Obj): ParsedLorebook | undefined {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return;
  let j = root;
  // A NovelAI scenario carries its lorebook inside.
  if (j.lorebook && typeof j.lorebook === 'object') j = j.lorebook as Obj;
  // A character card (V2/V3) carries a character_book.
  const card = ((j.data as Obj | undefined)?.character_book ?? j.character_book) as Obj | undefined;
  if (card) return { format: 'Character card', entries: fromCardBook(card) };
  if (Array.isArray(j.entries) && ('lorebookVersion' in j || j.entries.some((e) => (e as Obj)?.displayName !== undefined))) return { format: 'NovelAI', entries: fromNai(j) };
  if (Array.isArray(j.entries)) return { format: 'Character card', entries: fromCardBook(j) };
  if (j.entries && typeof j.entries === 'object') return { format: 'SillyTavern', entries: fromTavern(j.entries as Obj) };
}

const pick = (o: Obj, names: string[]) => names.map((n) => o[n]).find((v) => (typeof v === 'string' && v.trim()) || (Array.isArray(v) && v.length));
const TEXT = ['content', 'text', 'entry', 'description', 'value', 'body', 'prompt', 'info'];
const NAME = ['name', 'displayName', 'title', 'comment', 'label', 'key'];
const KEYS = ['keys', 'key', 'keywords', 'triggers', 'activationKeys', 'aliases', 'tags', 'secondary_keys'];
const asKeys = (v: unknown) => (typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : strs(v));

/** Any other lorebook-like JSON: the largest list (or map) of objects that carry some text. */
function anyShape(root: unknown): ImportedEntry[] {
  let best: Obj[] = [];
  const visit = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 5) return;
    const items = (Array.isArray(v) ? v : Object.values(v)).filter((x): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x));
    const withText = items.filter((x) => typeof pick(x, TEXT) === 'string');
    if (withText.length > best.length) best = withText;
    for (const x of Array.isArray(v) ? v : Object.values(v)) visit(x, depth + 1);
  };
  visit(root, 0);
  return best.map((e) => {
    const keys = asKeys(pick(e, KEYS));
    const name = pick(e, NAME);
    return {
      entry: newEntry({ name: (typeof name === 'string' ? name.trim() : '') || keys[0] || 'Untitled', keys, text: String(pick(e, TEXT)).trim(), alwaysOn: e.constant === true || e.alwaysOn === true || undefined }),
      category: str(e.category) || str(e.group) || 'Entries',
      off: e.enabled === false || e.disable === true || e.disabled === true,
    };
  });
}

function fromNai(j: Obj): ImportedEntry[] {
  const cats = new Map<string, { name: string; enabled: boolean }>();
  for (const c of (j.categories as Obj[] | undefined) ?? []) cats.set(str(c.id), { name: str(c.name) || 'Category', enabled: c.enabled !== false });
  return (j.entries as Obj[]).map((e) => {
    const cat = cats.get(str(e.category));
    const name = str(e.displayName).trim() || strs(e.keys)[0] || 'Untitled';
    const budget = Number((e.contextConfig as Obj | undefined)?.budgetPriority ?? 400);
    return {
      entry: newEntry({
        name,
        keys: strs(e.keys),
        text: str(e.text).trim(),
        alwaysOn: e.forceActivation === true || undefined,
        // NovelAI's default is 400; each 100 either way is one step here.
        priority: Number.isFinite(budget) && budget !== 400 ? Math.round((budget - 400) / 100) || undefined : undefined,
      }),
      category: cat?.name ?? 'No category',
      off: e.enabled === false || cat?.enabled === false,
    };
  });
}

function fromTavern(entries: Obj): ImportedEntry[] {
  return Object.values(entries).map((v) => {
    const e = v as Obj;
    const keys = strs(e.key);
    const name = str(e.comment).trim() || keys[0] || 'Untitled';
    return {
      entry: newEntry({ name, keys, text: str(e.content).trim(), alwaysOn: e.constant === true || undefined }),
      category: str(e.group).trim() || 'No group',
      off: e.disable === true,
    };
  });
}

function fromCardBook(book: Obj): ImportedEntry[] {
  return ((book.entries as Obj[] | undefined) ?? []).map((e) => {
    const keys = strs(e.keys);
    const name = str(e.name).trim() || str(e.comment).trim() || keys[0] || 'Untitled';
    return { entry: newEntry({ name, keys, text: str(e.content).trim(), alwaysOn: e.constant === true || undefined }), category: str(book.name) || 'Entries', off: e.enabled === false };
  });
}

export type DuplicateMode = 'skip' | 'replace' | 'both';

/** Same entry: same name, ignoring case and spacing. */
export const sameName = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');

/** Adds entries to a book. Returns how many were added, replaced and skipped. */
export function mergeEntries(book: CodexBook, incoming: CodexEntry[], mode: DuplicateMode) {
  let entries = [...book.entries];
  let added = 0, replaced = 0, skipped = 0;
  for (const e of incoming) {
    const i = entries.findIndex((x) => sameName(x.name, e.name));
    if (i < 0 || mode === 'both') {
      entries.push(e);
      added++;
    } else if (mode === 'replace') {
      entries = entries.map((x, k) => (k === i ? { ...e, id: x.id } : x));
      replaced++;
    } else skipped++;
  }
  return { book: { ...book, entries }, added, replaced, skipped };
}

/** Imports into the story's own Codex, or into a new shared book attached to the story. */
export async function importEntries(chat: Chat, incoming: CodexEntry[], to: 'story' | { newBook: string }, mode: DuplicateMode) {
  let book: CodexBook;
  if (to === 'story') book = await ownBook(chat);
  else book = { id: uid(), name: to.newBook, entries: [], createdAt: Date.now(), updatedAt: Date.now() };
  const r = mergeEntries(book, incoming, mode);
  await putBook(r.book);
  if (to !== 'story') {
    const c = useStore.getState().chats.find((x) => x.id === chat.id) ?? chat;
    await updateChat({ sharedCodexIds: [...(c.sharedCodexIds ?? []), book.id] }, chat.id);
  }
  return { ...r, bookId: book.id };
}

// ---------- Tidy ----------

const TIDY_BATCH = 8;

const TIDY_PROMPT = `You tidy Codex entries imported from another app (NovelAI or SillyTavern) for a fiction co-writing tool. A Codex entry is sent to the story model only when one of its trigger words appears in the recent story.

For each entry, decide if it needs work. Fix only real problems:
- leftover formatting from the other app (bracket blocks like [ Name: x; Attributes: y ], "----" separators, {{char}}/{{user}} macros, "Everyone:" style lists) rewritten as short, clear prose or tidy lines;
- trigger words that are too common to be useful (e.g. "the", "he", "man"), or missing obvious ones (the name, nicknames);
- text that contradicts itself or is cut off.
Keep every fact. Don't shorten good entries, don't add new facts, and leave entries that are fine alone.

Reply with only a JSON array of changes, using the entry's exact name:
[{"type":"codex-edit","entry":"<exact name>","text":"<full new text>","keys":["..."],"reason":"<a few words>"}]
Return [] if nothing needs changing.`;

/** Proposes clean-ups for entries, a few at a time, as suggestion cards. Calls onBatch after each batch. */
export async function tidyEntries(chatId: string, entries: CodexEntry[], onBatch?: (done: number, total: number, cards: number) => void, signal?: AbortSignal) {
  let cards = 0;
  for (let i = 0; i < entries.length; i += TIDY_BATCH) {
    if (signal?.aborted) break;
    const batch = entries.slice(i, i + TIDY_BATCH);
    const list = batch.map((e) => `## ${e.name}\nTrigger words: ${e.keys.join(', ') || '(none)'}\n${e.text}`).join('\n\n');
    const res = await runJob({
      job: 'updates', // the quick model: this is careful editing, not planning
      chat: useStore.getState().chats.find((c) => c.id === chatId),
      label: `Tidying imported entries (${Math.min(i + TIDY_BATCH, entries.length)} of ${entries.length})`,
      maxTokens: 3000,
      temperature: 0.3,
      signal,
      messages: [{ role: 'system', content: TIDY_PROMPT }, { role: 'user', content: list }],
    });
    const proposals = parseJson<Proposal[]>(res.text) ?? [];
    const chat = useStore.getState().chats.find((c) => c.id === chatId);
    if (chat) cards += (await addSuggestions(chatId, toSuggestions(chat, proposals.filter((p) => p.type === 'codex-edit'), 'helper'))).length;
    onBatch?.(Math.min(i + TIDY_BATCH, entries.length), entries.length, cards);
  }
  return cards;
}
