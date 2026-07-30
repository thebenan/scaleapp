// Stamped with the commit SHA at deploy time by the sed in netlify.toml. This
// is the whole point: browsers only treat a service worker as updated when its
// bytes change, so the version must come from the build, never from Date.now().
const BUILD_ID = "__BUILD_ID__";
const CACHE = `shell-${BUILD_ID}`;

const SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/storage.js",
  "/sync.js",
  "/manifest.json",
  "/vendor/bootstrap.min.css",
  "/vendor/bootstrap.bundle.min.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      // cache: "reload" so precaching goes to the network, not the HTTP cache
      .then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      // Delete every other cache unconditionally. Clients poisoned by the old
      // Date.now()-named worker accumulated one bucket per wake-up; this is
      // what clears them out.
      .then(names => Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // The sync API and anything cross-origin always goes to the network. Offline
  // writes are queued by the app itself, not smuggled through the cache.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // Network-first, so a deploy is visible on the next load.
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.open(CACHE).then(cache =>
          cache.match(request).then(hit => hit || cache.match("/index.html"))
        ))
    );
    return;
  }

  // Stale-while-revalidate for the rest of the shell, always scoped to CACHE by
  // opening it explicitly — a bare caches.match() searches every bucket and is
  // how the old worker kept serving assets from a first-visit cache forever.
  event.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(request).then(hit => {
        const fresh = fetch(request).then(response => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        }).catch(() => hit);
        return hit || fresh;
      })
    )
  );
});
