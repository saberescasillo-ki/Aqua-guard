// Service worker: guarda la interfaz para que abra sin internet.
// Las peticiones a los ESP32 nunca se guardan en caché.
const CACHE = 'aquaguard-v1';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'simulation.js', 'manifest.json', 'icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
});

self.addEventListener('fetch', (e) => {
  if (new URL(e.request.url).origin !== location.origin) return;
  // Primero la red (así tus cambios se ven al recargar); si falla, la caché
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
