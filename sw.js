/* Service Worker do Norte — cache do "app shell" para uso offline.
   Estratégia: network-first com fallback para cache (assim o app sempre
   tenta buscar a versão mais nova, mas continua funcionando sem internet
   usando a última versão salva). Os dados financeiros em si NÃO passam
   por aqui — eles ficam no localStorage / Supabase, tratados pelo próprio
   index.html. */

const CACHE_NAME = 'norte-shell-v1';
const APP_SHELL = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {}) // se algum arquivo não existir, não trava a instalação
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((fresh) => {
        const clone = fresh.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return fresh;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match('./index.html'))
      )
  );
});
