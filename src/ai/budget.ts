// Context budgeting for Helpers and side jobs: one shared fitter, with per-job priorities.
//
// A request is: fixed instructions (always sent), named sections of story material, the chat so
// far, and room for the reply. When it doesn't fit the model's window (including limits learned
// from the provider), it gives way in this order, so what each job needs most stays whole:
//   1. sections are cut back to their floor, least important first (story text from its old end,
//      lists item by item, least relevant items first);
//   2. older chat turns are folded into a short recap (newest kept turns stay whole);
//   3. the reply room shrinks, but never below its floor;
//   4. sections go below their floor / are left out, least important first (pinned ones never);
//   5. kept turns go, all but the last message.
// If even that doesn't fit, it says what's too big rather than sending a request that will fail.
import { estimateTokens } from '../context/tokens';

/** Pinned sections are never cut (only reported if they don't fit). */
export const PINNED = 100;

export interface Item {
  text: string;
  /** Higher stays longer when the list must shrink. */
  score: number;
  /** Shown instead when the item itself can't fit (e.g. an entry's name). */
  short?: string;
}

export interface Section {
  id: string;
  label: string;
  /** Plain text, or a list of items (one per line). */
  text?: string;
  items?: Item[];
  /** How much this job needs it: higher is kept longer; PINNED is never cut. */
  keep: number;
  /** Tokens it keeps in the first round of cuts. */
  floor?: number;
  /** Which end of plain text to keep when cutting: 'end' keeps the newest (story), 'start' the beginning. */
  keepEnd?: 'start' | 'end';
}

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export interface BudgetInput {
  head: string;
  sections: Section[];
  turns: Turn[];
  /** Newest turns kept whole before any are folded into the recap. */
  keepTurns: number;
  reply: { want: number; floor: number };
  limit?: number;
  /** Correction for our token estimate (from a provider's count). */
  scale?: number;
}

export interface SectionReport {
  id: string;
  label: string;
  tokens: number;
  full: number;
  status: 'full' | 'trimmed' | 'left out';
}

export interface BudgetResult {
  system: string;
  turns: Turn[];
  reply: number;
  report: SectionReport[];
  /** Older turns folded into the recap. */
  folded: number;
  total: number;
  limit?: number;
  error?: string;
}

const MARGIN = 300;

/** Keeps about `tokens` of text, at a paragraph or sentence break, from the start or the end. */
export function cutText(text: string, tokens: number, keepEnd: 'start' | 'end', est = estimateTokens): string {
  if (tokens <= 0) return '';
  const full = est(text);
  if (full <= tokens) return text;
  const chars = Math.max(0, Math.floor(((text.length * tokens) / full) * 0.97) - 30);
  if (keepEnd === 'end') {
    let cut = text.slice(text.length - chars);
    const brk = cut.search(/\n\n|(?<=[.!?…"”])\s/);
    if (brk > 0 && brk < cut.length / 3) cut = cut.slice(brk).trimStart();
    return `(…earlier part left out)\n${cut}`;
  }
  let cut = text.slice(0, chars);
  const brk = Math.max(cut.lastIndexOf('\n\n'), cut.search(/[.!?…"”]\s[^.!?…]*$/) + 1);
  if (brk > cut.length * 0.66) cut = cut.slice(0, brk);
  return `${cut.trimEnd()}\n(…rest left out)`;
}

/** Keeps the highest-scoring items that fit (in their original order); the rest by their short form if that fits. */
export function cutItems(items: Item[], tokens: number, est = estimateTokens): { text: string; kept: number } {
  const order = items.map((it, i) => ({ it, i })).sort((a, b) => b.it.score - a.it.score);
  const whole = new Set<number>();
  let used = 0;
  for (const { it, i } of order) {
    const t = est(it.text) + 1;
    if (used + t > tokens) continue;
    whole.add(i);
    used += t;
  }
  const rest = items.map((it, i) => (whole.has(i) ? '' : it.short ?? '')).filter(Boolean);
  let restLine = rest.length ? `(Also there, not shown in full: ${rest.join('; ')})` : '';
  if (restLine && used + est(restLine) > tokens) restLine = rest.length ? `(${rest.length} more not shown)` : '';
  const text = [...items.filter((_, i) => whole.has(i)).map((it) => it.text), restLine].filter(Boolean).join('\n');
  return { text, kept: whole.size };
}

const sectionText = (s: Section) => (s.items ? s.items.map((i) => i.text).join('\n') : s.text ?? '');

/** First couple of sentences of a turn, for the recap of older chat. */
function gist(t: Turn, words = 45): string {
  const w = t.content.replace(/```[\s\S]*?```/g, '[suggestions]').replace(/\s+/g, ' ').trim().split(' ');
  return `${t.role === 'user' ? 'You' : 'Helper'}: ${w.slice(0, words).join(' ')}${w.length > words ? '…' : ''}`;
}

export function budget(o: BudgetInput): BudgetResult {
  const scale = o.scale ?? 1;
  const est = (t: string) => (t ? Math.ceil(estimateTokens(t) * scale) : 0);
  const secs = o.sections.filter((s) => sectionText(s).trim());
  // Current size of each section (tokens), starting full.
  const size = new Map(secs.map((s) => [s.id, est(sectionText(s))]));
  const full = new Map(size);
  const keepTurns = Math.max(1, o.keepTurns);
  let kept = o.turns;
  let recap: string[] = [];
  let reply = o.reply.want;
  const render = (): { system: string; turns: Turn[] } => {
    const body = secs
      .map((s) => {
        const n = size.get(s.id)!;
        if (n <= 0) return '';
        const text = n >= full.get(s.id)! ? sectionText(s) : s.items ? cutItems(s.items, n, est).text : cutText(s.text ?? '', n, s.keepEnd ?? 'start', est);
        return text.trim() ? `## ${s.label}\n${text}` : '';
      })
      .filter(Boolean);
    const recapText = recap.length ? `## Earlier in this conversation (shortened)\n${recap.join('\n')}` : '';
    return { system: [o.head, ...body, recapText].filter(Boolean).join('\n\n'), turns: kept };
  };
  const used = () => {
    const r = render();
    return est(r.system) + r.turns.reduce((n, t) => n + est(t.content) + 4, 0);
  };
  const fits = () => !o.limit || used() + reply + MARGIN <= o.limit;
  const over = () => (o.limit ? used() + reply + MARGIN - o.limit : 0);
  const byKeep = [...secs].filter((s) => s.keep < PINNED).sort((a, b) => a.keep - b.keep);

  // 1. Down to floors, least needed first.
  for (const s of byKeep) {
    if (fits()) break;
    const floor = Math.min(s.floor ?? 0, full.get(s.id)!);
    size.set(s.id, Math.max(floor, size.get(s.id)! - over()));
  }
  // 2. Fold older turns into the recap; drop recap lines oldest first if needed.
  while (!fits() && kept.length > keepTurns) {
    recap = [...recap, gist(kept[0])];
    kept = kept.slice(1);
  }
  while (!fits() && recap.length) recap = recap.slice(1);
  // 3. Less room for the reply, down to its floor.
  if (!fits()) reply = Math.max(o.reply.floor, reply - over());
  // 4. Below floors, then out.
  for (const s of byKeep) {
    if (fits()) break;
    size.set(s.id, Math.max(0, size.get(s.id)! - over()));
  }
  // 5. Kept turns, all but the last message.
  while (!fits() && kept.length > 1) kept = kept.slice(1);
  // A conversation should start with the person, not a Helper reply.
  while (kept.length > 1 && kept[0].role === 'assistant') kept = kept.slice(1);
  const { system, turns } = render();
  const report: SectionReport[] = secs.map((s) => {
    const n = size.get(s.id)!;
    const f = full.get(s.id)!;
    return { id: s.id, label: s.label, tokens: n >= f ? f : Math.max(0, n), full: f, status: n >= f ? 'full' : n <= 0 ? 'left out' : 'trimmed' };
  });
  const total = used();
  let error: string | undefined;
  if (o.limit && total + o.reply.floor + MARGIN > o.limit) {
    const pinned = secs.filter((s) => s.keep >= PINNED).map((s) => `${s.label} (~${full.get(s.id)!.toLocaleString()} tokens)`);
    error = `This doesn't fit the model's ${o.limit.toLocaleString()}-token window, even after shortening everything that can be shortened.${pinned.length ? ` What has to stay: ${pinned.join(', ')}.` : ''} Pick a model with a bigger window, or shorten those.`;
  }
  return { system, turns, reply: Math.max(256, Math.min(reply, o.limit ? o.limit - total - MARGIN : reply)), report, folded: o.turns.length - kept.length, total, limit: o.limit, error };
}
