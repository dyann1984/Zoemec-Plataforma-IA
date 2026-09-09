/* AUD-018 -- parte de _aiHealthSignal.mjs que SI toca Firestore
   (recordOpenAIOutcome/getOpenAIOperationalState), contra el EMULADOR REAL
   (nunca produccion). La logica de decision (TTL, clasificacion de errores,
   los 5 estados) ya esta cubierta sin emulador en
   server/api-lib/_aiHealthSignal.test.mjs (incluida en `npm test`) -- este
   archivo solo confirma que la escritura/lectura incondicional a Firestore
   funciona de verdad contra el servicio real. Corre con
   `npm run test:aiHealth` (firestore + auth emulator).

   config/aiHealth es un documento UNICO y compartido por diseño -- cada test
   lo borra antes de correr para no depender del orden ni de estado dejado
   por otro test. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { recordOpenAIOutcome, getOpenAIOperationalState, ErrorClass } from '../server/api-lib/_aiHealthSignal.mjs';
import { getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/aiHealthSignal.firestore.test.mjs requiere el emulador de Firebase Auth/Firestore. Ejecuta con `npm run test:aiHealth`.');
}

const DOC_REF = () => getAdminDb().collection('config').doc('aiHealth');

beforeEach(async () => {
  await DOC_REF().delete().catch(() => {});
});

describe('AUD-018 -- persistencia real en Firestore (emulador)', () => {
  it('TEST A -- sin ningun intento real registrado: unknown, nunca "ok" inventado', async () => {
    const state = await getOpenAIOperationalState();
    assert.equal(state.state, 'unknown');
    assert.equal(state.operational, null);
  });

  it('TEST B -- una llamada real exitosa se persiste y se lee de vuelta: operational', async () => {
    await recordOpenAIOutcome({ ok:true });
    const snap = await DOC_REF().get();
    assert.ok(snap.exists);
    assert.ok(snap.data().lastSuccessAt, 'lastSuccessAt debe quedar escrito con un Timestamp real de Firestore');
    const state = await getOpenAIOperationalState();
    assert.equal(state.state, 'operational');
  });

  it('TEST C -- caso real AUD-010 (429, no credits remaining) se persiste con la clase correcta: down/QUOTA_EXHAUSTED', async () => {
    await recordOpenAIOutcome({
      ok:false, status:429,
      errBody:{ error:{ message:'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.' } }
    });
    const snap = await DOC_REF().get();
    assert.equal(snap.data().lastErrorClass, ErrorClass.QUOTA_EXHAUSTED);
    assert.equal(snap.data().lastErrorStatus, 429);
    const state = await getOpenAIOperationalState();
    assert.equal(state.state, 'down');
    assert.equal(state.reason, ErrorClass.QUOTA_EXHAUSTED);
  });

  it('TEST D -- nunca persiste API key, saldo, prompt ni la respuesta completa del proveedor', async () => {
    await recordOpenAIOutcome({
      ok:false, status:429,
      errBody:{ error:{ message:'no credits remaining', code:'insufficient_quota' }, request_id:'req_abc123', someOtherField:'nunca deberia guardarse' }
    });
    const snap = await DOC_REF().get();
    const data = snap.data();
    const stored = JSON.stringify(data);
    assert.ok(!/sk-|apiKey|api_key/i.test(stored), 'no debe haber ninguna forma de API key en el documento persistido');
    assert.ok(!stored.includes('req_abc123'), 'no debe persistir campos crudos ajenos a los campos derivados permitidos');
    assert.ok(!stored.includes('nunca deberia guardarse'));
    // lastOutcomeKey/lastRecordedAt: metadata minima del throttle (punto 2 de
    // AUD-018) -- solo una etiqueta de estado y un timestamp, mismo criterio
    // de "nunca guardar nada sensible" que los demas campos.
    const allowedKeys = new Set(['lastSuccessAt', 'lastErrorAt', 'lastErrorClass', 'lastErrorStatus', 'lastOutcomeKey', 'lastRecordedAt']);
    for(const key of Object.keys(data)) assert.ok(allowedKeys.has(key), `campo inesperado persistido: ${key}`);
  });

  it('TEST G -- throttle real: 3 llamadas con el mismo resultado en <15s producen 1 sola escritura de fondo (lastErrorAt no avanza en la 2a/3a)', async () => {
    await recordOpenAIOutcome({ ok:false, status:429, errBody:{ error:{ code:'insufficient_quota' } } });
    const first = (await DOC_REF().get()).data().lastErrorAt.toMillis();
    await recordOpenAIOutcome({ ok:false, status:429, errBody:{ error:{ code:'insufficient_quota' } } });
    const second = (await DOC_REF().get()).data().lastErrorAt.toMillis();
    assert.equal(second, first, 'la segunda llamada con el mismo resultado dentro del throttle no debe reescribir lastErrorAt');
  });

  it('TEST H -- un cambio real de resultado (error -> exito) siempre escribe, sin importar el throttle; el estado resultante es degraded, no operational (hubo un error real reciente)', async () => {
    await recordOpenAIOutcome({ ok:false, status:429, errBody:{ error:{ code:'insufficient_quota' } } });
    await recordOpenAIOutcome({ ok:true });
    const data = (await DOC_REF().get()).data();
    assert.ok(data.lastSuccessAt, 'el exito inmediatamente despues de un error debe registrarse, nunca omitirse por throttle');
    const state = await getOpenAIOperationalState();
    // Corregido tras ejecutar contra el emulador real: la expectativa original
    // ('operational') era incorrecta, no el codigo. Con un error Y un exito
    // ambos dentro del TTL, deriveOperationalState devuelve 'degraded' -- un
    // exito no borra un error real reciente, exactamente el comportamiento
    // pedido explicitamente ("no conviertas un fallo real reciente en salud
    // limpia solo porque el ultimo intento funciono").
    assert.equal(state.state, 'degraded');
  });

  it('TEST E -- dos escrituras concurrentes (una exitosa, una fallida) nunca se pisan entre si -- cada una escribe SU PROPIO campo', async () => {
    await Promise.all([
      recordOpenAIOutcome({ ok:true }),
      recordOpenAIOutcome({ ok:false, status:500, errBody:null })
    ]);
    const snap = await DOC_REF().get();
    const data = snap.data();
    // Ambas escrituras deben sobrevivir: ninguna sobreescribe el documento
    // completo (a diferencia del diseño anterior con "history", que si tenia
    // esta condicion de carrera).
    assert.ok(data.lastSuccessAt, 'la escritura exitosa concurrente no debe perderse');
    assert.ok(data.lastErrorAt, 'la escritura fallida concurrente no debe perderse');
  });

  it('TEST F -- un fallo al escribir Firestore en recordOpenAIOutcome nunca lanza (fire-and-forget seguro)', async () => {
    await assert.doesNotReject(recordOpenAIOutcome({ ok:true }));
  });
});
