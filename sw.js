// Update this timestamp whenever you deploy new changes (or use current timestamp)
const VERSION = Date.now().toString();
const CACHE_NAME = `recipe-scaler-v${VERSION}`;
const FILES_TO_CACHE = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/manifest.json"
];

// Install: cache files and skip waiting
self.addEventListener("install", event => {
  console.log(`[SW] Installing version ${VERSION}`);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE);
    }).then(() => {
      // Skip waiting to activate new service worker immediately
      self.skipWaiting();
    })
  );
});

// Activate: clean up old caches
self.addEventListener("activate", event => {
  console.log(`[SW] Activating version ${VERSION}`);
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName.startsWith("recipe-scaler-v") && cacheName !== CACHE_NAME) {
            console.log(`[SW] Deleting old cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Take control of all pages immediately
      return self.clients.claim();
    })
  );
});

// Fetch: serve cached content, but with network-first strategy for HTML
self.addEventListener("fetch", event => {
  if (event.request.destination === 'document') {
    // Network-first strategy for HTML to get updates quickly
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
  } else {
    // Cache-first strategy for other resources
    event.respondWith(
      caches.match(event.request).then(response => {
        return response || fetch(event.request).then(fetchResponse => {
          const responseClone = fetchResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
          return fetchResponse;
        });
      })
    );
  }
});
