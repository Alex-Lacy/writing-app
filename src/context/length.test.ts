import { describe, expect, it } from 'vitest';
import { backstopCut, countWords, lengthBlocks } from './length';

const words = (n: number, end = '.') => Array.from({ length: n }, (_, i) => `w${i}`).join(' ') + end;

describe('length buckets', () => {
  it('adds nothing for Any', () => {
    expect(lengthBlocks('any')).toEqual([]);
  });
  it('places the instruction at the tail', () => {
    const [b] = lengthBlocks('scene');
    expect(b.placement).toEqual({ kind: 'tail' });
    expect(b.text).toMatch(/ONE scene only/);
  });
});

describe('backstopCut', () => {
  it('keeps going under the soft limit', () => {
    expect(backstopCut(words(200), 'short')).toBe(-1);
  });
  it('cuts at the first sentence end after the soft limit', () => {
    const text = words(210, '.') + ' More words that continue on and on';
    const cut = backstopCut(text, 'short');
    expect(text.slice(0, cut).endsWith('w209.')).toBe(true);
    expect(countWords(text.slice(0, cut))).toBe(210);
  });
  it('prefers a paragraph break when it comes first', () => {
    const text = words(205, '') + '\n\nNext paragraph starts. More.';
    const cut = backstopCut(text, 'short');
    expect(text.slice(0, cut)).toBe(words(205, ''));
  });
  it('waits for a clean break until the hard limit', () => {
    expect(backstopCut(words(270, ''), 'short')).toBe(-1);
  });
  it('stops One scene at a scene break once the scene has some length', () => {
    const scene1 = words(300) ;
    for (const brk of ['***', '* * *', '---', '## Scene 2', 'Scene Two', '⁂']) {
      const text = `${scene1}\n\n${brk}\n\nThe next morning`;
      expect(text.slice(0, backstopCut(text, 'scene'))).toBe(`${scene1}\n`);
    }
  });
  it('ignores a heading at the very start of a scene', () => {
    expect(backstopCut('## The Docks\n\n' + words(50), 'scene')).toBe(-1);
  });
  it('does not mistake bold text or ordinary sentences for breaks', () => {
    const text = `${words(300)}\n**Mara** smiled.\nPart of her wanted to stay.\nmore`;
    expect(backstopCut(text, 'scene')).toBe(-1);
  });
  it('stops Chapter at the next chapter heading', () => {
    const text = `${words(900)}\n\nChapter 2: The Fall\n\nIt began`;
    expect(backstopCut(text, 'chapter')).toBe(words(900).length + 1);
  });
  it('never stops Whole story', () => {
    expect(backstopCut(words(20000), 'story')).toBe(-1);
  });
  it('only counts words after the offset (for Continue)', () => {
    const prior = words(1000) + ' ';
    expect(backstopCut(prior + words(100), 'short', prior.length)).toBe(-1);
  });
  it('treats closing quotes as part of the sentence end', () => {
    const text = words(202, '') + ' "She left." Then more text follows here';
    const cut = backstopCut(text, 'short');
    expect(text.slice(0, cut).endsWith('left."')).toBe(true);
  });
});
