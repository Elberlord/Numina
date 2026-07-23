const CACHE_NAME = 'numina-serie-v3-4-0-20260722';
const APP_SHELL = [
  './',
  './index.html',
  './portal.html',
  './panel-privado-8f27c4.html',
  './home.css',
  './home.js',
  './styles.css',
  './app.bundle.js',
  './manifest.webmanifest',
  './icons/favicon-64.png',
  './icons/bingo-icon-192.png',
  './icons/bingo-icon-512.png',
  './icons/bingo-maskable-192.png',
  './icons/bingo-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const hadPreviousVersion = keys.some(key => key.startsWith('numina-serie-') && key !== CACHE_NAME);
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
    if (hadPreviousVersion) {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach(client => client.postMessage({ type: 'NUMINA_UPDATE_READY', version: CACHE_NAME }));
    }
  })());
});

function fallbackFor(url) {
  if (url.pathname.endsWith('/portal.html')) return './portal.html';
  if (url.pathname.endsWith('/panel-privado-8f27c4.html')) return './panel-privado-8f27c4.html';
  return './index.html';
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      }).catch(async () => (await caches.match(event.request)) || caches.match(fallbackFor(url)))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
      return response;
    }))
  );
});
