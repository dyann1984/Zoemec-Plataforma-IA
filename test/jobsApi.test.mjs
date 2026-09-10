/* POST /api/jobs (Fase 2: arquitectura de jobs de IA server-side) contra los
   emuladores REALES de Firebase Auth + Firestore. Corre con
   `npm run test:jobs`. Mismo patron que test/apusApi.test.mjs.

   La llamada real a OpenAI se mockea (global.fetch) -- igual criterio que
   test/apuDossier.pdf.integration.test.mjs: se prueba la orquestacion del
   job (creacion, estados, idempotencia, aislamiento por usuario, plan
   gating) sin depender de una API key real ni de la variabilidad de un LLM
   real. El fixture de respuesta de OpenAI es una copia reducida del mismo
   contrato ya validado en test/aiContractFixture.test.mjs (normalizeAIApuToV2
   -> finalizeProfessionalAPU), para no re-probar aqui la normalizacion del
   schema, solo la orquestacion del job. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-dummy-key';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/api-lib/_route-jobs.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/jobsApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:jobs`.');
}

async function createUserAndGetIdToken({ email }){
  const auth = getAdminAuth();
  const user = await auth.createUser({ email, password: 'Test1234!', emailVerified: true });
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test1234!', returnSecureToken: true })
  });
  const data = await res.json();
  if(!res.ok) throw new Error('No se pudo autenticar: ' + JSON.stringify(data));
  return { uid: user.uid, email, idToken: data.idToken };
}

function mockRes(){
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (d) => { res.body = d; return res; };
  return res;
}
function post(token, body){ return { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body }; }
async function call(req){ const res = mockRes(); await handler(req, res); return res; }
const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.zoemec`;

// Copia reducida del fixture ya validado en test/aiContractFixture.test.mjs
// (mismo contrato que pide el prompt de generateAPUv2, ver
// server/api-lib/_openaiApuCore.mjs) -- solo lo necesario para que
// normalizeAIApuToV2/finalizeProfessionalAPU no truenen.
function aiRawFixture(concept){
  return {
    concept, unit: 'kg', family: 'Estructura metalica', confidence: 90, sat: '72101700',
    materials: [['Acero estructural ASTM A500', 1.05, 'kg', 46.5, 0]],
    materialSources: [{ proveedor: null, region: null, integracion: 'POR_UNIDAD_OBRA' }],
    labor: [['Cuadrilla de montadores', 0.012, 'jor', 1650, 1]],
    laborDetails: [{ cuadrilla: 2, rendimiento: 166.67, jornada: 8 }],
    equipment: [['Grua / equipo de izaje', 0.015, 'hr', 550]],
    equipmentDetails: [{ integracion: 'POR_JORNADA', rendimientoDiario: 166.67, vidaUtilDias: null, factorUso: null, modalidad: 'renta_jornada' }],
    seguridad: [['Casco de seguridad', 2, 'pza', 250]],
    seguridadDetails: [{ integracion: 'AMORTIZABLE', rendimientoDiario: 166.67, vidaUtilDias: 180, factorReposicion: 1 }],
    consumables: [], consumableSources: [],
    procedimientoConstructivo: ['Trazo y plomeo de ejes', 'Izaje y montaje'],
    controlCalidad: [{ especificacion: 'Verticalidad', criterio: '± 3 mm' }],
    criterioMedicion: { incluye: ['suministro', 'montaje'], excluye: ['pintura de acabado'] },
    technicalJustifications: {
      materials: 'Acero requerido por especificacion.', labor: 'Cuadrilla estandar de montaje.',
      equipment: 'Grua necesaria para izaje.', smallTools: 'Herramienta menor calculada como % de MO.',
      consumables: 'NO APLICA -- no se identificaron consumibles independientes para este procedimiento.',
      safety: 'EPP obligatorio para trabajo en altura.'
    },
    herramienta: 3, indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16,
    confidenceBreakdown: { precios: 70, rendimientos: 85, cantidades: 80, composicion: 90 },
    notes: ['Fixture de prueba.']
  };
}

const originalFetch = global.fetch;
let openaiBehavior = 'ok'; // 'ok' | 'fail' | 'malformed'
let openaiCallCount = 0;
before(() => {
  global.fetch = async (url, init) => {
    const u = String(url);
    if(u.startsWith('https://api.openai.com/')){
      openaiCallCount++;
      if(openaiBehavior === 'fail'){
        return { ok: false, status: 500, text: async () => JSON.stringify({ error: { message: 'fallo simulado' } }) };
      }
      if(openaiBehavior === 'malformed'){
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'no es json valido' } }] }) };
      }
      const body = JSON.parse(init.body);
      const concept = (body.messages || []).map(m => m.content).join('\n').match(/CONCEPTO ORIGINAL[^:]*:\n([^\n]+)/)?.[1] || 'Concepto de prueba';
      const raw = aiRawFixture(concept.trim());
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) } }] }) };
    }
    return originalFetch(url, init);
  };
});
after(() => { global.fetch = originalFetch; });
beforeEach(() => { openaiBehavior = 'ok'; openaiCallCount = 0; });

async function waitForTerminalJob(uid, jobId, { timeoutMs = 8000 } = {}){
  const db = getAdminDb();
  const ref = db.collection('users').doc(uid).collection('jobs').doc(jobId);
  const deadline = Date.now() + timeoutMs;
  while(Date.now() < deadline){
    const snap = await ref.get();
    const data = snap.data();
    if(data && (data.status === 'completed' || data.status === 'failed')) return data;
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('El job no llego a un estado terminal a tiempo: ' + jobId);
}

describe('POST /api/jobs', () => {
  it('rechaza sin token de autenticacion', async () => {
    const res = await call(post(null, { type: 'apu-generate', payload: { concept: 'Muro de block' } }));
    assert.equal(res.statusCode, 401);
  });

  it('rechaza un tipo de job no soportado', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('badtype') });
    const res = await call(post(idToken, { type: 'no-existe', payload: {} }));
    assert.equal(res.statusCode, 400);
  });

  it('crea el job y responde con jobId de inmediato (sin esperar a que OpenAI termine)', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('createjob') });
    const res = await call(post(idToken, { type: 'apu-generate', payload: { concept: 'Muro de block 15 cm', catalog: [], schema: 'v2' } }));
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.jobId);
  });

  it('el job termina "completed" con un APU real normalizado, y aumenta el uso del plan del usuario', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('completes') });
    const res = await call(post(idToken, { type: 'apu-generate', payload: { concept: 'Montaje de estructura metalica', catalog: [], schema: 'v2' } }));
    const finalJob = await waitForTerminalJob(uid, res.body.jobId);
    assert.equal(finalJob.status, 'completed');
    assert.equal(finalJob.result.ok, true);
    assert.equal(finalJob.result.apu.concept, 'Montaje de estructura metalica');
    assert.ok(finalJob.result.apu.materials.length > 0);
    assert.ok(finalJob.startedAt);
    assert.ok(finalJob.completedAt);

    const profile = await getAdminDb().collection('users').doc(uid).get();
    const month = new Date().toISOString().slice(0, 7);
    assert.equal(profile.data().usage?.[month]?.apu, 1);
  });

  it('un job que agota los intentos (OpenAI cae) termina "failed" con un error legible, nunca "processing" para siempre', async () => {
    openaiBehavior = 'fail';
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('fails') });
    const res = await call(post(idToken, { type: 'apu-generate', payload: { concept: 'Concepto que va a fallar', catalog: [], schema: 'v2' } }));
    const finalJob = await waitForTerminalJob(uid, res.body.jobId);
    assert.equal(finalJob.status, 'failed');
    assert.ok(finalJob.error);
    assert.equal(finalJob.result, null);
  });

  it('un job que falla NUNCA incrementa el uso del plan (solo un job completado cuenta)', async () => {
    openaiBehavior = 'fail';
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('failsnousage') });
    const res = await call(post(idToken, { type: 'apu-generate', payload: { concept: 'Concepto que va a fallar', catalog: [], schema: 'v2' } }));
    await waitForTerminalJob(uid, res.body.jobId);
    const profile = await getAdminDb().collection('users').doc(uid).get();
    const month = new Date().toISOString().slice(0, 7);
    assert.equal(profile.data().usage?.[month]?.apu ?? 0, 0);
  });

  it('reintenta hasta 2 veces server-side antes de marcar failed (nunca 3, para caber en maxDuration)', async () => {
    openaiBehavior = 'fail';
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('retries') });
    const res = await call(post(idToken, { type: 'apu-generate', payload: { concept: 'Concepto con reintentos', catalog: [], schema: 'v2' } }));
    await waitForTerminalJob(uid, res.body.jobId);
    assert.equal(openaiCallCount, 2);
  });

  it('respuesta de OpenAI mal formada (JSON invalido) tambien termina el job en "failed", nunca lo deja colgado', async () => {
    openaiBehavior = 'malformed';
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('malformed') });
    const res = await call(post(idToken, { type: 'apu-generate', payload: { concept: 'Concepto mal formado', catalog: [], schema: 'v2' } }));
    const finalJob = await waitForTerminalJob(uid, res.body.jobId);
    assert.equal(finalJob.status, 'failed');
  });

  it('idempotencia: repetir el mismo idempotencyKey reutiliza el job ya creado, nunca dispara una segunda llamada a OpenAI', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('idempotent') });
    const key = 'idem-' + Date.now();
    const first = await call(post(idToken, { type: 'apu-generate', idempotencyKey: key, payload: { concept: 'Concepto idempotente', catalog: [], schema: 'v2' } }));
    const second = await call(post(idToken, { type: 'apu-generate', idempotencyKey: key, payload: { concept: 'Concepto idempotente', catalog: [], schema: 'v2' } }));
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.jobId, first.body.jobId);
    assert.equal(second.body.reused, true);
  });

  it('aislamiento por usuario: el job de un usuario nunca es visible/legible por otro via la coleccion de otro uid', async () => {
    const alice = await createUserAndGetIdToken({ email: uniq('alice-jobs') });
    const res = await call(post(alice.idToken, { type: 'apu-generate', payload: { concept: 'Concepto de alice', catalog: [], schema: 'v2' } }));
    await waitForTerminalJob(alice.uid, res.body.jobId);
    const bobJobsSnap = await getAdminDb().collection('users').doc('bob-inexistente').collection('jobs').doc(res.body.jobId).get();
    assert.equal(bobJobsSnap.exists, false);
  });

  it('respeta el limite de plan Gratis (1 APU/mes): el segundo job del mes se rechaza con 402 antes de llamar a OpenAI', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('planlimit') });
    const first = await call(post(idToken, { type: 'apu-generate', payload: { concept: 'Primer APU del mes', catalog: [], schema: 'v2' } }));
    await waitForTerminalJob(uid, first.body.jobId);
    const callsAfterFirst = openaiCallCount;
    const second = await call(post(idToken, { type: 'apu-generate', payload: { concept: 'Segundo APU del mes', catalog: [], schema: 'v2' } }));
    assert.equal(second.statusCode, 402);
    assert.equal(openaiCallCount, callsAfterFirst); // nunca llego a llamar a OpenAI
  });
});
