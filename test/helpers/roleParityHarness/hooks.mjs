// Loader hook: sustituye SOLO infraestructura (Firebase Admin SDK y Firebase
// client SDK) por shims en memoria. Toda la logica de negocio de ZOEMEC
// (authGuard, rate limit, entitlement, handlers, orquestador de precios,
// motor APU) se carga desde el repositorio tal cual.
const ADMIN_SHIM = new URL('./shim-admin.mjs', import.meta.url).href;
const CLIENT_SHIM = new URL('./shim-client-firebase.mjs', import.meta.url).href;

export async function resolve(specifier, context, next){
  const r = await next(specifier, context);
  const u = r.url.replace(/\\/g, '/');
  if(u.endsWith('/server/api-lib/_firebaseAdmin.mjs')) return { url: ADMIN_SHIM, shortCircuit: true };
  if(u.endsWith('/src/firebase.js')) return { url: CLIENT_SHIM, shortCircuit: true };
  return r;
}
