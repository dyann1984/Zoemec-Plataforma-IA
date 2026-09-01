/* Espejo logico (no importado literalmente) de las reglas de enrutamiento
   de public/sw.js. public/sw.js es un archivo estatico servido tal cual
   por Vite (carpeta public/) -- no pasa por el grafo de modulos de Vite,
   asi que no puede hacer `import` de algo bajo src/. Este archivo existe
   para poder probar la LOGICA de decision (que se cachea, que nunca se
   toca) bajo node --test sin necesitar un navegador ni un Service Worker
   real -- ver src/pwa/cacheRules.test.js.

   Riesgo documentado: si se cambia la logica de enrutamiento en
   public/sw.js, este archivo debe actualizarse a mano en paralelo (no hay
   mecanismo automatico que los mantenga sincronizados). Verificado que
   ambos coinciden al momento de escribir esto. */

export function isSameOriginGet(method, requestUrl, origin){
  if(method !== 'GET') return false;
  try{ return new URL(requestUrl).origin === origin; }catch{ return false; }
}

export function isApiPath(pathname){
  return pathname.startsWith('/api/');
}

export function isAssetPath(pathname){
  return pathname.startsWith('/assets/');
}

export function isImagePath(pathname){
  return pathname.startsWith('/images/');
}

/* Decide la estrategia para una request ya filtrada por isSameOriginGet.
   Nunca devuelve 'cache' para /api/* -- esta funcion es la que el test
   ejercita para probar esa regla sin un navegador real. */
export function strategyFor(pathname, isNavigation){
  if(isApiPath(pathname)) return 'network-only';
  if(isNavigation) return 'network-first';
  if(isAssetPath(pathname)) return 'cache-first';
  if(isImagePath(pathname)) return 'stale-while-revalidate';
  return 'passthrough';
}
