/* api/apus.mjs contra los emuladores REALES de Firebase Auth + Firestore
   (Fase 7). Corre con `npm run test:apus`. Mismo patron que
   test/projectsApi.test.mjs / test/challengeDecisionsApi.test.mjs.

   Fixture minima de APU (materials/labor vacios validos -- ver
   finalizeProfessionalAPU en apuProfessional.js, que tolera arreglos
   vacios) con un renglon de mano de obra real para poder verificar que el
   snapshot conserva datos reales entre versiones. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/apus.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/apusApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:apus`.');
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

function apuFixture(overrides = {}){
  return {
    concept: 'Concepto de prueba', unit: 'm2', cantidadObra: 10,
    materials: [], labor: [{ descripcion: 'Oficial albañil', cuadrilla: 1, rendimiento: 5, salarioBase: 380, fsr: 1.65 }],
    equipment: [], consumables: [], seguridad: [], factores: {},
    ...overrides
  };
}

describe('POST /api/apus action=create', () => {
  it('crea el APU con version inicial V1, identidad real del token', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('create') });
    const res = await call(post(idToken, { action: 'create', id: 'APU-1', projectId: 'PRO-1', apu: apuFixture(), ownerUid: 'uid-falso' }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.apu.ownerUid, uid);
    assert.equal(res.body.apu.currentVersion, 'V1');
    assert.equal(res.body.version.version, 'V1');
    assert.equal(res.body.apu.snapshot.labor[0].descripcion, 'Oficial albañil');
  });

  it('es idempotente: repetir create con el mismo id no duplica versiones', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('idempotent') });
    await call(post(idToken, { action: 'create', id: 'APU-2', apu: apuFixture() }));
    const second = await call(post(idToken, { action: 'create', id: 'APU-2', apu: apuFixture({ concept: 'Otro concepto' }) }));
    assert.equal(second.statusCode, 201);
    assert.equal(second.body.version, null); // no crea una version nueva en el reintento
    const listRes = await call(get(idToken, { id: 'APU-2' }));
    assert.equal(listRes.body.versions.length, 1);
  });

  it('create con id ya usado por OTRO usuario devuelve 409', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('owner') });
    await call(post(owner.idToken, { action: 'create', id: 'APU-SHARED', apu: apuFixture() }));
    const stranger = await createUserAndGetIdToken({ email: uniq('stranger') });
    const res = await call(post(stranger.idToken, { action: 'create', id: 'APU-SHARED', apu: apuFixture() }));
    assert.equal(res.statusCode, 409);
  });

  it('sin token, 401', async () => {
    const res = await call(post(null, { action: 'create', id: 'APU-X', apu: apuFixture() }));
    assert.equal(res.statusCode, 401);
  });
});

describe('GET /api/apus', () => {
  it('id: devuelve el APU actual + su historial de versiones', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('get-id') });
    await call(post(idToken, { action: 'create', id: 'APU-G1', apu: apuFixture() }));
    const res = await call(get(idToken, { id: 'APU-G1' }));
    assert.equal(res.body.apu.id, 'APU-G1');
    assert.equal(res.body.versions.length, 1);
    assert.equal(res.body.versions[0].version, 'V1');
  });

  it('projectId: lista solo mis APUs de ese proyecto', async () => {
    const a = await createUserAndGetIdToken({ email: uniq('list-a') });
    const b = await createUserAndGetIdToken({ email: uniq('list-b') });
    await call(post(a.idToken, { action: 'create', id: 'APU-LA1', projectId: 'PRO-L', apu: apuFixture() }));
    await call(post(b.idToken, { action: 'create', id: 'APU-LB1', projectId: 'PRO-L', apu: apuFixture() }));
    const listA = await call(get(a.idToken, { projectId: 'PRO-L' }));
    assert.ok(listA.body.apus.every(x => x.ownerUid === a.uid));
    assert.ok(listA.body.apus.some(x => x.id === 'APU-LA1'));
    assert.ok(!listA.body.apus.some(x => x.id === 'APU-LB1'));
  });

  it('sin id ni projectId: lista TODOS mis APUs, de cualquier proyecto', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('list-all') });
    await call(post(idToken, { action: 'create', id: 'APU-ALL1', projectId: 'PRO-X', apu: apuFixture() }));
    await call(post(idToken, { action: 'create', id: 'APU-ALL2', projectId: 'PRO-Y', apu: apuFixture() }));
    const res = await call(get(idToken, {}));
    const ids = res.body.apus.map(a => a.id);
    assert.ok(ids.includes('APU-ALL1'));
    assert.ok(ids.includes('APU-ALL2'));
  });

  it('un usuario distinto no puede leer un APU ajeno por id (403)', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('owner-get') });
    await call(post(owner.idToken, { action: 'create', id: 'APU-PRIV', apu: apuFixture() }));
    const stranger = await createUserAndGetIdToken({ email: uniq('stranger-get') });
    const res = await call(get(stranger.idToken, { id: 'APU-PRIV' }));
    assert.equal(res.statusCode, 403);
  });
});

describe('POST /api/apus action=save-version', () => {
  it('crea V2 sin alterar V1 (version anterior inmutable)', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('save-version') });
    await call(post(idToken, { action: 'create', id: 'APU-SV1', apu: apuFixture() }));
    const changed = apuFixture({ labor: [{ descripcion: 'Oficial albañil', cuadrilla: 1, rendimiento: 8, salarioBase: 380, fsr: 1.65 }] });
    const res = await call(post(idToken, { action: 'save-version', id: 'APU-SV1', apu: changed, reason: 'Ajuste de rendimiento', expectedParentVersionId: 'V1' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.version.version, 'V2');
    assert.equal(res.body.apu.currentVersion, 'V2');
    assert.equal(res.body.version.reason, 'Ajuste de rendimiento');

    const listRes = await call(get(idToken, { id: 'APU-SV1' }));
    assert.equal(listRes.body.versions.length, 2);
    const v1 = listRes.body.versions.find(v => v.version === 'V1');
    assert.equal(v1.snapshot.labor[0].rendimiento, 5, 'V1 nunca debe reflejar el cambio hecho para V2');
  });

  it('un usuario distinto no puede guardar version sobre un APU ajeno (403)', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('owner-sv') });
    await call(post(owner.idToken, { action: 'create', id: 'APU-SV2', apu: apuFixture() }));
    const stranger = await createUserAndGetIdToken({ email: uniq('stranger-sv') });
    const res = await call(post(stranger.idToken, { action: 'save-version', id: 'APU-SV2', apu: apuFixture(), expectedParentVersionId: 'V1' }));
    assert.equal(res.statusCode, 403);
  });

  it('save-version sobre un id inexistente da 404 (no crea nada implicito)', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('no-existe') });
    const res = await call(post(idToken, { action: 'save-version', id: 'APU-NO-EXISTE', apu: apuFixture(), expectedParentVersionId: 'V1' }));
    assert.equal(res.statusCode, 404);
  });

  // FIX Fase 9 (hallazgo F-004, P1): tests dedicados de concurrencia optimista.
  it('exige expectedParentVersionId -- sin el, se rechaza con error real (nunca crea version implicitamente)', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('no-parent') });
    await call(post(idToken, { action: 'create', id: 'APU-SV-NOPARENT', apu: apuFixture() }));
    const res = await call(post(idToken, { action: 'save-version', id: 'APU-SV-NOPARENT', apu: apuFixture({ cantidadObra: 99 }) }));
    assert.ok(res.statusCode >= 400);
    assert.equal(res.body.version, undefined);
    const check = await call(get(idToken, { id: 'APU-SV-NOPARENT' }));
    assert.equal(check.body.apu.currentVersion, 'V1', 'sin expectedParentVersionId nunca debe avanzar currentVersion');
    assert.equal(check.body.versions.length, 1);
  });

  it('CASO F-004: dos clientes parten de V1, A guarda V2, B (todavia en V1) recibe 409 VERSION_CONFLICT -- V3 NO se crea, currentVersion sigue V2, retry desde V2 SI crea V3', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('conflict') });
    await call(post(idToken, { action: 'create', id: 'APU-CONFLICT-1', apu: apuFixture() })); // V1

    // Cliente A: guarda V2 partiendo de V1 -- exito real.
    const saveA = await call(post(idToken, { action: 'save-version', id: 'APU-CONFLICT-1', apu: apuFixture({ cantidadObra: 20 }), reason: 'Guardado de A', expectedParentVersionId: 'V1' }));
    assert.equal(saveA.statusCode, 200);
    assert.equal(saveA.body.version.version, 'V2');
    assert.equal(saveA.body.apu.currentVersion, 'V2');

    // Cliente B: NUNCA se entero de A -- sigue creyendo que la version vigente es V1.
    const saveB = await call(post(idToken, { action: 'save-version', id: 'APU-CONFLICT-1', apu: apuFixture({ cantidadObra: 30 }), reason: 'Guardado de B (obsoleto)', expectedParentVersionId: 'V1' }));
    assert.equal(saveB.statusCode, 409, 'B debe recibir 409, nunca 200');
    assert.equal(saveB.body.code, 'VERSION_CONFLICT');
    assert.equal(saveB.body.currentVersion, 'V2', 'el error debe informar cual es la version REAL vigente');
    assert.equal(saveB.body.version, undefined, 'el intento fallido de B nunca debe traer un objeto version en la respuesta');

    // V3 NO se creo, currentVersion sigue siendo V2 (el guardado de A), y solo existen 2 versiones.
    const afterConflict = await call(get(idToken, { id: 'APU-CONFLICT-1' }));
    assert.equal(afterConflict.body.apu.currentVersion, 'V2', 'currentVersion debe seguir en V2 -- el intento fallido de B nunca lo debe mover');
    assert.equal(afterConflict.body.versions.length, 2, 'solo V1 y V2 deben existir -- el conflicto de B nunca debe crear una V3');
    assert.ok(!afterConflict.body.versions.some(v => v.version === 'V3'), 'V3 no debe existir tras el conflicto');
    assert.equal(afterConflict.body.apu.snapshot.cantidadObra, 20, 'el snapshot vigente debe seguir siendo el de A (20), nunca el de B (30) que fue rechazado');

    // Retry correcto: B recarga la version vigente real (V2) y reintenta desde ahi -- SI debe poder crear V3.
    const retryB = await call(post(idToken, { action: 'save-version', id: 'APU-CONFLICT-1', apu: apuFixture({ cantidadObra: 30 }), reason: 'Guardado de B (retry correcto)', expectedParentVersionId: 'V2' }));
    assert.equal(retryB.statusCode, 200, 'un retry que SI parte de la version vigente real (V2) debe tener exito');
    assert.equal(retryB.body.version.version, 'V3');
    assert.equal(retryB.body.apu.currentVersion, 'V3');
    assert.equal(retryB.body.apu.snapshot.cantidadObra, 30);

    const final = await call(get(idToken, { id: 'APU-CONFLICT-1' }));
    assert.equal(final.body.versions.length, 3);
    assert.deepEqual(final.body.versions.map(v => v.version).sort(), ['V1', 'V2', 'V3']);
  });
});

describe('POST /api/apus action=restore-version', () => {
  it('restaurar V1 crea una V3 nueva con el snapshot de V1, sin borrar ni tocar V1/V2', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('restore') });
    await call(post(idToken, { action: 'create', id: 'APU-R1', apu: apuFixture() })); // V1 rendimiento=5
    await call(post(idToken, { action: 'save-version', id: 'APU-R1', apu: apuFixture({ labor: [{ descripcion: 'Oficial albañil', cuadrilla: 1, rendimiento: 9, salarioBase: 380, fsr: 1.65 }] }), expectedParentVersionId: 'V1' })); // V2 rendimiento=9

    const res = await call(post(idToken, { action: 'restore-version', id: 'APU-R1', version: 'V1' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.version.version, 'V3');
    assert.equal(res.body.apu.snapshot.labor[0].rendimiento, 5, 'V3 debe reproducir el contenido de V1');
    assert.match(res.body.version.reason, /Restauracion de V1/);

    const listRes = await call(get(idToken, { id: 'APU-R1' }));
    assert.equal(listRes.body.versions.length, 3);
    const v2 = listRes.body.versions.find(v => v.version === 'V2');
    assert.equal(v2.snapshot.labor[0].rendimiento, 9, 'V2 sigue intacta, restaurar V1 no la toco');
  });

  it('restaurar una version que no existe da 404', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('restore-404') });
    await call(post(idToken, { action: 'create', id: 'APU-R2', apu: apuFixture() }));
    const res = await call(post(idToken, { action: 'restore-version', id: 'APU-R2', version: 'V99' }));
    assert.equal(res.statusCode, 404);
  });
});

describe('POST /api/apus action=archive', () => {
  it('un APU archivado desaparece de la lista por proyecto pero conserva sus versiones (equivalente a "Borrar" sin perder el dato)', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('archive') });
    await call(post(idToken, { action: 'create', id: 'APU-ARCH', projectId: 'PRO-ARCH', apu: apuFixture() }));
    const archiveRes = await call(post(idToken, { action: 'archive', id: 'APU-ARCH' }));
    assert.equal(archiveRes.statusCode, 200);
    assert.ok(archiveRes.body.apu.archivedAt);

    const list = await call(get(idToken, { projectId: 'PRO-ARCH' }));
    assert.ok(!list.body.apus.some(a => a.id === 'APU-ARCH'));

    const direct = await call(get(idToken, { id: 'APU-ARCH' }));
    assert.equal(direct.body.versions.length, 1, 'las versiones se conservan aunque el APU este archivado');
  });
});

describe('POST /api/apus action=link-project', () => {
  async function seedProject(db, ownerUid, id){
    await db.collection('projects').doc(id).set({ id, ownerUid, name: 'Proyecto de prueba', archivedAt: null });
  }

  it('vincula un APU legacy (sin projectId) a un proyecto real del mismo dueno', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('link') });
    const db = getAdminDb();
    await seedProject(db, uid, 'PRO-LINK1');
    await call(post(idToken, { action: 'create', id: 'APU-LINK1', apu: apuFixture() })); // sin projectId
    const res = await call(post(idToken, { action: 'link-project', id: 'APU-LINK1', projectId: 'PRO-LINK1' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.apu.projectId, 'PRO-LINK1');

    const auditSnap = await db.collection('apuAudit').where('entryId', '==', 'APU-LINK1').where('action', '==', 'APU_PROJECT_LINKED').get();
    assert.equal(auditSnap.size, 1);
  });

  it('es idempotente: vincular dos veces al mismo proyecto no falla', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('link-idem') });
    const db = getAdminDb();
    await seedProject(db, uid, 'PRO-LINK2');
    await call(post(idToken, { action: 'create', id: 'APU-LINK2', apu: apuFixture() }));
    await call(post(idToken, { action: 'link-project', id: 'APU-LINK2', projectId: 'PRO-LINK2' }));
    const second = await call(post(idToken, { action: 'link-project', id: 'APU-LINK2', projectId: 'PRO-LINK2' }));
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.apu.projectId, 'PRO-LINK2');
  });

  it('rechaza vincular un APU ajeno', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('link-owner') });
    const stranger = await createUserAndGetIdToken({ email: uniq('link-stranger') });
    const db = getAdminDb();
    await seedProject(db, stranger.uid, 'PRO-LINK3');
    await call(post(owner.idToken, { action: 'create', id: 'APU-LINK3', apu: apuFixture() }));
    const res = await call(post(stranger.idToken, { action: 'link-project', id: 'APU-LINK3', projectId: 'PRO-LINK3' }));
    assert.equal(res.statusCode, 403);
  });

  it('rechaza vincular a un proyecto ajeno (nunca cruza APU de un dueno con proyecto de otro)', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('link-owner2') });
    const stranger = await createUserAndGetIdToken({ email: uniq('link-stranger2') });
    const db = getAdminDb();
    await seedProject(db, stranger.uid, 'PRO-AJENO');
    await call(post(owner.idToken, { action: 'create', id: 'APU-LINK4', apu: apuFixture() }));
    const res = await call(post(owner.idToken, { action: 'link-project', id: 'APU-LINK4', projectId: 'PRO-AJENO' }));
    assert.equal(res.statusCode, 403);
  });

  it('proyecto inexistente da 404, nunca vincula a un id inventado', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('link-404') });
    await call(post(idToken, { action: 'create', id: 'APU-LINK5', apu: apuFixture() }));
    const res = await call(post(idToken, { action: 'link-project', id: 'APU-LINK5', projectId: 'PRO-NO-EXISTE' }));
    assert.equal(res.statusCode, 404);
  });
});
