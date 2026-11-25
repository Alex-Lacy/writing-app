// Cliché Filter rule engine. Rules are plain text so people can read and add their own:
//   NAME== a|b|c          a word list; %NAME% in a pattern expands to (?:a|b|c)
//   #! [rule-id] Description
//   /pattern/flags        one or more patterns for the rule above
import { DEFAULT_RULES, DEFAULT_WORDLISTS } from './defaultRules';

export interface Rule {
  id: string;
  description: string;
  patterns: RegExp[];
  builtIn: boolean;
}
export interface Hit {
  ruleId: string;
  description: string;
  from: number;
  to: number;
  text: string;
}

export function parseLists(text: string, into = new Map<string, string>(), errors: string[] = []) {
  const raw = new Map<string, string>();
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = /^([A-Z_][A-Z0-9_]*)==\s*(.*)$/.exec(t);
    if (m) raw.set(m[1], m[2].trim());
    else errors.push(`Not a word list: ${t}`);
  }
  const expand = (s: string, seen: string[]): string =>
    s.replace(/%([A-Z_][A-Z0-9_]*)%/g, (all, name: string) => {
      if (seen.includes(name)) return all;
      const body = raw.get(name) ?? into.get(name);
      return body === undefined ? all : `(?:${expand(body, [...seen, name])})`;
    });
  for (const [name, body] of raw) into.set(name, expand(body, [name]));
  return into;
}

export function parseRules(text: string, lists: Map<string, string>, builtIn: boolean, errors: string[] = []): Rule[] {
  const rules: Rule[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('#!')) {
      const m = /^#!\s*\[([\w-]+)\]\s*(.*)$/.exec(t);
      if (m) rules.push({ id: m[1], description: m[2] || m[1], patterns: [], builtIn });
      else errors.push(`Bad rule header: ${t}`);
      continue;
    }
    if (t.startsWith('#')) continue;
    const m = /^\/(.+)\/([a-z]*)$/.exec(t);
    const rule = rules.at(-1);
    if (!m || !rule) {
      errors.push(`Not a pattern: ${t}`);
      continue;
    }
    const src = m[1].replace(/%([A-Z_][A-Z0-9_]*)%/g, (all, name: string) => (lists.has(name) ? `(?:${lists.get(name)})` : all));
    try {
      rule.patterns.push(new RegExp(src, m[2].replace(/[^imsu]/g, '') + 'g'));
    } catch (e) {
      errors.push(`[${rule.id}] ${(e as Error).message}`);
    }
  }
  return rules.filter((r) => r.patterns.length);
}

let cache: { key: string; rules: Rule[]; errors: string[] } | undefined;

/** Built-in rules plus the person's own, compiled once per change. */
export function compileRules(userRules = '', userLists = ''): { rules: Rule[]; errors: string[] } {
  const key = `${userRules}\u0000${userLists}`;
  if (cache?.key === key) return cache;
  const errors: string[] = [];
  const lists = parseLists(DEFAULT_WORDLISTS);
  parseLists(userLists, lists, errors);
  const rules = [...parseRules(DEFAULT_RULES, lists, true, errors), ...parseRules(userRules, lists, false, errors)];
  cache = { key, rules, errors };
  return cache;
}

/** All rule hits in a text, in order, without overlaps (the earlier/longer match wins). */
export function scan(text: string, rules: Rule[], disabled: string[] = []): Hit[] {
  const out: Hit[] = [];
  for (const r of rules) {
    if (disabled.includes(r.id)) continue;
    for (const re of r.patterns) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        if (!m[0]) continue;
        out.push({ ruleId: r.id, description: r.description, from: m.index!, to: m.index! + m[0].length, text: m[0] });
      }
    }
  }
  out.sort((a, b) => a.from - b.from || b.to - a.to);
  const kept: Hit[] = [];
  for (const h of out) if (!kept.length || h.from >= kept.at(-1)!.to) kept.push(h);
  return kept;
}

/** Widens a hit to the whole sentence (or sentences) around it, for a rewrite. */
export function sentenceAround(text: string, from: number, to: number): { from: number; to: number } {
  let a = from;
  while (a > 0 && !/[.!?…\n]/.test(text[a - 1]) ) a--;
  // Keep closing quotes with the previous sentence.
  while (a < from && /[\s"”’')\]]/.test(text[a])) a++;
  let b = to;
  while (b < text.length && !/[.!?…\n]/.test(text[b])) b++;
  while (b < text.length && /[.!?…"”’')\]*]/.test(text[b])) b++;
  return { from: a, to: b };
}
