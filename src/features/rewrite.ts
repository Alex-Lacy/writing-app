// Rewrite with feedback and Proofread, for a whole message or a highlighted passage. The model
// always sees the story around the passage (text before and after it, the setup, the Codex
// entries that come up there, and the summary of anything earlier), even when the passage is in
// a part of the story that has already been summarised: the original messages are still stored.
import { parseJson, runJob } from '../ai/jobs';
import { triggeredEntries } from '../context/codex';
import { countWords } from '../context/length';
import { repo } from '../db/db';
import { codexBooksFor, contextLimitFor, updateChat, useStore } from '../store/store';
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
      // The passage goes last, right before the instruction: with it in the middle (tested live),
      // small story models carried on writing the story that follows instead of revising it.
      { role: 'system', content: `You are revising one passage of an ongoing piece of fiction. You get the story before it, the story after it, the passage itself and an instruction. Rewrite ONLY the passage, following the instruction. The new version must cover the same moment as the passage: it starts where the passage starts and ends where it ends, so the text after it still follows on. Don't repeat or add events from the text before or after it. Keep the voice, tense, point of view, facts and formatting. Output only the new passage: no quotes around it, no comments, no notes.${a.notes ? `\n\n# Story notes\n${a.notes}` : ''}` },
      { role: 'user', content: `# Story before the passage\n${a.before || '(start of story)'}\n\n# Story after the passage\n${a.after.trim() || '(end of story so far)'}\n\n# THE PASSAGE TO REWRITE\n<passage>\n${a.passage.trim()}\n</passage>\n\n# Instruction\n${o.feedback}\n\nWrite the new version of the passage now.` },
    ],
  });
  const after = res.text.replace(/^\s*<\/?passage>|<\/?passage>\s*$/g, '').trim();
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
  // Always work on the newest copy of the message: other edits can land while the job waits.
  const slot = m0.swipes.length;
  const latest = async () => useStore.getState().messages.find((x) => x.id === messageId) ?? (await repo.get('messages', messageId));
  const write = async (change: (m: Message) => Message, persist: boolean) => {
    const cur = await latest();
    if (!cur) return;
    const next = change(cur);
    useStore.setState({ messages: useStore.getState().messages.map((x) => (x.id === next.id ? next : x)) });
    if (persist) await repo.put('messages', next);
  };
  const fresh = () => ({ content: '', createdAt: Date.now(), modelKey: activeSwipe(m0).modelKey });
  const setText = (m: Message, text: string) => {
    const swipes = m.swipes.length > slot ? m.swipes : [...m.swipes, fresh()];
    return { ...m, swipes: swipes.map((x, i) => (i === slot ? { ...x, content: text } : x)) };
  };
  // Saved straight away, so switching story while it runs doesn't lose the new version.
  await write((m) => ({ ...m, swipes: [...m.swipes, fresh()], activeSwipe: m.swipes.length }), true);
  try {
    const res = await runJob({
      job: 'rewrite',
      chat,
      label: 'Rewriting the message',
      maxTokens: Math.max(800, Math.round(countWords(content) * 2.2)),
      temperature: 0.8,
      onText: (t) => void write((m) => setText(m, t), false),
      messages: [
        { role: 'system', content: `${chat.systemPrompt}\n\nYou are revising one message of an ongoing story. Rewrite it following the instruction, keeping what the instruction doesn't ask to change. Cover the same events: don't carry on into what happens next. Output only the new message.${a.notes ? `\n\n# Story notes\n${a.notes}` : ''}` },
        { role: 'user', content: `# Story before this message\n${a.before || '(start of story)'}\n\n# Story after it\n${a.after.trim() || '(nothing yet)'}\n\n# THE MESSAGE TO REWRITE\n<message>\n${content}\n</message>\n\n# Instruction\n${feedback}\n\nWrite the new version of the message now.` },
      ],
    });
    await write((m) => setText(m, res.text), true);
  } catch (e) {
    // Leave the original showing if the rewrite failed.
    await write((m) => ({ ...m, swipes: m.swipes.filter((_, i) => i !== slot), activeSwipe: Math.min(m0.activeSwipe, m.swipes.length - 2) }), true);
    useStore.setState({ error: (e as Error).message });
    throw e;
  }
}

interface Issue { quote: string; problem: string; fix: string }

/** Proofread: consistency and facts against the setup, Codex and earlier story; spelling and grammar too on your own messages. */
export interface ProofreadOptions {
  /** The pre-publishing pass: spelling, grammar, punctuation and typos in every message too. */
  thorough?: boolean;
  signal?: AbortSignal;
  label?: string;
}

export async function proofread(chatId: string, messageId: string, range?: { from: number; to: number }, o: ProofreadOptions = {}): Promise<number> {
  const chat = useStore.getState().chats.find((c) => c.id === chatId);
  const m = (await messagesOf(chatId)).find((x) => x.id === messageId);
  if (!chat || !m) return 0;
  const content = activeSwipe(m).content;
  const from = range?.from ?? 0;
  const to = range?.to ?? content.length;
  const a = await storyAround(chat, messageId, from, to);
  const grammar = m.role === 'user' || o.thorough;
  const res = await runJob({
    job: 'proofread',
    chat,
    label: o.label ?? 'Proofreading',
    signal: o.signal,
    maxTokens: o.thorough ? 3000 : 2000,
    temperature: 0.2,
    messages: [
      { role: 'system', content: `You proofread a passage of fiction for consistency with the story's notes and the story so far: wrong names, contradicted facts, characters who aren't present or know things they shouldn't, wrong pronouns, timeline or location slips, objects that changed.${grammar ? ` Also fix spelling, grammar, punctuation and typos (doubled or missing words).${o.thorough ? ' This is the final check before publishing: be thorough, but leave deliberate style alone (dialect in dialogue, fragments, the author\'s punctuation habits).' : ''}` : ' Ignore style and taste; only report real errors.'}
Reply with JSON only: {"issues":[{"quote":"<exact text from the passage, short>","problem":"<one sentence>","fix":"<replacement for the quote>"}]}. The quote must be copied exactly from the passage. If there are no problems, reply {"issues":[]}.${a.notes ? `\n\n# Story notes\n${a.notes}` : ''}` },
      { role: 'user', content: `# Story before the passage\n${a.before || '(start of story)'}\n\n# PASSAGE TO CHECK\n${a.passage}\n\n# Story after the passage\n${a.after || '(end of story so far)'}` },
    ],
  });
  const issues = parseJson<{ issues?: Issue[] }>(res.text)?.issues ?? [];
  const cards: NewSuggestion[] = [];
  let cursor = from;
  for (const it of issues.slice(0, o.thorough ? 30 : 12)) {
    if (!it?.quote || typeof it.fix !== 'string' || it.fix === it.quote) continue;
    let at = content.indexOf(it.quote, cursor);
    if (at < 0 || at >= to) at = content.indexOf(it.quote, from);
    if (at < 0 || at >= to) continue;
    cursor = at + it.quote.length;
    cards.push({ source: 'proofread', target: { kind: 'passage', messageId, swipe: m.activeSwipe, from: at, to: at + it.quote.length }, before: it.quote, after: it.fix, reason: it.problem });
  }
  return (await addSuggestions(chatId, cards)).length;
}

// ---------- Whole story, before publishing ----------

/** Longest stretch sent in one request; longer messages are split at paragraph breaks. */
const PROOF_CHUNK_WORDS = 1200;

/** Splits a message into ranges of at most ~PROOF_CHUNK_WORDS, ending at paragraph breaks. */
export function proofChunks(text: string, maxWords = PROOF_CHUNK_WORDS): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let from = 0;
  let words = 0;
  const re = /\n\s*\n/g;
  let last = 0;
  for (let m = re.exec(text); ; m = re.exec(text)) {
    const end = m ? m.index : text.length;
    words += countWords(text.slice(last, end));
    if (words >= maxWords || !m) {
      if (text.slice(from, end).trim()) out.push({ from, to: end });
      from = m ? m.index + m[0].length : text.length;
      words = 0;
    }
    if (!m) break;
    last = m.index + m[0].length;
  }
  return out;
}

/** A short fingerprint of a message's text, so unchanged messages are skipped on the next run. */
export function textHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

export interface StoryProof {
  chatId: string;
  done: number;
  total: number;
  cards: number;
  startedAt: number;
  running: boolean;
  note?: string;
}

let proofAbort: AbortController | undefined;
export const stopStoryProofread = () => proofAbort?.abort();

/**
 * Proofreads every message (or only the AI's), a message or ~1,200 words at a time, as cards.
 * Messages checked before and unchanged since are skipped, so a stopped run picks up where it was.
 */
export async function proofreadStory(chatId: string, include: 'story' | 'all', fromStart = false) {
  const s = useStore.getState();
  const chat = s.chats.find((c) => c.id === chatId);
  if (!chat || s.storyProof?.running) return;
  const checked = fromStart ? {} : { ...(chat.proofChecked ?? {}) };
  const msgs = (await messagesOf(chatId)).filter((m) => m.role !== 'system' && (include === 'all' || m.role === 'assistant') && activeSwipe(m).content.trim());
  const todo = msgs.filter((m) => checked[m.id] !== textHash(activeSwipe(m).content));
  const total = todo.length;
  const show = (p: Partial<StoryProof>) => {
    const cur = useStore.getState().storyProof;
    useStore.setState({ storyProof: { chatId, done: 0, total, cards: 0, startedAt: Date.now(), running: true, ...cur, ...p } as StoryProof });
  };
  useStore.setState({ storyProof: undefined });
  show({ startedAt: Date.now() });
  proofAbort = new AbortController();
  let cards = 0;
  let done = 0;
  try {
    for (const m of todo) {
      const text = activeSwipe(m).content;
      for (const r of proofChunks(text)) {
        if (proofAbort.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        cards += await proofread(chatId, m.id, r, { thorough: true, signal: proofAbort.signal, label: `Proofreading the story (${done + 1} of ${total})` });
        show({ cards });
      }
      checked[m.id] = textHash(text);
      done++;
      show({ done });
      // Saved as it goes, so closing the app or stopping keeps the progress.
      await updateChat({ proofChecked: checked }, chatId);
    }
    show({ running: false, note: total ? undefined : 'Every message was already checked and hasn\'t changed since.' });
  } catch (e) {
    show({ running: false, note: (e as Error).name === 'AbortError' ? 'Stopped. Run it again to carry on from here.' : (e as Error).message });
  } finally {
    proofAbort = undefined;
  }
}
