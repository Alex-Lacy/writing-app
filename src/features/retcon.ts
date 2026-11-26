// Retcon: one note about a fact that changed ("Subaru is coming back from Pristella, by way of
// the Sanctuary"), checked against a stretch of the story. A model returns only the sentences that
// contradict it, each with the smallest fix; they come back as one group of edits to apply or ignore.
import { create } from 'zustand';
import { parseJson, runJob } from '../ai/jobs';
import { locate } from '../components/messageHooks';
import { uid } from '../lib/id';
import { useStore } from '../store/store';
import { accept, addSuggestions, reject, undo } from '../store/suggestions';
import { activeSwipe, type Message, type Suggestion } from '../types';

const CHUNK = 12000;

const PROMPT = `You keep a story consistent after the author changes a fact. You get the change (a retcon note) and numbered messages from the story. Find every sentence that contradicts the note, and rewrite each one as little as possible so it fits: keep the voice, tense, wording and everything the note doesn't touch. Don't change sentences that already fit, and don't add new events. Quote each sentence exactly as it appears.
If the story's notes (Background) should also change to match, give that one line as "background", else leave it empty.
Reply with JSON only: {"edits":[{"m":<message number>,"quote":"<the exact sentence>","text":"<the rewritten sentence>"}],"background":""}`;

interface RetconState {
  running: boolean;
  chatId?: string;
  note?: string;
  group?: string;
  done: number;
  total: number;
  error?: string;
  stopper?: AbortController;
}
export const useRetcon = create<RetconState>(() => ({ running: false, done: 0, total: 0 }));

/** The story messages a retcon looks at: from `fromId` to the end, or the last `count`. */
export function retconScope(messages: Message[], o: { fromId?: string; count?: number }): Message[] {
  const story = messages.filter((m) => m.role !== 'system' && activeSwipe(m).content.trim());
  if (o.fromId) {
    const i = story.findIndex((m) => m.id === o.fromId);
    return i < 0 ? story : story.slice(i);
  }
  return o.count ? story.slice(-o.count) : story;
}

/** Groups messages into requests of about CHUNK characters, numbered across the whole scope. */
export function chunkMessages(ms: Message[]): { n: number; m: Message }[][] {
  const out: { n: number; m: Message }[][] = [];
  let cur: { n: number; m: Message }[] = [];
  let size = 0;
  ms.forEach((m, i) => {
    const len = activeSwipe(m).content.length;
    if (cur.length && size + len > CHUNK) { out.push(cur); cur = []; size = 0; }
    cur.push({ n: i + 1, m });
    size += len;
  });
  if (cur.length) out.push(cur);
  return out;
}

/** Where a quoted sentence sits in a message: exactly, else allowing for Markdown marks. */
export function findQuote(content: string, quote: string): { from: number; to: number } | undefined {
  const q = quote.trim();
  if (!q) return;
  const at = content.indexOf(q);
  if (at >= 0) return { from: at, to: at + q.length };
  return locate(content, q);
}

export async function startRetcon(chatId: string, note: string, scope: { fromId?: string; count?: number }) {
  const s = useStore.getState();
  const chat = s.chats.find((c) => c.id === chatId);
  if (!chat || !note.trim() || useRetcon.getState().running) return;
  const ms = retconScope(chatId === s.currentChatId ? s.messages : [], scope);
  const chunks = chunkMessages(ms);
  const group = uid();
  const stopper = new AbortController();
  useRetcon.setState({ running: true, chatId, note, group, done: 0, total: chunks.length, error: undefined, stopper });
  let background = '';
  try {
    for (const [ci, part] of chunks.entries()) {
      const text = part.map(({ n, m }) => `## Message ${n}\n${activeSwipe(m).content}`).join('\n\n');
      const res = await runJob({
        job: 'retcon',
        chat,
        label: chunks.length > 1 ? `Retcon (${ci + 1} of ${chunks.length})` : 'Retcon',
        signal: stopper.signal,
        maxTokens: 2500,
        temperature: 0.3,
        messages: [
          { role: 'system', content: `${PROMPT}${chat.writing.background?.trim() ? `\n\n# Story notes (Background)\n${chat.writing.background.trim()}` : ''}` },
          { role: 'user', content: `# Retcon note\n${note.trim()}\n\n# Messages\n${text}` },
        ],
      });
      const out = parseJson<{ edits?: { m: number; quote: string; text: string }[]; background?: string }>(res.text);
      const cards: Omit<Suggestion, 'id' | 'chatId' | 'status' | 'createdAt'>[] = [];
      for (const e of out?.edits ?? []) {
        const hit = part.find((x) => x.n === e?.m);
        if (!hit || typeof e.quote !== 'string' || typeof e.text !== 'string') continue;
        const content = activeSwipe(hit.m).content;
        const r = findQuote(content, e.quote);
        if (!r) continue;
        const before = content.slice(r.from, r.to);
        if (!e.text.trim() || e.text.trim() === before.trim()) continue;
        cards.push({ source: 'retcon', group, target: { kind: 'passage', messageId: hit.m.id, swipe: hit.m.activeSwipe, from: r.from, to: r.to }, before, after: e.text.trim() });
      }
      await addSuggestions(chatId, cards);
      if (!background && typeof out?.background === 'string') background = out.background.trim();
      useRetcon.setState({ done: ci + 1 });
    }
    if (background) {
      const cur = useStore.getState().chats.find((c) => c.id === chatId)?.writing.background ?? '';
      if (!cur.includes(background)) await addSuggestions(chatId, [{ source: 'retcon', group, target: { kind: 'background' }, before: cur, after: cur.trim() ? `${cur.trim()}\n${background}` : background, reason: 'Keep the story notes in line with the retcon.' }]);
    }
    useRetcon.setState({ running: false, stopper: undefined });
  } catch (e) {
    useRetcon.setState({ running: false, stopper: undefined, error: (e as Error).name === 'AbortError' ? 'Stopped. The edits found so far are below.' : (e as Error).message });
  }
}

export const stopRetcon = () => useRetcon.getState().stopper?.abort();

const groupCards = (group: string, status: Suggestion['status']) => useStore.getState().suggestions.filter((x) => x.group === group && x.status === status);

/** Applies every open edit in the group (in story order, so later offsets stay right). */
export async function applyRetcon(group: string) {
  for (const x of groupCards(group, 'pending')) await accept(x.id);
}
export async function ignoreRetcon(group: string) {
  for (const x of groupCards(group, 'pending')) await reject(x.id);
}
/** Takes back every applied edit in the group, newest first. */
export async function undoRetcon(group: string) {
  for (const x of groupCards(group, 'accepted').reverse()) await undo(x.id);
}
