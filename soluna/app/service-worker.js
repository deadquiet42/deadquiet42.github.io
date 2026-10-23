const CACHE_NAME = 'soluna-v13';
const NAVIGATION_TIMEOUT_MS = 3000;
const APP_SCOPE_PATH = new URL(self.registration.scope).pathname;
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './pwa.js',
  './manifest.json',
  './icon-16.png',
  './icon-32.png',
  './icon-44.png',
  './icon-48.png',
  './icon-180-v2.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('soluna-') && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(APP_SCOPE_PATH)
  ) return;

  if (request.mode === 'navigate') {
    const networkResponse = fetch(request).then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    });

    const navigationResponse = Promise.race([
      networkResponse,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Navigation timed out')), NAVIGATION_TIMEOUT_MS);
      })
    ]);

    event.waitUntil(networkResponse.then(() => undefined).catch(() => undefined));
    event.respondWith(
      navigationResponse.catch(async () => (
        await caches.match(request, { ignoreSearch: true }) ||
        await caches.match('./index.html')
      ))
    );
    return;
  }

  const networkResponse = fetch(request).then(async (response) => {
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  });

  event.waitUntil(networkResponse.then(() => undefined).catch(() => undefined));
  event.respondWith(
    caches.match(request).then((cachedResponse) => (
      cachedResponse || networkResponse
    )).catch(() => Response.error())
  );
});
