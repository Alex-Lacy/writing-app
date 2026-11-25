import type { WireMessage } from '../providers/openai';
import type { WritingSettings } from '../types';
import { estimateTokens, MESSAGE_OVERHEAD } from './tokens';

/**
 * Context assembly pipeline.
 *
 * Every piece of injected text (Memory, Author's Note, and later lorebook entries, the
 * condensed-history summary, search results) is a ContextBlock produced by a contributor.
 * The builder places blocks, fits history into the token budget oldest-first, and reports
 * exactly what was sent so the UI can show it.
 */

export type Placement =
  /** Joined into the single leading system message, sorted by `order`. */
  | { kind: 'top'; order: number }
  /** Inserted `depth` messages from the end of the history (1 = just before the latest). */
  | { kind: 'depth'; depth: number; mode: 'system' | 'inline' };

export interface ContextBlock {
  id: string;
  label: string;
  text: string;
  placement: Placement;
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
}

export interface BuildResult {
  messages: WireMessage[];
  includedIds: string[];
  droppedIds: string[];
  tokens: { top: number; blocks: number; history: number; total: number; budget: number };
  /** The latest message alone exceeds the budget. */
  overflow: boolean;
}

const textOf = (c: WireMessage['content']) =>
  typeof c === 'string' ? c : c.map((p) => (p.type === 'text' ? p.text : '')).join('\n');

// Images are billed differently per provider; use a flat rough estimate.
const tokensOf = (c: WireMessage['content']) =>
  estimateTokens(textOf(c)) + (typeof c === 'string' ? 0 : c.filter((p) => p.type === 'image_url').length * 800);

/** Contributor for the writing toggle: Memory and Author's Note. */
export function writingBlocks(w: WritingSettings | undefined): ContextBlock[] {
  if (!w?.enabled) return [];
  const out: ContextBlock[] = [];
  if (w.memory.trim()) out.push({ id: 'memory', label: 'Memory', text: w.memory.trim(), placement: { kind: 'top', order: 10 } });
  if (w.authorsNote.trim())
    out.push({
      id: 'authors-note',
      label: "Author's Note",
      text: w.authorsNote.trim(),
      placement: { kind: 'depth', depth: Math.max(1, Math.floor(w.anDepth || 1)), mode: w.anRole === 'inline' ? 'inline' : 'system' },
    });
  return out;
}

function prependText(c: WireMessage['content'], prefix: string): WireMessage['content'] {
  if (typeof c === 'string') return `${prefix}\n\n${c}`;
  return [{ type: 'text', text: prefix }, ...c];
}

export function buildContext(input: BuildInput): BuildResult {
  const top = input.blocks
    .filter((b): b is ContextBlock & { placement: { kind: 'top'; order: number } } => b.placement.kind === 'top')
    .sort((a, b) => a.placement.order - b.placement.order);
  const depthBlocks = input.blocks.filter((b) => b.placement.kind === 'depth');

  const topText = [input.systemPrompt.trim(), ...top.map((b) => b.text)].filter(Boolean).join('\n\n');
  const topTokens = topText ? estimateTokens(topText) + MESSAGE_OVERHEAD : 0;
  const blockTokens = depthBlocks.reduce((n, b) => n + estimateTokens(b.text) + MESSAGE_OVERHEAD + 8, 0);
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

  const body: WireMessage[] = kept.map((h) => ({ role: h.role, content: h.content }));

  // Insert depth blocks deepest-first so indices stay valid.
  const sorted = [...depthBlocks].sort(
    (a, b) => (b.placement as { depth: number }).depth - (a.placement as { depth: number }).depth,
  );
  for (const b of sorted) {
    const p = b.placement as { kind: 'depth'; depth: number; mode: 'system' | 'inline' };
    const idx = Math.max(0, body.length - p.depth);
    if (p.mode === 'inline' && body[idx]) {
      body[idx] = { ...body[idx], content: prependText(body[idx].content, `[${b.label}: ${b.text}]`) };
    } else {
      body.splice(idx, 0, { role: 'system', content: b.text });
    }
  }

  const messages: WireMessage[] = topText ? [{ role: 'system', content: topText }, ...body] : body;
  return {
    messages,
    includedIds: kept.map((h) => h.id),
    droppedIds,
    tokens: { top: topTokens, blocks: blockTokens, history: historyTokens, total: topTokens + blockTokens + historyTokens, budget },
    overflow,
  };
}
