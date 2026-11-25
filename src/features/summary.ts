// Auto-summary. When the story nears the context limit, the oldest stretch that is still sent in
// full gets its own short summary, written from the original text. Parts stack like chapter
// recaps; only when the parts themselves fill their budget are the oldest merged into one
// "Earlier story" recap. Original messages are never deleted, only left out of the context.
import { runJob } from '../ai/jobs';
import { countWords } from '../context/length';
import { estimateTokens } from '../context/tokens';
import { repo } from '../db/db';
import { uid } from '../lib/id';
import { buildFor, contextLimitFor, replyHooks, updateChat, useStore } from '../store/store';
import { accept, addSuggestions } from '../store/suggestions';
import type { Chat, Message, SummaryPart } from '../types';
import { msgText, setupText, transcript } from './storyText';

/** Summarise when the prompt uses this share of the room it has. */
export const SUMMARY_TRIGGER = 0.85;
/** Summary parts may use this share of the context window before the oldest are merged. */
export const SUMMARY_SHARE = 0.2;
const STRETCH_MIN = 3000;
const STRETCH_MAX = 5000;
/** Never summarise the newest messages. */
const KEEP_RECENT = 6;

const SYSTEM = `You write recaps of a story for the author's notes. Write in past tense, third person, as plain prose.
Cover who did what, where, what changed, and threads left open. Keep names exact. No commentary, no headings, no quotes from the text unless a line matters later.`;

async function messagesOf(chatId: string): Promise<Message[]> {
  const s = useStore.getState();
  return chatId === s.currentChatId ? s.messages : repo.messages(chatId);
}

/** The oldest stretch of messages not yet covered by a summary, ending at a reply where possible. */
export function nextStretch(msgs: Message[]): Message[] {
  const open = msgs.filter((m) => !m.condensed && msgText(m));
  const candidates = open.slice(0, Math.max(0, open.length - KEEP_RECENT));
  const out: Message[] = [];
  let words = 0;
  for (const m of candidates) {
    out.push(m);
    words += countWords(msgText(m));
    if (words >= STRETCH_MIN && m.role === 'assistant') break;
    if (words >= STRETCH_MAX) break;
  }
  return words >= 300 ? out : [];
}

/** Whether this chat is close enough to its context limit to need a summary. */
export function needsSummary(chat: Chat, msgs: Message[]): boolean {
  const ctx = buildFor(chat, msgs);
  return ctx.droppedIds.length > 0 || ctx.tokens.total > ctx.tokens.budget * SUMMARY_TRIGGER;
}

async function writePart(chat: Chat, stretch: Message[]): Promise<SummaryPart> {
  const words = countWords(stretch.map(msgText).join(' '));
  const target = Math.min(350, Math.max(120, Math.round(words / 12)));
  const res = await runJob({
    job: 'summary',
    chat,
    label: 'Summarising older story',
    maxTokens: 900,
    temperature: 0.3,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `# Notes for context (do not summarise these)\n${setupText(chat, { codex: 'names' }) || '(none)'}\n\n# Story stretch to summarise\n${transcript(stretch)}\n\nSummarise only the stretch above in about ${target} words.` },
    ],
  });
  return { id: uid(), messageIds: stretch.map((m) => m.id), text: res.text, createdAt: Date.now() };
}

/** Summarises the next stretch. Returns true when it made a summary, otherwise why not. */
export async function summariseNext(chatId: string, opts: { force?: boolean } = {}): Promise<true | string> {
  let chat = useStore.getState().chats.find((c) => c.id === chatId);
  if (!chat) return 'No story.';
  // Saved cards, not just the open chat's: the person may have switched chats meanwhile.
  const cards = await repo.byChat('suggestions', chatId);
  // One summary card waiting for review is enough.
  if (cards.some((x) => x.status === 'pending' && x.target.kind === 'summary')) return 'A summary is waiting for your review in Suggestions.';
  const msgs = await messagesOf(chatId);
  if (!opts.force && !needsSummary(chat, msgs)) return 'Not needed yet.';
  const stretch = nextStretch(msgs);
  if (!stretch.length) return 'Not enough older story to summarise yet (the newest messages are always kept in full).';
  // A summary of this same stretch was rejected: don't keep offering it after every reply.
  if (!opts.force && cards.some((x) => x.status === 'rejected' && x.target.kind === 'summary' && !x.target.replaces && x.target.part.messageIds[0] === stretch[0].id)) return 'Rejected before.';
  // (Lasting details already went to the Codex through suggested updates when this text was new.)
  chat = useStore.getState().chats.find((c) => c.id === chatId) ?? chat;
  const part = await writePart(chat, stretch);
  if (!part.text) return 'The model returned an empty summary.';
  const first = !chat.summary?.length;
  const [card] = await addSuggestions(chatId, [{ source: 'summary', target: { kind: 'summary', part }, before: '', after: part.text, reason: `Covers ${stretch.length} older messages (about ${countWords(stretch.map(msgText).join(' ')).toLocaleString()} words).` }]);
  // The first summary in a chat is reviewed; later ones apply quietly unless "always ask" is on.
  if (!first && !chat.summaryAlwaysAsk) await accept(card.id);
  else return true;
  await mergeIfFull(chatId);
  return true;
}

/** Merges the oldest parts into one "Earlier story" recap when the parts use too much room. */
export async function mergeIfFull(chatId: string) {
  const chat = useStore.getState().chats.find((c) => c.id === chatId);
  const parts = chat?.summary ?? [];
  if (!chat || parts.length < 3) return;
  const used = estimateTokens(parts.map((p) => p.text).join('\n\n'));
  if (used <= contextLimitFor(chat) * SUMMARY_SHARE) return;
  const old = parts.slice(0, parts.length - 2);
  const res = await runJob({
    job: 'summary',
    chat,
    label: 'Merging older summaries',
    maxTokens: 1200,
    temperature: 0.3,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Merge these consecutive recaps into one recap of about 400 words. Keep every name and every fact that could matter later; drop moment-to-moment detail.\n\n${old.map((p, i) => `## Part ${i + 1}\n${p.text}`).join('\n\n')}` },
    ],
  });
  if (!res.text) return;
  const part: SummaryPart = { id: uid(), messageIds: old.flatMap((p) => p.messageIds), text: res.text, merged: true, createdAt: Date.now() };
  const [card] = await addSuggestions(chatId, [{ source: 'summary', target: { kind: 'summary', part, replaces: old.map((p) => p.id) }, before: old.map((p) => p.text).join('\n\n'), after: part.text, reason: `Merged ${old.length} older summary parts to save room.` }]);
  await accept(card.id);
}

/** Rewrites a stale part from its (edited) original messages, as a card. */
export async function refreshPart(chatId: string, partId: string) {
  const chat = useStore.getState().chats.find((c) => c.id === chatId);
  const part = chat?.summary?.find((p) => p.id === partId);
  if (!chat || !part) return;
  const msgs = (await messagesOf(chatId)).filter((m) => part.messageIds.includes(m.id));
  if (!msgs.length) return;
  const fresh = await writePart(chat, msgs);
  await addSuggestions(chatId, [{ source: 'summary', target: { kind: 'summary', part: { ...fresh, merged: part.merged }, replaces: [part.id] }, before: part.text, after: fresh.text, reason: 'A message in this part was edited.' }]);
}

/** Puts a part's messages back into the context and drops the part. */
export async function unsummarise(chatId: string, partId: string) {
  const chat = useStore.getState().chats.find((c) => c.id === chatId);
  const part = chat?.summary?.find((p) => p.id === partId);
  if (!chat || !part) return;
  const s = useStore.getState();
  for (const m of await messagesOf(chatId)) {
    if (!part.messageIds.includes(m.id) || !m.condensed) continue;
    const next = { ...m, condensed: false };
    await repo.put('messages', next);
    if (chatId === s.currentChatId) useStore.setState({ messages: useStore.getState().messages.map((x) => (x.id === m.id ? next : x)) });
  }
  await updateChat({ summary: chat.summary!.filter((p) => p.id !== partId) }, chatId);
}

export async function editPart(chatId: string, partId: string, text: string) {
  const chat = useStore.getState().chats.find((c) => c.id === chatId);
  if (chat?.summary) await updateChat({ summary: chat.summary.map((p) => (p.id === partId ? { ...p, text, stale: false } : p)) }, chatId);
}

replyHooks.push(async ({ chatId }) => {
  const chat = useStore.getState().chats.find((c) => c.id === chatId);
  if (!chat || chat.autoSummary === false) return;
  // A long story can need a few parts at once; stop after three.
  for (let i = 0; i < 3; i++) if ((await summariseNext(chatId)) !== true) break;
});
