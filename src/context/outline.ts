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

const clean = (l: string) => l.replace(/^\s*(?:>\s*)?(?:[-*•]|\d+[.)])?\s*!?\s*/, '').trim();
/** A moment the writer asked for: "!" at the start. Written-out scene beats always keep it. */
export const isPinned = (l: string) => /^\s*(?:>\s*)?(?:[-*•]|\d+[.)])?\s*!/.test(l);
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

export interface Chapter {
  title: string;
  /** Line index of the heading. */
  line: number;
  /** Beat indexes in this chapter (into Beats.beats). */
  beats: number[];
  /** The writer's must-have moments in it ("!" lines), as written. */
  pins: string[];
  /** Only pinned moments (or nothing) so far: its scenes haven't been written out. */
  open: boolean;
}

export function chaptersOf(text: string | undefined): Chapter[] {
  const out: (Chapter & { plain: number })[] = [];
  let n = 0;
  (text ?? '').split('\n').forEach((l, line) => {
    if (isHeading(l)) out.push({ title: headingText(l), line, beats: [], pins: [], open: true, plain: 0 });
    else if (isBeat(l)) {
      const c = out.at(-1);
      if (c) {
        c.beats.push(n);
        if (isPinned(l)) c.pins.push(clean(l));
        else c.plain++;
      }
      n++;
    }
  });
  return out.map(({ plain, ...c }) => ({ ...c, open: plain === 0 }));
}

/**
 * The chapter whose scenes should be written out now, if any: the next chapter that has only
 * pinned moments (or nothing), once the story is on the last beat before it or inside it.
 */
export function chapterNeedingBeats(text: string | undefined): Chapter | undefined {
  const o = parseOutline(text);
  const lines = (text ?? '').split('\n');
  for (const c of chaptersOf(text)) {
    if (!c.open) continue;
    const before = lines.slice(0, c.line).filter(isBeat).length;
    return o.current >= before - 1 ? c : undefined; // a later chapter waits for this one
  }
  return undefined;
}

const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9']+/g, ' ').split(' ').filter((w) => w.length > 2));
/** Share of the pinned moment's words found in a beat. */
function overlap(pin: string, beat: string) {
  const p = words(pin), b = words(beat);
  return p.size ? [...p].filter((w) => b.has(w)).length / p.size : 0;
}

/** The writer's pinned moments survive whatever the model wrote: kept word for word, marked "!". */
export function keepPins(written: string[], pins: string[]): string[] {
  const out = written.map((b) => b.replace(/^\s*!\s*/, '').trim()).filter(Boolean);
  const marked = new Set<number>();
  let at = 0;
  for (const p of pins) {
    // The model may reword it a little: the closest beat sharing most of its words is that moment.
    let i = -1, best = 0.6;
    out.forEach((b, k) => {
      if (marked.has(k)) return;
      const score = overlap(p, b);
      if (score >= best) [i, best] = [k, score];
    });
    if (i >= 0) {
      out[i] = p;
      marked.add(i);
      at = i + 1;
    } else {
      out.splice(at, 0, p); // dropped by the model: put it back where it belongs
      for (const k of [...marked]) if (k >= at) { marked.delete(k); marked.add(k + 1); }
      marked.add(at);
      at++;
    }
  }
  return out.map((b, k) => (marked.has(k) ? `! ${b}` : b));
}

/** Replaces a chapter's beat lines with its written-out scenes. Keeps the marker in the chapter, or starts it there if the story had run out. */
export function setChapterBeats(text: string, ch: Chapter, beats: string[]): string {
  const o = parseOutline(text);
  const ended = o.current >= o.beats.length;
  const lines = text.split('\n');
  let end = lines.findIndex((l, i) => i > ch.line && isHeading(l));
  if (end < 0) end = lines.length;
  const inside = lines.slice(ch.line + 1, end);
  const markHere = ended || inside.some((l) => isBeat(l) && isMarked(l));
  const kept = inside.filter((l) => !isBeat(l) && !(isMarked(l) && !isHeading(l)));
  const before = lines.slice(0, ch.line + 1);
  const after = lines.slice(end).filter((l) => !(ended && isMarked(l) && !isBeat(l) && !isHeading(l)));
  const fresh = beats.map((b, i) => (markHere && i === 0 ? `> ${b}` : b));
  return [...before.filter((l) => !(ended && isMarked(l) && !isBeat(l) && !isHeading(l))), ...fresh, ...kept.filter((l) => l.trim()), ...(after.length ? [''] : []), ...after].join('\n');
}

/** Context blocks: the chapter plan and the next scenes near the top, the current scene near the reply. */
export function outlineBlocks(chat: Chat): ContextBlock[] {
  const ol = chat.outline;
  if (!ol || ol.off) return [];
  const { beats, current, chapters } = parseOutline(ol.text);
  if (current >= beats.length) return [];
  const ahead = beats
    .slice(current + 1, current + 1 + (ol.ahead ?? 2))
    .map((b, i) => (chapters[current + 1 + i] && chapters[current + 1 + i] !== chapters[current] ? `(${chapters[current + 1 + i]}) ${b}` : b));
  const out: ContextBlock[] = [];
  const chs = chaptersOf(ol.text);
  if (chs.length > 1) {
    const here = chs.findIndex((c) => c.beats.includes(current));
    out.push({
      id: 'outline-chapters',
      label: 'Outline: chapters',
      text: `[The story's plan by chapter, for orientation only. Stay on the current scene; don't skip ahead, rush, or foreshadow later chapters.\n${chs.map((c, i) => `- ${c.title}${i < here ? ' (done)' : i === here ? ' (current chapter)' : ''}`).join('\n')}]`,
      placement: { kind: 'top', order: 11 },
      source: 'outline',
    });
  }
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

