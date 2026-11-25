// Outline: long-term steering. The story's plan is a list of beats, one per line, with the
// current beat marked by a leading ">"; lines starting with "#" are chapter headings, not beats. Only the current beat steers the reply (close to it,
// like Steering); the next couple of beats go near the top as background awareness only (not to
// foreshadow: that turns heavy-handed), so the story doesn't contradict them; finished beats are
// left to the summary.
import type { ContextBlock } from './build';
import type { Chat } from '../types';

export interface Beats {
  beats: string[];
  /** Index of the current beat; beats.length when every beat is done. */
  current: number;
  /** The chapter heading each beat sits under ("" before any heading). */
  chapters: string[];
}

const clean = (l: string) => l.replace(/^\s*(?:>\s*)?(?:[-*•]|\d+[.)])?\s*/, '').trim();
const isHeading = (l: string) => /^\s*#/.test(l);
const headingText = (l: string) => l.replace(/^\s*#+\s*/, '').trim();
const isMarked = (l: string) => /^\s*>/.test(l);
// "> (end)": past the last beat.
const isBeat = (l: string) => !isHeading(l) && !!clean(l) && clean(l) !== '(end)';

export function parseOutline(text: string | undefined): Beats {
  const lines = (text ?? '').split('\n');
  const beats: string[] = [];
  const chapters: string[] = [];
  let chapter = '';
  let current = -1;
  for (const l of lines) {
    if (isHeading(l)) chapter = headingText(l);
    else if (isBeat(l)) {
      if (isMarked(l) && current < 0) current = beats.length;
      beats.push(clean(l));
      chapters.push(chapter);
    } else if (isMarked(l) && current < 0) current = beats.length; // "> (end)"
  }
  return { beats, chapters, current: current < 0 ? 0 : current };
}

/** Moves the marker by `by` beats, keeping everything else (headings, numbering) as written. */
export function moveMarker(text: string, by: number): string {
  const o = parseOutline(text);
  const target = Math.max(0, Math.min(o.beats.length, o.current + by));
  let n = 0;
  const lines = text
    .split('\n')
    .filter((l) => !(isMarked(l) && !isBeat(l) && !isHeading(l)))
    .map((l) => {
      const plain = isMarked(l) && !isHeading(l) ? l.replace(/^\s*>\s*/, '') : l;
      if (!isBeat(plain)) return plain;
      return n++ === target ? `> ${plain}` : plain;
    });
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (target >= o.beats.length && o.beats.length) lines.push('> (end)');
  return lines.join('\n');
}

/** Context blocks: the current beat near the reply, the next beats near the top. */
export function outlineBlocks(chat: Chat): ContextBlock[] {
  const ol = chat.outline;
  if (!ol || ol.off) return [];
  const { beats, current, chapters } = parseOutline(ol.text);
  if (current >= beats.length) return [];
  const ahead = beats
    .slice(current + 1, current + 1 + (ol.ahead ?? 2))
    .map((b, i) => (chapters[current + 1 + i] && chapters[current + 1 + i] !== chapters[current] ? `(${chapters[current + 1 + i]}) ${b}` : b));
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
    text: `[${chapters[current] ? `Current chapter: ${chapters[current]}. ` : ''}Current scene goal: ${beats[current]} Work toward it naturally; it doesn't have to be reached in this reply.]`,
    placement: { kind: 'depth', depth: Math.max(1, Math.floor(w.steeringDepth || 1)), mode: w.steeringMode === 'system' ? 'system' : 'inline' },
    source: 'outline',
  });
  return out;
}

