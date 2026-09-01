/* ====================================================================
   ZOEMEC · Service Worker minimo para PWA instalable.

   ESTRATEGIA DE ACTUALIZACION (para que un deploy nuevo nunca deje a un
   usuario atorado en una version vieja):
   - Nunca se precachea una lista fija de archivos: los bundles de Vite
     llevan hash de contenido en el nombre (dist/assets/index-XXXX.js), asi
     que una lista fija se rompe en cada build. En vez de eso, el cache se
     llena en runtime, bajo demanda.
   - Las NAVEGACIONES (el HTML de la SPA) usan network-first: si hay
     conexion, SIEMPRE se pide index.html a la red primero (que es lo que
     trae las referencias a los bundles hasheados de la version actual).
     El cache de navegacion solo se usa como respaldo si el usuario esta
     offline. Esto es lo que evita que quede "pegada" una version vieja:
     el navegador nunca preferira un index.html viejo del cache si hay red.
   - Los assets bajo /assets/ (JS/CSS con hash de contenido) usan
     cache-first: son inmutables por nombre -- si el contenido cambia, Vite
     genera un nombre de archivo nuevo, nunca reescribe uno existente, asi
     que cachearlos "para siempre" es seguro.
   - Imagenes bajo /images/ usan stale-while-revalidate (sirve del cache
     de inmediato, actualiza en segundo plano).
   - CUALQUIER request a /api/* pasa de largo, nunca se cachea ni se
     intercepta -- ver comentario en el fetch handler.
   - self.skipWaiting() en install + self.clients.claim() en activate:
     un Service Worker nuevo (deploy nuevo) toma control de las pestanas
     abiertas de inmediato, sin esperar a que el usuario cierre todas las
     pestanas. Combinado con el network-first de arriba, la siguiente
     navegacion/recarga ya sirve la version nueva completa.
   - activate() borra cualquier cache con un nombre de version anterior.

   Para forzar una limpieza de cache en un deploy futuro (ej. si cambia la
   estrategia), basta con subir CACHE_VERSION.
   ==================================================================== */

const CACHE_VERSION = 'zoemec-shell-v1';
const NAV_CACHE = `${CACHE_VERSION}-nav`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;
const KNOWN_CACHES = [NAV_CACHE, ASSET_CACHE, IMAGE_CACHE];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith('zoemec-shell-') && !KNOWN_CACHES.includes(name))
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo GET, solo mismo origen: deja pasar sin interceptar cualquier
  // cosa que no sea una lectura simple de nuestro propio dominio -- esto
  // excluye automaticamente POST/PUT/DELETE, llamadas cross-origin
  // (Firebase Auth, Google, etc.) y evita que el SW se meta en flujos de
  // autenticacion que no debe tocar.
  if(request.method !== 'GET' || new URL(request.url).origin !== self.location.origin){
    return;
  }

  const url = new URL(request.url);

  // Nunca interceptar /api/*: ni auth ni datos sensibles pasan por cache.
  if(url.pathname.startsWith('/api/')){
    return;
  }

  // Navegaciones (la SPA): network-first con respaldo a cache solo offline.
  if(request.mode === 'navigate'){
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(NAV_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // Assets con hash de contenido (Vite): cache-first, inmutables por nombre.
  if(url.pathname.startsWith('/assets/')){
    event.respondWith(
      caches.match(request).then((cached) => {
        if(cached) return cached;
        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
          return response;
        });
      })
    );
    return;
  }

  // Imagenes: stale-while-revalidate.
  if(url.pathname.startsWith('/images/')){
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(IMAGE_CACHE).then((cache) => cache.put(request, copy));
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Todo lo demas (fuentes de Google Fonts via CSS @import, etc.): deja que
  // el navegador lo maneje normal, sin pasar por el SW.
});
