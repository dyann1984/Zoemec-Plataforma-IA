import { FieldValue, getAdminDb } from './_firebaseAdmin.mjs';

/* AUD-018: /api/status y /api/health reportaban OpenAI como "ok" con solo
   comprobar que GET /v1/models respondiera -- eso confirma CONFIGURADO y
   ALCANZABLE, nunca si una generacion real (POST /v1/chat/completions, la
   unica que de verdad usa el producto) puede completarse. El 8-sep-2026 la
   cuenta se quedo sin credito: /v1/models seguia respondiendo 200 (no
   consume saldo) mientras /api/generate-apu fallaba 15/15 veces -- el panel
   decia "ok" durante una caida total de la funcion.

   ARQUITECTURA (revisada tras encontrar una condicion de carrera en la
   primera version): la señal vive en Firestore (config/aiHealth), NUNCA en
   memoria del proceso -- api/generate-apu.mjs y api/status.mjs son funciones
   serverless FISICAS separadas en Vercel (archivos distintos bajo api/, ver
   VERCEL_HOBBY_COMPAT.md), sin memoria compartida entre si ni entre cold
   starts. Firestore es externo a cualquier instancia y ya es el patron
   establecido en este proyecto para este problema exacto (mismo enfoque que
   _authGuard.mjs#enforceRateLimit, que ya usa Firestore para un contador
   compartido entre instancias).

   recordOpenAIOutcome() NUNCA lee antes de escribir: cada llamada real
   (exitosa o fallida) escribe de forma incondicional su propio timestamp
   (lastSuccessAt o lastErrorAt) via serverTimestamp(). Dos escrituras
   concurrentes nunca compiten por el mismo campo ni requieren merge de un
   valor leido previamente -- cada una es valida por si sola. El estado
   (operational/degraded/down/unknown) se DERIVA al leer, comparando cual de
   los dos timestamps es mas reciente y si sigue dentro del TTL. Esto
   reemplaza un diseño anterior con un arreglo "history" que si tenia una
   condicion de carrera real (leer-modificar-escribir bajo concurrencia).

   Se llena en requestChatCompletion() (_openaiApuCore.mjs), el unico punto
   compartido por generateAPU/generateAPUv2/answerAssistant: cada llamada
   REAL que el producto ya hace por uso normal deja constancia de si
   funciono o no. Nunca dispara una llamada nueva a OpenAI solo para revisar
   salud -- leer/escribir este documento es Firestore puro, gratis. Nunca se
   guarda la API key, el saldo, el prompt ni la respuesta completa del
   proveedor -- solo la categoria del error y el status HTTP. */

const COLLECTION = 'config';
const DOC_ID = 'aiHealth';

// TTL: cuanto dura una evidencia operacional antes de dejar de contar como
// "reciente". Un exito de hace 7 horas no puede seguir justificando
// "operational" ahora -- pasado el TTL, el estado cae a "unknown" (nunca se
// reafirma un "ok" viejo). 6h cubre una sesion de trabajo normal sin exigir
// trafico constante para no caer en "sin datos".
export const TTL_MS = 6 * 60 * 60 * 1000;

// Throttle de escritura: el reintento cliente de main.jsx#generateAI hace
// hasta 3 llamadas reales a /api/generate-apu por UN solo clic del usuario
// cuando OpenAI falla (ver comentario de recordOpenAIOutcome). Sin throttle,
// eso son 3 escrituras a Firestore por un solo intento fallido del usuario.
// Con throttle: si el MISMO resultado (mismo ok/errorClass) ya se registro
// hace menos de THROTTLE_MS, se omite la escritura -- el estado no cambio,
// no hay nada nuevo que persistir. Un cambio real de resultado (exito tras
// error, o distinta clase de error) siempre se escribe de inmediato, sin
// importar el throttle.
export const THROTTLE_MS = 15 * 1000;

// Taxonomia interna del error real. Nunca se expone el mensaje crudo de
// OpenAI al cliente (ver api/generate-apu.mjs) -- solo esta categoria.
export const ErrorClass = Object.freeze({
  AUTH_ERROR: 'AUTH_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
});

/* Interpreta el resultado del chequeo GRATUITO de alcanzabilidad
   (GET /v1/models, usado por api/status.mjs y _route-health.mjs) sin
   confundir "alcanzable" con "autorizado"/"usable":
   - threwNetworkError=true (DNS, timeout, conexion rechazada -- el fetch()
     nunca obtuvo una respuesta HTTP): reachable=false. Es el UNICO caso.
   - Cualquier respuesta HTTP real, sea 200, 401, 429 o 500, cuenta como
     reachable=true: el servidor SI contesto.
   - Un 401/403 en este chequeo especifico es evidencia fuerte e inmediata
     de credencial invalida (misma autenticacion que /v1/chat/completions,
     confirmado empiricamente: un 429 por falta de credito en cambio NO se
     refleja aqui -- /v1/models respondio 200 durante toda la caida real de
     AUD-010 -- por eso 401/403 si se usa como señal directa y 429/5xx en
     esta ruta especifica no se usan como proxy de nada, se deja que
     getOpenAIOperationalState() decida con la señal de generaciones reales).
   Pura: no hace fetch, solo interpreta un resultado ya obtenido. */
export function interpretReachabilityCheck({ threwNetworkError, httpStatus }){
  if(threwNetworkError) return { reachable:false, immediateErrorClass:null };
  if(httpStatus === 401 || httpStatus === 403) return { reachable:true, immediateErrorClass:ErrorClass.AUTH_ERROR };
  return { reachable:true, immediateErrorClass:null };
}

/* Clasifica un fallo real de OpenAI. Prioriza error.code (mas fiable cuando
   OpenAI lo manda, ej. "insufficient_quota") y cae a un patron de texto
   sobre error.message solo cuando no hay code -- exactamente el caso real
   observado en produccion ("You have no credits remaining...", sin code
   confirmado). Pura: no toca Firestore, no hace I/O -- testeable sin
   emulador. */
export function classifyOpenAIError(status, errBody){
  const code = String(errBody?.error?.code || '').toLowerCase();
  const message = String(errBody?.error?.message || '');
  if(status === 401 || status === 403) return ErrorClass.AUTH_ERROR;
  if(status === 429){
    if(code === 'insufficient_quota' || /no credits remaining|credit|quota/i.test(message)){
      return ErrorClass.QUOTA_EXHAUSTED;
    }
    return ErrorClass.RATE_LIMITED;
  }
  if(!status) return ErrorClass.UPSTREAM_TIMEOUT;
  if(status >= 500) return ErrorClass.UPSTREAM_ERROR;
  return ErrorClass.UNKNOWN_ERROR;
}

/* Mensaje seguro para el usuario final -- nunca el texto crudo del
   proveedor. El detalle tecnico real se registra server-side (console.error
   en _openaiApuCore.mjs), nunca en la respuesta HTTP. */
export function publicMessageForErrorClass(errorClass){
  switch(errorClass){
    case ErrorClass.AUTH_ERROR:
    case ErrorClass.RATE_LIMITED:
    case ErrorClass.QUOTA_EXHAUSTED:
    case ErrorClass.UPSTREAM_TIMEOUT:
    case ErrorClass.UPSTREAM_ERROR:
    default:
      return 'El servicio de IA se encuentra temporalmente no disponible. Intenta nuevamente mas tarde.';
  }
}

/* Pura: dado el estado ya leido de Firestore (o datos de prueba en tests),
   deriva operational/degraded/down/unknown. Separada de la lectura a
   Firestore a proposito -- esta es la logica con valor real de negocio y es
   la que se prueba sin necesitar el emulador. */
export function deriveOperationalState({ lastSuccessAtMs, lastErrorAtMs, lastErrorClass, lastErrorStatus }, nowMs = Date.now()){
  const successAge = lastSuccessAtMs ? nowMs - lastSuccessAtMs : Infinity;
  const errorAge = lastErrorAtMs ? nowMs - lastErrorAtMs : Infinity;
  const successRecent = successAge <= TTL_MS;
  const errorRecent = errorAge <= TTL_MS;

  if(!successRecent && !errorRecent){
    return { operational:null, state:'unknown', reason:'sin_evidencia_dentro_del_ttl' };
  }
  if(successRecent && !errorRecent){
    return { operational:true, state:'operational', reason:'ultimo_intento_real_exitoso' };
  }
  if(!successRecent && errorRecent){
    return { operational:false, state:'down', reason:lastErrorClass || ErrorClass.UNKNOWN_ERROR, lastErrorStatus:lastErrorStatus ?? null };
  }
  // Ambos dentro del TTL: el mas reciente de los dos manda.
  if(errorAge < successAge){
    return { operational:false, state:'down', reason:lastErrorClass || ErrorClass.UNKNOWN_ERROR, lastErrorStatus:lastErrorStatus ?? null };
  }
  return { operational:false, state:'degraded', reason:'exito_reciente_con_error_reciente_previo', lastErrorClass:lastErrorClass || null, lastErrorStatus:lastErrorStatus ?? null };
}

// outcomeKey identifica "el mismo resultado que la ultima vez": 'ok' para
// exito, o la clase de error para un fallo. Dos fallos seguidos con
// DISTINTA clase (ej. RATE_LIMITED y luego QUOTA_EXHAUSTED) NO se
// consideran "el mismo resultado" -- eso es informacion nueva, se escribe.
function outcomeKeyFor({ ok, status, errBody }){
  return ok ? 'ok' : classifyOpenAIError(status, errBody);
}

/* Pura: decide si esta escritura se puede omitir porque es un duplicado
   reciente del mismo resultado. Nunca omite un cambio real de estado
   (exito<->error, o cambio de clase de error) -- solo colapsa repeticiones
   identicas dentro de la ventana de throttle (ver THROTTLE_MS). Testeable
   sin Firestore. */
export function shouldSkipWrite({ lastRecordedOutcomeKey, lastRecordedAtMs }, outcomeKey, nowMs = Date.now()){
  if(!lastRecordedOutcomeKey || !lastRecordedAtMs) return false;
  if(lastRecordedOutcomeKey !== outcomeKey) return false;
  return (nowMs - lastRecordedAtMs) < THROTTLE_MS;
}

/* Fire-and-forget mas alla del try/catch propio: un fallo aqui NUNCA debe
   romper la respuesta real que ya recibio (o no) el usuario que disparo la
   llamada.

   Escritura NO estrictamente incondicional (a diferencia del diseño
   anterior a este throttle): se lee un solo campo escalar
   (lastOutcomeKey/lastRecordedAt) para decidir si omitir una repeticion
   reciente del mismo resultado. Esto reintroduce una lectura, pero NO el
   patron read-modify-write de arreglo que causaba la condicion de carrera
   real -- en el peor caso de una carrera entre dos escrituras concurrentes
   con el mismo resultado, ambas escriben (nunca se pierde informacion
   distinta, solo puede sobrar, como mucho, una escritura redundante). */
export async function recordOpenAIOutcome({ ok, status, errBody }){
  try{
    const ref = getAdminDb().collection(COLLECTION).doc(DOC_ID);
    const outcomeKey = outcomeKeyFor({ ok, status, errBody });
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    const skip = shouldSkipWrite({
      lastRecordedOutcomeKey: data?.lastOutcomeKey || null,
      lastRecordedAtMs: data?.lastRecordedAt?.toMillis?.() || 0
    }, outcomeKey);
    if(skip) return;

    if(ok){
      await ref.set({ lastSuccessAt: FieldValue.serverTimestamp(), lastOutcomeKey:'ok', lastRecordedAt: FieldValue.serverTimestamp() }, { merge:true });
    }else{
      await ref.set({
        lastErrorAt: FieldValue.serverTimestamp(),
        lastErrorClass: outcomeKey,
        lastErrorStatus: status || null,
        lastOutcomeKey: outcomeKey,
        lastRecordedAt: FieldValue.serverTimestamp()
      }, { merge:true });
    }
  }catch{
    /* Ver comentario de arriba: intencionalmente silencioso. */
  }
}

/* Unica funcion que toca Firestore para lectura. Delega toda la logica de
   TTL/clasificacion a deriveOperationalState (pura, probada sin emulador). */
export async function getOpenAIOperationalState(){
  try{
    const snap = await getAdminDb().collection(COLLECTION).doc(DOC_ID).get();
    if(!snap.exists) return { operational:null, state:'unknown', reason:'sin_intentos_reales_registrados' };
    const data = snap.data() || {};
    return deriveOperationalState({
      lastSuccessAtMs: data.lastSuccessAt?.toMillis?.() || 0,
      lastErrorAtMs: data.lastErrorAt?.toMillis?.() || 0,
      lastErrorClass: data.lastErrorClass || null,
      lastErrorStatus: data.lastErrorStatus ?? null
    });
  }catch{
    return { operational:null, state:'unknown', reason:'no_se_pudo_consultar_firestore' };
  }
}
