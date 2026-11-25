import { describe, expect, it } from 'vitest';
import { chunkText, foldFound } from './extract';
import { NotALorebook, parseLorebook } from './lorebook';
import type { CodexEntry } from '../types';

describe('lorebook files in other shapes', () => {
  it('reads an Agnai-style memory book (entry / keywords)', () => {
    const p = parseLorebook(JSON.stringify({ kind: 'memory', name: 'W', entries: [{ name: 'Rell', entry: 'A smuggler.', keywords: ['Rell'], enabled: true }, { name: 'Off', entry: 'x', keywords: [], enabled: false }] }));
    expect(p.format).toBe('Lorebook');
    expect(p.entries.map((x) => [x.entry.name, x.entry.text, x.off])).toEqual([['Rell', 'A smuggler.', false], ['Off', 'x', true]]);
  });
  it('reads a bare list with comma-separated triggers, nested anywhere', () => {
    const p = parseLorebook(JSON.stringify({ export: { world: { items: [{ title: 'Docks', description: 'Rotting piers.', triggers: 'docks, pier' }] } } }));
    expect(p.entries[0].entry).toMatchObject({ name: 'Docks', keys: ['docks', 'pier'], text: 'Rotting piers.' });
  });
  it('says plainly when there is nothing to read, so the panel can offer extraction', () => {
    expect(() => parseLorebook('not json')).toThrow(NotALorebook);
    expect(() => parseLorebook('{"a":1}')).toThrow(NotALorebook);
  });
});

describe('extraction', () => {
  it('cuts text into parts at paragraph breaks', () => {
    const paras = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} `.repeat(20));
    const parts = chunkText(paras.join('\n\n'), 1000);
    expect(parts.length).toBeGreaterThan(5);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
    expect(parts.join('\n\n')).toBe(paras.join('\n\n'));
    expect(chunkText('x'.repeat(2500), 1000).map((p) => p.length)).toEqual([1000, 1000, 500]);
  });
  it('merges mentions across parts and matches entries the story already has', () => {
    const mine: CodexEntry = { id: 'm', name: 'Mara Voss', keys: ['Mara'], text: 'The detective.', enabled: true };
    const known = [{ bookId: 'b', e: mine }];
    let f = foldFound([], [{ name: 'Rell', category: 'Character', keys: ['the smuggler'], text: 'A smuggler.' }, { name: 'mara voss', keys: ['Mara', 'Voss'], text: 'Has a scar.' }, { name: 'Nobody', text: '' }], known);
    f = foldFound(f, [{ name: 'Rell', keys: ['Rell', 'Smuggler'], text: 'Owes Mara money.' }], known);
    expect(f).toHaveLength(2);
    expect(f[0].entry).toMatchObject({ name: 'Rell', keys: ['Rell', 'the smuggler', 'Smuggler'], text: 'A smuggler.\nOwes Mara money.' });
    expect(f[0].category).toBe('character');
    expect(f[1].existing).toEqual({ bookId: 'b', entryId: 'm' });
    expect(f[1].entry).toMatchObject({ name: 'Mara Voss', keys: ['Voss'], text: 'Has a scar.' });
  });
});
