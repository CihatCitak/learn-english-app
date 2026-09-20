// Service worker: uygulama kabuğu cache-first, data/*.json network-first (çevrimdışı yedekli)
const VERSION = 'v20260921010020';
const SHELL = ['./', './index.html', './style.css', './app.js', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('shell-' + VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open('data-' + VERSION).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
