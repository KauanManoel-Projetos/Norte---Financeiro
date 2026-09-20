// Service Worker do Norte — Gestão Financeira Pessoal
//
// Estratégia: "network-first, cache como reserva". Sempre que há internet,
// busca a versão mais nova do app na rede (importante porque o app está em
// desenvolvimento e muda com frequência) e atualiza o cache junto. Só usa o
// cache quando a rede falha (modo offline) ou está muito lenta.
//
// Ao publicar uma atualização importante do app, é uma boa prática mudar o
// número da versão abaixo (CACHE_NAME) — isso força os aparelhos que já
// instalaram o app a descartar o cache antigo e buscar tudo de novo.
const CACHE_NAME = 'norte-financeiro-v1';
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Só intercepta requisições GET de navegação/arquivos do próprio app —
  // deixa passar direto chamadas a APIs externas (Supabase, CDNs de script,
  // fontes do Google) para não interferir no funcionamento normal delas.
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match('./index.html'))
      )
  );
});
