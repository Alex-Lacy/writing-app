import { describe, expect, it } from 'vitest';
import { locate } from '../../components/messageHooks';
import { spotsFor } from './filter';
import { compileRules, scan } from './rules';

describe('Cliché Filter helpers', () => {
  it('groups hits in one sentence into one spot', () => {
    const text = 'Hello there. A shiver ran down her spine, a testament to her fear. Then quiet.';
    const { rules } = compileRules();
    const hits = scan(text, rules);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const spots = spotsFor(text, hits);
    expect(spots).toHaveLength(1);
    expect(text.slice(spots[0].from, spots[0].to).trim()).toBe('A shiver ran down her spine, a testament to her fear.');
  });

  it('finds highlighted text in Markdown source', () => {
    const src = 'She said **no** and\nleft the *room*.';
    expect(locate(src, 'no and left the room')).toEqual({ from: 9, to: 35 });
    expect(locate(src, 'left')).toEqual({ from: 20, to: 24 });
    expect(locate(src, 'nothing here')).toBeUndefined();
  });
});
