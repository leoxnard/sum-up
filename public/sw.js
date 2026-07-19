// Sum Up service worker: app-shell + per-URL navigation caching.
// Data freshness is the app's job (IndexedDB mirror + outbox); the worker only
// guarantees that HTML, JS, CSS and photos are available offline.
const VERSION = "v2";
const ASSET_CACHE = `sumup-assets-${VERSION}`;
const PAGE_CACHE = `sumup-pages-${VERSION}`;
const PHOTO_CACHE = `sumup-photos-${VERSION}`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([ASSET_CACHE, PAGE_CACHE, PHOTO_CACHE]);
      for (const key of await caches.keys()) {
        if (key.startsWith("sumup-") && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Hashed build assets: immutable, cache-first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(ASSET_CACHE, request));
    return;
  }

  // Receipt photos: immutable ids, cache-first.
  if (/^\/g\/[^/]+\/photo\//.test(url.pathname)) {
    event.respondWith(cacheFirst(PHOTO_CACHE, request));
    return;
  }

  // Static shell files.
  if (["/manifest.webmanifest", "/favicon.ico"].includes(url.pathname) || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(ASSET_CACHE, request));
    return;
  }

  // Navigations: network-first, falling back to the last cached copy of the
  // same URL, then to the cached home page shell.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(PAGE_CACHE);
            await cache.put(request, response.clone());
          }
          return response;
        } catch {
          const cached = await caches.match(request, { cacheName: PAGE_CACHE });
          if (cached) return cached;
          // Subpages of a group fall back to the cached group page, then home.
          const groupRoot = /^\/g\/[^/]+/.exec(url.pathname);
          if (groupRoot) {
            const groupPage = await caches.match(groupRoot[0], { cacheName: PAGE_CACHE });
            if (groupPage) return groupPage;
          }
          const home = await caches.match("/", { cacheName: PAGE_CACHE });
          if (home) return home;
          return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        }
      })(),
    );
  }
});

async function cacheFirst(cacheName, request) {
  const cached = await caches.match(request, { cacheName });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}
