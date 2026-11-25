import { describe, expect, it } from 'vitest';
import { applySplit, ThinkSplitter } from './thinkSplitter';

function run(chunks: string[], expectThinking = false, fieldAt?: number) {
  const s = new ThinkSplitter(expectThinking);
  let acc = { content: '', reasoning: '' };
  const seen: string[] = [];
  chunks.forEach((ch, i) => {
    if (i === fieldAt) acc = applySplit(acc, s.reasoningElsewhere());
    acc = applySplit(acc, s.push(ch));
    seen.push(acc.content);
  });
  acc = applySplit(acc, s.flush());
  return { c: acc.content, r: acc.reasoning, seen };
}

describe('ThinkSplitter', () => {
  it('splits a think block across chunk boundaries', () => {
    expect(run(['<th', 'ink>plan', 'ning</th', 'ink>\n\nHello', ' world'])).toMatchObject({ c: 'Hello world', r: 'planning' });
  });
  it('passes plain content through', () => {
    expect(run(['Hi ', '<b>there</b>'])).toMatchObject({ c: 'Hi <b>there</b>', r: '' });
  });
  it('does not treat a later <think> block as reasoning', () => {
    expect(run(['Story text. ', '<think>not reasoning</think>'])).toMatchObject({ c: 'Story text. <think>not reasoning</think>', r: '' });
  });
  it('a lone closing tag turns what came before into reasoning (template opened the block)', () => {
    const out = run(['Let me plan', ' the scene.', '</thi', 'nk>\n\nShe ran.']);
    expect(out).toMatchObject({ c: 'She ran.', r: 'Let me plan the scene.' });
    expect(out.seen[1]).toBe('Let me plan the scene.'); // shown, then moved
  });
  it('expecting thinking: reasoning never shows as text', () => {
    const out = run(['Let me plan', ' the scene.', '</think>', 'She ran.'], true);
    expect(out).toMatchObject({ c: 'She ran.', r: 'Let me plan the scene.' });
    expect(out.seen.slice(0, 3)).toEqual(['', '', '']);
  });
  it('expecting thinking, but the model opens its own block', () => {
    expect(run(['<think>', 'plan</think>', 'Text'], true)).toMatchObject({ c: 'Text', r: 'plan' });
  });
  it('expecting thinking, but no closing tag ever comes: it was the answer', () => {
    expect(run(['She ran ', 'home.'], true)).toMatchObject({ c: 'She ran home.', r: '' });
  });
  it('expecting thinking, but the server sends reasoning separately', () => {
    expect(run(['', 'She ran.'], true, 1)).toMatchObject({ c: 'She ran.', r: '' });
  });
});
