// Writing Studio search relay: a tiny Cloudflare Worker you run on your own (free) account.
// The app can't call search sites from the browser (they block it), so it asks this relay:
//   GET /?q=words   -> [{ title, url, snippet }]   (DuckDuckGo's plain HTML results)
//   GET /?url=https://...  -> { title, text }      (a page's readable text)
// It stores nothing. Set ALLOWED_ORIGIN (e.g. https://alex-lacy.github.io) so only your app can use it.

export default {
  async fetch(req, env) {
    const allowed = env.ALLOWED_ORIGIN || '*';
    const origin = req.headers.get('Origin') || '';
    const cors = { 'Access-Control-Allow-Origin': allowed === '*' ? '*' : allowed, 'Content-Type': 'application/json; charset=utf-8' };
    if (allowed !== '*' && origin && origin !== allowed) return new Response(JSON.stringify({ error: 'Not allowed from this site.' }), { status: 403, headers: cors });
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    const u = new URL(req.url);
    try {
      if (u.searchParams.get('q')) return json(await search(u.searchParams.get('q')), cors);
      if (u.searchParams.get('url')) return json(await page(u.searchParams.get('url')), cors);
      return json({ ok: true, usage: '?q=search words  or  ?url=https://…' }, cors);
    } catch (e) {
      return json({ error: String(e.message || e) }, cors, 502);
    }
  },
};

const UA = 'Mozilla/5.0 (compatible; WritingStudioSearch/1.0)';
const json = (v, headers, status = 200) => new Response(JSON.stringify(v), { status, headers });
const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export async function search(q) {
  const r = await fetch(`https://html.duckduckgo.com/html/?${new URLSearchParams({ q })}`, { headers: { 'User-Agent': UA } });
  return parseResults(await r.text());
}

/** DuckDuckGo HTML results page -> [{ title, url, snippet }]. */
export function parseResults(html) {
  const out = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="result__a"|$)/g;
  for (let m = re.exec(html); m && out.length < 10; m = re.exec(html)) {
    let url = m[1].replace(/&amp;/g, '&');
    const wrapped = url.match(/[?&]uddg=([^&]+)/);
    if (wrapped) url = decodeURIComponent(wrapped[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    if (/duckduckgo\.com\/y\.js/.test(url)) continue; // ads
    const snippet = m[3].match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)?.[1];
    out.push({ title: decode(m[2]), url, snippet: snippet ? decode(snippet) : '' });
  }
  return out;
}

export async function page(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http and https links.');
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`The site answered ${r.status}.`);
  const html = (await r.text()).slice(0, 2_000_000);
  return { title: decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''), text: pageText(html).slice(0, 30_000) };
}

/** Rough readable text: drops scripts, menus and footers, keeps headings, paragraphs and list items. */
export function pageText(html) {
  const body = (html.match(/<(?:article|main)[^>]*>([\s\S]*?)<\/(?:article|main)>/i) || html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  return body
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, __, t) => `\n\n## ${decode(t)}\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(p|div|br|tr|section)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((l) => decode(l))
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}
