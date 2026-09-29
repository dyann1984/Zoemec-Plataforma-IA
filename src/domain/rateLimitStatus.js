/* F1/P0 (paridad por rol): vocabulario UNICO para "limite temporal de
   frecuencia" (HTTP 429), compartido por servidor (_authGuard.mjs) y cliente
   (orquestador de precios, lotes de Catalogo y de APU). Puro: sin React,
   Firebase ni red.

   Regla del encargo: un 429 NUNCA es un error definitivo ni se convierte en
   un resultado economico distinto -- es un estado "pendiente por limite",
   reintentable despues de `retryAfterSeconds`. */

export const RATE_LIMIT_CODE = 'RATE_LIMITED';

export function isRateLimitError(err){
  return Boolean(err) && (Number(err.status) === 429 || err.code === RATE_LIMIT_CODE);
}

/* Segundos restantes de la ventana. Siempre >= 1 cuando hay limite activo
   (nunca "reintenta en 0 s" mientras la ventana siga cerrada). */
export function computeRetryAfterSeconds(windowStart, windowMs, now = Date.now()){
  const remainingMs = Number(windowStart || 0) + Number(windowMs || 0) - now;
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

export function retryAfterSecondsOf(err){
  const n = Number(err?.retryAfterSeconds);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/* Texto corto para UI: "~1 min", "~15 min", "~45 s". */
export function formatRetryAfter(seconds){
  const s = Number(seconds);
  if(!Number.isFinite(s) || s <= 0) return 'en unos minutos';
  if(s < 60) return `~${Math.ceil(s)} s`;
  return `~${Math.ceil(s / 60)} min`;
}

/* Instante ISO a partir del cual se puede reintentar (persistible). */
export function retryAtFrom(seconds, now = Date.now()){
  const s = Number(seconds);
  return Number.isFinite(s) && s > 0 ? new Date(now + s * 1000).toISOString() : null;
}

/* Error tipado para el cliente: conserva status/code/retryAfterSeconds para
   que los lotes distingan PENDIENTE POR LIMITE de un ERROR REAL. */
export function makeRateLimitError(message, retryAfterSeconds = null){
  const e = new Error(message || 'Limite temporal de solicitudes alcanzado.');
  e.status = 429;
  e.code = RATE_LIMIT_CODE;
  e.retryAfterSeconds = retryAfterSeconds;
  return e;
}
