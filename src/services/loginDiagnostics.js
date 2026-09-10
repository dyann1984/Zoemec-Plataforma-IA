/* Instrumentacion temporal de diagnostico para el incidente de produccion
   "permission-denied al iniciar sesion" (ver informe de auditoria). Objetivo
   unico: dejar rastro en consola de en que etapa exacta de una autenticacion
   ocurre un fallo, sin cambiar ningun comportamiento (nunca lanza, nunca
   altera el valor de retorno de nada que envuelva).

   No registra NUNCA: password, idToken, refreshToken, apiKey, el objeto
   `credential` completo ni el objeto de usuario de Firebase completo --
   solo strings cortos (stage, code, name, y hasta 200 caracteres del
   mensaje).

   traceId: cada intento de autenticacion (login interactivo, restauracion de
   sesion via onAuthStateChanged, login con Google) genera un id corto propio
   -- necesario porque, tras corregir la condicion de carrera (ver
   src/domain/authSessionCoordinator.js), sigue habiendo MULTIPLES
   disparadores posibles (login() explicito vs onAuthStateChanged en un
   reload) que pueden, en teoria, competir por construir la sesion; el
   coordinator garantiza que solo uno de verdad ejecute loadOrCreateProfile,
   pero sin un traceId por intento seria imposible, leyendo la consola,
   saber si dos lineas pertenecen al MISMO intento o a dos intentos
   distintos en rapida sucesion.

   Este modulo es deliberadamente desechable: una vez cerrado el incidente,
   se puede borrar junto con las llamadas a trace()/logLoginTrace() que lo
   usan. */

const PREFIX = '[ZOEMEC][LOGIN_TRACE]';

export function makeTraceId(){
  return Math.random().toString(36).slice(2, 8);
}

function emit(traceId, stage, extra){
  try{
    const label = traceId ? `${PREFIX} ${traceId}` : PREFIX;
    if(extra && Object.keys(extra).length){
      console.info(label, stage, extra);
    }else{
      console.info(label, stage);
    }
  }catch{ /* la instrumentacion nunca debe poder romper el login */ }
}

/* Tracer atado a UN intento de autenticacion: todas las llamadas a
   .trace(stage, extra) que compartan la misma instancia comparten traceId
   -- eso es lo que produce, en consola, lineas como
   "[ZOEMEC][LOGIN_TRACE] abc123 AUTH_SIGNIN_START". */
export function createLoginTracer(traceId = makeTraceId()){
  return {
    traceId,
    trace(stage, extra){ emit(traceId, stage, extra); },
  };
}

/* Compatibilidad: traza suelta, sin traceId (para el unico caso donde
   todavia no existe un tracer -- ej. un error que ocurre antes de poder
   crear uno). Se prefiere siempre createLoginTracer() cuando sea posible. */
export function logLoginTrace(stage, extra){
  emit(null, stage, extra);
}

/* Extrae SOLO los campos seguros de un error para diagnostico: nunca el
   objeto completo (podria traer, segun el SDK, referencias a la request
   original). */
export function errInfo(error){
  return {
    code: error?.code || null,
    name: error?.name || null,
    message: String(error?.message || '').slice(0, 200),
  };
}

export function isPermissionDeniedCode(code){
  return String(code || '').includes('permission-denied');
}
