/* SmokeCount — service worker
   Objetivo: o app precisa abrir e registrar um cigarro mesmo sem rede.
   Falhar em registrar por falta de conexão é inaceitável para o produto.

   Estratégia:
     - App shell em cache-first (HTML, CSS, JS): abre instantâneo, offline.
     - Fontes externas em stale-while-revalidate.
     - Nunca cacheia nada que não seja GET.
   Os dados do usuário NÃO passam por aqui — vivem em IndexedDB/localStorage.
*/

const VERSION = 'v1';
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
  './icons/icon-512.png'
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

  // Fontes: stale-while-revalidate.
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.open(RUNTIME).then(async cache => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then(res => { if (res.ok) cache.put(request, res.clone()); return res; })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

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
