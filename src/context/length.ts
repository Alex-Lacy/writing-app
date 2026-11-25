import type { ContextBlock } from './build';

/**
 * Response length buckets. The model gets a soft instruction (placed with the Author's Note),
 * and a backstop watches only the reply text (never the reasoning) and ends the reply cleanly
 * at a sentence or paragraph end if it runs far past the target.
 */
export type LengthBucket = 'any' | 'short' | 'medium' | 'long' | 'scene' | 'chapter' | 'story';

interface BucketDef {
  label: string;
  /** Instruction given to the model. */
  instruction: string;
  /** Start looking for a clean stopping point after this many words (undefined = never). */
  softStop?: number;
  /** Cut at the last sentence end no matter what after this many words. */
  hardStop?: number;
  /** Also stop where a new scene / chapter begins. */
  breaks?: 'scene' | 'chapter';
}

export const LENGTH_BUCKETS: Record<LengthBucket, BucketDef> = {
  any: { label: 'Any length', instruction: '' },
  short: { label: 'Short (~150 words)', instruction: 'Reply in about 150 words (one or two short paragraphs), then stop.', softStop: 200, hardStop: 280 },
  medium: { label: 'Medium (~400 words)', instruction: 'Reply in about 400 words, then stop.', softStop: 520, hardStop: 700 },
  long: { label: 'Long (~800 words)', instruction: 'Reply in about 800 words, then stop.', softStop: 1050, hardStop: 1400 },
  scene: {
    label: 'One scene',
    instruction:
      'Write ONE scene only (about 600 to 1,200 words) and stop when it ends. Do not start a second scene, add a scene break (***), jump ahead in time, or summarise what happens next.',
    softStop: 1400, hardStop: 1800, breaks: 'scene',
  },
  chapter: {
    label: 'Chapter (several scenes)',
    instruction: 'Write one full chapter made of several connected scenes (about 2,500 to 4,000 words), then stop at the chapter break. Do not begin the next chapter.',
    softStop: 4800, hardStop: 6500, breaks: 'chapter',
  },
  story: { label: 'Whole story', instruction: 'Write the complete story from beginning to end, with a satisfying ending. Do not stop partway.' },
};

export const LENGTH_ORDER: LengthBucket[] = ['any', 'short', 'medium', 'long', 'scene', 'chapter', 'story'];

/** Context contributor: the length instruction, at the very end of the context (strongest spot). */
export function lengthBlocks(bucket: LengthBucket | undefined): ContextBlock[] {
  const def = LENGTH_BUCKETS[bucket ?? 'any'];
  if (!def?.instruction) return [];
  return [{ id: 'length', label: 'Length', source: 'length', text: `[Length: ${def.instruction}]`, placement: { kind: 'tail' } }];
}

/** Lines that mark the start of a new scene or chapter. */
const SCENE_BREAK = /\n[ \t]*(?:\*[ \t]*\*[ \t]*\*[ *\t]*|-{3,}|_{3,}|~{3,}|#{3,}|⁂|§|❖|◇|#{1,6}[ \t]+\S[^\n]{0,80}|(?:\*\*)?(?:Scene|Part|Chapter)[ \t]+(?:\d+|[IVXLC]+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)\b[^\n]{0,60})[ \t]*(?=\n)/i;
const CHAPTER_BREAK = /\n[ \t]*(?:#{1,6}[ \t]+)?(?:\*\*)?Chapter[ \t]+(?:\d+|[IVXLC]+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)\b[^\n]{0,60}(?=\n)/i;
/** Words a reply must have before a break counts (so a heading at the very start is fine). */
const MIN_BEFORE_BREAK = { scene: 120, chapter: 800 };

export const countWords = (s: string) => (s.match(/\S+/g) ?? []).length;

/**
 * Backstop. Given the reply text so far (words written in this generation only), returns the
 * index to cut at, or -1 to keep going. Past the soft limit it cuts at the first paragraph or
 * sentence end; past the hard limit at the last sentence end available.
 */
export function backstopCut(text: string, bucket: LengthBucket | undefined, startOffset = 0): number {
  const def = LENGTH_BUCKETS[bucket ?? 'any'];
  if (!def?.softStop) return -1;
  const fresh = text.slice(startOffset);
  const words = countWords(fresh);

  if (def.breaks) {
    const re = def.breaks === 'scene' ? SCENE_BREAK : CHAPTER_BREAK;
    const m = re.exec(fresh);
    if (m && countWords(fresh.slice(0, m.index)) >= MIN_BEFORE_BREAK[def.breaks]) return startOffset + m.index;
  }

  if (words < def.softStop) return -1;

  // Find the position (in fresh) where the soft limit was crossed, then the first clean break after it.
  let seen = 0;
  let softPos = 0;
  for (const m of fresh.matchAll(/\S+/g)) {
    if (++seen === def.softStop) { softPos = m.index!; break; }
  }
  const after = fresh.slice(softPos);
  const para = after.search(/\n\s*\n/);
  const sent = after.search(/[.!?…]["”’)\]*_]*\s/);
  const cands = [para, sent].filter((i) => i >= 0);
  if (cands.length) {
    const i = Math.min(...cands);
    const cut = i === para ? softPos + i : softPos + i + (after.slice(i).match(/^[.!?…]["”’)\]*_]*/)?.[0].length ?? 1);
    return startOffset + cut;
  }
  if (def.hardStop && words >= def.hardStop) {
    const all = [...fresh.matchAll(/[.!?…]["”’)\]*_]*(?=\s)/g)];
    const last = all.at(-1);
    return startOffset + (last ? last.index! + last[0].length : fresh.length);
  }
  return -1;
}
