// Compile: turns a chat into a clean manuscript (Markdown, plain text or Word).
import { countWords } from '../context/length';
import { zip } from '../lib/zip';
import { activeSwipe, type Message } from '../types';

export interface CompileOptions {
  /** 'story': AI replies only. 'all': your messages too. */
  include: 'story' | 'all';
  /** Drop [bracketed notes] and (OOC: ...) asides. */
  stripNotes: boolean;
  /** Turn scene breaks (***, ---, ###) into numbered chapter headings. */
  chapters: boolean;
}

export const DEFAULT_COMPILE: CompileOptions = { include: 'story', stripNotes: true, chapters: false };

const SCENE_BREAK = /^\s*(?:\*\s*){3,}$|^\s*(?:-\s*){3,}$|^\s*(?:#\s*){3}$|^\s*~{3,}\s*$/;

export function compileStory(title: string, messages: Message[], o: CompileOptions): { markdown: string; words: number } {
  const blocks: string[] = [];
  for (const m of messages) {
    if (m.role === 'system' || (o.include === 'story' && m.role !== 'assistant')) continue;
    let t = activeSwipe(m).content;
    if (o.stripNotes) t = t.replace(/\[[^\]\n]*\]/g, '').replace(/\(\s*OOC:[^)]*\)/gi, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n');
    t = t.trim();
    if (t) blocks.push(t);
  }
  let body = blocks.join('\n\n');
  if (o.chapters) {
    let n = 1;
    body = `## Chapter 1\n\n${body.split('\n').map((l) => (SCENE_BREAK.test(l) ? `## Chapter ${++n}` : l)).join('\n')}`;
  } else body = body.split('\n').map((l) => (SCENE_BREAK.test(l) ? '* * *' : l)).join('\n');
  body = body.replace(/\n{3,}/g, '\n\n');
  return { markdown: `# ${title}\n\n${body}\n`, words: countWords(body.replace(/^(?:\* \* \*|## Chapter \d+)$/gm, '')) };
}

export function toPlainText(md: string): string {
  return md.replace(/^#{1,6}\s+/gm, '').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(\*|_)(.+?)\1/g, '$2');
}

// ---------- .docx ----------

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Runs for one paragraph, with **bold** and *italic*. */
function runs(text: string): string {
  const out: string[] = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3/g;
  let last = 0;
  const run = (t: string, props = '') => t && out.push(`<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>`);
  for (const m of text.matchAll(re)) {
    run(text.slice(last, m.index));
    if (m[2] !== undefined) run(m[2], '<w:b/>');
    else run(m[4], '<w:i/>');
    last = m.index! + m[0].length;
  }
  run(text.slice(last));
  return out.join('');
}

export function toDocx(md: string): Blob {
  const paras: string[] = [];
  for (const block of md.split(/\n{2,}/)) {
    const b = block.trim();
    if (!b) continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(b);
    if (h) {
      const style = h[1].length === 1 ? 'Title' : 'Heading1';
      paras.push(`<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${runs(h[2])}</w:p>`);
    } else if (b === '* * *') {
      paras.push('<w:p><w:pPr><w:pStyle w:val="Break"/></w:pPr><w:r><w:t>* * *</w:t></w:r></w:p>');
    } else {
      // Line breaks inside a paragraph (dialogue, verse) stay as breaks.
      paras.push(`<w:p>${b.split('\n').map((l) => runs(l)).join('<w:r><w:br/></w:r>')}</w:p>`);
    }
  }
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="480"/></w:pPr><w:rPr><w:sz w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:pageBreakBefore/><w:spacing w:before="480" w:after="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Break"><w:name w:val="Scene break"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>
</w:styles>`;
  const bytes = zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'word/document.xml', data: doc },
    { name: 'word/styles.xml', data: styles },
  ]);
  return new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

export function download(name: string, data: Blob | string, type = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type: `${type};charset=utf-8` }) : data;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const fileName = (title: string, ext: string) => `${(title || 'Story').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'Story'}.${ext}`;
