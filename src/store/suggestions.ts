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
      undo = chat.systemPrompt;
      await updateChat({ systemPrompt: after, presetId: undefined }, chat.id);
      break;
    case 'title':
      undo = chat.title;
      await updateChat({ title: after }, chat.id);
      break;
    case 'background':
    case 'steering':
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
      if (!b || !old) return reject(id);
      const entries = t.kind === 'codex-remove' ? b.entries.filter((e) => e.id !== t.entryId) : b.entries.map((e) => (e.id === t.entryId ? { ...t.entry, id: e.id, text: after } : e));
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
      if (!old) return reject(id);
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
      if (!m) return reject(id);
      const sw = m.swipes[t.swipe];
      const content = sw?.content ?? '';
      let from = t.from;
      if (content.slice(t.from, t.to) !== x.before) from = content.indexOf(x.before);
      if (from < 0) return reject(id);
      undo = content;
      await putMessageAnywhere({ ...m, swipes: m.swipes.map((s, i) => (i === t.swipe ? { ...s, content: content.slice(0, from) + after + content.slice(from + x.before.length) } : s)) });
      break;
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
      // Put back just this passage, so undoing one fix keeps later ones; the full snapshot is the fallback.
      if (m) await putMessageAnywhere({ ...m, swipes: m.swipes.map((s, i) => {
        if (i !== t.swipe) return s;
        const at = s.content.indexOf(x.after);
        return { ...s, content: at < 0 ? u : s.content.slice(0, at) + x.before + s.content.slice(at + x.after.length) };
      }) });
      break;
    }
  }
  await save({ ...x, status: 'pending', undo: undefined });
}

export async function acceptAll(chatId: string) {
  for (const x of get().suggestions.filter((s) => s.chatId === chatId && s.status === 'pending')) await accept(x.id);
}

/** Clears handled cards older than the latest 30, so the list stays short. */
export async function tidy(chatId: string) {
  const done = get().suggestions.filter((s) => s.chatId === chatId && s.status !== 'pending').sort((a, b) => b.createdAt - a.createdAt);
  for (const x of done.slice(30)) await repo.del('suggestions', x.id);
  set({ suggestions: get().suggestions.filter((s) => !done.slice(30).includes(s)) });
}

// ---------- message helpers (the message may be in a chat that isn't open) ----------

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
