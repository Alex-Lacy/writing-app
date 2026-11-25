// Rewrite with feedback and Proofread, for a whole message or a highlighted passage. The model
// always sees the story around the passage (text before and after it, the setup, the Codex
// entries that come up there, and the summary of anything earlier), even when the passage is in
// a part of the story that has already been summarised: the original messages are still stored.
import { parseJson, runJob } from '../ai/jobs';
import { triggeredEntries } from '../context/codex';
import { countWords } from '../context/length';
import { repo } from '../db/db';
import { codexBooksFor, contextLimitFor, useStore } from '../store/store';
import { addSuggestions } from '../store/suggestions';
import { activeSwipe, type Chat, type Message, type Suggestion } from '../types';
import { setupText } from './storyText';

const BEFORE_WORDS = 1800;
const AFTER_WORDS = 500;

const label = (m: Message) => (m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Story' : 'Note');

function takeWords(text: string, n: number, fromEnd: boolean): string {
  const words = text.split(/(\s+)/);
  let count = 0;
  const out: string[] = [];
  const seq = fromEnd ? [...words].reverse() : words;
  for (const w of seq) {
    if (w.trim()) count++;
    if (count > n) break;
    out.push(w);
  }
  return (fromEnd ? out.reverse() : out).join('');
}

async function messagesOf(chatId: string) {
  const s = useStore.getState();
  return chatId === s.currentChatId ? s.messages : repo.messages(chatId);
}

/** The story around a passage, as one prompt block. */
export async function storyAround(chat: Chat, messageId: string, from: number, to: number) {
  const msgs = await messagesOf(chat.id);
  const idx = msgs.findIndex((m) => m.id === messageId);
  const msg = msgs[idx];
  const content = activeSwipe(msg).content;
  // Before: earlier messages (newest last) plus this message up to the passage.
  let before = content.slice(0, from);
  for (let i = idx - 1; i >= 0 && countWords(before) < BEFORE_WORDS; i--) before = `${label(msgs[i])}: ${activeSwipe(msgs[i]).content}\n\n${before}`;
  before = takeWords(before, BEFORE_WORDS, true);
  let after = content.slice(to);
  for (let i = idx + 1; i < msgs.length && countWords(after) < AFTER_WORDS; i++) after += `\n\n${label(msgs[i])}: ${activeSwipe(msgs[i]).content}`;
  after = takeWords(after, AFTER_WORDS, false);
  // Summary parts for story earlier than what we include in full.
  const firstShown = Math.max(0, idx - 30);
  const earlierIds = new Set(msgs.slice(0, firstShown).map((m) => m.id));
  const summary = (chat.summary ?? []).filter((p) => p.messageIds.some((id) => earlierIds.has(id))).map((p) => p.text).join('\n\n');
  const passage = content.slice(from, to);
  const { hits } = triggeredEntries(codexBooksFor(chat), `${before.slice(-3000)}\n${passage}`, Math.floor(contextLimitFor(chat) * 0.1));
  const codex = hits.map((h) => `- ${h.entry.name}: ${h.entry.text}`).join('\n');
  const notes = [setupText(chat, { codex: 'none', summary: false }), codex && `## Codex entries that come up here\n${codex}`, summary && `## Earlier story (summary)\n${summary}`].filter(Boolean).join('\n\n');
  return { msg, content, passage, before, after, notes };
}

type NewSuggestion = Omit<Suggestion, 'id' | 'chatId' | 'status' | 'createdAt'>;

/** Rewrites a passage (a highlighted part, or a whole message) and offers it as a card. */
export async function rewritePassage(o: { chatId: string; messageId: string; from: number; to: number; feedback: string; source?: 'rewrite' | 'filter'; reason?: string }) {
  const chat = useStore.getState().chats.find((c) => c.id === o.chatId);
  if (!chat) return;
  const a = await storyAround(chat, o.messageId, o.from, o.to);
  const res = await runJob({
    job: o.source === 'filter' ? 'filter' : 'rewrite',
    chat,
    label: o.source === 'filter' ? 'Rewriting a cliché' : 'Rewriting',
    maxTokens: Math.max(400, Math.round(countWords(a.passage) * 2.5)),
    temperature: 0.7,
    messages: [
      { role: 'system', content: `You are revising a passage of an ongoing piece of fiction. Rewrite ONLY the marked passage, following the instruction. Keep the same voice, tense, point of view, facts and formatting as the surrounding story, and make it flow into the text after it. Output only the new passage: no quotes around it, no comments, no notes.${a.notes ? `\n\n# Story notes\n${a.notes}` : ''}` },
      { role: 'user', content: `# Story before the passage\n${a.before || '(start of story)'}\n\n# PASSAGE TO REWRITE\n${a.passage}\n\n# Story after the passage\n${a.after || '(end of story so far)'}\n\n# Instruction\n${o.feedback}` },
    ],
  });
  const after = res.text.replace(/^["“]|["”]$/g, '').trim();
  if (!after || after === a.passage.trim()) return;
  const lead = a.passage.match(/^\s*/)![0];
  const trail = a.passage.match(/\s*$/)![0];
  const card: NewSuggestion = { source: o.source ?? 'rewrite', target: { kind: 'passage', messageId: o.messageId, swipe: a.msg.activeSwipe, from: o.from, to: o.to }, before: a.passage, after: lead + after + trail, reason: o.reason ?? o.feedback };
  return (await addSuggestions(o.chatId, [card]))[0];
}

/** Rewrites a whole message as a new version (swipe), streaming, so the original is one arrow away. */
export async function rewriteMessage(chatId: string, messageId: string, feedback: string) {
  const s = useStore.getState();
  const chat = s.chats.find((c) => c.id === chatId);
  const m0 = (await messagesOf(chatId)).find((m) => m.id === messageId);
  if (!chat || !m0) return;
  const content = activeSwipe(m0).content;
  const a = await storyAround(chat, messageId, 0, content.length);
  let m: Message = { ...m0, swipes: [...m0.swipes, { content: '', createdAt: Date.now(), modelKey: activeSwipe(m0).modelKey }], activeSwipe: m0.swipes.length };
  const put = (text: string) => {
    m = { ...m, swipes: m.swipes.map((x, i) => (i === m.activeSwipe ? { ...x, content: text } : x)) };
    useStore.setState({ messages: useStore.getState().messages.map((x) => (x.id === m.id ? m : x)) });
  };
  put('');
  try {
    const res = await runJob({
      job: 'rewrite',
      chat,
      label: 'Rewriting the message',
      maxTokens: Math.max(800, Math.round(countWords(content) * 2.2)),
      temperature: 0.8,
      onText: put,
      messages: [
        { role: 'system', content: `${chat.systemPrompt}\n\nYou are revising one message of an ongoing story. Rewrite it following the instruction, keeping what the instruction doesn't ask to change. Output only the new message.${a.notes ? `\n\n# Story notes\n${a.notes}` : ''}` },
        { role: 'user', content: `# Story before this message\n${a.before || '(start of story)'}\n\n# MESSAGE TO REWRITE\n${content}\n\n# Story after it\n${a.after || '(nothing yet)'}\n\n# Instruction\n${feedback}` },
      ],
    });
    put(res.text);
  } catch (e) {
    // Leave the original showing if the rewrite failed.
    m = { ...m, swipes: m.swipes.slice(0, -1), activeSwipe: m0.activeSwipe };
    useStore.setState({ messages: useStore.getState().messages.map((x) => (x.id === m.id ? m : x)), error: (e as Error).message });
    throw e;
  } finally {
    await repo.put('messages', m);
  }
}

interface Issue { quote: string; problem: string; fix: string }

/** Proofread: consistency and facts against the setup, Codex and earlier story; spelling and grammar too on your own messages. */
export async function proofread(chatId: string, messageId: string, range?: { from: number; to: number }): Promise<number> {
  const chat = useStore.getState().chats.find((c) => c.id === chatId);
  const m = (await messagesOf(chatId)).find((x) => x.id === messageId);
  if (!chat || !m) return 0;
  const content = activeSwipe(m).content;
  const from = range?.from ?? 0;
  const to = range?.to ?? content.length;
  const a = await storyAround(chat, messageId, from, to);
  const grammar = m.role === 'user';
  const res = await runJob({
    job: 'proofread',
    chat,
    label: 'Proofreading',
    maxTokens: 2000,
    temperature: 0.2,
    messages: [
      { role: 'system', content: `You proofread a passage of fiction for consistency with the story's notes and the story so far: wrong names, contradicted facts, characters who aren't present or know things they shouldn't, wrong pronouns, timeline or location slips, objects that changed.${grammar ? ' Also fix spelling, grammar and punctuation.' : ' Ignore style and taste; only report real errors.'}
Reply with JSON only: {"issues":[{"quote":"<exact text from the passage, short>","problem":"<one sentence>","fix":"<replacement for the quote>"}]}. The quote must be copied exactly from the passage. If there are no problems, reply {"issues":[]}.${a.notes ? `\n\n# Story notes\n${a.notes}` : ''}` },
      { role: 'user', content: `# Story before the passage\n${a.before || '(start of story)'}\n\n# PASSAGE TO CHECK\n${a.passage}\n\n# Story after the passage\n${a.after || '(end of story so far)'}` },
    ],
  });
  const issues = parseJson<{ issues?: Issue[] }>(res.text)?.issues ?? [];
  const cards: NewSuggestion[] = [];
  let cursor = from;
  for (const it of issues.slice(0, 12)) {
    if (!it?.quote || typeof it.fix !== 'string' || it.fix === it.quote) continue;
    let at = content.indexOf(it.quote, cursor);
    if (at < 0 || at >= to) at = content.indexOf(it.quote, from);
    if (at < 0 || at >= to) continue;
    cursor = at + it.quote.length;
    cards.push({ source: 'proofread', target: { kind: 'passage', messageId, swipe: m.activeSwipe, from: at, to: at + it.quote.length }, before: it.quote, after: it.fix, reason: it.problem });
  }
  return (await addSuggestions(chatId, cards)).length;
}
