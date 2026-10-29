// Caché sin internet
const CACHE = 'aquaguard-beta-v2';
const FILES = ['./', 'index.html', 'styles.css', 'settings.js', 'i18n.js', 'engine.js', 'scenarios.js', 'menu.js', 'app.js', 'sim.js', 'manifest.json', 'icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
});

self.addEventListener('fetch', (e) => {
  if (new URL(e.request.url).origin !== location.origin) return;
  // Red, luego caché
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
