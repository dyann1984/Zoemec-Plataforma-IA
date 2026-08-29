/* api/technical-memory.mjs contra los emuladores REALES de Firebase Auth +
   Firestore (nunca produccion). Corre con:
     npm run test:decisions
   Mismo patron que test/authGuard.test.mjs: tokens de ID reales emitidos
   por el emulador de Auth, llamando el handler exportado directo (mismo
   contrato req/res que usa Vercel). */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/api-lib/_route-technical-memory.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';
import { MEMORY_SCOPE, MEMORY_TYPE, MEMORY_STATUS } from '../src/domain/technicalMemory.js';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/technicalMemoryApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:decisions`.');
}

async function createUserAndGetIdToken({ email, password = 'Test1234!', emailVerified = true, role = 'user' }){
  const auth = getAdminAuth();
  const user = await auth.createUser({ email, password, emailVerified });
  if(role !== 'user') await getAdminDb().collection('users').doc(user.uid).set({ uid: user.uid, email, role, plan: 'Empresa', active: true }, { merge: true });
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await res.json();
  if(!res.ok) throw new Error('No se pudo autenticar el usuario de prueba: ' + JSON.stringify(data));
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

// CASO A: usuario autorizado crea proposal.
describe('POST /api/technical-memory action=proposal', () => {
  it('CASO A: cualquier usuario autenticado con correo verificado puede crear una propuesta', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('user') });
    const res = await call(post(idToken, {
      action: 'proposal', scope: MEMORY_SCOPE.PROJECT, type: MEMORY_TYPE.APPROVED_YIELD,
      subject: { primaryActivity: 'acero' }, value: 6.5, context: { projectId: 'P-TEST-1' }
    }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.entry.status, MEMORY_STATUS.PROPOSED);
  });

  // CASO G: actor viene del auth real, no del body.
  it('CASO G: createdBy/provenance.userId se toman del token real, ignorando lo que mande el body', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('identity') });
    const res = await call(post(idToken, {
      action: 'proposal', scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD,
      subject: { primaryActivity: 'acero' }, value: 10,
      createdBy: 'suplantado@evil.zoemec', provenance: { userId: 'uid-falso' }
    }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.entry.provenance.userId, uid);
    assert.notEqual(res.body.entry.provenance.userId, 'uid-falso');
    assert.notEqual(res.body.entry.createdBy, 'suplantado@evil.zoemec');
  });

  it('sin token, rechaza con 401', async () => {
    const res = await call(post(null, { action: 'proposal', scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD, subject: {}, value: 1 }));
    assert.equal(res.statusCode, 401);
  });
});

describe('POST /api/technical-memory action=approve/reject', () => {
  // CASO B: usuario sin permiso no aprueba.
  it('CASO B: un usuario normal (no admin) no puede aprobar -> 403', async () => {
    const admin = await createUserAndGetIdToken({ email: uniq('admin-b'), role: 'admin' });
    const created = await call(post(admin.idToken, { action: 'proposal', scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, value: 5 }));
    const normal = await createUserAndGetIdToken({ email: uniq('normal-b') });
    const res = await call(post(normal.idToken, { action: 'approve', id: created.body.entry.id }));
    assert.equal(res.statusCode, 403);
  });

  // CASO C: supervisor (admin) aprueba.
  it('CASO C: un admin aprueba correctamente y la entrada queda APPROVED', async () => {
    const admin = await createUserAndGetIdToken({ email: uniq('admin-c'), role: 'admin' });
    const created = await call(post(admin.idToken, { action: 'proposal', scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, value: 5 }));
    const res = await call(post(admin.idToken, { action: 'approve', id: created.body.entry.id }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.entry.status, MEMORY_STATUS.APPROVED);
    assert.equal(res.body.entry.approvedBy, admin.email);
  });

  // CASO H: body intenta falsificar approvedBy -> ignorado.
  it('CASO H: approvedBy enviado en el body se ignora, siempre es el admin autenticado real', async () => {
    const admin = await createUserAndGetIdToken({ email: uniq('admin-h'), role: 'admin' });
    const created = await call(post(admin.idToken, { action: 'proposal', scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, value: 5 }));
    const res = await call(post(admin.idToken, { action: 'approve', id: created.body.entry.id, approvedBy: 'suplantado@evil.zoemec' }));
    assert.equal(res.body.entry.approvedBy, admin.email);
    assert.notEqual(res.body.entry.approvedBy, 'suplantado@evil.zoemec');
  });

  // CASO D: doble approval no rompe estado.
  it('CASO D: aprobar dos veces la misma entrada falla con 409 en el segundo intento, el estado queda consistente', async () => {
    const admin = await createUserAndGetIdToken({ email: uniq('admin-d'), role: 'admin' });
    const created = await call(post(admin.idToken, { action: 'proposal', scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, value: 5 }));
    const first = await call(post(admin.idToken, { action: 'approve', id: created.body.entry.id }));
    const second = await call(post(admin.idToken, { action: 'approve', id: created.body.entry.id }));
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 409);
    const listRes = await call(get(admin.idToken, { id: created.body.entry.id }));
    assert.equal(listRes.body.entry.status, MEMORY_STATUS.APPROVED);
    assert.equal(listRes.body.entry.approvedAt, first.body.entry.approvedAt, 'la segunda llamada fallida no debe haber pisado la fecha de aprobacion real');
  });

  // CASO E: reject persiste motivo.
  it('CASO E: rechazar persiste el motivo real', async () => {
    const admin = await createUserAndGetIdToken({ email: uniq('admin-e'), role: 'admin' });
    const created = await call(post(admin.idToken, { action: 'proposal', scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, value: 5 }));
    const res = await call(post(admin.idToken, { action: 'reject', id: created.body.entry.id, reason: 'Rendimiento no verificado en campo.' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.entry.status, MEMORY_STATUS.REJECTED);
    assert.equal(res.body.entry.rejectionReason, 'Rendimiento no verificado en campo.');
  });

  // CASO I: transicion invalida rechazada server-side (REJECTED -> APPROVED).
  it('CASO I: aprobar una entrada ya RECHAZADA se rechaza server-side (409), la UI no es la barrera real', async () => {
    const admin = await createUserAndGetIdToken({ email: uniq('admin-i'), role: 'admin' });
    const created = await call(post(admin.idToken, { action: 'proposal', scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, value: 5 }));
    await call(post(admin.idToken, { action: 'reject', id: created.body.entry.id, reason: 'no' }));
    const res = await call(post(admin.idToken, { action: 'approve', id: created.body.entry.id }));
    assert.equal(res.statusCode, 409);
  });
});

// CASO F: supersede conserva la version anterior.
describe('POST /api/technical-memory action=supersede', () => {
  it('CASO F: supersede crea una version nueva PROPOSED y conserva la anterior como SUPERSEDED con su valor intacto', async () => {
    const admin = await createUserAndGetIdToken({ email: uniq('admin-f'), role: 'admin' });
    const created = await call(post(admin.idToken, { action: 'proposal', scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, value: 10 }));
    const approved = await call(post(admin.idToken, { action: 'approve', id: created.body.entry.id }));
    const res = await call(post(admin.idToken, { action: 'supersede', id: created.body.entry.id, value: 8 }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.superseded.status, MEMORY_STATUS.SUPERSEDED);
    assert.equal(res.body.superseded.value, 10, 'el valor original de la version anterior debe conservarse integro');
    assert.equal(res.body.nextEntry.status, MEMORY_STATUS.PROPOSED);
    assert.equal(res.body.nextEntry.value, 8);
    assert.equal(res.body.nextEntry.supersedes, created.body.entry.id);

    const oldStillThere = await call(get(admin.idToken, { id: created.body.entry.id }));
    assert.equal(oldStillThere.body.entry.status, MEMORY_STATUS.SUPERSEDED);
    assert.equal(oldStillThere.body.entry.value, 10);
  });
});

// CASO P: PROPOSED permanece distinto de APPROVED (via GET real, no solo en memoria).
describe('GET /api/technical-memory', () => {
  it('CASO P: una entrada recien creada se lee como PROPOSED, nunca como APPROVED, desde una lectura fresca', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('read-p') });
    const created = await call(post(idToken, { action: 'proposal', scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, value: 5 }));
    const res = await call(get(idToken, { id: created.body.entry.id }));
    assert.equal(res.body.entry.status, MEMORY_STATUS.PROPOSED);
    assert.notEqual(res.body.entry.status, MEMORY_STATUS.APPROVED);
  });

  it('lista filtra por status/scope/type correctamente', async () => {
    const admin = await createUserAndGetIdToken({ email: uniq('admin-list'), role: 'admin' });
    const projectId = `P-LIST-${Date.now()}`;
    const created = await call(post(admin.idToken, { action: 'proposal', scope: MEMORY_SCOPE.PROJECT, type: MEMORY_TYPE.APPROVED_PRICE, subject: { resourceDescripcion: 'Cemento' }, value: 230, context: { projectId } }));
    await call(post(admin.idToken, { action: 'approve', id: created.body.entry.id }));
    const res = await call(get(admin.idToken, { status: MEMORY_STATUS.APPROVED, type: MEMORY_TYPE.APPROVED_PRICE, projectId }));
    assert.ok(res.body.entries.some(e => e.id === created.body.entry.id));
    assert.ok(res.body.entries.every(e => e.status === MEMORY_STATUS.APPROVED));
  });
});
