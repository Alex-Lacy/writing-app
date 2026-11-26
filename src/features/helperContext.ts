// What each Helper keeps when its context is tight. All Helpers share one budgeter
// (ai/budget.ts); these profiles say what matters most to each one.
import { budget, type BudgetResult, type Section } from '../ai/budget';
import type { WireMessage } from '../providers/openai';
import type { Chat, HelperDef, HelperMessage, Message } from '../types';
import { setupParts, transcript, type SetupPart } from './storyText';
import { create } from 'zustand';

const ALL = 1e9; // "keep all of it" as a floor

type PartId = SetupPart['id'] | 'story' | 'others';
interface Profile {
  /** keep: higher stays longer (100 = never cut); floor: tokens kept before deeper cuts. */
  parts: Partial<Record<PartId, [keep: number, floor: number]>>;
  keepTurns: number;
}

const BASE: Profile['parts'] = {
  system: [40, 600], background: [90, ALL], steering: [80, ALL], outline: [60, 1500], tags: [30, 0], styles: [50, 1500],
  stylesOff: [10, 0], codex: [70, 3000], summary: [55, 1500], story: [45, 2000], others: [5, 0],
};

/** Per Helper: what it can least do without. */
export const PROFILES: Record<string, Profile> = {
  // Story setup: the setup fields themselves, then the Codex and enough story to judge them.
  'helper-setup': { parts: { ...BASE, system: [75, ALL] }, keepTurns: 6 },
  // Codex editor: the Codex comes first (entries named in the chat stay whole longest), then the
  // Background it must agree with; story text gives way first.
  'helper-codex': { parts: { ...BASE, codex: [95, ALL], background: [85, ALL], steering: [40, 400], outline: [30, 500], styles: [15, 0], system: [20, 0], summary: [50, 1000], story: [60, 1500] }, keepTurns: 6 },
  // Plot ideas: the outline, Background and the story so far; the Codex by relevance.
  'helper-plot': { parts: { ...BASE, outline: [95, ALL], summary: [88, ALL], codex: [60, 2000], story: [65, 3000], steering: [50, 800], styles: [20, 0] }, keepTurns: 6 },
  // Style editor: the Style modules and real story prose to judge the voice by.
  'helper-style': { parts: { ...BASE, styles: [95, ALL], stylesOff: [60, 1000], story: [85, 3000], steering: [70, ALL], background: [40, 800], codex: [15, 0], outline: [20, 0], summary: [20, 0] }, keepTurns: 6 },
  // New story: whatever has been set up so far; little story exists yet.
  'helper-new-story': { parts: { ...BASE, codex: [60, 1500] }, keepTurns: 8 },
  // Research: lookup results arrive as chat turns, so fewer kept whole; setup for orientation.
  'helper-research': { parts: { ...BASE, background: [70, ALL], codex: [55, 1500], story: [30, 800], outline: [30, 500], summary: [35, 800] }, keepTurns: 4 },
};
const profileFor = (helperId: string) => PROFILES[helperId] ?? PROFILES['helper-setup'];

/** Codex entries named in the newest chat turns score highest, then ones in the recent story. */
export function codexScore(item: { name: string; keys: string[] }, latest: string, chat: string, story: string): number {
  const words = [item.name, ...item.keys].filter((w) => w && w.length > 1 && !w.startsWith('/'));
  const has = (t: string) => words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t));
  return (has(latest) ? 100 : 0) + (has(chat) ? 20 : 0) + (has(story) ? 5 : 0);
}

/** About this much recent story is offered (newest kept when cut). */
const STORY_OFFER = 24000;

export interface HelperRequest {
  head: string;
  chat: Chat;
  helper: HelperDef;
  convo: HelperMessage[];
  story: Message[];
  others: string;
  /** Asked for in the reply (tokens); never squeezed below `replyFloor`. */
  reply: number;
  replyFloor: number;
}

/** The last budget each Helper ran with, for "What the Helper sees". */
export const useHelperContext = create<{ last?: BudgetResult & { chatId: string; helperId: string } }>(() => ({}));

export function helperSections(r: HelperRequest): Section[] {
  const prof = profileFor(r.helper.id).parts;
  const turns = r.convo.filter((m) => m.role !== 'tool').map((m) => m.content);
  const latest = turns.at(-1) ?? '';
  const chatText = turns.slice(-6).join('\n');
  // Newest story first until the offer is used, then put back in order.
  const recent: Message[] = [];
  let used = 0;
  for (const m of [...r.story].reverse()) {
    used += Math.ceil((m.swipes[m.activeSwipe]?.content.length ?? 0) / 4);
    if (used > STORY_OFFER && recent.length) break;
    recent.unshift(m);
  }
  const storyText = transcript(recent);
  const sec = (id: PartId, label: string, text: string, extra: Partial<Section> = {}): Section => {
    const [keep, floor] = prof[id] ?? [30, 0];
    return { id, label, text, keep, floor, ...extra };
  };
  const out: Section[] = setupParts(r.chat, { stylesOff: true }).map((p) =>
    p.items
      ? sec(p.id, p.label, '', { text: undefined, items: p.items.map((i) => ({ text: i.text, short: i.name, score: codexScore(i, latest, chatText, storyText.slice(-8000)) })) })
      : sec(p.id, p.label, p.text),
  );
  out.push(sec('story', 'Recent story (newest last)', storyText || '(No story written yet.)', { keepEnd: 'end' }));
  if (r.others) out.push(sec('others', 'Other stories', r.others));
  return out;
}

/** Turns the Helper chat into model turns (lookup results go in as the person's side). */
export function helperTurns(convo: HelperMessage[]) {
  return convo.map((m) => (m.role === 'tool' ? { role: 'user' as const, content: `# Lookup results (from the app, not the person)\n${m.content}` } : { role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.content }));
}

/** A fitter for runJob: builds the Helper's request for the model's window and remembers the breakdown. */
export function helperFit(r: HelperRequest, onReport?: (b: BudgetResult) => void) {
  const sections = helperSections(r);
  const turns = helperTurns(r.convo);
  return (limit: number | undefined, scale: number): { messages: WireMessage[]; maxTokens: number; error?: string } => {
    const b = budget({ head: r.head, sections, turns, keepTurns: profileFor(r.helper.id).keepTurns, reply: { want: r.reply, floor: r.replyFloor }, limit, scale });
    onReport?.(b);
    useHelperContext.setState({ last: { ...b, chatId: r.chat.id, helperId: r.helper.id } });
    return { messages: [{ role: 'system', content: b.system }, ...b.turns], maxTokens: b.reply, error: b.error };
  };
}

// ---------- one-shot side jobs (suggested updates, summaries) ----------

export interface NotesJob {
  head: string;
  chat: Chat;
  /** Which setup parts to offer, and how the Codex is shown. */
  codex: 'full' | 'names';
  /** The material the job is about (new story text, a stretch to summarise), as its own section. */
  material: { label: string; text: string; keep: number; floor: number };
  /** What to do, sent as the person's message. */
  task: string;
  parts: Profile['parts'];
  reply: number;
  replyFloor: number;
}

/** A fitter for one-shot jobs: the notes and the material, cut to the window by the job's priorities. */
export function notesFit(j: NotesJob) {
  const sec = (id: PartId, label: string, extra: Partial<Section>): Section => {
    const [keep, floor] = j.parts[id] ?? [30, 0];
    return { id, label, keep, floor, ...extra };
  };
  const material = j.material.text.slice(-8000);
  const sections: Section[] = [
    ...setupParts(j.chat, { codex: j.codex, summary: false, stylesOff: false }).map((p) =>
      p.items ? sec(p.id, `Current notes: ${p.label}`, { items: p.items.map((i) => ({ text: i.text, short: i.name, score: codexScore(i, '', '', material) })) }) : sec(p.id, `Current notes: ${p.label}`, { text: p.text }),
    ),
    { id: 'material', label: j.material.label, text: j.material.text, keep: j.material.keep, floor: j.material.floor, keepEnd: 'end' },
  ];
  return (limit: number | undefined, scale: number): { messages: WireMessage[]; maxTokens: number; error?: string } => {
    const b = budget({ head: j.head, sections, turns: [{ role: 'user', content: j.task }], keepTurns: 1, reply: { want: j.reply, floor: j.replyFloor }, limit, scale });
    return { messages: [{ role: 'system', content: b.system }, ...b.turns], maxTokens: b.reply, error: b.error };
  };
}

/** Suggested updates: the new story and the Codex entries it mentions matter most. */
export const UPDATES_PARTS: Profile['parts'] = { background: [85, ALL], codex: [80, 4000], steering: [50, 600], outline: [40, 600], tags: [30, 0], styles: [10, 0], system: [10, 0] };
/** Summaries: the stretch is the job; notes only help with names. */
export const SUMMARY_PARTS: Profile['parts'] = { background: [60, 800], codex: [40, 600], steering: [20, 0], outline: [30, 0], tags: [10, 0], styles: [5, 0], system: [5, 0] };
