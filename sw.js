/* SmokeCount — service worker
   Objetivo: o app precisa abrir e registrar um cigarro mesmo sem rede.
   Falhar em registrar por falta de conexão é inaceitável para o produto.

   Estratégia:
     - App shell em cache-first (HTML, CSS, JS): abre instantâneo, offline.
     - Fontes: self-hosted, pré-cacheadas junto com o app shell (não há
       mais requisição a terceiros — zero rastreamento).
     - Nunca cacheia nada que não seja GET.
   Os dados do usuário NÃO passam por aqui — vivem em IndexedDB/localStorage.
*/

const VERSION = 'v7';
const SHELL = `smokecount-shell-${VERSION}`;
const RUNTIME = `smokecount-rt-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/app.js',
  './js/stats.js',
  './js/storage.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './fonts/inter-400.woff2',
  './fonts/inter-500.woff2',
  './fonts/inter-600.woff2',
  './fonts/inter-700.woff2',
  './fonts/jetbrains-mono-400.woff2',
  './fonts/jetbrains-mono-500.woff2',
  './fonts/jetbrains-mono-600.woff2',
  './fonts/jetbrains-mono-700.woff2'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[sw] falha ao pré-cachear:', err))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Mesma origem: cache-first, com atualização em segundo plano.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(request).then(cached => {
        const network = fetch(request)
          .then(res => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL).then(c => c.put(request, copy));
            }
            return res;
          })
          .catch(() => cached || caches.match('./index.html'));
        return cached || network;
      })
    );
  }
});
