const CACHE_NAME = 'numina-github-pages-v2-bingo-icon';
const BASE = new URL('./', self.location.href);
const ASSETS = [
  '',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/favicon-64.png',
  'icons/bingo-icon-192.png',
  'icons/bingo-icon-512.png',
  'icons/bingo-maskable-192.png',
  'icons/bingo-maskable-512.png'
].map(path => new URL(path, BASE).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match(new URL('index.html', BASE).href);
        return Response.error();
      });
    })
  );
});
