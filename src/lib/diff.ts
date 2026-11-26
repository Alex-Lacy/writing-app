// Word-level diff for suggestion cards: which words were removed, added or kept.
export interface Part { kind: 'same' | 'del' | 'ins'; text: string }

const tokens = (s: string) => s.split(/(\s+)/).filter(Boolean);

/** Words removed and added between two texts (spaces count as words, so the text reads back whole).
 * Returns undefined when the texts are too long to compare quickly. */
export function wordDiff(a: string, b: string, maxCells = 4_000_000): Part[] | undefined {
  const x = tokens(a), y = tokens(b);
  let pre = 0;
  while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++;
  let suf = 0;
  while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
  const xs = x.slice(pre, x.length - suf), ys = y.slice(pre, y.length - suf);
  const n = xs.length, m = ys.length;
  if ((n + 1) * (m + 1) > maxCells) return;
  // Longest common subsequence table, filled from the end.
  const w = m + 1;
  const L = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i * w + j] = xs[i] === ys[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
  const out: Part[] = [];
  const push = (kind: Part['kind'], text: string) => {
    const last = out.at(-1);
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  if (pre) push('same', x.slice(0, pre).join(''));
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && xs[i] === ys[j]) { push('same', xs[i]); i++; j++; }
    else if (j < m && (i >= n || L[i * w + j + 1] >= L[(i + 1) * w + j])) push('ins', ys[j++]);
    else push('del', xs[i++]);
  }
  if (suf) push('same', x.slice(x.length - suf).join(''));
  return tidy(out);
}

/** A word or two kept between two changes (often just "the" or a space) reads as noise:
 * fold it into the changes, so each change reads as a whole phrase. Each run of changes is then
 * shown as all removals, then all additions, so it reads "old → new". */
function tidy(parts: Part[]): Part[] {
  const small = (t: string) => t.length < 16 && t.trim().split(/\s+/).filter(Boolean).length <= 2;
  const res: Part[] = [];
  let del = '', ins = '';
  const flush = () => { if (del) res.push({ kind: 'del', text: del }); if (ins) res.push({ kind: 'ins', text: ins }); del = ins = ''; };
  parts.forEach((p, k) => {
    if (p.kind === 'del') del += p.text;
    else if (p.kind === 'ins') ins += p.text;
    else if ((del || ins) && k < parts.length - 1 && small(p.text)) { del += p.text; ins += p.text; }
    else { flush(); res.push(p); }
  });
  flush();
  return res;
}

/** Share of the old text that is kept; low means it was mostly rewritten. */
export function keptShare(parts: Part[], before: string): number {
  const kept = parts.filter((p) => p.kind === 'same').reduce((n, p) => n + p.text.length, 0);
  return before.length ? kept / before.length : 0;
}
