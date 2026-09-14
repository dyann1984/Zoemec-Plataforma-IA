/* server/api-lib/_route-presupuestos.mjs contra los emuladores REALES de
   Firebase Auth + Firestore. Mismo patron que test/apusApi.test.mjs/
   test/planoTakeoffsApi.test.mjs. Cubre versionado inmutable, conflicto de
   concurrencia optimista, Baseline set-once, y aislamiento multi-tenant. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/api-lib/_route-presupuestos.mjs';
import { getAdminAuth } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/presupuestosApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:presupuestos`.');
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
function get(token, query){ return { method: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {}, query: query || {} }; }
async function call(req){ const res = mockRes(); await handler(req, res); return res; }
const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.zoemec`;

function snapshotFixture(overrides = {}){
  return {
    conceptos: [{ conceptoId: 'C1', capitulo: 'CIMENTACION', qty: 10, pu: 500, direct: 300, importe: 5000, apuId: 'A1' }],
    capituloSubtotals: [{ capitulo: 'CIMENTACION', direct: 3000, importe: 5000 }],
    costoDirectoTotal: 3000, importeTotal: 5000,
    ...overrides
  };
}

describe('POST /api/presupuestos action=create', () => {
  it('crea el presupuesto con version inicial V1 y baselineVersion null, identidad real del token', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('create') });
    const res = await call(post(idToken, { action: 'create', id: 'PRE-1', projectId: 'PRO-1', snapshot: snapshotFixture(), ownerUid: 'uid-falso' }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.presupuesto.ownerUid, uid);
    assert.equal(res.body.presupuesto.currentVersion, 'V1');
    assert.equal(res.body.presupuesto.baselineVersion, null);
  });

  it('sin token, 401', async () => {
    const res = await call(post(null, { action: 'create', id: 'PRE-X', projectId: 'PRO-X', snapshot: snapshotFixture() }));
    assert.equal(res.statusCode, 401);
  });
});

describe('versionado y conflicto de concurrencia', () => {
  it('save-version crea version nueva; releer trae EXACTAMENTE lo guardado', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('save') });
    await call(post(idToken, { action: 'create', id: 'PRE-2', projectId: 'PRO-2', snapshot: snapshotFixture() }));
    const edited = snapshotFixture({ importeTotal: 9999 });
    const saved = await call(post(idToken, { action: 'save-version', id: 'PRE-2', snapshot: edited, expectedParentVersionId: 'V1' }));
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.body.presupuesto.currentVersion, 'V2');
    const reopened = await call(get(idToken, { id: 'PRE-2' }));
    assert.deepEqual(reopened.body.presupuesto.snapshot, edited);
    assert.equal(reopened.body.versions.length, 2);
  });

  it('conflicto de version: dos guardados concurrentes desde la misma base -- el segundo se rechaza', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('conflict') });
    await call(post(idToken, { action: 'create', id: 'PRE-3', projectId: 'PRO-3', snapshot: snapshotFixture() }));
    const first = await call(post(idToken, { action: 'save-version', id: 'PRE-3', snapshot: snapshotFixture({ nota: 'A' }), expectedParentVersionId: 'V1' }));
    assert.equal(first.statusCode, 200);
    const second = await call(post(idToken, { action: 'save-version', id: 'PRE-3', snapshot: snapshotFixture({ nota: 'B' }), expectedParentVersionId: 'V1' }));
    assert.equal(second.statusCode, 409);
    assert.equal(second.body.code, 'VERSION_CONFLICT');
  });

  it('restore-version crea una version nueva identica, nunca borra las intermedias', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('restore') });
    await call(post(idToken, { action: 'create', id: 'PRE-4', projectId: 'PRO-4', snapshot: snapshotFixture({ nota: 'v1' }) }));
    await call(post(idToken, { action: 'save-version', id: 'PRE-4', snapshot: snapshotFixture({ nota: 'v2' }), expectedParentVersionId: 'V1' }));
    const restored = await call(post(idToken, { action: 'restore-version', id: 'PRE-4', version: 'V1' }));
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.body.presupuesto.currentVersion, 'V3');
    assert.equal(restored.body.presupuesto.snapshot.nota, 'v1');
    const listed = await call(get(idToken, { id: 'PRE-4' }));
    assert.equal(listed.body.versions.length, 3);
  });
});

describe('Baseline (set-once)', () => {
  it('approve-baseline fija baselineVersion sobre la version vigente', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('baseline') });
    await call(post(idToken, { action: 'create', id: 'PRE-5', projectId: 'PRO-5', snapshot: snapshotFixture() }));
    const approved = await call(post(idToken, { action: 'approve-baseline', id: 'PRE-5' }));
    assert.equal(approved.statusCode, 200);
    assert.equal(approved.body.presupuesto.baselineVersion, 'V1');
  });

  it('un segundo intento de aprobar Baseline se rechaza -- NUNCA se reasigna', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('baseline2') });
    await call(post(idToken, { action: 'create', id: 'PRE-6', projectId: 'PRO-6', snapshot: snapshotFixture() }));
    await call(post(idToken, { action: 'approve-baseline', id: 'PRE-6' }));
    const second = await call(post(idToken, { action: 'approve-baseline', id: 'PRE-6' }));
    assert.equal(second.statusCode, 409);
    assert.equal(second.body.code, 'BASELINE_ALREADY_SET');
  });

  it('guardar una version nueva DESPUES del baseline no lo mueve -- currentVersion avanza, baselineVersion queda fijo', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('baseline3') });
    await call(post(idToken, { action: 'create', id: 'PRE-7', projectId: 'PRO-7', snapshot: snapshotFixture() }));
    await call(post(idToken, { action: 'approve-baseline', id: 'PRE-7' }));
    const saved = await call(post(idToken, { action: 'save-version', id: 'PRE-7', snapshot: snapshotFixture({ importeTotal: 111 }), expectedParentVersionId: 'V1' }));
    assert.equal(saved.body.presupuesto.currentVersion, 'V2');
    assert.equal(saved.body.presupuesto.baselineVersion, 'V1');
  });
});

describe('aislamiento multi-tenant y archive', () => {
  it('un usuario no puede leer/guardar/aprobar baseline del presupuesto de otro', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('owner') });
    const stranger = await createUserAndGetIdToken({ email: uniq('stranger') });
    await call(post(owner.idToken, { action: 'create', id: 'PRE-8', projectId: 'PRO-8', snapshot: snapshotFixture() }));
    assert.equal((await call(get(stranger.idToken, { id: 'PRE-8' }))).statusCode, 403);
    assert.equal((await call(post(stranger.idToken, { action: 'save-version', id: 'PRE-8', snapshot: snapshotFixture(), expectedParentVersionId: 'V1' }))).statusCode, 403);
    assert.equal((await call(post(stranger.idToken, { action: 'approve-baseline', id: 'PRE-8' }))).statusCode, 403);
  });

  it('el listado por projectId solo trae los presupuestos propios', async () => {
    const a = await createUserAndGetIdToken({ email: uniq('lista-a') });
    const b = await createUserAndGetIdToken({ email: uniq('lista-b') });
    await call(post(a.idToken, { action: 'create', id: 'PRE-A1', projectId: 'PRO-LISTA', snapshot: snapshotFixture() }));
    await call(post(b.idToken, { action: 'create', id: 'PRE-B1', projectId: 'PRO-LISTA', snapshot: snapshotFixture() }));
    const listA = await call(get(a.idToken, { projectId: 'PRO-LISTA' }));
    assert.ok(listA.body.presupuestos.every(p => p.ownerUid === a.uid));
    assert.ok(!listA.body.presupuestos.some(p => p.id === 'PRE-B1'));
  });

  it('archive nunca borra el documento, solo lo saca del listado por defecto', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('archive') });
    await call(post(idToken, { action: 'create', id: 'PRE-9', projectId: 'PRO-9', snapshot: snapshotFixture() }));
    const archived = await call(post(idToken, { action: 'archive', id: 'PRE-9' }));
    assert.equal(archived.statusCode, 200);
    assert.ok(archived.body.presupuesto.archivedAt);
    const list = await call(get(idToken, { projectId: 'PRO-9' }));
    assert.ok(!list.body.presupuestos.some(p => p.id === 'PRE-9'));
  });

  it('organizationId siempre se deriva del token, nunca del body', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('noorg') });
    const res = await call(post(idToken, { action: 'create', id: 'PRE-10', projectId: 'PRO-10', snapshot: snapshotFixture(), organizationId: 'org-inventada' }));
    assert.equal(res.body.presupuesto.organizationId, null);
    assert.equal(res.body.presupuesto.ownerUid, uid);
  });
});
