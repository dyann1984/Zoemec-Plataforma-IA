/* server/api-lib/_route-plano-takeoffs.mjs contra los emuladores REALES de
   Firebase Auth + Firestore. Mismo patron que test/apusApi.test.mjs. Cubre
   TEST QA 9 (reapertura con autosave -- guardar, releer, coincide exacto) y
   TEST QA 12 (aislamiento multi-tenant: un usuario nunca lee/escribe el
   plano de otro). */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/api-lib/_route-plano-takeoffs.mjs';
import { getAdminAuth } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/planoTakeoffsApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:planotakeoffs`.');
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
    elementos: [{ id: 'el-1', tipo: 'muro', estado: 'DETECTADO_VECTORIAL', origin: 'VECTOR_DETECTED', dimension: { longitud: 10 } }],
    escalaResuelta: { fuente: 'escala_grafica', realUnitsPerPdfPoint: 0.017638888888888888 },
    ...overrides
  };
}

describe('POST /api/plano-takeoffs action=create', () => {
  it('crea el plano con version inicial V1, identidad real del token (nunca del body)', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('create') });
    const res = await call(post(idToken, { action: 'create', id: 'PLANO-1', fileName: 'planta.pdf', snapshot: snapshotFixture(), ownerUid: 'uid-falso' }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.planoTakeoff.ownerUid, uid);
    assert.equal(res.body.planoTakeoff.currentVersion, 'V1');
    assert.equal(res.body.planoTakeoff.organizationId, null);
  });

  it('sin token, 401, no se crea nada', async () => {
    const res = await call(post(null, { action: 'create', id: 'PLANO-X', snapshot: snapshotFixture() }));
    assert.equal(res.statusCode, 401);
  });
});

describe('TEST QA 9 -- autosave y reapertura', () => {
  it('save-version guarda una version nueva; releer el plano trae EXACTAMENTE lo guardado', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('autosave') });
    const created = await call(post(idToken, { action: 'create', id: 'PLANO-2', snapshot: snapshotFixture() }));
    assert.equal(created.statusCode, 201);

    const editedSnapshot = snapshotFixture({
      elementos: [
        { id: 'el-1', tipo: 'muro', estado: 'VALIDADO_POR_USUARIO', origin: 'VECTOR_DETECTED', dimension: { longitud: 10 }, validatedBy: 'diana@zoemec.com' },
        { id: 'el-2', tipo: 'puerta', estado: 'PROPUESTO_POR_IA', origin: 'AI_APPROXIMATION', dimension: { piezas: 1 } }
      ]
    });
    const saved = await call(post(idToken, { action: 'save-version', id: 'PLANO-2', snapshot: editedSnapshot, expectedParentVersionId: 'V1' }));
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.body.planoTakeoff.currentVersion, 'V2');

    // "Reapertura": una peticion GET completamente nueva, como si el
    // usuario cerrara y volviera a abrir la app -- nunca depende de estado
    // en memoria del cliente.
    const reopened = await call(get(idToken, { id: 'PLANO-2' }));
    assert.equal(reopened.statusCode, 200);
    assert.deepEqual(reopened.body.planoTakeoff.snapshot, editedSnapshot);
    assert.equal(reopened.body.versions.length, 2);
  });

  it('conflicto de version: dos guardados concurrentes desde la MISMA base -- el segundo se rechaza, nunca pisa al primero en silencio', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('conflict') });
    await call(post(idToken, { action: 'create', id: 'PLANO-3', snapshot: snapshotFixture() }));
    const first = await call(post(idToken, { action: 'save-version', id: 'PLANO-3', snapshot: snapshotFixture({ nota: 'A' }), expectedParentVersionId: 'V1' }));
    assert.equal(first.statusCode, 200);
    const second = await call(post(idToken, { action: 'save-version', id: 'PLANO-3', snapshot: snapshotFixture({ nota: 'B' }), expectedParentVersionId: 'V1' }));
    assert.equal(second.statusCode, 409);
    assert.equal(second.body.code, 'VERSION_CONFLICT');
  });
});

describe('TEST QA 12 -- aislamiento multi-tenant', () => {
  it('un usuario NO puede leer el plano de otro usuario aunque conozca el id', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('owner') });
    const stranger = await createUserAndGetIdToken({ email: uniq('stranger') });
    await call(post(owner.idToken, { action: 'create', id: 'PLANO-PRIVADO', snapshot: snapshotFixture() }));
    const res = await call(get(stranger.idToken, { id: 'PLANO-PRIVADO' }));
    assert.equal(res.statusCode, 403);
  });

  it('un usuario NO puede guardar una version sobre el plano de otro usuario', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('owner2') });
    const stranger = await createUserAndGetIdToken({ email: uniq('stranger2') });
    await call(post(owner.idToken, { action: 'create', id: 'PLANO-PRIVADO-2', snapshot: snapshotFixture() }));
    const res = await call(post(stranger.idToken, { action: 'save-version', id: 'PLANO-PRIVADO-2', snapshot: snapshotFixture({ nota: 'hackeado' }), expectedParentVersionId: 'V1' }));
    assert.equal(res.statusCode, 403);
  });

  it('el listado GET sin id solo trae los planos propios, nunca los de otro usuario', async () => {
    const a = await createUserAndGetIdToken({ email: uniq('lista-a') });
    const b = await createUserAndGetIdToken({ email: uniq('lista-b') });
    await call(post(a.idToken, { action: 'create', id: 'PLANO-A1', snapshot: snapshotFixture() }));
    await call(post(b.idToken, { action: 'create', id: 'PLANO-B1', snapshot: snapshotFixture() }));
    const listA = await call(get(a.idToken, {}));
    assert.equal(listA.statusCode, 200);
    assert.ok(listA.body.planoTakeoffs.every(p => p.ownerUid === a.uid));
    assert.ok(!listA.body.planoTakeoffs.some(p => p.id === 'PLANO-B1'));
  });

  it('organizationId siempre se deriva del token/perfil server-side, nunca del valor enviado en el body', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('noorg') });
    const res = await call(post(idToken, { action: 'create', id: 'PLANO-ORG-SPOOF', snapshot: snapshotFixture(), organizationId: 'org-inventada-por-el-cliente' }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.planoTakeoff.organizationId, null); // usuario sin organizacion real
    assert.equal(res.body.planoTakeoff.ownerUid, uid);
  });
});

describe('POST /api/plano-takeoffs action=restore-version / archive', () => {
  it('restore-version crea una version NUEVA identica a la restaurada, nunca borra las intermedias', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('restore') });
    await call(post(idToken, { action: 'create', id: 'PLANO-4', snapshot: snapshotFixture({ nota: 'v1' }) }));
    await call(post(idToken, { action: 'save-version', id: 'PLANO-4', snapshot: snapshotFixture({ nota: 'v2' }), expectedParentVersionId: 'V1' }));
    const restored = await call(post(idToken, { action: 'restore-version', id: 'PLANO-4', version: 'V1' }));
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.body.planoTakeoff.currentVersion, 'V3');
    assert.equal(restored.body.planoTakeoff.snapshot.nota, 'v1');
    const listed = await call(get(idToken, { id: 'PLANO-4' }));
    assert.equal(listed.body.versions.length, 3);
  });

  it('archive nunca borra el documento, solo lo saca del listado por defecto', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('archive') });
    await call(post(idToken, { action: 'create', id: 'PLANO-5', snapshot: snapshotFixture() }));
    const archived = await call(post(idToken, { action: 'archive', id: 'PLANO-5' }));
    assert.equal(archived.statusCode, 200);
    assert.ok(archived.body.planoTakeoff.archivedAt);
    const list = await call(get(idToken, {}));
    assert.ok(!list.body.planoTakeoffs.some(p => p.id === 'PLANO-5'));
    const direct = await call(get(idToken, { id: 'PLANO-5' }));
    assert.equal(direct.statusCode, 200);
    assert.ok(direct.body.planoTakeoff.archivedAt);
  });
});
