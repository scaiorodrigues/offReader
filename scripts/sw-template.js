// Service worker do Leitor (gerado pelo build). Guarda o app para uso offline.
// Os modelos de voz NÃO passam por aqui: os workers os guardam no Cache Storage ("leitor-models-v1").
const VERSION = '__VERSION__';
const APP_CACHE = `leitor-app-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('leitor-app-') && key !== APP_CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // rede primeiro (pega atualizações); sem rede, usa o app guardado
    event.respondWith(fetch(req).catch(async () => (await caches.match(req)) || (await caches.match('./')) || Response.error()));
    return;
  }
  // arquivos com hash no nome e binários de /vendor: cache primeiro, preenchendo ao usar
  event.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) (await caches.open(APP_CACHE)).put(req, res.clone());
    return res;
  })());
});
