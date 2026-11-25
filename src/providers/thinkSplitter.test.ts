import { describe, expect, it } from 'vitest';
import { ThinkSplitter } from './thinkSplitter';

function run(chunks: string[], startInThink = false) {
  const s = new ThinkSplitter(startInThink);
  let c = '', r = '';
  for (const ch of chunks) { const o = s.push(ch); c += o.content; r += o.reasoning; }
  const f = s.flush(); c += f.content; r += f.reasoning;
  return { c, r };
}

describe('ThinkSplitter', () => {
  it('splits a think block across chunk boundaries', () => {
    expect(run(['<th', 'ink>plan', 'ning</th', 'ink>\n\nHello', ' world'])).toEqual({ c: 'Hello world', r: 'planning' });
  });
  it('passes plain content through', () => {
    expect(run(['Hi ', '<b>there</b>'])).toEqual({ c: 'Hi <b>there</b>', r: '' });
  });
  it('does not treat a later <think> as reasoning', () => {
    expect(run(['Story text. ', '<think>not reasoning</think>'])).toEqual({ c: 'Story text. <think>not reasoning</think>', r: '' });
  });
  it('handles output that starts mid-reasoning', () => {
    expect(run(['abc</think>done'], true)).toEqual({ c: 'done', r: 'abc' });
  });
});
