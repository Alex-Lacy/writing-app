// Offline support. The app shell is cached so Writing Studio opens without a connection (your stories
// are already on the device). Calls to AI providers are never cached or touched.
const CACHE = 'ws-v2';
const SHELL = ['./manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
const PAGE = './index.html';

/** Caches a fresh copy of the page and the built files it uses, and drops built files it no longer uses. */
async function cachePage(res) {
  if (!res.ok) return;
  const html = await res.clone().text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => new URL(m[1], self.registration.scope).href))];
  const c = await caches.open(CACHE);
  await c.put(PAGE, res.clone());
  await Promise.all(assets.map(async (u) => (await c.match(u, { ignoreVary: true })) || c.add(u)));
  for (const req of await c.keys()) if (req.url.includes('/assets/') && !assets.includes(req.url)) await c.delete(req);
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      await c.addAll(SHELL);
      await cachePage(await fetch('./', { cache: 'no-cache' }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const timeout = (ms) => new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (req.mode === 'navigate') {
    // The newest page when the network answers within 4 seconds (so updates arrive); otherwise the cached one.
    e.respondWith(
      (async () => {
        const net = fetch(req);
        try {
          const res = await Promise.race([net, timeout(4000)]);
          if (res.ok) {
            e.waitUntil(cachePage(res.clone()));
            return res;
          }
        } catch {
          e.waitUntil(net.then(cachePage, () => {}));
        }
        return (await caches.match(PAGE)) || net;
      })(),
    );
    return;
  }
  const rel = url.href.slice(self.registration.scope.length);
  if (!rel.startsWith('assets/') && !SHELL.includes(`./${rel}`)) return;
  // Built files have content hashes in their names, so a cached copy is always right.
  e.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req)));
});
