import { describe, expect, it } from 'vitest';
import { markdownHtml } from './markdown';

describe('markdown', () => {
  it('shows tildes as written, never as strikethrough', () => {
    for (const t of ['“Ferris can fix it, nya~ but that face, desu~”', '~~~aaaaahhhh <3', 'a ~~b~~ c']) {
      const html = markdownHtml(t);
      expect(html).not.toMatch(/<del|<s>/);
      expect(html.replace(/<[^>]+>/g, '')).toContain('~');
    }
  });
  it('keeps other formatting and HTML strikethrough', () => {
    expect(markdownHtml('**bold** and <s>gone</s>')).toMatch(/<strong>bold<\/strong>.*<s>gone<\/s>/);
  });
});
