import { describe, expect, it } from 'vitest';
import { contextError, fitRequest } from './fit';

describe('fitting a job into the context', () => {
  it('reads the provider error', () => {
    const e = contextError("Maximum context length for model 'x' allowed on your plan is 32768 tokens. Your prompt has 32198 tokens plus max_tokens=8000 = 40198 total");
    expect(e).toEqual({ limit: 32768, prompt: 32198 });
    expect(contextError('Rate limited')).toBeUndefined();
  });
  it('shrinks the reply room, then drops the oldest turns', () => {
    const sys = { role: 'system' as const, content: 'x'.repeat(4000) };
    const turns = Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: 'y'.repeat(4000) }));
    const all = [sys, ...turns];
    expect(fitRequest(all, 1000, 100000).maxOut).toBe(1000);
    const tight = fitRequest(all, 8000, 14000);
    expect(tight.maxOut).toBeGreaterThanOrEqual(1536);
    expect(tight.messages[0]).toBe(sys);
    expect(tight.messages.at(-1)).toBe(turns.at(-1));
    expect(tight.messages[1].role).toBe('user');
    expect(tight.dropped).toBeGreaterThan(0);
  });
});
