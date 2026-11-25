// Codex books: every story has its own (created on first use, deleted with the chat); shared
// books live in the Library and can be attached to many chats.
import { repo } from '../db/db';
import { uid } from '../lib/id';
import type { Chat, CodexBook, CodexEntry } from '../types';
import { updateChat, useStore } from './store';

const get = useStore.getState;
const set = useStore.setState;

export async function putBook(b: CodexBook) {
  const book = { ...b, updatedAt: Date.now() };
  set({ codex: [...get().codex.filter((x) => x.id !== b.id), book] });
  await repo.put('codex', book);
  return book;
}

/** The chat's own book, made on first use. */
export async function ownBook(chat: Chat): Promise<CodexBook> {
  const existing = get().codex.find((b) => b.id === chat.codexId);
  if (existing) return existing;
  const book: CodexBook = { id: uid(), name: `${chat.title} (story)`, chatId: chat.id, entries: [], createdAt: Date.now(), updatedAt: Date.now() };
  await putBook(book);
  await updateChat({ codexId: book.id }, chat.id);
  return book;
}

export function newEntry(partial: Partial<CodexEntry> = {}): CodexEntry {
  return { id: uid(), name: partial.name ?? 'New entry', keys: partial.keys ?? [], text: partial.text ?? '', enabled: partial.enabled ?? true, alwaysOn: partial.alwaysOn, priority: partial.priority };
}

export async function upsertEntry(bookId: string, entry: CodexEntry) {
  const b = get().codex.find((x) => x.id === bookId);
  if (!b) return;
  const entries = b.entries.some((e) => e.id === entry.id) ? b.entries.map((e) => (e.id === entry.id ? entry : e)) : [...b.entries, entry];
  await putBook({ ...b, entries });
}

export async function removeEntry(bookId: string, entryId: string) {
  const b = get().codex.find((x) => x.id === bookId);
  if (b) await putBook({ ...b, entries: b.entries.filter((e) => e.id !== entryId) });
}

/** Library: a new shared book. */
export async function newSharedBook(name: string, series?: string) {
  return putBook({ id: uid(), name, series, entries: [], createdAt: Date.now(), updatedAt: Date.now() });
}

/** "Make reusable": copies the story's own entries into a new shared book attached to this chat, and empties the story's book. */
export async function makeReusable(chat: Chat, name: string, series?: string) {
  const own = get().codex.find((b) => b.id === chat.codexId);
  const shared = await putBook({ id: uid(), name, series, entries: own ? structuredClone(own.entries) : [], createdAt: Date.now(), updatedAt: Date.now() });
  if (own) await putBook({ ...own, entries: [] });
  await updateChat({ sharedCodexIds: [...(chat.sharedCodexIds ?? []), shared.id] }, chat.id);
  return shared;
}

export async function deleteSharedBook(id: string) {
  set({ codex: get().codex.filter((b) => b.id !== id) });
  await repo.del('codex', id);
  for (const c of get().chats.filter((c) => c.sharedCodexIds?.includes(id))) await updateChat({ sharedCodexIds: c.sharedCodexIds!.filter((x) => x !== id) }, c.id);
}

export async function setAttached(chat: Chat, bookId: string, on: boolean) {
  const ids = (chat.sharedCodexIds ?? []).filter((x) => x !== bookId);
  await updateChat({ sharedCodexIds: on ? [...ids, bookId] : ids }, chat.id);
}
