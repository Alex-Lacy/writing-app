// Helpers: small built-in chats that change a story's setup for you. A Helper reads the story's
// setup and recent text, talks with you, and proposes changes as suggestion cards. It never
// writes story text and never changes anything without your Accept.
import { parseJson, runJob } from '../ai/jobs';
import { estimateTokens } from '../context/tokens';
import { repo } from '../db/db';
import { uid } from '../lib/id';
import { useStore } from '../store/store';
import { addSuggestions, reject } from '../store/suggestions';
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

/** The thread from the open story, else from storage (the person may have switched story). */
async function threadFor(chatId: string, helperId: string): Promise<HelperThread> {
  const s = useStore.getState();
  const mine = (t: HelperThread) => t.helperId === helperId;
  const found = chatId === s.currentChatId ? s.helperThreads.find((t) => t.chatId === chatId && mine(t)) : (await repo.byChat('helperThreads', chatId)).find(mine);
  return found ?? { id: uid(), chatId, helperId, messages: [], updatedAt: Date.now() };
}

async function saveThread(t: HelperThread) {
  const next = { ...t, updatedAt: Date.now() };
  const s = useStore.getState();
  if (t.chatId === s.currentChatId) useStore.setState({ helperThreads: [...s.helperThreads.filter((x) => x.id !== t.id), next] });
  await repo.put('helperThreads', next);
}

let helperAbort: AbortController | undefined;
/** Set by Start over: the reply being stopped is thrown away, not kept. */
let discard = false;

export async function clearThread(chatId: string, helperId: string) {
  if (busyFor(chatId, helperId)) {
    discard = true;
    stopHelper();
  }
  const t = await threadFor(chatId, helperId);
  useStore.setState({ helperThreads: useStore.getState().helperThreads.filter((x) => x.id !== t.id) });
  await repo.del('helperThreads', t.id);
}

const setLive = (v: ReturnType<typeof useStore.getState>['helperLive']) => useStore.setState({ helperLive: v });
const busyFor = (chatId: string, helperId: string) => {
  const l = useStore.getState().helperLive;
  return !!l && !l.error && l.chatId === chatId && l.helperId === helperId;
};
/** Whether any Helper is replying right now. */
export const helperBusy = () => !!useStore.getState().helperLive && !useStore.getState().helperLive?.error;

/** Sends a message to a Helper; the reply runs in the background and its changes become cards. */
export async function askHelper(chatId: string, helperId: string, text: string) {
  if (!text.trim() || helperBusy()) return;
  const thread = await threadFor(chatId, helperId);
  await saveThread({ ...thread, messages: [...thread.messages, { role: 'user', content: text.trim(), createdAt: Date.now() }] });
  await reply(chatId, helperId);
}

/** Stops the Helper reply; what it wrote so far is kept. */
export function stopHelper() {
  helperAbort?.abort();
}

/** Asks again for the last reply (the old one and its open cards are dropped). */
export async function retryHelper(chatId: string, helperId: string) {
  if (helperBusy()) return;
  const t = await threadFor(chatId, helperId);
  const last = t.messages.at(-1);
  if (last?.role === 'assistant') await dropMessages(t, t.messages.length - 1, t.messages.length);
  await reply(chatId, helperId);
}

/** Deletes one message (an assistant one takes its open cards with it). */
export async function deleteHelperMessage(chatId: string, helperId: string, index: number) {
  if (busyFor(chatId, helperId)) return;
  await dropMessages(await threadFor(chatId, helperId), index, index + 1);
}

/** Removes a message of yours and everything after it, and gives back its text to edit and resend. */
export async function editHelperMessage(chatId: string, helperId: string, index: number): Promise<string> {
  if (busyFor(chatId, helperId)) return '';
  const t = await threadFor(chatId, helperId);
  const text = t.messages[index]?.content ?? '';
  await dropMessages(t, index, t.messages.length);
  return text;
}

async function dropMessages(t: HelperThread, from: number, to: number) {
  for (const m of t.messages.slice(from, to)) for (const id of m.suggestionIds ?? []) await reject(id);
  await saveThread({ ...t, messages: [...t.messages.slice(0, from), ...t.messages.slice(to)] });
}

async function reply(chatId: string, helperId: string) {
  const s = useStore.getState();
  const chat = s.chats.find((c) => c.id === chatId);
  const helper = helpersList().find((h) => h.id === helperId);
  const thread = await threadFor(chatId, helperId);
  if (!chat || !helper || thread.messages.at(-1)?.role !== 'user') return;

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

  helperAbort = new AbortController();
  discard = false;
  const startedAt = Date.now();
  let phase: 'queued' | 'sent' | 'busy' | 'thinking' | 'writing' = 'queued';
  let thought = 0;
  const show = (t: string) => setLive({ chatId, helperId, text: t, startedAt, phase, reasoning: thought });
  show('');
  let text = '';
  let lastPaint = 0;
  try {
    const res = await runJob({
      job: 'helper',
      chat,
      label: `${helper.name} is thinking`,
      maxTokens: 3000,
      temperature: 0.6,
      signal: helperAbort.signal,
      onText: (t) => {
        text = t;
        show(t);
      },
      onProgress: (p) => {
        if (p.phase === phase && p.phase !== 'thinking') return;
        phase = p.phase;
        thought = p.reasoning;
        // Thinking streams in tiny pieces; repaint a few times a second at most.
        if (p.phase !== 'thinking' || Date.now() - lastPaint > 400) {
          lastPaint = Date.now();
          show(text);
        }
      },
      messages: [
        { role: 'system', content: `${helper.instructions}\n${PROTOCOL}\n\n${context}` },
        ...thread.messages.map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.content })),
      ],
    });
    text = res.text;
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      setLive({ chatId, helperId, text: '', error: (e as Error).message });
      return;
    }
    if (!text.trim() || discard) return setLive(undefined); // stopped before it said anything, or Start over
  } finally {
    helperAbort = undefined;
  }
  const { say, changes } = splitReply(text);
  const fresh = useStore.getState().chats.find((c) => c.id === chatId) ?? chat;
  const cards = await addSuggestions(chatId, toSuggestions(fresh, changes, 'helper'));
  const t = await threadFor(chatId, helperId);
  await saveThread({ ...t, messages: [...t.messages, { role: 'assistant', content: say || (cards.length ? 'Here are my suggestions.' : '…'), suggestionIds: cards.map((c) => c.id), createdAt: Date.now() }] });
  const now = useStore.getState();
  const seen = now.panel === 'chat-settings' && now.panelTab === 'helper' && now.currentChatId === chatId && (now.helperId ?? helperId) === helperId;
  useStore.setState({ helperLive: undefined, helperDone: seen ? undefined : { chatId, helperId } });
}
