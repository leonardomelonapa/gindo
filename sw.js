const CACHE = 'gindo-v4';
const SHELL = [
  '.', 'index.html', 'styles.css', 'app.js', 'engine.js',
  'manifest.webmanifest',
  'icon-32.png', 'icon-180.png', 'icon-192.png', 'icon-512.png',
  'assets/logo.png', 'assets/monsters-a.png', 'assets/monsters-b.webp',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('index.html')))
  );
});
