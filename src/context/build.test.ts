import { describe, expect, it } from 'vitest';
import { buildContext, writingBlocks, type HistoryItem } from './build';
import { DEFAULT_WRITING } from '../types';

const hist = (n: number, len = 10): HistoryItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `msg${i} ` + 'x'.repeat(len) }));

describe('buildContext', () => {
  it('puts system prompt and memory in one leading system message', () => {
    const r = buildContext({
      systemPrompt: 'SYS',
      blocks: writingBlocks({ ...DEFAULT_WRITING, enabled: true, memory: 'MEM' }),
      history: hist(2),
      contextLimit: 32768, maxTokens: 512, safetyMargin: 0,
    });
    expect(r.messages[0]).toEqual({ role: 'system', content: 'SYS\n\nMEM' });
    expect(r.messages).toHaveLength(3);
  });

  it('ignores writing blocks when the toggle is off', () => {
    expect(writingBlocks({ ...DEFAULT_WRITING, memory: 'MEM', authorsNote: 'AN' })).toEqual([]);
  });

  it("inserts the Author's Note just before the latest message at depth 1", () => {
    const r = buildContext({
      systemPrompt: '',
      blocks: writingBlocks({ ...DEFAULT_WRITING, enabled: true, authorsNote: 'AN', anDepth: 1 }),
      history: hist(4),
      contextLimit: 32768, maxTokens: 512, safetyMargin: 0,
    });
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'system', 'assistant']);
    expect(r.messages[3].content).toBe('AN');
  });

  it('inline mode merges the note into the next message to keep strict role alternation', () => {
    const r = buildContext({
      systemPrompt: '',
      blocks: writingBlocks({ ...DEFAULT_WRITING, enabled: true, authorsNote: 'AN', anDepth: 2, anRole: 'inline' }),
      history: hist(3),
      contextLimit: 32768, maxTokens: 512, safetyMargin: 0,
    });
    expect(r.messages).toHaveLength(3);
    expect(String(r.messages[1].content)).toMatch(/^\[Author's Note: AN\]/);
  });

  it('drops oldest history to fit the budget but keeps the latest message', () => {
    const r = buildContext({
      systemPrompt: 'SYS', blocks: [], history: hist(50, 330), // ~100 tokens each
      contextLimit: 2000, maxTokens: 500, safetyMargin: 100,
    });
    expect(r.droppedIds.length).toBeGreaterThan(0);
    expect(r.includedIds.at(-1)).toBe('m49');
    expect(r.droppedIds[0]).toBe('m0');
    expect(r.tokens.total).toBeLessThanOrEqual(r.tokens.budget);
  });

  it('flags overflow when the latest message alone is too big', () => {
    const r = buildContext({ systemPrompt: '', blocks: [], history: hist(1, 10000), contextLimit: 1000, maxTokens: 100, safetyMargin: 0 });
    expect(r.overflow).toBe(true);
    expect(r.includedIds).toEqual(['m0']);
  });
});
