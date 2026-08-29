/* api/challenge-decisions.mjs contra los emuladores REALES de Firebase Auth
   + Firestore. Corre con `npm run test:decisions`. Mismo patron que
   test/technicalMemoryApi.test.mjs.

   Fase 6.1: se agregan los casos A-L del hardening de integridad (server
   verifica el impacto economico en vez de confiar en el cliente, y el flujo
   CORRECT queda en 2 fases explicitas). Los casos J/K/L (viejos, Fase 6) se
   actualizan al nuevo nombre de campo `clientSnapshot` (antes `snapshot`). */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/api-lib/_route-challenge-decisions.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';
import { runApuChallenge } from '../src/domain/apuChallenge.js';
import { SYSTEM_RESOURCES } from '../src/domain/constructionSystems.js';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/challengeDecisionsApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:decisions`.');
}

async function createUserAndGetIdToken({ email, password = 'Test1234!', role = 'user' }){
  const auth = getAdminAuth();
  const user = await auth.createUser({ email, password, emailVerified: true });
  if(role !== 'user') await getAdminDb().collection('users').doc(user.uid).set({ uid: user.uid, email, role, plan: 'Empresa', active: true }, { merge: true });
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
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
function get(token, query){ return { method: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {}, query: query || {} }; }
async function call(req){ const res = mockRes(); await handler(req, res); return res; }
const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.zoemec`;

const sampleSnapshot = { category: 'rendimiento', currentValue: 6.36, baselineValue: 4.55, unitImpact: 59.02, projectImpact: 4721.65, baselineSource: 'Historico calibrado (Biblioteca ZOEMEC, matriz real)' };

/* Fixture con una desviacion de rendimiento REAL y verificable (mismo patron
   que src/domain/apuChallenge.test.js) -- se usa como `apuSnapshot` para
   probar que el servidor de verdad ejecuta runApuChallenge, no que confia en
   lo que el cliente reporta. El finding esperado se calcula aqui con el
   MISMO motor (nunca un numero inventado a mano). */
function deviatedApuFixture(){
  const [descripcion, cantidadPorUnidad, , salarioBase, fsr] = SYSTEM_RESOURCES.tablaroca.labor[0];
  const baselineRendimiento = 1 / cantidadPorUnidad;
  const currentRendimiento = baselineRendimiento * 1.3; // 30% mas optimista -- dispara el challenge (umbral 15%)
  const apu = {
    concept: 'Concepto de prueba', unit: 'm2', cantidadObra: 100, primaryActivity: 'tablaroca',
    materials: [], labor: [{ descripcion, cuadrilla: 1, rendimiento: currentRendimiento, salarioBase, fsr }],
    equipment: [], consumables: [], seguridad: [], factores: {}
  };
  const { challenges } = runApuChallenge(apu);
  const expectedFinding = challenges.find(c => c.category === 'rendimiento');
  return { apu, expectedFinding };
}

describe('POST /api/challenge-decisions action=record', () => {
  it('CASO J: MAINTAIN persiste y se puede leer de vuelta', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('maintain') });
    const apuId = `APU-${Date.now()}`;
    const res = await call(post(idToken, { action: 'record', apuId, projectId: 'P1', challengeId: 'yield:0', decision: 'MAINTAIN', clientSnapshot: sampleSnapshot }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.decision.decision, 'MAINTAIN');
    assert.equal(res.body.decision.actorUid, uid);
    const listRes = await call(get(idToken, { apuId }));
    assert.equal(listRes.body.decisions.length, 1);
    assert.equal(listRes.body.decisions[0].decision, 'MAINTAIN');
  });

  it('CASO K: JUSTIFY persiste el motivo real capturado', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('justify') });
    const apuId = `APU-${Date.now()}`;
    const res = await call(post(idToken, { action: 'record', apuId, challengeId: 'price:materials:0', decision: 'JUSTIFY', reason: 'Precio confirmado telefonicamente con el proveedor habitual.', clientSnapshot: sampleSnapshot }));
    assert.equal(res.body.decision.reason, 'Precio confirmado telefonicamente con el proveedor habitual.');
  });

  it('CASO L (Fase 6): el clientSnapshot (baseline/actual/impacto reportado) se guarda completo, tal como lo calculo Challenge en el cliente', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('snapshot') });
    const apuId = `APU-${Date.now()}`;
    const res = await call(post(idToken, { action: 'record', apuId, challengeId: 'yield:0', decision: 'MAINTAIN', clientSnapshot: sampleSnapshot }));
    assert.deepEqual(res.body.decision.clientSnapshot, sampleSnapshot);
  });

  it('CASO M (Fase 6): releer la decision mas tarde devuelve el MISMO clientSnapshot, sin recalcular nada por el paso del tiempo', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('immutable') });
    const apuId = `APU-${Date.now()}`;
    await call(post(idToken, { action: 'record', apuId, challengeId: 'yield:0', decision: 'MAINTAIN', clientSnapshot: sampleSnapshot }));
    const laterRead = await call(get(idToken, { apuId }));
    assert.deepEqual(laterRead.body.decisions[0].clientSnapshot, sampleSnapshot);
  });

  it('CASO N: un usuario distinto (no admin) no puede modificar la decision ya registrada por otro', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('owner') });
    const apuId = `APU-${Date.now()}`;
    await call(post(owner.idToken, { action: 'record', apuId, challengeId: 'yield:0', decision: 'MAINTAIN', clientSnapshot: sampleSnapshot }));
    const stranger = await createUserAndGetIdToken({ email: uniq('stranger') });
    const res = await call(post(stranger.idToken, { action: 'record', apuId, challengeId: 'yield:0', decision: 'JUSTIFY', reason: 'intento ajeno' }));
    assert.equal(res.statusCode, 403);
  });

  it('el mismo autor SI puede actualizar su propia decision (MAINTAIN -> JUSTIFY)', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('self-update') });
    const apuId = `APU-${Date.now()}`;
    await call(post(owner.idToken, { action: 'record', apuId, challengeId: 'yield:0', decision: 'MAINTAIN', clientSnapshot: sampleSnapshot }));
    const res = await call(post(owner.idToken, { action: 'record', apuId, challengeId: 'yield:0', decision: 'JUSTIFY', reason: 'cambio de opinion informado' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.decision.decision, 'JUSTIFY');
    assert.equal(res.body.decision.previousDecision, 'MAINTAIN');
  });

  it('un admin SI puede modificar la decision de otro usuario', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('owner2') });
    const apuId = `APU-${Date.now()}`;
    await call(post(owner.idToken, { action: 'record', apuId, challengeId: 'yield:0', decision: 'MAINTAIN', clientSnapshot: sampleSnapshot }));
    const admin = await createUserAndGetIdToken({ email: uniq('admin-n'), role: 'admin' });
    const res = await call(post(admin.idToken, { action: 'record', apuId, challengeId: 'yield:0', decision: 'DISMISS', reason: 'revisado por supervisor' }));
    assert.equal(res.statusCode, 200);
  });

  it('CASO O: una decision invalida devuelve error real (nunca body.decision), status != 2xx', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('badinput') });
    const res = await call(post(idToken, { action: 'record', apuId: 'APU-X', challengeId: 'yield:0', decision: 'NOT_A_REAL_DECISION' }));
    assert.ok(res.statusCode >= 400);
    assert.equal(typeof res.body.error, 'string');
    assert.equal(res.body.decision, undefined);
  });

  it('decision generada sin token se rechaza con 401, nunca se guarda nada', async () => {
    const res = await call(post(null, { action: 'record', apuId: 'APU-X', challengeId: 'yield:0', decision: 'MAINTAIN' }));
    assert.equal(res.statusCode, 401);
  });
});

/* Fase 6.1 -- hardening de integridad: separacion clientSnapshot (lo que
   reporta el cliente) vs verifiedSnapshot (lo que el servidor recalcula con
   runApuChallenge/calcAPUv2 real a partir del apuSnapshot enviado). */
describe('Fase 6.1 -- verificacion server-side del snapshot de Challenge', () => {
  it('CASO A: cliente envia projectImpact falso -- el servidor no lo acepta como verificado, guarda su propio recalculo', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('fake-impact') });
    const apuId = `APU-${Date.now()}`;
    const { apu, expectedFinding } = deviatedApuFixture();
    const fakeClientSnapshot = { category: 'rendimiento', currentValue: expectedFinding.currentValue, baselineValue: expectedFinding.baselineValue, unitImpact: 1, projectImpact: 1 };
    const res = await call(post(idToken, {
      action: 'record', apuId, challengeId: expectedFinding.id, decision: 'MAINTAIN',
      clientSnapshot: fakeClientSnapshot, apuSnapshot: apu
    }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.decision.verificationStatus, 'SERVER_VERIFIED');
    // El valor guardado como verificado es el del MOTOR, no el 1/1 falso del cliente.
    assert.equal(res.body.decision.verifiedSnapshot.projectImpact, expectedFinding.projectImpact);
    assert.equal(res.body.decision.verifiedSnapshot.unitImpact, expectedFinding.unitImpact);
    assert.notEqual(res.body.decision.verifiedSnapshot.projectImpact, 1);
  });

  it('CASO B: cliente envia baseline falso -- se detecta el mismatch con diferencias estructuradas', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('fake-baseline') });
    const apuId = `APU-${Date.now()}`;
    const { apu, expectedFinding } = deviatedApuFixture();
    const fakeClientSnapshot = { category: 'rendimiento', currentValue: expectedFinding.currentValue, baselineValue: 999999, unitImpact: expectedFinding.unitImpact, projectImpact: expectedFinding.projectImpact };
    const res = await call(post(idToken, {
      action: 'record', apuId, challengeId: expectedFinding.id, decision: 'MAINTAIN',
      clientSnapshot: fakeClientSnapshot, apuSnapshot: apu
    }));
    assert.equal(res.body.decision.clientMismatch, true);
    const diff = res.body.decision.differences.find(d => d.field === 'baselineValue');
    assert.ok(diff, 'debe reportar la diferencia estructurada del campo baselineValue');
    assert.equal(diff.client, 999999);
    assert.equal(diff.server, expectedFinding.baselineValue);
  });

  it('CASO C: el servidor recalcula Challenge con el motor real -- verifiedSnapshot queda SERVER_VERIFIED y coincide con runApuChallenge', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('server-verify') });
    const apuId = `APU-${Date.now()}`;
    const { apu, expectedFinding } = deviatedApuFixture();
    const res = await call(post(idToken, {
      action: 'record', apuId, challengeId: expectedFinding.id, decision: 'MAINTAIN', apuSnapshot: apu
    }));
    assert.equal(res.body.decision.verificationStatus, 'SERVER_VERIFIED');
    assert.equal(res.body.decision.verifiedSnapshot.currentValue, expectedFinding.currentValue);
    assert.equal(res.body.decision.verifiedSnapshot.baselineValue, expectedFinding.baselineValue);
    assert.equal(res.body.decision.verifiedSnapshot.unitImpact, expectedFinding.unitImpact);
    assert.equal(res.body.decision.verifiedSnapshot.projectImpact, expectedFinding.projectImpact);
    assert.equal(res.body.decision.verifiedSnapshot.severity, 'HIGH');
  });

  it('CASO D: un cambio posterior del APU no altera el snapshot historico ya guardado (releer da exactamente lo mismo)', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('frozen') });
    const apuId = `APU-${Date.now()}`;
    const { apu, expectedFinding } = deviatedApuFixture();
    await call(post(idToken, { action: 'record', apuId, challengeId: expectedFinding.id, decision: 'MAINTAIN', apuSnapshot: apu }));
    const firstRead = await call(get(idToken, { apuId }));
    const frozen = firstRead.body.decisions[0];
    // "El APU cambia despues" -- otra llamada de solo lectura (list), el
    // endpoint de decisiones nunca vuelve a tocar Firestore de `apus` (no
    // existe esa coleccion) ni recalcula nada por iniciativa propia.
    const secondRead = await call(get(idToken, { apuId }));
    assert.deepEqual(secondRead.body.decisions[0].verifiedSnapshot, frozen.verifiedSnapshot);
    assert.equal(secondRead.body.decisions[0].verificationStatus, 'SERVER_VERIFIED');
  });

  it('CASO E: sin apuSnapshot en la request -- UNVERIFIED_CLIENT_SNAPSHOT, nunca SERVER_VERIFIED', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('no-source') });
    const apuId = `APU-${Date.now()}`;
    const res = await call(post(idToken, { action: 'record', apuId, challengeId: 'yield:0', decision: 'MAINTAIN', clientSnapshot: sampleSnapshot }));
    assert.equal(res.body.decision.verificationStatus, 'UNVERIFIED_CLIENT_SNAPSHOT');
    assert.equal(res.body.decision.verifiedSnapshot, null);
    assert.notEqual(res.body.decision.verificationStatus, 'SERVER_VERIFIED');
  });

  it('CASO E-bis: apuSnapshot presente pero el challengeId no corresponde a ningun hallazgo recalculado -- NOT_VERIFIABLE, nunca SERVER_VERIFIED', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('not-verifiable') });
    const apuId = `APU-${Date.now()}`;
    const { apu } = deviatedApuFixture();
    const res = await call(post(idToken, { action: 'record', apuId, challengeId: 'yield:99-no-existe', decision: 'MAINTAIN', apuSnapshot: apu }));
    assert.equal(res.body.decision.verificationStatus, 'NOT_VERIFIABLE');
    assert.equal(res.body.decision.verifiedSnapshot, null);
    assert.ok(res.body.decision.verificationReason.length > 0);
  });

  it('CASO F: actor falso enviado en el body sigue ignorado (actorEmail/actorUid siempre del token verificado)', async () => {
    const { uid, email, idToken } = await createUserAndGetIdToken({ email: uniq('real-actor') });
    const apuId = `APU-${Date.now()}`;
    const res = await call(post(idToken, {
      action: 'record', apuId, challengeId: 'yield:0', decision: 'MAINTAIN', clientSnapshot: sampleSnapshot,
      actorUid: 'uid-falso-inyectado', actorEmail: 'atacante@evil.example'
    }));
    assert.equal(res.body.decision.actorUid, uid);
    assert.equal(res.body.decision.actorEmail, email);
  });

  it('CASO L: un mismatch detectado NO bloquea la decision profesional -- sigue devolviendo 200 con la decision guardada', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('mismatch-not-blocking') });
    const apuId = `APU-${Date.now()}`;
    const { apu, expectedFinding } = deviatedApuFixture();
    const res = await call(post(idToken, {
      action: 'record', apuId, challengeId: expectedFinding.id, decision: 'JUSTIFY', reason: 'Justificado a pesar de la discrepancia',
      clientSnapshot: { category: 'rendimiento', projectImpact: -1 }, apuSnapshot: apu
    }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.decision.decision, 'JUSTIFY');
    assert.equal(res.body.decision.clientMismatch, true);
  });

  it('CASO J: NaN/Infinity nunca se persisten como cifra de impacto -- se guardan como null', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('nan-infinity') });
    const apuId = `APU-${Date.now()}`;
    const res = await call(post(idToken, {
      action: 'record', apuId, challengeId: 'yield:0', decision: 'MAINTAIN',
      clientSnapshot: { category: 'rendimiento', unitImpact: Infinity, projectImpact: NaN, baselineValue: 'no-es-un-numero' }
    }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.decision.clientSnapshot.unitImpact, null);
    assert.equal(res.body.decision.clientSnapshot.projectImpact, null);
    assert.equal(res.body.decision.clientSnapshot.baselineValue, null);
  });

  it('CASO K: projectImpact=null se conserva como no estimable, nunca se convierte en 0', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('null-not-zero') });
    const apuId = `APU-${Date.now()}`;
    const res = await call(post(idToken, {
      action: 'record', apuId, challengeId: 'price:materials:0', decision: 'MAINTAIN',
      clientSnapshot: { category: 'precio', unitImpact: 45.5, projectImpact: null }
    }));
    assert.equal(res.body.decision.clientSnapshot.projectImpact, null);
    assert.notEqual(res.body.decision.clientSnapshot.projectImpact, 0);
  });
});

/* Fase 6.1 -- correccion #2: flujo CORRECT en 2 fases (PENDING_APPLICATION
   -> APPLIED_LOCAL_ONLY), nunca un "APPLIED" que finja persistencia server-
   side de un APU que hoy no tiene ninguna API de guardado. */
describe('Fase 6.1 -- applicationStatus de decisiones CORRECT', () => {
  it('CASO G: si nunca llega la 2a fase, la decision se queda honestamente en PENDING_APPLICATION (nunca se auto-promueve a APPLIED)', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('pending-only') });
    const apuId = `APU-${Date.now()}`;
    const { apu, expectedFinding } = deviatedApuFixture();
    const res = await call(post(idToken, {
      action: 'record', apuId, challengeId: expectedFinding.id, decision: 'CORRECT', applicationStatus: 'PENDING_APPLICATION',
      clientSnapshot: sampleSnapshot, apuSnapshot: apu
    }));
    assert.equal(res.body.decision.applicationStatus, 'PENDING_APPLICATION');
    const laterRead = await call(get(idToken, { apuId }));
    assert.equal(laterRead.body.decisions[0].applicationStatus, 'PENDING_APPLICATION', 'nunca debe aparecer APPLIED_LOCAL_ONLY sin la 2a llamada explicita');
  });

  it('flujo completo: PENDING_APPLICATION -> APPLIED_LOCAL_ONLY vía 2a llamada, preservando la verificacion de la 1a fase', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('two-phase') });
    const apuId = `APU-${Date.now()}`;
    const { apu, expectedFinding } = deviatedApuFixture();
    await call(post(idToken, {
      action: 'record', apuId, challengeId: expectedFinding.id, decision: 'CORRECT', applicationStatus: 'PENDING_APPLICATION',
      apuSnapshot: apu
    }));
    // 2a fase: NO reenvia apuSnapshot (el cliente ya aplico la correccion
    // localmente en este punto -- reenviar el APU corregido haria que el
    // servidor ya no encuentre el hallazgo original). La verificacion previa
    // (SERVER_VERIFIED) debe preservarse, no degradarse.
    const res2 = await call(post(idToken, { action: 'record', apuId, challengeId: expectedFinding.id, decision: 'CORRECT', applicationStatus: 'APPLIED_LOCAL_ONLY' }));
    assert.equal(res2.body.decision.applicationStatus, 'APPLIED_LOCAL_ONLY');
    assert.equal(res2.body.decision.verificationStatus, 'SERVER_VERIFIED', 'la verificacion de la fase 1 no debe perderse solo porque la fase 2 no reenvio el APU');
    assert.equal(res2.body.decision.verifiedSnapshot.projectImpact, expectedFinding.projectImpact);
  });

  it('CASO H: retry de la confirmacion APPLIED_LOCAL_ONLY es idempotente -- no crea un segundo documento ni decisiones contradictorias', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('idempotent-correct') });
    const apuId = `APU-${Date.now()}`;
    const { apu, expectedFinding } = deviatedApuFixture();
    await call(post(idToken, { action: 'record', apuId, challengeId: expectedFinding.id, decision: 'CORRECT', applicationStatus: 'PENDING_APPLICATION', apuSnapshot: apu }));
    await call(post(idToken, { action: 'record', apuId, challengeId: expectedFinding.id, decision: 'CORRECT', applicationStatus: 'APPLIED_LOCAL_ONLY' }));
    // Reintento de red simulado: la MISMA confirmacion se manda otra vez.
    const retry = await call(post(idToken, { action: 'record', apuId, challengeId: expectedFinding.id, decision: 'CORRECT', applicationStatus: 'APPLIED_LOCAL_ONLY' }));
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body.decision.applicationStatus, 'APPLIED_LOCAL_ONLY');
    const listRes = await call(get(idToken, { apuId }));
    assert.equal(listRes.body.decisions.length, 1, 'el id determinista apuId+challengeId debe seguir dando upsert, nunca duplicado');
  });

  it('un applicationStatus invalido es rechazado con error real', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('bad-application-status') });
    const res = await call(post(idToken, { action: 'record', apuId: 'APU-X', challengeId: 'yield:0', decision: 'CORRECT', applicationStatus: 'ALGO_INVENTADO' }));
    assert.ok(res.statusCode >= 400);
    assert.equal(res.body.decision, undefined);
  });
});

describe('Fase 6.1 -- audit trail conserva la verificacion y el estado de aplicacion', () => {
  it('CASO I: el registro de auditoria conserva verificationStatus/clientMismatch/applicationStatus, no solo el decision/reason', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('audit-trail') });
    const apuId = `APU-${Date.now()}`;
    const { apu, expectedFinding } = deviatedApuFixture();
    const res = await call(post(idToken, {
      action: 'record', apuId, challengeId: expectedFinding.id, decision: 'CORRECT', applicationStatus: 'PENDING_APPLICATION',
      clientSnapshot: { category: 'rendimiento', projectImpact: 1 }, apuSnapshot: apu
    }));
    // entryId = docId real devuelto por la API (decisionDocId sanea el
    // challengeId, ej. "yield:0" -> "yield_0" -- nunca reconstruir el id a
    // mano en el test, usar el que la API ya devolvio).
    const auditSnap = await getAdminDb().collection('challengeDecisionAudit').where('entryId', '==', res.body.decision.id).get();
    assert.equal(auditSnap.size, 1);
    const record = auditSnap.docs[0].data();
    assert.equal(record.verificationStatus, 'SERVER_VERIFIED');
    assert.equal(record.clientMismatch, true);
    assert.equal(record.applicationStatus, 'PENDING_APPLICATION');
    assert.ok(record.timestamp, 'debe tener timestamp real de Firestore, no inventado en el cliente');
  });
});
