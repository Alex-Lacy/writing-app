import { describe, expect, it } from 'vitest';
import { budget, cutItems, cutText, PINNED, type Section, type Turn } from './budget';

const words = (n: number, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i}.`).join(' ');
const turns = (n: number, len = 300): Turn[] => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i} ${words(len)}` }));

describe('budget', () => {
  const codex: Section = { id: 'codex', label: 'Codex entries', keep: PINNED, items: [
    { text: `- Citadel: ${words(200)}`, score: 5, short: 'Citadel' },
    { text: `- Mara: ${words(200)}`, score: 1, short: 'Mara' },
  ] };
  const story: Section = { id: 'story', label: 'Recent story', keep: 40, floor: 400, keepEnd: 'end', text: `OLDEST ${words(3000)} NEWEST` };

  it('sends everything when it fits', () => {
    const r = budget({ head: 'H', sections: [codex, story], turns: turns(4), keepTurns: 4, reply: { want: 4000, floor: 2000 }, limit: 100000 });
    expect(r.report.every((x) => x.status === 'full')).toBe(true);
    expect(r.turns.length).toBe(4);
    expect(r.reply).toBe(4000);
    expect(r.error).toBeUndefined();
  });

  it('cuts story text before the pinned Codex, keeping the newest story', () => {
    const r = budget({ head: 'H', sections: [codex, story], turns: turns(2), keepTurns: 2, reply: { want: 4000, floor: 2000 }, limit: 9000 });
    expect(r.report.find((x) => x.id === 'codex')!.status).toBe('full');
    expect(r.report.find((x) => x.id === 'story')!.status).not.toBe('full');
    expect(r.system).toContain('NEWEST');
    expect(r.system).not.toContain('OLDEST');
    expect(r.total + r.reply).toBeLessThanOrEqual(9000);
  });

  it('folds older chat turns into a recap but keeps the newest whole', () => {
    const t = turns(12, 400);
    const r = budget({ head: 'H', sections: [codex], turns: t, keepTurns: 4, reply: { want: 4000, floor: 2000 }, limit: 10000 });
    expect(r.folded).toBeGreaterThan(0);
    expect(r.turns.at(-1)).toBe(t.at(-1));
    expect(r.turns.length).toBeGreaterThanOrEqual(3);
    expect(r.turns[0].role).toBe('user');
    expect(r.reply).toBeGreaterThanOrEqual(2000);
  });

  it('keeps room for the reply before dropping the floors', () => {
    const r = budget({ head: 'H', sections: [codex, story], turns: turns(2, 50), keepTurns: 2, reply: { want: 6000, floor: 3000 }, limit: 6000 });
    expect(r.reply).toBeGreaterThanOrEqual(3000);
  });

  it('says what is too big when even the pinned parts do not fit', () => {
    const huge: Section = { id: 'codex', label: 'Codex entries', keep: PINNED, text: words(20000) };
    const r = budget({ head: 'H', sections: [huge], turns: turns(1), keepTurns: 2, reply: { want: 4000, floor: 2000 }, limit: 8000 });
    expect(r.error).toMatch(/Codex entries/);
  });

  it('cuts lists by relevance and text at a break', () => {
    const one = Math.ceil(codex.items![0].text.length / 3);
    const r = cutItems(codex.items!, one);
    expect(r.text).toContain('Citadel');
    expect(r.text).toMatch(/not shown in full: Mara|1 more/);
    expect(cutText(words(400), 100, 'end')).toMatch(/word399\.$/);
    expect(cutText(words(400), 100, 'start')).toMatch(/^word0\./);
  });
});
