// Suggestion cards: every change the AI wants to make to a story (from the Helper, suggested
// updates, auto-summary, Proofread, rewrites, the Cliché Filter) goes through here, so the
// person always sees before and after and can accept, edit, reject, or undo.
import { repo } from '../db/db';
import { uid } from '../lib/id';
import type { Chat, CodexEntry, Message, Suggestion, SummaryPart } from '../types';
import { ownBook, putBook } from './codexStore';
import { saveSettings, updateChat, useStore } from './store';

const get = useStore.getState;
const set = useStore.setState;

/** Suggestion target for "the story's own Codex" before that book exists. */
export const OWN_BOOK = 'own';

async function save(x: Suggestion) {
  if (x.chatId === get().currentChatId) set({ suggestions: [...get().suggestions.filter((y) => y.id !== x.id), x] });
  await repo.put('suggestions', x);
}

export async function addSuggestions(chatId: string, items: Omit<Suggestion, 'id' | 'chatId' | 'status' | 'createdAt'>[]): Promise<Suggestion[]> {
  const out: Suggestion[] = [];
  for (const it of items) {
    const x: Suggestion = { ...it, id: uid(), chatId, status: 'pending', createdAt: Date.now() };
    await save(x);
    out.push(x);
  }
  return out;
}

const chatOf = (id: string) => get().chats.find((c) => c.id === id);

async function bookId(chat: Chat, id: string) {
  return id === OWN_BOOK ? (await ownBook(chat)).id : id;
}

/** Applies a suggestion. `edited` replaces the proposed text (the person's Edit). */
export async function accept(id: string, edited?: string) {
  const x = get().suggestions.find((s) => s.id === id) ?? (await repo.get('suggestions', id));
  const chat = x && chatOf(x.chatId);
  if (!x || !chat || x.status !== 'pending') return;
  const after = edited ?? x.after;
  const t = x.target;
  let undo: unknown;
  switch (t.kind) {
    case 'system':
      if ((chat.systemPrompt ?? '') !== (x.before ?? '')) return fail(x, 'the system prompt was changed after this was suggested.');
      undo = chat.systemPrompt;
      await updateChat({ systemPrompt: after, presetId: undefined }, chat.id);
      break;
    case 'title':
      undo = chat.title;
      await updateChat({ title: after }, chat.id);
      break;
    case 'background':
    case 'steering':
      if ((chat.writing[t.kind] ?? '') !== (x.before ?? '')) return fail(x, `the ${t.kind === 'background' ? 'Background' : 'Steering'} was changed after this was suggested.`);
      undo = chat.writing[t.kind];
      await updateChat({ writing: { ...chat.writing, enabled: true, [t.kind]: after } }, chat.id);
      break;
    case 'length':
      undo = chat.length;
      await updateChat({ length: t.value as Chat['length'] }, chat.id);
      break;
    case 'codex-add': {
      const bid = await bookId(chat, t.bookId);
      const b = get().codex.find((b) => b.id === bid)!;
      const entry: CodexEntry = { ...t.entry, text: after };
      await putBook({ ...b, entries: [...b.entries, entry] });
      undo = { bookId: bid, entryId: entry.id };
      break;
    }
    case 'codex-edit':
    case 'codex-remove': {
      const b = get().codex.find((b) => b.id === t.bookId);
      const old = b?.entries.find((e) => e.id === t.entryId);
      if (!b || !old) return fail(x, 'that Codex entry no longer exists.');
      // Only what the card is about (name, triggers, text); switches and priority set since stay.
      const entries = t.kind === 'codex-remove' ? b.entries.filter((e) => e.id !== t.entryId) : b.entries.map((e) => (e.id === t.entryId ? { ...e, name: t.entry.name, keys: t.entry.keys, text: after } : e));
      await putBook({ ...b, entries });
      undo = { bookId: b.id, entry: old, index: b.entries.indexOf(old) };
      break;
    }
    case 'summary': {
      const prev = chat.summary ?? [];
      const part: SummaryPart = { ...t.part, text: after };
      const replaced = new Set(t.replaces ?? []);
      const at = prev.findIndex((p) => replaced.has(p.id));
      const kept = prev.filter((p) => !replaced.has(p.id));
      const summary = at >= 0 ? [...kept.slice(0, at), part, ...kept.slice(at)] : [...kept, part];
      undo = { summary: prev, condensed: await setCondensed(chat.id, part.messageIds, true) };
      await updateChat({ summary }, chat.id);
      break;
    }
    case 'style-add': {
      const mod = { ...t.module, text: after };
      await saveSettings({ styles: [...(get().settings.styles ?? []), mod] });
      undo = chat.styleIds;
      await updateChat({ styleIds: [...(chat.styleIds ?? []), mod.id] }, chat.id);
      break;
    }
    case 'style-edit': {
      const styles = get().settings.styles ?? [];
      const old = styles.find((m) => m.id === t.styleId);
      if (!old) return fail(x, 'that Style module no longer exists.');
      undo = old.text;
      await saveSettings({ styles: styles.map((m) => (m.id === t.styleId ? { ...m, text: after } : m)) });
      break;
    }
    case 'style-toggle': {
      undo = chat.styleIds;
      const ids = (chat.styleIds ?? []).filter((x) => x !== t.styleId);
      await updateChat({ styleIds: t.on ? [...ids, t.styleId] : ids }, chat.id);
      break;
    }
    case 'passage': {
      const m = await findMessage(t.messageId);
      const content = m?.swipes[t.swipe]?.content;
      if (!m || content === undefined) return fail(x, 'that message no longer exists.');
      const from = content.slice(t.from, t.to) === x.before ? t.from : nearest(content, x.before, t.from);
      if (from < 0) return fail(x, 'that passage was edited after this was suggested.');
      await putPassage(m, t.swipe, from, x.before.length, after);
      await shiftCards(x, from + x.before.length, after.length - x.before.length);
      // Where the new text now sits, for Undo. (No copy of the whole message: auto fixes add up.)
      await save({ ...x, target: { ...t, from, to: from + after.length }, status: 'accepted', after, undo: from });
      return;
    }
  }
  await save({ ...x, status: 'accepted', after, undo });
}

export async function reject(id: string) {
  const x = get().suggestions.find((s) => s.id === id) ?? (await repo.get('suggestions', id));
  if (x && x.status === 'pending') await save({ ...x, status: 'rejected' });
}

/** Reverses an accepted suggestion. */
export async function undo(id: string) {
  const x = get().suggestions.find((s) => s.id === id);
  const chat = x && chatOf(x.chatId);
  if (!x || !chat || x.status !== 'accepted') return;
  const t = x.target;
  const u = x.undo as never;
  switch (t.kind) {
    case 'system':
      await updateChat({ systemPrompt: u }, chat.id);
      break;
    case 'title':
      await updateChat({ title: u }, chat.id);
      break;
    case 'background':
    case 'steering':
      await updateChat({ writing: { ...chat.writing, [t.kind]: u } }, chat.id);
      break;
    case 'length':
      await updateChat({ length: u }, chat.id);
      break;
    case 'codex-add': {
      const { bookId: bid, entryId } = u as { bookId: string; entryId: string };
      const b = get().codex.find((b) => b.id === bid);
      if (b) await putBook({ ...b, entries: b.entries.filter((e) => e.id !== entryId) });
      break;
    }
    case 'codex-edit':
    case 'codex-remove': {
      const { bookId: bid, entry, index } = u as { bookId: string; entry: CodexEntry; index: number };
      const b = get().codex.find((b) => b.id === bid);
      if (!b) break;
      const rest = b.entries.filter((e) => e.id !== entry.id);
      await putBook({ ...b, entries: [...rest.slice(0, index), entry, ...rest.slice(index)] });
      break;
    }
    case 'summary': {
      const { summary, condensed } = u as { summary: SummaryPart[]; condensed: string[] };
      await setCondensedIds(chat.id, condensed, false);
      await updateChat({ summary }, chat.id);
      break;
    }
    case 'style-add':
      await saveSettings({ styles: (get().settings.styles ?? []).filter((m) => m.id !== t.module.id) });
      await updateChat({ styleIds: u }, chat.id);
      break;
    case 'style-edit':
      await saveSettings({ styles: (get().settings.styles ?? []).map((m) => (m.id === t.styleId ? { ...m, text: u } : m)) });
      break;
    case 'style-toggle':
      await updateChat({ styleIds: u }, chat.id);
      break;
    case 'passage': {
      const m = await findMessage(t.messageId);
      const content = m?.swipes[t.swipe]?.content;
      if (!m || content === undefined) return;
      const from = content.slice(t.from, t.from + x.after.length) === x.after ? t.from : x.after ? nearest(content, x.after, t.from) : -1;
      if (from < 0) {
        set({ error: 'Couldn’t undo: that passage was edited since.' });
        return;
      }
      await putPassage(m, t.swipe, from, x.after.length, x.before);
      await shiftCards(x, from + x.after.length, x.before.length - x.after.length);
      await save({ ...x, target: { ...t, from, to: from + x.before.length }, status: 'pending', undo: undefined });
      return;
    }
  }
  await save({ ...x, status: 'pending', undo: undefined });
}

export async function acceptAll(chatId: string) {
  for (const x of get().suggestions.filter((s) => s.chatId === chatId && s.status === 'pending')) await accept(x.id);
}

/** Deletes handled cards beyond the newest 30, so storage doesn't grow with every reply. */
export async function tidy(chatId: string) {
  const all = chatId === get().currentChatId ? get().suggestions : await repo.byChat('suggestions', chatId);
  const gone = all.filter((s) => s.chatId === chatId && s.status !== 'pending').sort((a, b) => b.createdAt - a.createdAt).slice(30);
  if (!gone.length) return;
  for (const x of gone) await repo.del('suggestions', x.id);
  set({ suggestions: get().suggestions.filter((s) => !gone.some((g) => g.id === s.id)) });
}

async function fail(x: Suggestion, why: string) {
  await save({ ...x, status: 'rejected', failed: `Couldn’t apply: ${why}` });
}

// ---------- message helpers (the message may be in a chat that isn't open) ----------

/** The occurrence of `needle` closest to `pos`, or -1. */
export function nearest(text: string, needle: string, pos: number): number {
  if (!needle) return -1;
  let best = -1;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) if (best < 0 || Math.abs(i - pos) < Math.abs(best - pos)) best = i;
  return best;
}

async function putPassage(m: Message, swipe: number, from: number, len: number, text: string) {
  await putMessageAnywhere({ ...m, swipes: m.swipes.map((s, i) => (i === swipe ? { ...s, content: s.content.slice(0, from) + text + s.content.slice(from + len) } : s)) });
}

/** Moves the offsets of other cards for the same message text after an edit at `at`. */
async function shiftCards(x: Suggestion, at: number, delta: number) {
  if (!delta || x.target.kind !== 'passage') return;
  const t0 = x.target;
  const all = x.chatId === get().currentChatId ? get().suggestions : await repo.byChat('suggestions', x.chatId);
  for (const y of all) {
    const t = y.target;
    if (y.id === x.id || t.kind !== 'passage' || t.messageId !== t0.messageId || t.swipe !== t0.swipe || t.from < at) continue;
    await save({ ...y, target: { ...t, from: t.from + delta, to: t.to + delta } });
  }
}

async function findMessage(id: string): Promise<Message | undefined> {
  return get().messages.find((m) => m.id === id) ?? (await repo.get('messages', id));
}
async function putMessageAnywhere(m: Message) {
  set({ messages: get().messages.map((x) => (x.id === m.id ? m : x)) });
  await repo.put('messages', m);
}
/** Marks messages as covered by the summary; returns the ids it changed. */
async function setCondensed(chatId: string, ids: string[], on: boolean): Promise<string[]> {
  const msgs = chatId === get().currentChatId ? get().messages : await repo.messages(chatId);
  const changed = msgs.filter((m) => ids.includes(m.id) && !!m.condensed !== on).map((m) => m.id);
  await setCondensedIds(chatId, changed, on);
  return changed;
}
async function setCondensedIds(chatId: string, ids: string[], on: boolean) {
  const msgs = chatId === get().currentChatId ? get().messages : await repo.messages(chatId);
  for (const m of msgs.filter((m) => ids.includes(m.id))) await putMessageAnywhere({ ...m, condensed: on });
}
