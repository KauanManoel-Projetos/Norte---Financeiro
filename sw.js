// Service Worker do Norte — Gestão Financeira Pessoal
//
// 1) Cache: "network-first, cache como reserva". Sempre que há internet, busca a
//    versão mais nova do app na rede e atualiza o cache junto; só usa o cache
//    quando a rede falha (modo offline).
// 2) Notificações: mostra os avisos do app (notificationclick abre/foca o app),
//    e — nos aparelhos que permitem (Chrome/Android com o app instalado) —
//    acorda de tempos em tempos ("periodicsync") pra avisar de vencimentos
//    mesmo com o app fechado, lendo a agenda que o app deixa no IndexedDB.
//    Também já está pronto pra receber "push" de um servidor, se um dia for usado.
//
// Ao publicar uma atualização importante do app, mude o número da versão
// abaixo (CACHE_NAME) — isso força os aparelhos a baixarem tudo de novo.
const CACHE_NAME = 'norte-financeiro-v3';
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './badge-96.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // um arquivo que falte não pode derrubar a instalação inteira
      .then((cache) => Promise.all(APP_SHELL.map((u) => cache.add(u).catch(() => {}))))
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

/* ---------------- Notificações ---------------- */
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('norte-notif', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  try {
    const db = await idbOpen();
    const v = await new Promise((res, rej) => { const rq = db.transaction('kv').objectStore('kv').get(key); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
    db.close();
    return v;
  } catch (e) { return undefined; }
}
async function idbSet(key, value) {
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(value, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  } catch (e) { /* sem IndexedDB: segue sem avisar */ }
}
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

async function swCheckDue() {
  // Plano B (sem servidor): quando o Chrome/Android acorda o app, avisa dos
  // vencimentos que o app deixou gravados no IndexedDB.
  const prefs = Object.assign({ twoDays: true, dayBefore: true, dayOf: true, hour: 9 }, (await idbGet('prefs')) || {});
  const schedule = (await idbGet('schedule')) || [];
  if (!schedule.length) return;
  const now = new Date();
  if (now.getHours() < prefs.hour) return;
  const at = (n) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  const today = at(0), tomorrow = at(1), in2 = at(2);
  const sent = (await idbGet('sent')) || {};
  let changed = false;
  for (const it of schedule) {
    const when = it.due === today ? 'today' : it.due === tomorrow ? 'tomorrow' : it.due === in2 ? 'in2' : null;
    if (!when) continue;
    if ((when === 'today' && !prefs.dayOf) || (when === 'tomorrow' && !prefs.dayBefore) || (when === 'in2' && !prefs.twoDays)) continue;
    const key = it.key + '|' + when;
    if (sent[key]) continue;
    const t = (it.texts || {})[when];
    if (!t) continue;
    await self.registration.showNotification(t.title, {
      body: t.body, tag: key, icon: 'icon-192.png', badge: 'badge-96.png', vibrate: [140, 70, 140], timestamp: Date.now(),
      data: { view: it.view || null, url: './index.html' + (it.view ? '?open=' + it.view : '') },
    });
    sent[key] = Date.now();
    changed = true;
  }
  if (changed) await idbSet('sent', sent);
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'norte-due-check') event.waitUntil(swCheckDue());
});

// Toque na notificação: foca o app que já está aberto (e manda abrir a tela
// certa) ou abre uma janela nova.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if (data.view) c.postMessage({ type: 'norte-open', view: data.view });
          return c.focus();
        }
      }
      return self.clients.openWindow(data.url || './index.html');
    })
  );
});

// Preparado pra "push" de servidor (opcional, ainda não usado pelo app).
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { payload = { title: 'Norte', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(payload.title || 'Norte', {
    body: payload.body || '', tag: payload.tag, icon: 'icon-192.png', badge: 'badge-96.png', vibrate: [140, 70, 140],
    data: { view: payload.view || null, url: './index.html' + (payload.view ? '?open=' + payload.view : '') },
  }));
});
