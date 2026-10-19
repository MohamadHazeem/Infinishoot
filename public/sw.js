/* Built by scripts/mobilePwa.ts. An update waits for old game tabs to close so a run never mixes versions. */
const VERSION = '__BUILD_VERSION__';
const FILES = /* __PRECACHE__ */ [];
const ROOT = new URL('./', self.location.href);
const PREFIX = `infinishoot:${ROOT.pathname}:`;
const CACHE = PREFIX + VERSION;
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Atomic install: any missing file rejects installation; the previous version stays usable.
      await cache.addAll(
        FILES.map((path) => new Request(new URL(path, ROOT), { cache: 'reload' })),
      );
    })(),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  const req = event.request,
    url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname))
    return;
  // Online APIs/signalling and unknown URLs remain network-only. No opaque external responses.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const key = req.mode === 'navigate' ? new URL('index.html', ROOT).href : req.url;
      return (await cache.match(key, { ignoreSearch: true })) || fetch(req);
    })(),
  );
});
