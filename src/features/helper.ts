// Helpers: small built-in chats that change a story's setup for you. A Helper reads the story's
// setup and recent text, talks with you, and proposes changes as suggestion cards. It never
// writes story text and never changes anything without your Accept.
import { parseJson, runJob } from '../ai/jobs';
import { estimateTokens } from '../context/tokens';
import { repo } from '../db/db';
import { uid } from '../lib/id';
import { useStore } from '../store/store';
import { addSuggestions } from '../store/suggestions';
import type { HelperDef, HelperThread } from '../types';
import { BUILTIN_HELPERS, PROTOCOL } from './starters';
import { setupText, transcript } from './storyText';
import { toSuggestions, type Proposal } from './updates';

/** Built-in Helpers (or the person's edited copies) followed by their own. */
export function helpersList(): HelperDef[] {
  const mine = useStore.getState().settings.helpers ?? [];
  return [...BUILTIN_HELPERS.map((b) => mine.find((m) => m.id === b.id) ?? b), ...mine.filter((m) => !BUILTIN_HELPERS.some((b) => b.id === m.id))];
}

/** How much recent story a Helper sees, in tokens. */
const RECENT_BUDGET = 6000;

const CHANGES = /```changes\s*([\s\S]*?)(```|$)/i;

/** Splits a Helper reply into what it says and the changes it proposes. */
export function splitReply(text: string): { say: string; changes: Proposal[] } {
  const m = text.match(CHANGES);
  if (!m) return { say: text.trim(), changes: [] };
  const parsed = parseJson<Proposal[] | { changes?: Proposal[] }>(m[1]);
  const changes = Array.isArray(parsed) ? parsed : (parsed?.changes ?? []);
  return { say: text.replace(m[0], '').trim(), changes };
}

function threadFor(chatId: string, helperId: string): HelperThread {
  return useStore.getState().helperThreads.find((t) => t.chatId === chatId && t.helperId === helperId) ?? { id: uid(), chatId, helperId, messages: [], updatedAt: Date.now() };
}

async function saveThread(t: HelperThread) {
  const next = { ...t, updatedAt: Date.now() };
  useStore.setState({ helperThreads: [...useStore.getState().helperThreads.filter((x) => x.id !== t.id), next] });
  await repo.put('helperThreads', next);
}

export async function clearThread(chatId: string, helperId: string) {
  const t = threadFor(chatId, helperId);
  useStore.setState({ helperThreads: useStore.getState().helperThreads.filter((x) => x.id !== t.id) });
  await repo.del('helperThreads', t.id);
}

/** Sends a message to a Helper; the reply streams into the thread and its changes become cards. */
export async function askHelper(chatId: string, helperId: string, text: string, onText?: (t: string) => void) {
  const s = useStore.getState();
  const chat = s.chats.find((c) => c.id === chatId);
  const helper = helpersList().find((h) => h.id === helperId);
  if (!chat || !helper || !text.trim()) return;
  let thread = threadFor(chatId, helperId);
  thread = { ...thread, messages: [...thread.messages, { role: 'user', content: text.trim(), createdAt: Date.now() }] };
  await saveThread(thread);

  // Recent story, newest last, within budget.
  const msgs = chatId === s.currentChatId ? s.messages : await repo.messages(chatId);
  const recent: typeof msgs = [];
  let used = 0;
  for (const m of [...msgs].reverse()) {
    used += estimateTokens(m.swipes[m.activeSwipe]?.content ?? '');
    if (used > RECENT_BUDGET && recent.length) break;
    recent.unshift(m);
  }
  const others = s.chats.filter((c) => c.id !== chatId).slice(0, 30).map((c) => `#${c.num} ${c.title}`).join(', ');
  const context = `# This story: #${chat.num} "${chat.title}"\n${setupText(chat) || '(Nothing set up yet.)'}\n\n# Recent story\n${transcript(recent) || '(No story written yet.)'}${others ? `\n\n# Other stories\n${others}` : ''}`;

  const res = await runJob({
    job: 'helper',
    chat,
    label: `${helper.name} is thinking`,
    maxTokens: 3000,
    temperature: 0.6,
    onText,
    messages: [
      { role: 'system', content: `${helper.instructions}\n${PROTOCOL}\n\n${context}` },
      ...thread.messages.map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.content })),
    ],
  });
  const { say, changes } = splitReply(res.text);
  const fresh = useStore.getState().chats.find((c) => c.id === chatId) ?? chat;
  const cards = await addSuggestions(chatId, toSuggestions(fresh, changes, 'helper'));
  thread = threadFor(chatId, helperId);
  await saveThread({ ...thread, messages: [...thread.messages, { role: 'assistant', content: say || (cards.length ? 'Here are my suggestions.' : '…'), suggestionIds: cards.map((c) => c.id), createdAt: Date.now() }] });
}
