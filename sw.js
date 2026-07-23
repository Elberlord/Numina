const CACHE_NAME = 'numina-serie-v3-6-1';
const CACHE_PREFIX = 'numina-serie-';
const CORE_SHELL = [
  './',
  './index.html',
  './portal.html',
  './panel-privado-8f27c4.html',
  './home.css',
  './home.js',
  './styles.css',
  './stability.js',
  './app.bundle.js',
  './manifest.webmanifest',
  './VERSION.txt'
];
const OPTIONAL_SHELL = [
  './icons/favicon-64.png',
  './icons/bingo-icon-192.png',
  './icons/bingo-icon-512.png',
  './icons/bingo-maskable-192.png',
  './icons/bingo-maskable-512.png'
];
const NAVIGATION_TIMEOUT_MS = 8000;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_SHELL);
    await Promise.allSettled(OPTIONAL_SHELL.map(asset => cache.add(asset)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const previous = keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
    await Promise.all(previous.map(key => caches.delete(key)));
    await self.clients.claim();
    if (previous.length) {
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

async function fetchWithTimeout(request, timeoutMs = NAVIGATION_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function networkFirstNavigation(request, url) {
  try {
    const response = await fetchWithTimeout(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match(fallbackFor(url))) || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.headers.has('range')) return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/VERSION.txt')) {
    event.respondWith(fetch(event.request).catch(() => caches.match('./VERSION.txt')));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event.request, url));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'NUMINA_SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'NUMINA_GET_VERSION') {
    event.source?.postMessage({ type: 'NUMINA_VERSION', version: CACHE_NAME });
  }
});
