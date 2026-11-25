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
}

export const LENGTH_BUCKETS: Record<LengthBucket, BucketDef> = {
  any: { label: 'Any length', instruction: '' },
  short: { label: 'Short (~150 words)', instruction: 'Keep this response short: about 150 words, one or two paragraphs.', softStop: 230, hardStop: 320 },
  medium: { label: 'Medium (~400 words)', instruction: 'Write a medium-length response: about 400 words.', softStop: 600, hardStop: 800 },
  long: { label: 'Long (~800 words)', instruction: 'Write a long response: about 800 words.', softStop: 1200, hardStop: 1600 },
  scene: {
    label: 'One scene',
    instruction: 'Write one complete scene (roughly 800 to 1,500 words) and end it at a natural scene break. Stop there; do not continue into the next scene.',
    softStop: 2200, hardStop: 3000,
  },
  chapter: {
    label: 'Chapter (several scenes)',
    instruction: 'Write a full chapter made of several connected scenes (roughly 2,500 to 4,000 words), ending at a natural chapter break.',
    softStop: 6000, hardStop: 8000,
  },
  story: { label: 'Whole story', instruction: 'Write the complete story from beginning to end, with a satisfying ending. Do not stop partway.' },
};

export const LENGTH_ORDER: LengthBucket[] = ['any', 'short', 'medium', 'long', 'scene', 'chapter', 'story'];

const SUFFIX = ' Finish at a natural stopping point rather than trailing off mid-sentence.';

/** Context contributor: the length instruction, inserted just before the latest message. */
export function lengthBlocks(bucket: LengthBucket | undefined, mode: 'system' | 'inline'): ContextBlock[] {
  const def = LENGTH_BUCKETS[bucket ?? 'any'];
  if (!def?.instruction) return [];
  return [{ id: 'length', label: 'Length', text: `[Response length: ${def.instruction}${SUFFIX}]`, placement: { kind: 'depth', depth: 1, mode } }];
}

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
