import type { WireMessage } from '../providers/openai';
import type { WritingSettings } from '../types';
import { estimateTokens, MESSAGE_OVERHEAD } from './tokens';

/**
 * Context assembly pipeline.
 *
 * Every piece of injected text (Memory, Author's Note, the length instruction, and later
 * lorebook entries, the condensed-history summary, search results) is a ContextBlock produced
 * by a contributor. The builder places blocks, fits history into the token budget newest-first,
 * and returns both the wire messages and an annotated copy (which part came from where, in
 * the exact order sent) for the context viewer.
 */

export type Placement =
  /** Joined into the single leading system message, sorted by `order`. */
  | { kind: 'top'; order: number }
  /**
   * `depth` messages from the end of the history (1 = just before the latest message).
   * 'system' adds a system message there; 'inline' folds the text into that message.
   */
  | { kind: 'depth'; depth: number; mode: 'system' | 'inline' }
  /**
   * The very end: appended to the latest user message, or sent as a new user message if the
   * chat ends on a reply. The strongest spot for instructions that must be followed now.
   */
  | { kind: 'tail' };

/** Where a piece of context came from; drives colours in the context viewer. */
export type Source = 'system' | 'memory' | 'authors-note' | 'length' | 'lore' | 'summary' | 'user' | 'assistant' | 'other';

export interface ContextBlock {
  id: string;
  label: string;
  text: string;
  placement: Placement;
  source?: Source;
}

export interface HistoryItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: WireMessage['content'];
}

export interface BuildInput {
  systemPrompt: string;
  blocks: ContextBlock[];
  history: HistoryItem[];
  contextLimit: number;
  maxTokens: number;
  safetyMargin: number;
  /** Continue mode: the last history item is a reply the server will keep writing, so it must stay last. */
  continueLast?: boolean;
}

export interface Part {
  source: Source;
  label: string;
  text: string;
  tokens: number;
  messageId?: string;
}

export interface AnnotatedMessage {
  role: WireMessage['role'];
  parts: Part[];
}

export interface SourceTotal {
  source: Source;
  label: string;
  tokens: number;
  count: number;
}

export interface BuildResult {
  messages: WireMessage[];
  /** Same order as `messages`, split into labelled parts. */
  annotated: AnnotatedMessage[];
  /** Token totals per source, in the order each source first appears in the context. */
  totals: SourceTotal[];
  includedIds: string[];
  droppedIds: string[];
  tokens: { top: number; blocks: number; history: number; total: number; budget: number };
  /** The latest message alone exceeds the budget. */
  overflow: boolean;
}

const textOf = (c: WireMessage['content']) =>
  typeof c === 'string' ? c : c.map((p) => (p.type === 'text' ? p.text : '[image]')).join('\n');

// Images are billed differently per provider; use a flat rough estimate.
const tokensOf = (c: WireMessage['content']) =>
  estimateTokens(textOf(c)) + (typeof c === 'string' ? 0 : c.filter((p) => p.type === 'image_url').length * 800);

const SOURCE_LABEL: Record<Source, string> = {
  system: 'System prompt',
  memory: 'Memory',
  'authors-note': "Author's Note",
  length: 'Length instruction',
  lore: 'Lorebook',
  summary: 'Story summary',
  user: 'Your message',
  assistant: 'AI reply',
  other: 'Other',
};
/** Chip label: the same name the legend uses, except lore entries keep their own names. */
const labelOf = (b: ContextBlock): string => {
  const src = sourceOf(b);
  return src === 'lore' || src === 'other' ? b.label : SOURCE_LABEL[src];
};
export const sourceLabel = (s: Source) => SOURCE_LABEL[s];

const sourceOf = (b: ContextBlock): Source =>
  b.source ?? (b.id === 'memory' ? 'memory' : b.id === 'authors-note' ? 'authors-note' : b.id === 'length' ? 'length' : 'other');

/** Contributor for the writing toggle: Memory and Author's Note. */
export function writingBlocks(w: WritingSettings | undefined): ContextBlock[] {
  if (!w?.enabled) return [];
  const out: ContextBlock[] = [];
  if (w.memory.trim()) out.push({ id: 'memory', label: 'Memory', text: w.memory.trim(), placement: { kind: 'top', order: 10 }, source: 'memory' });
  if (w.authorsNote.trim())
    out.push({
      id: 'authors-note',
      label: "Author's Note",
      text: w.authorsNote.trim(),
      placement: { kind: 'depth', depth: Math.max(1, Math.floor(w.anDepth || 1)), mode: w.anRole === 'system' ? 'system' : 'inline' },
      source: 'authors-note',
    });
  return out;
}

interface Slot {
  role: WireMessage['role'];
  content: WireMessage['content'];
  parts: Part[];
}

const join = (a: string, b: string) => (a ? `${a}\n\n${b}` : b);

function prepend(slot: Slot, part: Part): Slot {
  const c = slot.content;
  const content = typeof c === 'string' ? join(part.text, c) : [{ type: 'text' as const, text: part.text }, ...c];
  return { ...slot, content, parts: [part, ...slot.parts] };
}

function append(slot: Slot, part: Part): Slot {
  const c = slot.content;
  const content = typeof c === 'string' ? join(c, part.text) : [...c, { type: 'text' as const, text: part.text }];
  return { ...slot, content, parts: [...slot.parts, part] };
}

const mkPart = (source: Source, label: string, text: string, messageId?: string): Part => ({
  source, label, text, tokens: estimateTokens(text), messageId,
});

export function buildContext(input: BuildInput): BuildResult {
  const top = input.blocks
    .filter((b): b is ContextBlock & { placement: { kind: 'top'; order: number } } => b.placement.kind === 'top')
    .sort((a, b) => a.placement.order - b.placement.order);
  const depthBlocks = input.blocks.filter((b) => b.placement.kind === 'depth');
  const tailBlocks = input.blocks.filter((b) => b.placement.kind === 'tail');

  const topParts: Part[] = [
    ...(input.systemPrompt.trim() ? [mkPart('system', SOURCE_LABEL.system, input.systemPrompt.trim())] : []),
    ...top.map((b) => mkPart(sourceOf(b), labelOf(b), b.text)),
  ];
  const topText = topParts.map((p) => p.text).join('\n\n');
  const topTokens = topText ? estimateTokens(topText) + MESSAGE_OVERHEAD : 0;
  const blockTokens = [...depthBlocks, ...tailBlocks].reduce((n, b) => n + estimateTokens(b.text) + MESSAGE_OVERHEAD + 8, 0);
  const budget = input.contextLimit - input.maxTokens - input.safetyMargin;
  let room = budget - topTokens - blockTokens;

  // Fit history newest-first; always keep the latest message.
  const kept: HistoryItem[] = [];
  let historyTokens = 0;
  let overflow = false;
  for (let i = input.history.length - 1; i >= 0; i--) {
    const h = input.history[i];
    const t = tokensOf(h.content) + MESSAGE_OVERHEAD;
    if (t > room && kept.length > 0) break;
    if (t > room) overflow = true;
    kept.unshift(h);
    room -= t;
    historyTokens += t;
  }
  const droppedIds = input.history.slice(0, input.history.length - kept.length).map((h) => h.id);

  let body: Slot[] = kept.map((h) => ({
    role: h.role,
    content: h.content,
    parts: [{ ...mkPart(h.role === 'assistant' ? 'assistant' : h.role === 'user' ? 'user' : 'other', h.role === 'assistant' ? SOURCE_LABEL.assistant : h.role === 'user' ? SOURCE_LABEL.user : 'Earlier system message', textOf(h.content), h.id), tokens: tokensOf(h.content) }],
  }));

  // Blocks at the same depth and mode share one message (strict templates dislike runs of
  // system messages). Insert deepest-first so indices stay valid.
  const groups = new Map<string, { depth: number; mode: 'system' | 'inline'; parts: Part[] }>();
  for (const blk of depthBlocks) {
    const p = blk.placement as { kind: 'depth'; depth: number; mode: 'system' | 'inline' };
    const key = `${p.depth}|${p.mode}`;
    const g = groups.get(key) ?? { depth: p.depth, mode: p.mode, parts: [] };
    const text = p.mode === 'inline' && !blk.text.startsWith('[') ? `[${blk.label}: ${blk.text}]` : blk.text;
    g.parts.push(mkPart(sourceOf(blk), labelOf(blk), text));
    groups.set(key, g);
  }
  const lateParts: Part[] = [];
  for (const g of [...groups.values()].sort((a, b) => b.depth - a.depth)) {
    const idx = Math.max(0, body.length - g.depth);
    if (g.mode === 'inline') {
      // Fold into the first user message at or after that point, never into an AI reply.
      let at = idx;
      while (at < body.length && body[at].role !== 'user') at++;
      if (at < body.length) {
        let slot = body[at];
        for (const part of [...g.parts].reverse()) slot = prepend(slot, part);
        body[at] = slot;
      } else lateParts.push(...g.parts);
    } else {
      body.splice(idx, 0, { role: 'system', content: g.parts.map((p) => p.text).join('\n\n'), parts: g.parts });
    }
  }

  // Tail blocks: end of the latest user message, or a new user message after a reply.
  if (tailBlocks.length || lateParts.length) {
    const parts = [...lateParts, ...tailBlocks.map((b) => mkPart(sourceOf(b), labelOf(b), b.text))];
    const keepLast = !!input.continueLast && body.at(-1)?.role === 'assistant';
    // When continuing, the notes go with the user message before the reply being continued.
    const end = keepLast ? body.length - 1 : body.length;
    let at = end - 1;
    if (keepLast) while (at >= 0 && body[at].role !== 'user') at--;
    if (at >= 0 && body[at].role === 'user') {
      let slot = body[at];
      for (const part of parts) slot = append(slot, part);
      body = [...body.slice(0, at), slot, ...body.slice(at + 1)];
    } else {
      body.splice(end, 0, { role: 'user', content: parts.map((p) => p.text).join('\n\n'), parts });
    }
  }

  const slots: Slot[] = topText ? [{ role: 'system', content: topText, parts: topParts }, ...body] : body;

  const totals: SourceTotal[] = [];
  for (const s of slots)
    for (const p of s.parts) {
      const t = totals.find((x) => x.source === p.source);
      if (t) {
        t.tokens += p.tokens;
        t.count++;
      } else totals.push({ source: p.source, label: SOURCE_LABEL[p.source], tokens: p.tokens, count: 1 });
    }

  return {
    messages: slots.map((s) => ({ role: s.role, content: s.content })),
    annotated: slots.map((s) => ({ role: s.role, parts: s.parts })),
    totals,
    includedIds: kept.map((h) => h.id),
    droppedIds,
    tokens: { top: topTokens, blocks: blockTokens, history: historyTokens, total: topTokens + blockTokens + historyTokens, budget },
    overflow,
  };
}
