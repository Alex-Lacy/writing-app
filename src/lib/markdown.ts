import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });
// Tildes are stylistic in fiction ("nya~", "~~~aaahh"): never strikethrough, and never a code
// fence (``` still is). <s> / <del> still strike through.
marked.use({
  tokenizer: {
    del: () => undefined,
    fences(src: string) {
      return /^ {0,3}~/.test(src) ? undefined : false;
    },
  },
});

/** Markdown to HTML, before cleaning (separate so it can be tested without a browser). */
export const markdownHtml = (src: string): string => marked.parse(src, { async: false }) as string;

export function renderMarkdown(src: string): string {
  return DOMPurify.sanitize(markdownHtml(src));
}
