import { describe, expect, it } from 'vitest';
import { buildContext, writingBlocks, type HistoryItem } from './build';
import { DEFAULT_WRITING } from '../types';

const hist = (n: number, len = 10): HistoryItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `msg${i} ` + 'x'.repeat(len) }));

describe('buildContext', () => {
  it('puts system prompt and memory in one leading system message', () => {
    const r = buildContext({
      systemPrompt: 'SYS',
      blocks: writingBlocks({ ...DEFAULT_WRITING, enabled: true, background: 'MEM' }),
      history: hist(2),
      contextLimit: 32768, maxTokens: 512, safetyMargin: 0,
    });
    expect(r.messages[0]).toEqual({ role: 'system', content: 'SYS\n\nMEM' });
    expect(r.messages).toHaveLength(3);
  });

  it('sends Background and Steering whenever they have text (there is no on/off switch)', () => {
    expect(writingBlocks({ ...DEFAULT_WRITING, enabled: false, background: 'MEM', steering: 'AN' }).map((b) => b.id)).toEqual(['background', 'steering']);
    expect(writingBlocks({ ...DEFAULT_WRITING, background: ' ', steering: '' })).toEqual([]);
  });

  it("inserts the Steering just before the latest message at depth 1", () => {
    const r = buildContext({
      systemPrompt: '',
      blocks: writingBlocks({ ...DEFAULT_WRITING, enabled: true, steering: 'AN', steeringDepth: 1, steeringMode: 'system' }),
      history: hist(4),
      contextLimit: 32768, maxTokens: 512, safetyMargin: 0,
    });
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'system', 'assistant']);
    expect(r.messages[3].content).toBe('AN');
  });

  it('inline mode merges the note into the next message to keep strict role alternation', () => {
    const r = buildContext({
      systemPrompt: '',
      blocks: writingBlocks({ ...DEFAULT_WRITING, enabled: true, steering: 'AN', steeringDepth: 2, steeringMode: 'inline' }),
      history: hist(3),
      contextLimit: 32768, maxTokens: 512, safetyMargin: 0,
    });
    expect(r.messages).toHaveLength(3);
    expect(String(r.messages[2].content)).toMatch(/^\[Steering: AN\]/); // skips the AI reply at depth 2
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

describe('shared depth', () => {
  it('puts the length instruction at the end of the latest user message', async () => {
    const { lengthBlocks } = await import('./length');
    const r = buildContext({
      systemPrompt: 'SYS',
      blocks: [...writingBlocks({ ...DEFAULT_WRITING, enabled: true, steering: 'AN' }), ...lengthBlocks('short')],
      history: hist(3),
      contextLimit: 32768, maxTokens: 512, safetyMargin: 0,
    });
    expect(r.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(String(r.messages[3].content)).toMatch(/^\[Steering: AN\]\n\nmsg2 x+\n\n\[Length: Reply in about 150 words/);
    expect(r.annotated[3].parts.map((p) => p.source)).toEqual(['steering', 'user', 'length']);
    expect(r.totals.map((t) => t.source)).toEqual(['system', 'user', 'assistant', 'steering', 'length']);
  });

  it('adds a user message for the length instruction when the chat ends on a reply', async () => {
    const { lengthBlocks } = await import('./length');
    const r = buildContext({ systemPrompt: '', blocks: lengthBlocks('scene'), history: hist(2), contextLimit: 32768, maxTokens: 512, safetyMargin: 0 });
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(r.annotated[2].parts[0].source).toBe('length');
  });
});

describe('inline notes never go into AI replies', () => {
  it('moves the note to a new user message when the chat ends on a reply', () => {
    const r = buildContext({
      systemPrompt: '',
      blocks: writingBlocks({ ...DEFAULT_WRITING, enabled: true, steering: 'AN', steeringDepth: 1, steeringMode: 'inline' }),
      history: hist(2),
      contextLimit: 32768, maxTokens: 512, safetyMargin: 0,
    });
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(r.messages[2].content).toBe("[Steering: AN]");
  });
});

describe('buildContext in Continue mode', () => {
  const blocks = [
    ...writingBlocks({ ...DEFAULT_WRITING, enabled: true, steering: 'AN', steeringDepth: 1, steeringMode: 'inline' }),
    { id: 'length', label: 'Length', source: 'length' as const, text: '[Length: one scene]', placement: { kind: 'tail' as const } },
  ];
  const history: HistoryItem[] = [
    { id: 'u', role: 'user', content: 'Write it.' },
    { id: 'a', role: 'assistant', content: 'Half a reply' },
  ];

  it('keeps the reply being continued as the last message', () => {
    const r = buildContext({ systemPrompt: '', blocks, history, contextLimit: 32768, maxTokens: 512, safetyMargin: 0, continueLast: true });
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(r.messages[1].content).toBe('Half a reply');
    expect(r.messages[0].content).toContain('AN');
    expect(r.messages[0].content).toContain('[Length: one scene]');
  });

  it('adds a user message before the reply when there is no earlier one', () => {
    const r = buildContext({ systemPrompt: '', blocks, history: [history[1]], contextLimit: 32768, maxTokens: 512, safetyMargin: 0, continueLast: true });
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(r.messages.at(-1)!.content).toBe('Half a reply');
  });

  it('without Continue, notes after a reply still go in a new user message', () => {
    const r = buildContext({ systemPrompt: '', blocks, history, contextLimit: 32768, maxTokens: 512, safetyMargin: 0 });
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});
