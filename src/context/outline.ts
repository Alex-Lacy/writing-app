// Outline: long-term steering. The story's plan is a list of beats, one per line, with the
// current beat marked by a leading ">". Only the current beat steers the reply (close to it,
// like Steering); the next couple of beats go near the top as background awareness only (not to
// foreshadow: that turns heavy-handed), so the story doesn't contradict them; finished beats are
// left to the summary.
import type { ContextBlock } from './build';
import type { Chat } from '../types';

export interface Beats {
  beats: string[];
  /** Index of the current beat; beats.length when every beat is done. */
  current: number;
}

const clean = (l: string) => l.replace(/^\s*(?:>\s*)?(?:[-*•]|\d+[.)])?\s*/, '').trim();

export function parseOutline(text: string | undefined): Beats {
  const lines = (text ?? '').split('\n').filter((l) => l.trim());
  const marked = lines.findIndex((l) => /^\s*>/.test(l));
  // "> (end)": past the last beat.
  const isBeat = (l: string) => !!clean(l) && clean(l) !== '(end)';
  const beats = lines.filter(isBeat).map(clean);
  if (marked < 0) return { beats, current: 0 };
  const before = lines.slice(0, marked).filter(isBeat).length;
  return { beats, current: isBeat(lines[marked]) ? before : beats.length };
}

export function outlineText(o: Beats): string {
  const lines = o.beats.map((b, i) => (i === o.current ? `> ${b}` : b));
  if (o.current >= o.beats.length && o.beats.length) lines.push('> (end)');
  return lines.join('\n');
}

/** Moves the marker by `by` beats, keeping the text as written otherwise. */
export function moveMarker(text: string, by: number): string {
  const o = parseOutline(text);
  const current = Math.max(0, Math.min(o.beats.length, o.current + by));
  return outlineText({ ...o, current });
}

/** Context blocks: the current beat near the reply, the next beats near the top. */
export function outlineBlocks(chat: Chat): ContextBlock[] {
  const ol = chat.outline;
  if (!ol || ol.off) return [];
  const { beats, current } = parseOutline(ol.text);
  if (current >= beats.length) return [];
  const ahead = beats.slice(current + 1, current + 1 + (ol.ahead ?? 2));
  const out: ContextBlock[] = [];
  if (ahead.length)
    out.push({
      id: 'outline-ahead',
      label: 'Outline: coming later',
      text: `[For your awareness only, the outline continues later with: ${ahead.join(' Then: ')} Don't steer toward these, set them up, foreshadow or mention them now; just don't write anything that contradicts them.]`,
      placement: { kind: 'top', order: 12 },
      source: 'outline',
    });
  const w = chat.writing;
  out.push({
    id: 'outline-now',
    label: 'Outline: current beat',
    text: `[Current scene goal: ${beats[current]} Work toward it naturally; it doesn't have to be reached in this reply.]`,
    placement: { kind: 'depth', depth: Math.max(1, Math.floor(w.steeringDepth || 1)), mode: w.steeringMode === 'system' ? 'system' : 'inline' },
    source: 'outline',
  });
  return out;
}

