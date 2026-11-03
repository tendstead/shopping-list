import { self } from '$app/service-worker';
import { assets, immutable } from '$app/manifest';
const paths = [
  '/',
  ...assets.map((a) => '/' + a.path.replace(/^\//, '')),
  ...immutable.map((a) => '/' + a.path.replace(/^\//, '')),
];
// Hash the complete asset manifest so each build receives an independent shell cache.
const identity = paths.join('|');
let hash = 0;
for (const c of identity) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
const CACHE = `shopping-shell-${hash}`;
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(paths)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('shopping-shell-') && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/health/')
  )
    return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { signal: AbortSignal.timeout(3000) })
        .then((response) => {
          if (!response.ok) throw new Error('Application unavailable');
          return response;
        })
        .catch(async () => {
          const shell = await caches.match('/', { cacheName: CACHE });
          if (!shell) throw new Error('No cached application shell');
          return shell;
        }),
    );
    return;
  }
  if (paths.includes(url.pathname))
    event.respondWith(
      caches
        .match(event.request, { cacheName: CACHE })
        .then((cached) => cached || fetch(event.request)),
    );
});
