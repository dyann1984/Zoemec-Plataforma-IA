/* server/api-lib/_route-presupuestos.mjs contra los emuladores REALES de
   Firebase Auth + Firestore. Mismo patron que test/apusApi.test.mjs/
   test/planoTakeoffsApi.test.mjs. Cubre versionado inmutable, conflicto de
   concurrencia optimista, Baseline set-once, y aislamiento multi-tenant. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/api-lib/_route-presupuestos.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

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
/* projectId UNICO por llamada: 'PRO-1'/'PRO-2' fijos colisionaban con los
   MISMOS ids fijos usados en test/projectsApi.test.mjs cuando
   `npm run test:security` corre ambos archivos contra un solo emulador
   compartido. */
const uniqId = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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
    const res = await call(post(idToken, { action: 'create', id: uniqId('PRE-CREATE'), projectId: uniqId('PRO-BUDGET-CREATE'), snapshot: snapshotFixture(), ownerUid: 'uid-falso' }));
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
    const id = uniqId('PRE-SAVE');
    await call(post(idToken, { action: 'create', id, projectId: uniqId('PRO-BUDGET-SAVE'), snapshot: snapshotFixture() }));
    const edited = snapshotFixture({ importeTotal: 9999 });
    const saved = await call(post(idToken, { action: 'save-version', id, snapshot: edited, expectedParentVersionId: 'V1' }));
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.body.presupuesto.currentVersion, 'V2');
    const reopened = await call(get(idToken, { id }));
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

  it('PRUEBA ESPECIFICA de intento de sobrescritura del Baseline: multiples intentos por multiples caminos, ninguno lo mueve; existe audit trail; el Baseline sigue recuperable via restore-version', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('baseline-overwrite') });
    const db = getAdminDb();
    await call(post(idToken, { action: 'create', id: 'PRE-OVERWRITE', projectId: 'PRO-OVERWRITE', snapshot: snapshotFixture({ importeTotal: 100 }) }));
    const approved = await call(post(idToken, { action: 'approve-baseline', id: 'PRE-OVERWRITE' }));
    assert.equal(approved.body.presupuesto.baselineVersion, 'V1');

    // Intento 1: approve-baseline otra vez (camino directo) -- rechazado.
    const attempt1 = await call(post(idToken, { action: 'approve-baseline', id: 'PRE-OVERWRITE' }));
    assert.equal(attempt1.statusCode, 409);
    assert.equal(attempt1.body.code, 'BASELINE_ALREADY_SET');

    // Intento 2: guardar una version nueva y INTENTAR colar un baselineVersion
    // distinto en el body -- save-version nunca lee/escribe ese campo del
    // cliente, solo el servidor mueve baselineVersion (y solo approve-baseline
    // lo hace, una vez).
    const saved = await call(post(idToken, {
      action: 'save-version', id: 'PRE-OVERWRITE', snapshot: snapshotFixture({ importeTotal: 200 }),
      expectedParentVersionId: 'V1', baselineVersion: 'V2' // spoof deliberado, debe ignorarse
    }));
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.body.presupuesto.currentVersion, 'V2');
    assert.equal(saved.body.presupuesto.baselineVersion, 'V1', 'baselineVersion NUNCA se toma del body de save-version, ni siquiera si el cliente lo manda');

    // Intento 3: approve-baseline de nuevo, ya con currentVersion en V2 --
    // sigue rechazado, el gate es "ya existe baseline", no "coincide con currentVersion".
    const attempt3 = await call(post(idToken, { action: 'approve-baseline', id: 'PRE-OVERWRITE' }));
    assert.equal(attempt3.statusCode, 409);
    assert.equal(attempt3.body.code, 'BASELINE_ALREADY_SET');
    assert.equal(attempt3.body.presupuesto, undefined, 'un intento rechazado no debe devolver un presupuesto mutado');

    // Audit trail: debe existir un registro real de la aprobacion del Baseline.
    const auditSnap = await db.collection('presupuestoAudit').where('entryId', '==', 'PRE-OVERWRITE').where('action', '==', 'PRESUPUESTO_BASELINE_APPROVED').get();
    assert.equal(auditSnap.size, 1, 'debe existir exactamente UN evento de auditoria de aprobacion de Baseline, nunca uno por cada intento rechazado');
    assert.equal(auditSnap.docs[0].data().newStatus, 'V1');

    // El Baseline (V1) sigue siendo una version real y recuperable -- restore-version
    // sobre V1 crea una version NUEVA identica, nunca borra ni corrompe el Baseline.
    const restored = await call(post(idToken, { action: 'restore-version', id: 'PRE-OVERWRITE', version: 'V1' }));
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.body.presupuesto.snapshot.importeTotal, 100, 'el snapshot restaurado debe ser EXACTAMENTE el del Baseline original');
    assert.equal(restored.body.presupuesto.baselineVersion, 'V1', 'restaurar el contenido del Baseline no reasigna el puntero de Baseline');
    const finalList = await call(get(idToken, { id: 'PRE-OVERWRITE' }));
    assert.equal(finalList.body.versions.length, 3, 'V1 (baseline), V2, V3 (restauracion) -- ninguna version se perdio ni se sobreescribio');
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

describe('PRUEBA ESPECIFICA -- aislamiento por ORGANIZACION (Fase D.1, punto 9), no solo por usuario individual', () => {
  async function seedOrgMember(db, uid, organizationId){
    await db.doc(`organizations/${organizationId}`).set({ id: organizationId, name: `Empresa ${organizationId}`, status: 'ACTIVE_TRIAL' });
    await db.doc(`organizations/${organizationId}/members/${uid}`).set({ uid, role: 'company_manager', status: 'active' });
    await db.doc(`users/${uid}`).set({ uid, organizationId, role: 'user', plan: 'Gratis', active: true }, { merge: true });
  }

  it('un miembro de la Empresa B NUNCA puede leer/guardar/restaurar/aprobar Baseline/archivar un presupuesto de la Empresa A por ID', async () => {
    const db = getAdminDb();
    const { uid: uidA, idToken: tokenA } = await createUserAndGetIdToken({ email: uniq('presu-org-a') });
    const orgA = `org-presu-a-${Date.now()}`;
    await seedOrgMember(db, uidA, orgA);
    const { uid: uidB, idToken: tokenB } = await createUserAndGetIdToken({ email: uniq('presu-org-b') });
    const orgB = `org-presu-b-${Date.now()}`;
    await seedOrgMember(db, uidB, orgB);

    const created = await call(post(tokenA, { action: 'create', id: 'PRE-ORG-A', projectId: 'PRO-ORG-A', snapshot: snapshotFixture() }));
    assert.equal(created.body.presupuesto.organizationId, orgA);

    // Listado por projectId: la Empresa B nunca ve nada de un proyecto de la Empresa A.
    const listB = await call(get(tokenB, { projectId: 'PRO-ORG-A' }));
    assert.equal(listB.body.presupuestos.length, 0);

    // Acceso directo por ID -- todas las acciones deben rechazarse con 403.
    assert.equal((await call(get(tokenB, { id: 'PRE-ORG-A' }))).statusCode, 403);
    assert.equal((await call(post(tokenB, { action: 'save-version', id: 'PRE-ORG-A', snapshot: snapshotFixture({ nota: 'hackeado' }), expectedParentVersionId: 'V1' }))).statusCode, 403);
    assert.equal((await call(post(tokenB, { action: 'restore-version', id: 'PRE-ORG-A', version: 'V1' }))).statusCode, 403);
    assert.equal((await call(post(tokenB, { action: 'approve-baseline', id: 'PRE-ORG-A' }))).statusCode, 403);
    assert.equal((await call(post(tokenB, { action: 'archive', id: 'PRE-ORG-A' }))).statusCode, 403);

    // El presupuesto de la Empresa A sigue intacto.
    const stillThere = await call(get(tokenA, { id: 'PRE-ORG-A' }));
    assert.equal(stillThere.body.presupuesto.currentVersion, 'V1');
    assert.equal(stillThere.body.presupuesto.baselineVersion, null);
  });

  it('OTRO miembro de la MISMA organizacion SI puede leer/guardar/aprobar Baseline (espacio de trabajo compartido)', async () => {
    const db = getAdminDb();
    const { uid: uid1, idToken: token1 } = await createUserAndGetIdToken({ email: uniq('presu-share-1') });
    const org = `org-presu-share-${Date.now()}`;
    await seedOrgMember(db, uid1, org);
    const { uid: uid2, idToken: token2 } = await createUserAndGetIdToken({ email: uniq('presu-share-2') });
    await seedOrgMember(db, uid2, org);

    await call(post(token1, { action: 'create', id: 'PRE-ORG-SHARE', projectId: 'PRO-ORG-SHARE', snapshot: snapshotFixture() }));
    const approvedByColleague = await call(post(token2, { action: 'approve-baseline', id: 'PRE-ORG-SHARE' }));
    assert.equal(approvedByColleague.statusCode, 200, 'un companero de la misma organizacion SI puede aprobar el Baseline -- es trabajo de equipo');
    assert.equal(approvedByColleague.body.presupuesto.baselineVersion, 'V1');
  });
});
