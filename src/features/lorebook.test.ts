import { describe, expect, it } from 'vitest';
import { mergeEntries, parseLorebook } from './lorebook';
import type { CodexBook } from '../types';

const nai = JSON.stringify({
  lorebookVersion: 5,
  entries: [
    { displayName: 'Rell', keys: ['Rell', 'the smuggler'], text: 'A smuggler.', enabled: true, category: 'c1', contextConfig: { budgetPriority: 600 } },
    { displayName: 'Old docks', keys: ['docks'], text: 'Rotting piers.', enabled: false, category: 'c2', forceActivation: true },
    { displayName: '', keys: ['Mara'], text: 'The detective.', category: 'c1' },
  ],
  categories: [{ id: 'c1', name: 'Characters', enabled: true }, { id: 'c2', name: 'Places', enabled: true }],
});

describe('lorebook import', () => {
  it('reads a NovelAI lorebook: names, keys, categories, switched-off entries, priority', () => {
    const p = parseLorebook(nai);
    expect(p.format).toBe('NovelAI');
    expect(p.entries.map((x) => [x.entry.name, x.category, x.off])).toEqual([['Rell', 'Characters', false], ['Old docks', 'Places', true], ['Mara', 'Characters', false]]);
    expect(p.entries[0].entry.keys).toEqual(['Rell', 'the smuggler']);
    expect(p.entries[0].entry.priority).toBe(2);
    expect(p.entries[1].entry.alwaysOn).toBe(true);
  });
  it('reads the lorebook inside a NovelAI scenario', () => {
    expect(parseLorebook(JSON.stringify({ scenarioVersion: 3, lorebook: JSON.parse(nai) })).entries).toHaveLength(3);
  });
  it('reads SillyTavern world info and character card books', () => {
    const st = parseLorebook(JSON.stringify({ entries: { 0: { key: ['Rell'], comment: 'Rell', content: 'Smuggler', constant: true }, 1: { key: ['x'], content: 'y', disable: true } } }));
    expect(st.format).toBe('SillyTavern');
    expect(st.entries.map((x) => [x.entry.name, x.entry.alwaysOn, x.off])).toEqual([['Rell', true, false], ['x', undefined, true]]);
    const card = parseLorebook(JSON.stringify({ spec: 'chara_card_v2', data: { character_book: { name: 'World', entries: [{ keys: ['Port'], content: 'A city', name: 'Port city', enabled: true }] } } }));
    expect(card.entries[0].entry.name).toBe('Port city');
  });
  it('explains files it cannot read', () => {
    expect(() => parseLorebook('not json')).toThrow(/isn't JSON/);
    expect(() => parseLorebook('{"a":1}')).toThrow(/entries/);
  });
  it('handles same-name entries by skipping, replacing or keeping both', () => {
    const book: CodexBook = { id: 'b', name: 'B', entries: [{ id: 'mine', name: 'Rell', keys: [], text: 'mine', enabled: true }], createdAt: 0, updatedAt: 0 };
    const incoming = parseLorebook(nai).entries.map((x) => x.entry);
    expect(mergeEntries(book, incoming, 'skip')).toMatchObject({ added: 2, skipped: 1 });
    const r = mergeEntries(book, incoming, 'replace');
    expect(r.replaced).toBe(1);
    expect(r.book.entries[0]).toMatchObject({ id: 'mine', text: 'A smuggler.' });
    expect(mergeEntries(book, incoming, 'both').book.entries).toHaveLength(4);
  });
});
