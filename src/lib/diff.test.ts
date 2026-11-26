import { describe, expect, it } from 'vitest';
import { keptShare, wordDiff } from './diff';

describe('wordDiff', () => {
  it('marks only the changed words', () => {
    const d = wordDiff('Keep the tone playful. Rotate through the camps.', 'Keep the tone playful. Give each pairing a scene.')!;
    expect(d[0]).toEqual({ kind: 'same', text: 'Keep the tone playful. ' });
    expect(d.filter((p) => p.kind === 'del').map((p) => p.text).join('')).toContain('Rotate');
    expect(d.filter((p) => p.kind === 'ins').map((p) => p.text).join('')).toContain('Give each pairing');
  });
  it('reads back both texts', () => {
    const a = 'one two three four five', b = 'one 2 three five six';
    const d = wordDiff(a, b)!;
    expect(d.filter((p) => p.kind !== 'ins').map((p) => p.text).join('')).toBe(a);
    expect(d.filter((p) => p.kind !== 'del').map((p) => p.text).join('')).toBe(b);
  });
  it('reports how much was kept', () => {
    expect(keptShare(wordDiff('a b c', 'a b c')!, 'a b c')).toBe(1);
    expect(keptShare(wordDiff('alpha beta', 'gamma delta')!, 'alpha beta')).toBeLessThan(0.2);
  });
});
