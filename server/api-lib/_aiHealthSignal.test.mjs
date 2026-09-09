/* AUD-018 -- logica PURA de _aiHealthSignal.mjs (TTL, clasificacion de
   errores, mensaje publico). Cero Firestore, cero red: corre con
   `node --test` normal, sin emulador. La parte que si toca Firestore
   (recordOpenAIOutcome/getOpenAIOperationalState) se prueba por separado en
   test/aiHealthSignal.firestore.test.mjs (requiere emulador). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveOperationalState, classifyOpenAIError, publicMessageForErrorClass, shouldSkipWrite, interpretReachabilityCheck, ErrorClass, TTL_MS, THROTTLE_MS } from './_aiHealthSignal.mjs';

const HOUR = 60 * 60 * 1000;

describe('classifyOpenAIError -- taxonomia interna, nunca el texto crudo del proveedor', () => {
  it('401/403 -> AUTH_ERROR', () => {
    assert.equal(classifyOpenAIError(401, { error:{ message:'Incorrect API key provided' } }), ErrorClass.AUTH_ERROR);
    assert.equal(classifyOpenAIError(403, null), ErrorClass.AUTH_ERROR);
  });

  it('429 con code insufficient_quota real -> QUOTA_EXHAUSTED', () => {
    const errBody = { error:{ code:'insufficient_quota', message:'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.' } };
    assert.equal(classifyOpenAIError(429, errBody), ErrorClass.QUOTA_EXHAUSTED);
  });

  it('429 sin code pero con "no credits remaining" en el mensaje (caso real de AUD-010) -> QUOTA_EXHAUSTED, no RATE_LIMITED', () => {
    const errBody = { error:{ message:'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.' } };
    assert.equal(classifyOpenAIError(429, errBody), ErrorClass.QUOTA_EXHAUSTED);
  });

  it('429 real de rate limit (sin mencion de credito/cuota) -> RATE_LIMITED, nunca confundido con QUOTA_EXHAUSTED', () => {
    const errBody = { error:{ type:'requests', message:'Rate limit reached for requests' } };
    assert.equal(classifyOpenAIError(429, errBody), ErrorClass.RATE_LIMITED);
  });

  it('5xx -> UPSTREAM_ERROR', () => {
    assert.equal(classifyOpenAIError(500, null), ErrorClass.UPSTREAM_ERROR);
    assert.equal(classifyOpenAIError(503, null), ErrorClass.UPSTREAM_ERROR);
  });

  it('sin status (fallo de red antes de recibir respuesta HTTP) -> UPSTREAM_TIMEOUT', () => {
    assert.equal(classifyOpenAIError(0, null), ErrorClass.UPSTREAM_TIMEOUT);
    assert.equal(classifyOpenAIError(undefined, null), ErrorClass.UPSTREAM_TIMEOUT);
  });

  it('status no reconocido -> UNKNOWN_ERROR (nunca lanza, siempre clasifica algo)', () => {
    assert.equal(classifyOpenAIError(418, null), ErrorClass.UNKNOWN_ERROR);
  });
});

describe('publicMessageForErrorClass -- nunca expone el texto crudo del proveedor', () => {
  it('todas las clases de error dan un mensaje generico, controlado, sin detalle tecnico', () => {
    for(const cls of Object.values(ErrorClass)){
      const msg = publicMessageForErrorClass(cls);
      assert.equal(typeof msg, 'string');
      assert.ok(msg.length > 0);
      assert.ok(!/credit|quota|api key|billing/i.test(msg), `el mensaje publico para ${cls} no debe filtrar vocabulario interno del proveedor: "${msg}"`);
    }
  });
});

describe('deriveOperationalState -- TTL y los 5 estados, pura (sin Firestore)', () => {
  const now = 1_000_000_000_000; // referencia fija para que los tests sean deterministas

  it('sin ningun timestamp -> unknown, operational null (nunca "ok" inventado)', () => {
    const state = deriveOperationalState({ lastSuccessAtMs:0, lastErrorAtMs:0 }, now);
    assert.equal(state.state, 'unknown');
    assert.equal(state.operational, null);
  });

  it('solo exito, dentro del TTL -> operational', () => {
    const state = deriveOperationalState({ lastSuccessAtMs: now - HOUR, lastErrorAtMs:0 }, now);
    assert.equal(state.state, 'operational');
    assert.equal(state.operational, true);
  });

  it('exito justo en el limite del TTL (TTL_MS exacto) sigue contando como reciente', () => {
    const state = deriveOperationalState({ lastSuccessAtMs: now - TTL_MS, lastErrorAtMs:0 }, now);
    assert.equal(state.state, 'operational');
  });

  it('exito de hace mas del TTL (7h, TTL=6h) -> unknown, NO operational (un exito viejo no puede reafirmar salud actual)', () => {
    const state = deriveOperationalState({ lastSuccessAtMs: now - 7 * HOUR, lastErrorAtMs:0 }, now);
    assert.equal(state.state, 'unknown');
    assert.equal(state.operational, null);
  });

  it('solo error, dentro del TTL -> down, con la razon exacta clasificada', () => {
    const state = deriveOperationalState({ lastSuccessAtMs:0, lastErrorAtMs: now - HOUR, lastErrorClass: ErrorClass.QUOTA_EXHAUSTED, lastErrorStatus:429 }, now);
    assert.equal(state.state, 'down');
    assert.equal(state.operational, false);
    assert.equal(state.reason, ErrorClass.QUOTA_EXHAUSTED);
    assert.equal(state.lastErrorStatus, 429);
  });

  it('error de hace mas del TTL -> unknown, no se sigue mostrando "down" indefinidamente', () => {
    const state = deriveOperationalState({ lastSuccessAtMs:0, lastErrorAtMs: now - 7 * HOUR, lastErrorClass: ErrorClass.QUOTA_EXHAUSTED }, now);
    assert.equal(state.state, 'unknown');
  });

  it('exito Y error ambos dentro del TTL, error MAS reciente que el exito -> down (el mas reciente manda)', () => {
    const state = deriveOperationalState({
      lastSuccessAtMs: now - 3 * HOUR,
      lastErrorAtMs: now - 1 * HOUR,
      lastErrorClass: ErrorClass.UPSTREAM_ERROR
    }, now);
    assert.equal(state.state, 'down');
  });

  it('exito Y error ambos dentro del TTL, exito MAS reciente que el error -> degraded (recupero, pero hubo un fallo real reciente)', () => {
    const state = deriveOperationalState({
      lastSuccessAtMs: now - 1 * HOUR,
      lastErrorAtMs: now - 3 * HOUR,
      lastErrorClass: ErrorClass.RATE_LIMITED
    }, now);
    assert.equal(state.state, 'degraded');
    assert.equal(state.operational, false);
  });

  it('caso real AUD-010: 15/15 llamadas reales fallaron por quota_exceeded, sin ningun exito -> down, reason QUOTA_EXHAUSTED', () => {
    const state = deriveOperationalState({
      lastSuccessAtMs: 0,
      lastErrorAtMs: now - 5 * 60 * 1000,
      lastErrorClass: ErrorClass.QUOTA_EXHAUSTED,
      lastErrorStatus: 429
    }, now);
    assert.equal(state.state, 'down');
    assert.equal(state.reason, ErrorClass.QUOTA_EXHAUSTED);
  });

  it('secuencia SUCCESS -> SUCCESS: sigue operational (idempotente, no se degrada por repetir el mismo resultado)', () => {
    // Cada exito real solo actualiza lastSuccessAt -- dos exitos seguidos
    // dejan el mismo estado que uno solo, mas reciente.
    const afterFirst = deriveOperationalState({ lastSuccessAtMs: now - 2 * HOUR, lastErrorAtMs: 0 }, now);
    const afterSecond = deriveOperationalState({ lastSuccessAtMs: now - 5 * 60 * 1000, lastErrorAtMs: 0 }, now);
    assert.equal(afterFirst.state, 'operational');
    assert.equal(afterSecond.state, 'operational');
  });

  it('secuencia ERROR -> ERROR (misma clase): sigue down, con la clase mas reciente', () => {
    const afterFirst = deriveOperationalState({ lastSuccessAtMs:0, lastErrorAtMs: now - 2 * HOUR, lastErrorClass: ErrorClass.QUOTA_EXHAUSTED, lastErrorStatus:429 }, now);
    const afterSecond = deriveOperationalState({ lastSuccessAtMs:0, lastErrorAtMs: now - 5 * 60 * 1000, lastErrorClass: ErrorClass.QUOTA_EXHAUSTED, lastErrorStatus:429 }, now);
    assert.equal(afterFirst.state, 'down');
    assert.equal(afterSecond.state, 'down');
    assert.equal(afterSecond.reason, ErrorClass.QUOTA_EXHAUSTED);
  });

  it('ERROR -> ERROR con clase DISTINTA (ej. RATE_LIMITED luego QUOTA_EXHAUSTED): down, con la clase MAS RECIENTE, no la primera', () => {
    // Solo se puede observar el ultimo evento en este modelo de 2 timestamps
    // (por diseño, ver comentario de arquitectura) -- confirma que el ultimo
    // evento real siempre manda sobre uno anterior.
    const state = deriveOperationalState({ lastSuccessAtMs:0, lastErrorAtMs: now - 60_000, lastErrorClass: ErrorClass.QUOTA_EXHAUSTED, lastErrorStatus:429 }, now);
    assert.equal(state.reason, ErrorClass.QUOTA_EXHAUSTED);
  });

  it('QUOTA_EXHAUSTED reciente confirmado NUNCA se suaviza a degraded solo porque hubo un exito mas viejo dentro del TTL', () => {
    // Correccion explicita pedida: un quota_exhausted confirmado como el
    // evento MAS RECIENTE significa que la capacidad esta caida, aunque
    // OpenAI siga siendo alcanzable y haya habido un exito antes.
    const state = deriveOperationalState({
      lastSuccessAtMs: now - 4 * HOUR,
      lastErrorAtMs: now - 10 * 60 * 1000,
      lastErrorClass: ErrorClass.QUOTA_EXHAUSTED,
      lastErrorStatus: 429
    }, now);
    assert.equal(state.state, 'down');
    assert.notEqual(state.state, 'degraded');
  });

  it('AUTH_ERROR reciente -> down (nunca operational, nunca degraded)', () => {
    const state = deriveOperationalState({ lastSuccessAtMs:0, lastErrorAtMs: now - 60_000, lastErrorClass: ErrorClass.AUTH_ERROR, lastErrorStatus:401 }, now);
    assert.equal(state.state, 'down');
  });

  it('timeout/5xx aislado, con un exito MAS reciente despues (se recupero) -> degraded, no down ni operational puro', () => {
    const state = deriveOperationalState({
      lastSuccessAtMs: now - 10 * 60 * 1000,
      lastErrorAtMs: now - 30 * 60 * 1000,
      lastErrorClass: ErrorClass.UPSTREAM_ERROR,
      lastErrorStatus: 500
    }, now);
    assert.equal(state.state, 'degraded');
  });

  it('timestamp invalido/incompleto: lastErrorAt presente pero lastErrorClass ausente -> no revienta, cae a UNKNOWN_ERROR', () => {
    const state = deriveOperationalState({ lastSuccessAtMs:0, lastErrorAtMs: now - 60_000, lastErrorClass: null, lastErrorStatus: null }, now);
    assert.equal(state.state, 'down');
    assert.equal(state.reason, ErrorClass.UNKNOWN_ERROR);
  });

  it('timestamp corrupto (negativo): se trata como "no reciente", nunca revienta ni se toma como evidencia valida', () => {
    const state = deriveOperationalState({ lastSuccessAtMs: -5, lastErrorAtMs: 0 }, now);
    assert.equal(state.state, 'unknown');
  });

  it('timestamp corrupto (NaN): se trata igual que "sin timestamp" (Infinity de edad), nunca lanza', () => {
    const state = deriveOperationalState({ lastSuccessAtMs: NaN, lastErrorAtMs: 0 }, now);
    assert.equal(state.state, 'unknown');
  });

  it('documento inexistente equivale, en la capa pura, a ambos timestamps en 0 -> unknown', () => {
    const state = deriveOperationalState({ lastSuccessAtMs: 0, lastErrorAtMs: 0 }, now);
    assert.equal(state.state, 'unknown');
    assert.equal(state.operational, null);
  });
});

describe('shouldSkipWrite -- throttle de escrituras (AUD-018, punto 2: costo/volumen)', () => {
  const now = 1_000_000_000_000;

  it('sin registro previo -> nunca se omite (primera escritura siempre se hace)', () => {
    assert.equal(shouldSkipWrite({ lastRecordedOutcomeKey:null, lastRecordedAtMs:0 }, 'ok', now), false);
  });

  it('mismo resultado ("ok") hace 5s (dentro de THROTTLE_MS=15s) -> se omite: colapsa reintentos identicos', () => {
    assert.equal(shouldSkipWrite({ lastRecordedOutcomeKey:'ok', lastRecordedAtMs: now - 5000 }, 'ok', now), true);
  });

  it('mismo resultado ("ok") hace 20s (fuera de THROTTLE_MS) -> NO se omite', () => {
    assert.equal(shouldSkipWrite({ lastRecordedOutcomeKey:'ok', lastRecordedAtMs: now - 20000 }, 'ok', now), false);
  });

  it('resultado DISTINTO (ok -> QUOTA_EXHAUSTED), aunque sea inmediato -> NUNCA se omite: un cambio real de estado siempre se escribe', () => {
    assert.equal(shouldSkipWrite({ lastRecordedOutcomeKey:'ok', lastRecordedAtMs: now - 100 }, ErrorClass.QUOTA_EXHAUSTED, now), false);
  });

  it('clase de error DISTINTA (RATE_LIMITED -> QUOTA_EXHAUSTED), aunque sea inmediato -> NUNCA se omite', () => {
    assert.equal(shouldSkipWrite({ lastRecordedOutcomeKey:ErrorClass.RATE_LIMITED, lastRecordedAtMs: now - 100 }, ErrorClass.QUOTA_EXHAUSTED, now), false);
  });

  it('caso real: 3 reintentos del cliente (main.jsx) con el MISMO error QUOTA_EXHAUSTED en ~2s -> solo el primero escribe, los otros 2 se omiten', () => {
    // Simula la secuencia real: intento 1 en t=0 escribe: siguiente chequeo
    // (intento 2) a los 2.5s y (intento 3) a los ~7.5s, ambos dentro de 15s.
    const afterAttempt1 = { lastRecordedOutcomeKey: ErrorClass.QUOTA_EXHAUSTED, lastRecordedAtMs: now };
    assert.equal(shouldSkipWrite(afterAttempt1, ErrorClass.QUOTA_EXHAUSTED, now + 2500), true);
    assert.equal(shouldSkipWrite(afterAttempt1, ErrorClass.QUOTA_EXHAUSTED, now + 7500), true);
  });
});

describe('shouldSkipWrite -- el throttle NUNCA puede ocultar una transicion de estado (verificacion explicita pedida)', () => {
  const now = 2_000_000_000_000;

  it('ERROR -> ERROR (misma clase) dentro del TTL de throttle: SI puede colapsarse (no es una transicion, es una repeticion)', () => {
    assert.equal(shouldSkipWrite({ lastRecordedOutcomeKey:ErrorClass.QUOTA_EXHAUSTED, lastRecordedAtMs: now - 3000 }, ErrorClass.QUOTA_EXHAUSTED, now), true);
  });

  it('SUCCESS -> SUCCESS dentro del TTL de throttle: SI puede colapsarse', () => {
    assert.equal(shouldSkipWrite({ lastRecordedOutcomeKey:'ok', lastRecordedAtMs: now - 3000 }, 'ok', now), true);
  });

  it('ERROR -> SUCCESS inmediatamente: DEBE escribirse (transicion real, nunca se omite)', () => {
    assert.equal(shouldSkipWrite({ lastRecordedOutcomeKey:ErrorClass.QUOTA_EXHAUSTED, lastRecordedAtMs: now - 100 }, 'ok', now), false);
  });

  it('SUCCESS -> ERROR inmediatamente: DEBE escribirse (transicion real, nunca se omite)', () => {
    assert.equal(shouldSkipWrite({ lastRecordedOutcomeKey:'ok', lastRecordedAtMs: now - 100 }, ErrorClass.UPSTREAM_ERROR, now), false);
  });

  it('QUOTA_EXHAUSTED -> UPSTREAM_TIMEOUT inmediatamente: cambia informacion relevante (distinta causa raiz) -> DEBE escribirse, nunca se omite', () => {
    assert.equal(shouldSkipWrite({ lastRecordedOutcomeKey:ErrorClass.QUOTA_EXHAUSTED, lastRecordedAtMs: now - 100 }, ErrorClass.UPSTREAM_TIMEOUT, now), false);
  });

  it('UPSTREAM_TIMEOUT -> QUOTA_EXHAUSTED: se escribe (distinta clase) y el estado derivado resultante es down, con la razon actualizada', () => {
    assert.equal(shouldSkipWrite({ lastRecordedOutcomeKey:ErrorClass.UPSTREAM_TIMEOUT, lastRecordedAtMs: now - 100 }, ErrorClass.QUOTA_EXHAUSTED, now), false);
    // Confirma que, tras escribirse, deriveOperationalState refleja la causa
    // MAS RECIENTE (QUOTA_EXHAUSTED), no la anterior (UPSTREAM_TIMEOUT).
    const state = deriveOperationalState({ lastSuccessAtMs:0, lastErrorAtMs: now, lastErrorClass: ErrorClass.QUOTA_EXHAUSTED, lastErrorStatus:429 }, now);
    assert.equal(state.state, 'down');
    assert.equal(state.reason, ErrorClass.QUOTA_EXHAUSTED);
  });

  it('el throttle es solo una optimizacion de costo: bajo una carrera get()+decision+set(), el peor caso es una escritura redundante, nunca una transicion perdida ni un estado corrupto (documentado, verificado con concurrencia real en test/aiHealthSignal.firestore.test.mjs TEST E)', () => {
    // Nota de diseño, no una asercion de I/O: dos llamadas concurrentes con
    // DISTINTO outcomeKey nunca coinciden en el chequeo lastRecordedOutcomeKey
    // !== outcomeKey -> ambas devuelven false (no se omiten) sin importar el
    // orden de llegada de la lectura -- por construccion, una carrera en el
    // throttle no puede hacer que una transicion real se pierda.
    const raceReadSeenByRequestA = { lastRecordedOutcomeKey:'ok', lastRecordedAtMs: now - 50 };
    const raceReadSeenByRequestB = { lastRecordedOutcomeKey:'ok', lastRecordedAtMs: now - 50 }; // misma lectura "vieja" por la carrera
    assert.equal(shouldSkipWrite(raceReadSeenByRequestA, ErrorClass.QUOTA_EXHAUSTED, now), false);
    assert.equal(shouldSkipWrite(raceReadSeenByRequestB, ErrorClass.QUOTA_EXHAUSTED, now), false);
  });
});

describe('interpretReachabilityCheck -- reachable nunca es sinonimo de "usable" (tabla pedida)', () => {
  it('200 -> reachable=true, sin error inmediato', () => {
    const r = interpretReachabilityCheck({ threwNetworkError:false, httpStatus:200 });
    assert.equal(r.reachable, true);
    assert.equal(r.immediateErrorClass, null);
  });

  it('401 (credencial invalida) -> reachable=true (el servidor SI respondio), immediateErrorClass=AUTH_ERROR', () => {
    const r = interpretReachabilityCheck({ threwNetworkError:false, httpStatus:401 });
    assert.equal(r.reachable, true);
    assert.equal(r.immediateErrorClass, ErrorClass.AUTH_ERROR);
  });

  it('403 -> igual que 401: reachable=true, immediateErrorClass=AUTH_ERROR', () => {
    const r = interpretReachabilityCheck({ threwNetworkError:false, httpStatus:403 });
    assert.equal(r.reachable, true);
    assert.equal(r.immediateErrorClass, ErrorClass.AUTH_ERROR);
  });

  it('429 en el chequeo de /v1/models (rate limit o cuota) -> reachable=true, SIN immediateErrorClass -- nunca se usa como proxy de cuota (evidencia empirica: /v1/models respondio 200 durante toda la caida real de AUD-010)', () => {
    const r = interpretReachabilityCheck({ threwNetworkError:false, httpStatus:429 });
    assert.equal(r.reachable, true);
    assert.equal(r.immediateErrorClass, null);
  });

  it('5xx de OpenAI -> reachable=true (el servidor respondio, aunque con error) -- el estado operational/degraded se decide aparte, con la señal de generaciones reales, no aqui', () => {
    const r = interpretReachabilityCheck({ threwNetworkError:false, httpStatus:503 });
    assert.equal(r.reachable, true);
    assert.equal(r.immediateErrorClass, null);
  });

  it('timeout/DNS/red (fetch nunca obtuvo respuesta) -> reachable=false, el UNICO caso', () => {
    const r = interpretReachabilityCheck({ threwNetworkError:true, httpStatus:null });
    assert.equal(r.reachable, false);
  });
});
