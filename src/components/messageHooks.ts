// Hooks and helpers for MessageItem / MessageTools (kept apart so those files only export components).
import { useEffect, useMemo, type RefObject } from 'react';
import { clichesIn, filterMode } from '../features/filter/filter';
import { hitKey, type Hit } from '../features/filter/rules';
import { currentChat, useStore } from '../store/store';
import { activeSwipe, type Message } from '../types';

// ---------- Highlights (CSS Custom Highlight API: marks text without touching the HTML) ----------

const HL = 'cliche';
function sharedHighlight(): Highlight | undefined {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return;
  let h = CSS.highlights.get(HL);
  if (!h) CSS.highlights.set(HL, (h = new Highlight()));
  return h;
}

/** DOM ranges for each hit's text, found in order in the rendered message. */
function rangesFor(root: HTMLElement, hits: Hit[]): Range[] {
  const nodes: { node: Text; start: number }[] = [];
  let all = '';
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
    nodes.push({ node: n, start: all.length });
    all += n.data;
  }
  const at = (pos: number): [Text, number] | undefined => {
    for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].start <= pos) return [nodes[i].node, pos - nodes[i].start];
  };
  const out: Range[] = [];
  let cursor = 0;
  for (const h of hits) {
    const i = all.indexOf(h.text, cursor);
    if (i < 0) continue;
    cursor = i + h.text.length;
    const a = at(i);
    const b = at(cursor);
    if (!a || !b) continue;
    const r = document.createRange();
    r.setStart(a[0], a[1]);
    r.setEnd(b[0], Math.min(b[1], b[0].length));
    out.push(r);
  }
  return out;
}

export function useCliches(m: Message, active: boolean): Hit[] {
  const chat = useStore((s) => currentChat(s));
  const rulesKey = useStore((s) => `${s.settings.filterRules ?? ''}${s.settings.filterLists ?? ''}`);
  const content = activeSwipe(m).content;
  const on = active && m.role === 'assistant' && filterMode(chat) !== 'off';
  const disabled = chat?.filter?.disabled?.join(',');
  const ignored = activeSwipe(m).ignored;
  return useMemo(() => (on ? clichesIn(content, chat).filter((h) => !ignored?.includes(hitKey(h))) : []), [on, content, disabled, rulesKey, ignored]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useHighlight(body: RefObject<HTMLElement | null>, hits: Hit[], html: string) {
  useEffect(() => {
    const h = sharedHighlight();
    if (!h || !body.current || !hits.length) return;
    const mine = rangesFor(body.current, hits);
    for (const r of mine) h.add(r);
    return () => {
      for (const r of mine) h.delete(r);
    };
  }, [body, hits, html]);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Finds highlighted (rendered) text in the message's source, which may have Markdown marks in it. */
export function locate(source: string, selected: string, near = 0): { from: number; to: number } | undefined {
  const t = selected.trim();
  if (!t) return;
  // Every place the text could be (exactly, or with Markdown marks between words); the one
  // closest to where the selection sits on screen wins, so a repeated line picks the right copy.
  // Any Markdown marks (*, _, ~, `) may sit between rendered characters; any whitespace run (or a
  // line-start mark like > or #) stands for any whitespace run.
  const pat = t.split(/\s+/).filter(Boolean).map((w) => [...w].map(esc).join('[*_~`]*')).join('[*_~`]*\\s+[>#\\-*_~`\\s]*');
  const re = new RegExp(pat, 'g');
  let r: { from: number; to: number } | undefined;
  for (const m of source.matchAll(re)) if (!r || Math.abs(m.index - near) < Math.abs(r.from - near)) r = { from: m.index, to: m.index + m[0].length };
  if (!r) return;
  // Take in emphasis marks right at the edges, so a rewrite doesn't leave a stray ** behind.
  while (r.from > 0 && /[*_]/.test(source[r.from - 1])) r.from--;
  while (r.to < source.length && /[*_]/.test(source[r.to])) r.to++;
  return r;
}

