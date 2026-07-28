/* ============================================================
   Service Worker — offline-first (Vanilla JS, sin build)
   Estrategias:
     · App shell (HTML/CSS/JS/iconos)  -> precache + stale-while-revalidate
     · Navegación (SPA)                -> network-first con fallback a index.html
     · Librerías de IA desde CDN       -> cache-first (se guardan tras 1ª carga)
     · Modelos/pesos (WebLLM/HF)       -> los gestiona la propia librería en Cache API;
                                          aquí solo damos fallback cache-first perezoso.
   ============================================================ */
const VERSION = 'v1.3.0';
const APP_CACHE = `asistente-app-${VERSION}`;
const CDN_CACHE = `asistente-cdn-${VERSION}`;
const RUNTIME_CACHE = `asistente-rt-${VERSION}`;

/* Rutas relativas al scope del SW (raíz del proyecto) */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/ui.js',
  './js/voice-engine.js',
  './js/ai-brain.js',
  './js/commands.js',
  './js/wake-porcupine.js',
  './js/semantic-memory.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png'
];

/* Orígenes de CDN que cacheamos de forma agresiva (librerías, wasm) */
const CDN_HOSTS = [
  'esm.run',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'raw.githubusercontent.com'
];

/* ---------- Instalación: precache del app shell ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.error('[SW] Precache falló:', err))
  );
});

/* ---------- Activación: limpiar versiones viejas ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![APP_CACHE, CDN_CACHE, RUNTIME_CACHE].includes(k))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* Permitir actualización inmediata desde la app */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

/* ---------- Fetch: enrutado por tipo de petición ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Navegaciones -> network-first con fallback al app shell (offline)
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, APP_CACHE, './index.html'));
    return;
  }

  // 2) Recursos del mismo origen (app shell) -> stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, APP_CACHE));
    return;
  }

  // 3) CDN de librerías -> cache-first (persisten tras la primera carga)
  if (CDN_HOSTS.some((h) => url.hostname.endsWith(h))) {
    event.respondWith(cacheFirst(req, CDN_CACHE));
    return;
  }

  // 4) Resto de terceros -> intenta red y cachea de respaldo
  event.respondWith(networkFirst(req, RUNTIME_CACHE));
});

/* ============================================================
   Estrategias de caché
   ============================================================ */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return cached || Response.error();
  }
}

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (fallbackUrl) {
      const fb = await cache.match(fallbackUrl);
      if (fb) return fb;
    }
    return Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}
