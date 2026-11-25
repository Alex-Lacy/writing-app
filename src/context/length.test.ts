import { describe, expect, it } from 'vitest';
import { backstopCut, countWords, lengthBlocks } from './length';

const words = (n: number, end = '.') => Array.from({ length: n }, (_, i) => `w${i}`).join(' ') + end;

describe('length buckets', () => {
  it('adds nothing for Any', () => {
    expect(lengthBlocks('any', 'system')).toEqual([]);
  });
  it('places the instruction at depth 1', () => {
    const [b] = lengthBlocks('scene', 'inline');
    expect(b.placement).toEqual({ kind: 'depth', depth: 1, mode: 'inline' });
    expect(b.text).toMatch(/one complete scene/);
  });
});

describe('backstopCut', () => {
  it('keeps going under the soft limit', () => {
    expect(backstopCut(words(200), 'short')).toBe(-1);
  });
  it('cuts at the first sentence end after the soft limit', () => {
    const text = words(240, '.') + ' More words that continue on and on';
    const cut = backstopCut(text, 'short');
    expect(text.slice(0, cut).endsWith('w239.')).toBe(true);
    expect(countWords(text.slice(0, cut))).toBe(240);
  });
  it('prefers a paragraph break when it comes first', () => {
    const text = words(235, '') + '\n\nNext paragraph starts. More.';
    const cut = backstopCut(text, 'short');
    expect(text.slice(0, cut)).toBe(words(235, ''));
  });
  it('waits for a clean break until the hard limit', () => {
    expect(backstopCut(words(300, ''), 'short')).toBe(-1);
  });
  it('never stops Whole story', () => {
    expect(backstopCut(words(20000), 'story')).toBe(-1);
  });
  it('only counts words after the offset (for Continue)', () => {
    const prior = words(1000) + ' ';
    expect(backstopCut(prior + words(100), 'short', prior.length)).toBe(-1);
  });
  it('treats closing quotes as part of the sentence end', () => {
    const text = words(232, '') + ' "She left." Then more text follows here';
    const cut = backstopCut(text, 'short');
    expect(text.slice(0, cut).endsWith('left."')).toBe(true);
  });
});
