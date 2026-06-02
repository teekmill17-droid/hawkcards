const CACHE = 'hawkcollects-v1';
const SHELL = ['/', '/style.css', '/app.js', '/manifest.json', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Let API calls go straight to network — never cache them
  if (new URL(e.request.url).pathname.startsWith('/api/')) return;
  if (new URL(e.request.url).pathname.startsWith('/uploads/')) return;

  // App shell: cache-first, network fallback
  e.respondWith(
    caches.match(e.request).then(hit => {
      return hit || fetch(e.request).then(r => {
        if (r.ok && r.type !== 'opaque') {
          caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        }
        return r;
      });
    })
  );
});
