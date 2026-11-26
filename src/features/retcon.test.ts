import { describe, expect, it } from 'vitest';
import { chunkMessages, findQuote, retconScope } from './retcon';
import type { Message } from '../types';

const msg = (id: string, content: string, role: Message['role'] = 'assistant') => ({ id, chatId: 'c', role, activeSwipe: 0, swipes: [{ content, createdAt: 0 }], createdAt: 0 }) as unknown as Message;

describe('retcon', () => {
  const ms = [msg('a', 'One.'), msg('b', 'Two.', 'user'), msg('c', ''), msg('d', 'Four.')];
  it('picks the scope, skipping empty messages', () => {
    expect(retconScope(ms, { fromId: 'b' }).map((m) => m.id)).toEqual(['b', 'd']);
    expect(retconScope(ms, { count: 2 }).map((m) => m.id)).toEqual(['b', 'd']);
    expect(retconScope(ms, {}).length).toBe(3);
  });
  it('numbers messages across chunks', () => {
    const big = [msg('x', 'a'.repeat(9000)), msg('y', 'b'.repeat(9000)), msg('z', 'c')];
    const ch = chunkMessages(big);
    expect(ch.length).toBe(2);
    expect(ch[1].map((p) => p.n)).toEqual([2, 3]);
  });
  it('finds quotes exactly or through Markdown marks', () => {
    expect(findQuote('He came back from the Sanctuary. Then slept.', 'He came back from the Sanctuary.')).toEqual({ from: 0, to: 32 });
    expect(findQuote('He came *back* from the Sanctuary.', 'He came back from the Sanctuary.')).toBeTruthy();
    expect(findQuote('Nothing here.', 'Not in it at all.')).toBeUndefined();
  });
});
