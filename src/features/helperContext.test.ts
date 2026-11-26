import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WRITING, type Chat, type HelperDef, type Message } from '../types';

const { useStore } = await import('../store/store');
const { helperFit, codexScore } = await import('./helperContext');

const words = (n: number, w = 'w') => Array.from({ length: n }, (_, i) => `${w}${i}.`).join(' ');
const chat = { id: 'c', num: 1, title: 'T', systemPrompt: 'Be good.', writing: { ...DEFAULT_WRITING, background: 'Royal court intrigue.' }, codexId: 'b' } as unknown as Chat;
const entries = Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, name: i === 7 ? 'Citadel' : `Thing${i}`, keys: [], text: words(150), enabled: true }));
useStore.setState({ chats: [chat], codex: [{ id: 'b', name: 'T (story)', chatId: 'c', entries, createdAt: 0, updatedAt: 0 }] } as never);
const msg = (i: number): Message => ({ id: `m${i}`, chatId: 'c', role: i % 2 ? 'assistant' : 'user', activeSwipe: 0, swipes: [{ content: `${i === 0 ? 'OLDEST ' : ''}${words(400)}${i === 59 ? ' NEWEST' : ''}`, createdAt: 0 }], createdAt: 0 }) as unknown as Message;
const story = Array.from({ length: 60 }, (_, i) => msg(i));
const helper = (id: string) => ({ id, name: id, instructions: 'You help.' }) as HelperDef;
const convo = (last: string) => [
  ...Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `old turn ${i} ${words(300)}`, createdAt: 0 })),
  { role: 'user' as const, content: last, createdAt: 0 },
];

describe('Helper context', () => {
  it('Codex editor keeps the entry being discussed and lets story text go first', () => {
    let report: { id: string; status: string }[] = [];
    const fit = helperFit({ head: 'H', chat, helper: helper('helper-codex'), convo: convo('Update the Citadel entry, please.'), story, others: '', reply: 8000, replyFloor: 3000 }, (b) => (report = b.report));
    const r = fit(16000, 1);
    expect(r.error).toBeUndefined();
    const sys = r.messages[0].content as string;
    expect(sys).toContain('- Citadel');
    expect(report.find((x) => x.id === 'story')!.status).not.toBe('full');
    expect(sys).toContain('NEWEST');
    expect(r.messages.at(-1)!.content).toContain('Citadel');
    expect(r.maxTokens).toBeGreaterThanOrEqual(3000);
  });
  it('Plot ideas keeps the Background over the Codex', () => {
    let report: { id: string; status: string }[] = [];
    helperFit({ head: 'H', chat, helper: helper('helper-plot'), convo: convo('What next?'), story, others: '', reply: 8000, replyFloor: 3000 }, (b) => (report = b.report))(12000, 1);
    expect(report.find((x) => x.id === 'background')!.status).toBe('full');
    expect(report.find((x) => x.id === 'codex')!.status).not.toBe('full');
  });
  it('sends everything when the window is big', () => {
    let folded = -1;
    helperFit({ head: 'H', chat, helper: helper('helper-codex'), convo: convo('Hi'), story: story.slice(-4), others: '', reply: 8000, replyFloor: 3000 }, (b) => (folded = b.folded))(262144, 1);
    expect(folded).toBe(0);
  });
  it('scores entries named in the latest message highest', () => {
    expect(codexScore({ name: 'Citadel', keys: [] }, 'fix the citadel', '', '')).toBeGreaterThan(codexScore({ name: 'Citadel', keys: [] }, '', 'citadel', 'citadel'));
  });
});
