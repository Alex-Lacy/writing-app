import { describe, expect, it } from 'vitest';
import { splitLookups, wikiHost } from './research';

describe('research lookups', () => {
  it('reads a lookup block and keeps what the Helper said', () => {
    const r = splitLookups('Checking the wiki.\n```lookup\n[{"tool":"search","wiki":"witcher","query":"Yennefer"}]\n```');
    expect(r.say).toBe('Checking the wiki.');
    expect(r.lookups).toEqual([{ tool: 'search', wiki: 'witcher', query: 'Yennefer' }]);
  });
  it('caps lookups per round and ignores broken blocks', () => {
    const many = JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ tool: 'search', wiki: 'x', query: String(i) })));
    expect(splitLookups('```lookup\n' + many + '\n```').lookups).toHaveLength(4);
    expect(splitLookups('```lookup\nnot json\n```').lookups).toEqual([]);
    expect(splitLookups('No block here.').lookups).toEqual([]);
  });
  it('turns wiki names into hosts', () => {
    expect(wikiHost('wikipedia')).toBe('en.wikipedia.org');
    expect(wikiHost('witcher')).toBe('witcher.fandom.com');
    expect(wikiHost('https://witcher.fandom.com/wiki/Geralt')).toBe('witcher.fandom.com');
    expect(wikiHost('de.wikipedia.org')).toBe('de.wikipedia.org');
  });
});
