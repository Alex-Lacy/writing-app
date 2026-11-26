// Cliché Filter: finds stock AI phrases in replies (no AI needed), and in Suggest or Auto mode
// asks a quick model to rewrite just the sentences they're in, all in one request per reply.
import { parseJson, runJob } from '../../ai/jobs';
import { repo } from '../../db/db';
import { replyHooks, useStore } from '../../store/store';
import { accept, addSuggestions, tidy } from '../../store/suggestions';
import { activeSwipe, type Chat, type FilterMode, type Suggestion } from '../../types';
import { storyAround } from '../rewrite';
import { compileRules, scan, sentenceAround, type Hit } from './rules';

export const DEFAULT_FILTER_MODE: FilterMode = 'highlight';
export const DEFAULT_AUTO_LIMIT = 4;
/** Fixes per reply when the user hasn't set a number: more room for longer replies. */
const BY_LENGTH: Record<string, number> = { short: 2, medium: 3, long: 4, scene: 5, chapter: 10, story: 16 };
export function autoLimitFor(chat: Chat | undefined, words?: number): number {
  if (chat?.filter?.autoLimit) return chat.filter.autoLimit;
  const fixed = BY_LENGTH[chat?.length ?? 'any'];
  if (fixed) return fixed;
  // Any length: about one per 200 words of the reply.
  return words ? Math.min(16, Math.max(2, Math.ceil(words / 200))) : DEFAULT_AUTO_LIMIT;
}

/** The story's own mode, else the one last chosen in any story, so a new story keeps your choice. */
export const filterMode = (chat?: Chat): FilterMode => chat?.filter?.mode ?? useStore.getState().settings.filterMode ?? DEFAULT_FILTER_MODE;

/** Hits in a text, with this chat's switched-off rules left out. */
export function clichesIn(text: string, chat?: Chat): Hit[] {
  const s = useStore.getState().settings;
  const { rules } = compileRules(s.filterRules, s.filterLists);
  return scan(text, rules, chat?.filter?.disabled);
}

interface Spot { from: number; to: number; hits: Hit[] }

/** Groups hits into the sentences they sit in (one sentence may hold several). */
export function spotsFor(text: string, hits: Hit[]): Spot[] {
  const out: Spot[] = [];
  for (const h of hits) {
    const r = sentenceAround(text, h.from, h.to);
    const last = out.at(-1);
    if (last && r.from < last.to) {
      last.to = Math.max(last.to, r.to);
      last.hits.push(h);
    } else out.push({ ...r, hits: [h] });
  }
  return out;
}

/** The hits that fall in the first `n` sentences, so the limit counts sentences, not phrases. */
function hitsForSpots(text: string, hits: Hit[], n: number): Hit[] {
  return spotsFor(text, hits).slice(0, n).flatMap((s) => s.hits);
}

const FIX_SYSTEM = `You edit fiction to remove stock phrases that make prose sound machine-written. For each numbered sentence, rewrite it so the flagged phrase is gone, replaced by something specific and plain that fits this story. Keep the meaning, voice, tense, point of view and any dialogue intact; change as little as you can. If a flagged phrase is actually fine where it is, return the sentence unchanged.
Reply with JSON only: {"fixes":[{"n":1,"text":"<the whole rewritten sentence>"}]}`;

/** Rewrites the sentences around these hits in one request. With `apply`, the fixes go straight into the text
 * (each stays undoable); otherwise they're offered as cards. */
export async function fixCliches(chatId: string, messageId: string, hits: Hit[], apply = false): Promise<number> {
  const s = useStore.getState();
  const chat = s.chats.find((c) => c.id === chatId);
  if (!chat || !hits.length) return 0;
  const msg = (chatId === s.currentChatId ? s.messages : await repo.messages(chatId)).find((m) => m.id === messageId);
  const content = msg ? activeSwipe(msg).content : undefined;
  if (content === undefined) return 0;
  const spots = spotsFor(content, hits);
  const a = await storyAround(chat, messageId, spots[0].from, spots.at(-1)!.to);
  const list = spots
    .map((p, i) => `${i + 1}. ${content.slice(p.from, p.to).trim()}\n   Flagged: ${p.hits.map((h) => `"${h.text}" (${h.description})`).join('; ')}`)
    .join('\n');
  const res = await runJob({
    job: 'filter',
    chat,
    label: 'Cliché Filter',
    maxTokens: 300 + spots.length * 150,
    temperature: 0.6,
    messages: [
      { role: 'system', content: `${FIX_SYSTEM}${a.notes ? `\n\n# Story notes\n${a.notes}` : ''}` },
      { role: 'user', content: `# The story around these sentences\n${a.before.slice(-4000)}${content.slice(spots[0].from, spots.at(-1)!.to)}${a.after.slice(0, 1500)}\n\n# Sentences to fix\n${list}` },
    ],
  });
  const fixes = parseJson<{ fixes?: { n: number; text: string }[] }>(res.text)?.fixes ?? [];
  const cards: Omit<Suggestion, 'id' | 'chatId' | 'status' | 'createdAt'>[] = [];
  for (const f of fixes) {
    const p = spots[(f?.n ?? 0) - 1];
    if (!p || typeof f.text !== 'string') continue;
    const before = content.slice(p.from, p.to);
    const lead = before.match(/^\s*/)![0];
    const trail = before.match(/\s*$/)![0];
    const after = lead + f.text.trim() + trail;
    if (!f.text.trim() || after === before) continue;
    cards.push({
      source: 'filter',
      target: { kind: 'passage', messageId, swipe: msg!.activeSwipe, from: p.from, to: p.to },
      before,
      after,
      reason: p.hits.map((h) => h.description).join('; '),
    });
  }
  const added = await addSuggestions(chatId, cards);
  if (apply) for (const sg of added) await accept(sg.id);
  return added.length;
}

replyHooks.push(async ({ chatId, message, newText }) => {
  const chat = useStore.getState().chats.find((c) => c.id === chatId);
  const mode = filterMode(chat);
  if (!chat || message.role !== 'assistant' || (mode !== 'suggest' && mode !== 'auto')) return;
  const content = activeSwipe(message).content;
  // Only the new part (a Continue adds to the end of an existing reply).
  const start = content.endsWith(newText) ? content.length - newText.length : 0;
  const hits = clichesIn(content, chat).filter((h) => h.from >= start);
  if (!hits.length) return;
  const limit = autoLimitFor(chat, newText.split(/\s+/).filter(Boolean).length);
  // Auto applies every fix it asked for; the limit caps how many sentences go to the model per reply.
  await fixCliches(chatId, message.id, hitsForSpots(content, hits, limit), mode === 'auto');
  await tidy(chatId);
});
