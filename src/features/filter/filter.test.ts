import { describe, expect, it } from 'vitest';
import { locate } from '../../components/messageHooks';
import { spotsFor } from './filter';
import { compileRules, scan, sentenceAround } from './rules';

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

describe('locate', () => {
  it('picks the copy nearest the selection', () => {
    const src = 'She nodded. He left. She nodded.';
    expect(locate(src, 'She nodded.', 25)).toEqual({ from: 21, to: 32 });
    expect(locate(src, 'She nodded.', 0)).toEqual({ from: 0, to: 11 });
  });
});

describe('rules found missing in a live story', () => {
  it('catches them', () => {
    const t = "Her heart quickened. The hairs on the back of her neck stood up. Mara's jaw clenched. His voice held a note of desperate hope, breath coming quick and shallow.";
    const ids = scan(t, compileRules().rules).map((h) => h.ruleId);
    expect(ids).toEqual(['heart-reacts', 'neck-hairs', 'jaw-clenched', 'voice-held-note', 'quick-shallow-breath']);
  });
});

describe('locate with emphasis next to punctuation', () => {
  it('finds it', () => {
    const src = 'with a name. *Orrin Kessler*. And a date.';
    expect(locate(src, 'name. Orrin Kessler. And')).toEqual({ from: 7, to: 33 });
  });
});

describe('sentenceAround quotes', () => {
  it('keeps the opening quote of dialogue and drops the closing quote of the sentence before', () => {
    const t = 'She left. "It could be nothing," Tobias said, his voice held a note of hope. "Go." He ran down her spine.';
    const a = t.indexOf('voice');
    const r = sentenceAround(t, a, a + 5);
    expect(t.slice(r.from, r.to)).toBe('"It could be nothing," Tobias said, his voice held a note of hope.');
    const b = t.indexOf('ran');
    const r2 = sentenceAround(t, b, b + 3);
    expect(t.slice(r2.from, r2.to)).toBe('He ran down her spine.');
  });
});

describe('fixes per reply', () => {
  it('follows Length unless set', async () => {
    const { autoLimitFor } = await import('./filter');
    const c = (x: object) => x as Parameters<typeof autoLimitFor>[0];
    expect(autoLimitFor(c({ length: 'short' }))).toBe(2);
    expect(autoLimitFor(c({ length: 'chapter' }))).toBe(10);
    expect(autoLimitFor(c({ length: 'any' }), 1000)).toBe(5);
    expect(autoLimitFor(c({ length: 'any' }), 50)).toBe(2);
    expect(autoLimitFor(c({ length: 'chapter', filter: { mode: 'auto', autoLimit: 3 } }))).toBe(3);
  });
});
