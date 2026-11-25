// "Extract from any file or text": the Helper model reads a document (a past story, notes, an odd
// lorebook export) in parts and proposes Codex entries. Mentions across parts merge into one entry,
// and anything already in the story's Codex comes back as an addition to that entry.
import { runJob, parseJson, type JobProgress } from '../ai/jobs';
import { newEntry, ownBook, upsertEntry } from '../store/codexStore';
import { create } from 'zustand';
import { useStore } from '../store/store';
import { unzip } from '../lib/zip';
import type { Chat, CodexEntry } from '../types';
import { sameName } from './lorebook';

export interface Found {
  entry: CodexEntry;
  category: string;
  /** The Codex entry this adds to, when the name matches one the story already has. */
  existing?: { bookId: string; entryId: string };
}

/** Plain text from a .txt/.md/.json/.html/.docx/.epub file. */
export async function readSource(f: File): Promise<string> {
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'docx' || ext === 'epub') {
    const files = await unzip(await f.arrayBuffer());
    const dec = new TextDecoder();
    if (ext === 'docx') {
      const xml = files.get('word/document.xml');
      if (!xml) throw new Error("Couldn't find the text in this .docx.");
      return paragraphs(new DOMParser().parseFromString(dec.decode(xml), 'application/xml'), 'w:p');
    }
    const pages = [...files].filter(([n]) => /\.x?html?$/i.test(n));
    return pages.map(([, b]) => htmlText(dec.decode(b))).filter(Boolean).join('\n\n');
  }
  const text = await f.text();
  if (ext === 'html' || ext === 'htm') return htmlText(text);
  if (ext === 'json') {
    try {
      return JSON.stringify(JSON.parse(text), null, 1); // line breaks give the chunker places to cut
    } catch {
      /* not valid JSON: read it as text */
    }
  }
  return text;
}

function paragraphs(doc: Document, tag: string) {
  return [...doc.getElementsByTagName(tag)].map((p) => p.textContent?.trim() ?? '').filter(Boolean).join('\n\n');
}

function htmlText(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,nav').forEach((x) => x.remove());
  const blocks = paragraphs(doc, 'p');
  return blocks.length > 200 ? blocks : (doc.body?.innerText || doc.body?.textContent || '').trim();
}

/** Splits text into parts of about `size` characters, at paragraph breaks where it can. */
export function chunkText(text: string, size = 12000): string[] {
  const out: string[] = [];
  let cur = '';
  for (const para of text.split(/\n\s*\n/)) {
    for (let p = para; p; ) {
      const piece = p.length > size ? p.slice(0, size) : p;
      p = p.slice(piece.length);
      if (cur && cur.length + piece.length + 2 > size) {
        out.push(cur);
        cur = '';
      }
      cur = cur ? `${cur}\n\n${piece}` : piece;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const PROMPT = `You build Codex entries (a lorebook) for a fiction co-writing tool from a document the writer gives you: a past story, notes, or a lorebook exported from another app. A Codex entry is sent to the story model whenever one of its trigger words appears in the recent story, so each entry should hold what a writer needs to keep someone or something consistent.

Read the part you're given and pull out the characters, places, groups, objects, and pieces of lore that matter. For each:
- name: the fullest proper name;
- category: one of character, place, group, thing, lore;
- keys: trigger words: the name, first or last name, nicknames, titles used for it. Never common words;
- text: facts stated in the document: who or what it is, appearance, personality, relationships, history, rules. Short clear sentences or lines. Never invent anything.

Skip passing mentions with nothing worth recording. If something is listed under "Already known", use its exact name and give only facts that aren't already covered; leave it out if there's nothing new.

Reply with only a JSON array: [{"name":"…","category":"…","keys":["…"],"text":"…"}]. Return [] if there's nothing to add.`;

/** Every entry the story can see: its own book and its shared books. */
export function storyEntries(chat: Chat) {
  const books = useStore.getState().codex.filter((b) => b.id === chat.codexId || chat.sharedCodexIds?.includes(b.id));
  return books.flatMap((b) => b.entries.map((e) => ({ bookId: b.id, e })));
}

const mergeText = (a: string, b: string) => (!b.trim() || a.includes(b.trim()) ? a : a ? `${a}\n${b.trim()}` : b.trim());
const mergeKeys = (a: string[], b: string[]) => [...a, ...b.filter((k) => !a.some((x) => x.toLowerCase() === k.toLowerCase()))];

/** Folds one part's results into what's been found so far. Exported for tests. */
export function foldFound(found: Found[], items: { name?: string; category?: string; keys?: unknown; text?: string }[], known: { bookId: string; e: CodexEntry }[]) {
  const out = [...found];
  for (const it of items) {
    const name = typeof it.name === 'string' ? it.name.trim() : '';
    const text = typeof it.text === 'string' ? it.text.trim() : '';
    if (!name || !text) continue;
    const keys = Array.isArray(it.keys) ? it.keys.filter((k): k is string => typeof k === 'string' && !!k.trim()).map((k) => k.trim()) : [];
    const i = out.findIndex((f) => sameName(f.entry.name, name));
    if (i >= 0) {
      const f = out[i];
      out[i] = { ...f, entry: { ...f.entry, keys: mergeKeys(f.entry.keys, keys), text: mergeText(f.entry.text, text) } };
      continue;
    }
    const k = known.find((x) => sameName(x.e.name, name));
    out.push({
      entry: newEntry({ name: k?.e.name ?? name, keys: k ? keys.filter((x) => !k.e.keys.some((y) => y.toLowerCase() === x.toLowerCase())) : mergeKeys([name], keys), text }),
      category: (it.category || 'lore').toLowerCase(),
      existing: k && { bookId: k.bookId, entryId: k.e.id },
    });
  }
  return out;
}

export interface ExtractProgress {
  part: number;
  parts: number;
  found: number;
  phase?: JobProgress['phase'];
}

/** Reads the text part by part with the Helper model. Calls onFound after each part with everything so far. */
export async function extractEntries(chatId: string, text: string, onFound: (f: Found[], p: ExtractProgress) => void, signal?: AbortSignal) {
  const parts = chunkText(text);
  let found: Found[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (signal?.aborted) break;
    const chat = useStore.getState().chats.find((c) => c.id === chatId);
    if (!chat) break;
    const known = storyEntries(chat);
    const names = [...known.map((x) => x.e.name), ...found.filter((f) => !f.existing).map((f) => f.entry.name)];
    const tell = (phase?: JobProgress['phase']) => onFound(found, { part: i + 1, parts: parts.length, found: found.length, phase });
    tell('sent');
    const res = await runJob({
      job: 'helper',
      chat,
      label: `Extracting Codex entries (part ${i + 1} of ${parts.length})`,
      maxTokens: 6000,
      temperature: 0.3,
      signal,
      onProgress: (p) => tell(p.phase),
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: `${names.length ? `Already known: ${names.join('; ')}\n\n` : ''}# Part ${i + 1} of ${parts.length}\n\n${parts[i]}` },
      ],
    });
    found = foldFound(found, parseJson<Found['entry'][]>(res.text) ?? [], known);
    tell();
  }
  return found;
}

/** Adds a found entry to the story's Codex, or its new facts and trigger words to the entry it matches. */
export async function addFound(chat: Chat, f: Found) {
  if (f.existing) {
    const book = useStore.getState().codex.find((b) => b.id === f.existing!.bookId);
    const e = book?.entries.find((x) => x.id === f.existing!.entryId);
    if (book && e) return upsertEntry(book.id, { ...e, keys: mergeKeys(e.keys, f.entry.keys), text: mergeText(e.text, f.entry.text) });
  }
  const book = await ownBook(chat);
  await upsertEntry(book.id, f.entry);
}

// ---------- The run, kept outside the panel so it carries on when the panel closes ----------

export interface ExtractRun {
  chatId: string;
  source: string;
  found: Found[];
  progress?: ExtractProgress;
  running: boolean;
  startedAt: number;
  /** Ids of found entries already added. */
  added: string[];
  note?: string;
}

export const useExtract = create<{ run?: ExtractRun }>()(() => ({}));
let stopper: AbortController | undefined;
const patch = (p: Partial<ExtractRun>) => useExtract.setState((s) => (s.run ? { run: { ...s.run, ...p } } : s));

export async function startExtract(chatId: string, source: string, text: string) {
  stopper?.abort();
  const mine = (stopper = new AbortController());
  useExtract.setState({ run: { chatId, source, found: [], running: true, startedAt: Date.now(), added: [] } });
  try {
    const found = await extractEntries(chatId, text, (f, p) => stopper === mine && patch({ found: f, progress: p }), mine.signal);
    if (stopper === mine) patch({ found, running: false, note: found.length ? undefined : 'Nothing worth a Codex entry was found.' });
  } catch (e) {
    if (stopper === mine) patch({ running: false, note: (e as Error).name === 'AbortError' ? 'Stopped. What was found so far is below.' : (e as Error).message });
  }
}

export const stopExtract = () => stopper?.abort();
export function closeExtract() {
  stopper?.abort();
  stopper = undefined;
  useExtract.setState({ run: undefined });
}

export async function addExtracted(ids: string[]) {
  const run = useExtract.getState().run;
  const chat = useStore.getState().chats.find((c) => c.id === run?.chatId);
  if (!run || !chat) return;
  for (const f of run.found.filter((x) => ids.includes(x.entry.id) && !run.added.includes(x.entry.id))) {
    await addFound(useStore.getState().chats.find((c) => c.id === chat.id) ?? chat, f);
    patch({ added: [...(useExtract.getState().run?.added ?? []), f.entry.id] });
  }
}
