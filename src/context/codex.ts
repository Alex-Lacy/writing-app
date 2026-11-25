import type { CodexBook, CodexEntry, StyleModule, SummaryPart } from '../types';
import type { ContextBlock } from './build';
import { estimateTokens } from './tokens';

// Codex: entries are sent only when one of their trigger words shows up in the recent story,
// so a big Codex costs nothing until it's relevant.

/** How many recent messages are scanned for trigger words. */
export const CODEX_SCAN = 4;
/** Share of the context window the Codex may use. */
export const CODEX_SHARE = 0.15;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The first key of an entry that appears in the text, or undefined. */
export function matchKey(entry: CodexEntry, text: string): string | undefined {
  for (const raw of entry.keys) {
    const key = raw.trim();
    if (!key) continue;
    const re = key.length > 2 && key.startsWith('/') && key.lastIndexOf('/') > 0
      ? safeRegex(key.slice(1, key.lastIndexOf('/')), key.slice(key.lastIndexOf('/') + 1) || 'i')
      : new RegExp(`(^|[^\\p{L}\\p{N}_])${esc(key)}(?=$|[^\\p{L}\\p{N}_])`, 'iu');
    if (re?.test(text)) return key;
  }
  return undefined;
}

function safeRegex(src: string, flags: string): RegExp | undefined {
  try {
    return new RegExp(src, flags.replace(/[^gimsuy]/g, ''));
  } catch {
    return undefined;
  }
}

export interface CodexHit {
  entry: CodexEntry;
  bookName: string;
  /** The trigger word that matched, or 'always on'. */
  why: string;
}

/** Entries to send for this recent text, highest priority first, within the token budget. */
export function triggeredEntries(books: CodexBook[], recentText: string, budgetTokens: number): { hits: CodexHit[]; dropped: CodexHit[] } {
  const all: CodexHit[] = [];
  for (const b of books)
    for (const e of b.entries) {
      if (!e.enabled || !e.text.trim()) continue;
      const why = e.alwaysOn ? 'always on' : matchKey(e, recentText);
      if (why) all.push({ entry: e, bookName: b.name, why });
    }
  all.sort((a, b) => (b.entry.priority ?? 0) - (a.entry.priority ?? 0) || Number(!!b.entry.alwaysOn) - Number(!!a.entry.alwaysOn));
  const hits: CodexHit[] = [];
  const dropped: CodexHit[] = [];
  let used = 0;
  for (const h of all) {
    const t = estimateTokens(h.entry.text) + 8;
    if (used + t > budgetTokens) dropped.push(h);
    else {
      hits.push(h);
      used += t;
    }
  }
  return { hits, dropped };
}

export function codexBlocks(hits: CodexHit[]): ContextBlock[] {
  return hits.map((h, i) => ({
    id: `codex-${h.entry.id}`,
    label: `${h.entry.name} (${h.why})`,
    text: `[${h.entry.name}: ${h.entry.text.trim()}]`,
    placement: { kind: 'top', order: 20 + i / 1000 },
    source: 'codex',
  }));
}

export function globalNotesBlocks(notes: string | undefined, on: boolean | undefined): ContextBlock[] {
  return on !== false && notes?.trim() ? [{ id: 'global', label: 'Global notes', text: notes.trim(), placement: { kind: 'top', order: 5 }, source: 'global' }] : [];
}

export function summaryBlocks(parts: SummaryPart[] | undefined): ContextBlock[] {
  const text = (parts ?? []).map((p) => p.text.trim()).filter(Boolean).join('\n\n');
  return text ? [{ id: 'summary', label: 'Story so far', text: `[Story so far:\n${text}]`, placement: { kind: 'top', order: 30 }, source: 'summary' }] : [];
}

/** Story tags as one compact line, after Background and Style modules. */
export function tagsBlocks(tags: string[] | undefined): ContextBlock[] {
  const t = (tags ?? []).map((x) => x.trim()).filter(Boolean);
  return t.length ? [{ id: 'tags', label: 'Story tags', text: `[Tags: ${t.join('; ')}]`, placement: { kind: 'top', order: 15 }, source: 'tags' }] : [];
}

/** Style modules switched on for a chat, right after Background. */
export function styleBlocks(all: StyleModule[] | undefined, ids: string[] | undefined): ContextBlock[] {
  return (all ?? []).filter((m) => ids?.includes(m.id) && m.text.trim()).map((m, i) => ({ id: `style-${m.id}`, label: m.name, text: m.text.trim(), placement: { kind: 'top', order: 12 + i / 100 }, source: 'style' }));
}
