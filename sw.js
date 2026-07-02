const CACHE_NAME = 'emboobate-cache-v18';
const ASSETS = [
  './embobate.html',
  './manifest.json',
  './logo.png',
  './icon-192.png',
  './icon-512.png',
  './dieta.html',
  './dieta-manifest.json',
  './dieta-icon-192.png',
  './dieta-icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Para el HTML/navegación: primero la red (siempre lo más nuevo), y si no hay
// internet, se usa la copia en caché. Para el resto de archivos: primero caché.
function isHtml(request) {
  return request.mode === 'navigate' ||
    (request.destination === 'document') ||
    request.url.endsWith('.html');
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  if (isHtml(event.request)) {
    event.respondWith(
      fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => caches.match(event.request).then((c) => c || caches.match('./embobate.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => cached);
    })
  );
});
