// Research for Helpers: look things up on Wikipedia and Fandom wikis straight from the browser
// (their APIs allow it, no key or server), and, if the person has set one up, the general web
// through a small search proxy. Works with any model: the Helper asks in a ```lookup block, the
// app runs the lookups and hands back the results, up to a few rounds.
import { useStore } from '../store/store';

export type Lookup =
  | { tool: 'find_wiki'; series: string }
  | { tool: 'search'; wiki: string; query: string }
  | { tool: 'read'; wiki: string; page: string }
  | { tool: 'web'; query: string }
  | { tool: 'open'; url: string };

export interface LookupResult {
  label: string;
  /** Links shown under the Helper's reply. */
  sources: { title: string; url: string }[];
  text: string;
}

const MAX_PAGE_CHARS = 12_000;
const LOOKUP_MS = 20_000;
const LOOKUP_BLOCK = /```lookup\s*([\s\S]*?)(```|$)/i;

export function researchProtocol(): string {
  const web = !!useStore.getState().settings.searchProxy;
  return `
# Looking things up
You can look things up before answering, for facts about a real series, canon, setting or history. Put one block at the very end of your message, and nothing after it:
\`\`\`lookup
[{"tool":"find_wiki","series":"<series name>"},
 {"tool":"search","wiki":"<wikipedia | a fandom wiki id, e.g. witcher>","query":"<words>"},
 {"tool":"read","wiki":"<same>","page":"<exact page title from a search>"}${web ? `,
 {"tool":"web","query":"<web search words>"},
 {"tool":"open","url":"<a link from a web search>"}` : ''}]
\`\`\`
find_wiki finds a series' fan wiki on Fandom. search returns page titles and snippets; read returns a page's text. Ask for up to 4 lookups at a time; you'll get the results and can ask again (a few rounds at most), then answer. Before a lookup block, say in one short line what you're checking.
When you answer, base canon facts on what you read, say which pages you used, and say plainly when the sources don't cover something. Prefer the series' own wiki for lore, Wikipedia for real-world facts and publication details. Offer to save useful facts as Codex entries or Background; don't add them unasked.`;
}

/** The lookups a Helper reply asks for, and the reply without the block. */
export function splitLookups(text: string): { say: string; lookups: Lookup[] } {
  const m = text.match(LOOKUP_BLOCK);
  if (!m) return { say: text, lookups: [] };
  let lookups: Lookup[] = [];
  try {
    const parsed = JSON.parse(m[1].trim().replace(/,\s*]$/, ']')) as unknown;
    lookups = (Array.isArray(parsed) ? parsed : [parsed]).filter((x): x is Lookup => !!x && typeof x === 'object' && typeof (x as Lookup).tool === 'string');
  } catch {
    /* unreadable: treated as no lookups */
  }
  return { say: text.replace(m[0], '').trim(), lookups: lookups.slice(0, 4) };
}

/** "wikipedia", "witcher", "witcher.fandom.com" or a full URL → the wiki's host. */
export function wikiHost(wiki: string): string {
  const w = wiki.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!w || w === 'wikipedia' || w === 'en.wikipedia' || w === 'wiki') return 'en.wikipedia.org';
  if (w.includes('.')) return w;
  return `${w.replace(/[^a-z0-9-]/g, '')}.fandom.com`;
}
const apiOf = (host: string) => `https://${host}${host.endsWith('wikipedia.org') ? '/w/api.php' : '/api.php'}`;
const pageUrl = (host: string, title: string) => `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

async function api(host: string, params: Record<string, string>, signal?: AbortSignal) {
  const q = new URLSearchParams({ ...params, format: 'json', origin: '*' });
  const r = await fetch(`${apiOf(host)}?${q}`, { signal });
  if (!r.ok) throw new Error(`${host} answered ${r.status}`);
  return (await r.json()) as Record<string, unknown>;
}

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** A wiki page's readable text: infobox facts as lines, then headings, paragraphs and lists. */
export function pageText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, sup.reference, .reference, .mw-editsection, .navbox, .toc, #toc, .mw-references-wrap, .references, .noprint, .gallery, figure, .thumb, table.ambox, .printfooter').forEach((e) => e.remove());
  const lines: string[] = [];
  // Fandom's portable infobox: label / value pairs.
  doc.querySelectorAll('aside.portable-infobox .pi-item.pi-data').forEach((e) => {
    const k = e.querySelector('.pi-data-label')?.textContent?.trim();
    const v = e.querySelector('.pi-data-value')?.textContent?.replace(/\s+/g, ' ').trim();
    if (k && v) lines.push(`${k}: ${v}`);
  });
  doc.querySelectorAll('aside.portable-infobox, table.infobox').forEach((e) => e.remove());
  doc.querySelectorAll('h2, h3, h4, p, li, dd, blockquote').forEach((e) => {
    if (e.closest('li') && e.tagName !== 'LI') return;
    const t = e.textContent?.replace(/\s+/g, ' ').trim();
    if (!t) return;
    lines.push(/^H\d$/.test(e.tagName) ? `\n## ${t.replace(/\[edit\]$/i, '')}` : e.tagName === 'LI' ? `- ${t}` : t);
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Runs one lookup. Errors come back as text for the model, so one failure doesn't end the reply. */
export async function runLookup(l: Lookup, outer?: AbortSignal): Promise<LookupResult> {
  // Each lookup gets 20 seconds, so one slow site can't hold up the reply.
  const timer = new AbortController();
  const t = setTimeout(() => timer.abort(), LOOKUP_MS);
  const onOuter = () => timer.abort();
  outer?.addEventListener('abort', onOuter);
  const signal = timer.signal;
  try {
    switch (l.tool) {
      case 'find_wiki': return await findWiki(l.series, signal);
      case 'search': {
        const host = wikiHost(l.wiki);
        const j = await api(host, { action: 'query', list: 'search', srsearch: l.query, srlimit: '6' }, signal);
        const hits = ((j.query as { search?: { title: string; snippet?: string }[] })?.search ?? []);
        return {
          label: `Searched ${host} for “${l.query}”`,
          sources: [],
          text: hits.length ? hits.map((h) => `- ${h.title}${h.snippet ? `: ${stripTags(h.snippet)}` : ''}`).join('\n') : 'No results.',
        };
      }
      case 'read': {
        const host = wikiHost(l.wiki);
        const j = await api(host, { action: 'parse', page: l.page, prop: 'text', redirects: '1' }, signal);
        const p = j.parse as { title: string; text: { '*': string } } | undefined;
        if (!p) return { label: `Couldn't open “${l.page}” on ${host}`, sources: [], text: `No page called "${l.page}". Search first and use an exact title.` };
        let text = pageText(p.text['*']);
        if (text.length > MAX_PAGE_CHARS) {
          const heads = [...text.slice(MAX_PAGE_CHARS).matchAll(/^## (.+)$/gm)].map((m) => m[1]);
          text = `${text.slice(0, MAX_PAGE_CHARS)}\n\n[Page cut here. Later sections: ${heads.join('; ') || 'more of the same'}.]`;
        }
        return { label: `Read “${p.title}”`, sources: [{ title: `${p.title} (${host.replace(/\.(fandom\.com|org)$/, '')})`, url: pageUrl(host, p.title) }], text };
      }
      case 'web': {
        const base = useStore.getState().settings.searchProxy;
        if (!base) return { label: 'Web search is not set up', sources: [], text: 'Web search is not set up; use the wikis.' };
        const r = await fetch(`${base.replace(/\/$/, '')}/?q=${encodeURIComponent(l.query)}`, { signal });
        const hits = (await r.json()) as { title: string; url: string; snippet?: string }[];
        return { label: `Searched the web for “${l.query}”`, sources: [], text: hits.length ? hits.slice(0, 8).map((h) => `- ${h.title} (${h.url})${h.snippet ? `: ${h.snippet}` : ''}`).join('\n') : 'No results.' };
      }
      case 'open': {
        const base = useStore.getState().settings.searchProxy;
        if (!base) return { label: 'Web search is not set up', sources: [], text: 'Web pages can only be opened when web search is set up.' };
        const r = await fetch(`${base.replace(/\/$/, '')}/?url=${encodeURIComponent(l.url)}`, { signal });
        const j = (await r.json()) as { title?: string; text?: string; error?: string };
        if (j.error) return { label: `Couldn't open ${l.url}`, sources: [], text: j.error };
        return { label: `Read ${j.title || l.url}`, sources: [{ title: j.title || l.url, url: l.url }], text: (j.text ?? '').slice(0, MAX_PAGE_CHARS) };
      }
    }
    return { label: 'Unknown lookup', sources: [], text: `Unknown tool "${(l as { tool: string }).tool}".` };
  } catch (e) {
    if (outer?.aborted) throw e;
    const msg = signal.aborted ? 'the site took too long to answer' : (e as Error).message;
    return { label: `Lookup failed (${l.tool})`, sources: [], text: `Failed: ${msg}` };
  } finally {
    clearTimeout(t);
    outer?.removeEventListener('abort', onOuter);
  }
}

/** A series' Fandom wiki: Wikidata's Fandom IDs, then the obvious guesses, each checked to exist and be in English. */
async function findWiki(series: string, signal?: AbortSignal): Promise<LookupResult> {
  const guesses = new Set<string>();
  try {
    const s = (await (await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbsearchentities', search: series, language: 'en', limit: '4', format: 'json', origin: '*' })}`, { signal })).json()) as { search: { id: string }[] };
    if (s.search.length) {
      const e = (await (await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetentities', ids: s.search.map((x) => x.id).join('|'), props: 'claims', format: 'json', origin: '*' })}`, { signal })).json()) as { entities: Record<string, { claims?: { P4073?: { mainsnak: { datavalue?: { value: string } } }[] } }> };
      for (const x of Object.values(e.entities)) for (const c of x.claims?.P4073 ?? []) if (c.mainsnak.datavalue?.value) guesses.add(c.mainsnak.datavalue.value.toLowerCase());
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
  }
  const plain = series.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
  const dashed = series.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const g of [plain, dashed, plain.replace(/\d+$/, '')]) if (g) guesses.add(g);
  const found: { id: string; name: string; pages: number }[] = [];
  await Promise.all(
    [...guesses].slice(0, 12).map(async (g) => {
      try {
        const j = await api(`${g}.fandom.com`, { action: 'query', meta: 'siteinfo', siprop: 'general|statistics' }, signal);
        const q = j.query as { general?: { lang: string; sitename: string }; statistics?: { articles: number } } | undefined;
        if (q?.general?.lang === 'en') found.push({ id: g, name: q.general.sitename, pages: q.statistics?.articles ?? 0 });
      } catch {
        /* not a wiki */
      }
    }),
  );
  found.sort((a, b) => b.pages - a.pages);
  return {
    label: `Looked for a ${series} wiki`,
    sources: [],
    text: found.length ? found.map((f) => `- wiki id "${f.id}": ${f.name} (${f.pages.toLocaleString()} articles)`).join('\n') : 'No English Fandom wiki found. Try Wikipedia, or a different spelling of the series name.',
  };
}
