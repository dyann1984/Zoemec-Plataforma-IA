/* server/api-lib/_route-catalogo-conceptos.mjs contra los emuladores REALES
   de Firebase Auth + Firestore. Mismo patron que test/planoTakeoffsApi.test.mjs/
   test/apusApi.test.mjs. Cubre creacion en lote, edicion, transiciones de
   estado, asociacion de APU existente, regionalizacion (nunca default
   silencioso de ciudad) y aislamiento multi-tenant. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/api-lib/_route-catalogo-conceptos.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/catalogConceptosApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:catalogconceptos`.');
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

function conceptoFixture(overrides = {}){
  return { clave: 'ALB-001', capitulo: 'albañilería', concept: 'Muro de block hueco 15cm', unit: 'm²', qty: 24, ...overrides };
}

describe('POST /api/catalogo-conceptos action=create', () => {
  it('crea en lote, normaliza capitulo, arranca en PENDIENTE sin APU', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('create') });
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-1', conceptos: [conceptoFixture(), conceptoFixture({ clave: 'ALB-002', concept: 'Aplanado fino' })] }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.conceptos.length, 2);
    assert.equal(res.body.conceptos[0].capitulo, 'ALBANILERIA');
    assert.equal(res.body.conceptos[0].status, 'PENDIENTE');
    assert.equal(res.body.conceptos[0].apuId, null);
    assert.equal(res.body.conceptos[0].ownerUid, uid);
    assert.deepEqual(res.body.rejected, []);
  });

  it('un concepto invalido en el lote se rechaza SIN tumbar a los demas', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('partial') });
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-2', conceptos: [conceptoFixture(), { concept: 'sin unidad ni cantidad' }] }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.conceptos.length, 1);
    assert.equal(res.body.rejected.length, 1);
  });

  it('sin token, 401', async () => {
    const res = await call(post(null, { action: 'create', projectId: 'PRO-X', conceptos: [conceptoFixture()] }));
    assert.equal(res.statusCode, 401);
  });

  it('regionalizacion: sin ubicacion del proyecto, el concepto queda SIN ubicacion (nunca default silencioso de ciudad)', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('sinubic') });
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-SIN-UBIC', conceptos: [conceptoFixture()] }));
    assert.equal(res.body.conceptos[0].ubicacionEstructurada, null);
  });

  it('regionalizacion: hereda la ubicacion estructurada del proyecto cuando el concepto no trae una propia', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('conubic') });
    const db = getAdminDb();
    await db.collection('projects').doc('PRO-CON-UBIC').set({
      id: 'PRO-CON-UBIC', ownerUid: uid, organizationId: null,
      locationCountry: 'MX', locationState: 'Jalisco', locationCity: 'Guadalajara', ubicacion: 'Guadalajara, Jalisco'
    });
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-CON-UBIC', conceptos: [conceptoFixture()] }));
    assert.equal(res.body.conceptos[0].ubicacionEstructurada.city, 'Guadalajara');
    assert.equal(res.body.conceptos[0].ubicacionEstructurada.state, 'Jalisco');
  });
});

describe('GET /api/catalogo-conceptos', () => {
  it('lista solo los conceptos del proyecto pedido, y solo los propios', async () => {
    const a = await createUserAndGetIdToken({ email: uniq('lista-a') });
    const b = await createUserAndGetIdToken({ email: uniq('lista-b') });
    await call(post(a.idToken, { action: 'create', projectId: 'PRO-LISTA', conceptos: [conceptoFixture({ clave: 'A1' })] }));
    await call(post(b.idToken, { action: 'create', projectId: 'PRO-LISTA', conceptos: [conceptoFixture({ clave: 'B1' })] }));
    const listA = await call(get(a.idToken, { projectId: 'PRO-LISTA' }));
    assert.equal(listA.statusCode, 200);
    assert.ok(listA.body.conceptos.every(c => c.ownerUid === a.uid));
    assert.ok(!listA.body.conceptos.some(c => c.clave === 'B1'));
  });

  it('sin projectId, 400', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('noproj') });
    const res = await call(get(idToken, {}));
    assert.equal(res.statusCode, 400);
  });
});

describe('POST action=set-status', () => {
  it('transicion legal PENDIENTE -> GENERANDO -> GENERADO se acepta y persiste (fuente de verdad durable)', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('setstatus') });
    const created = await call(post(idToken, { action: 'create', projectId: 'PRO-3', conceptos: [conceptoFixture()] }));
    const id = created.body.conceptos[0].id;
    const generando = await call(post(idToken, { action: 'set-status', id, status: 'GENERANDO', batchId: 'BATCH-1' }));
    assert.equal(generando.statusCode, 200);
    assert.equal(generando.body.concepto.status, 'GENERANDO');
    const generado = await call(post(idToken, { action: 'set-status', id, status: 'GENERADO', apuId: 'APU-9' }));
    assert.equal(generado.statusCode, 200);
    assert.equal(generado.body.concepto.status, 'GENERADO');
    assert.equal(generado.body.concepto.apuId, 'APU-9');
  });

  it('transicion ilegal (PENDIENTE -> GENERADO, saltandose GENERANDO) se rechaza con 409', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('badtrans') });
    const created = await call(post(idToken, { action: 'create', projectId: 'PRO-4', conceptos: [conceptoFixture()] }));
    const id = created.body.conceptos[0].id;
    const res = await call(post(idToken, { action: 'set-status', id, status: 'GENERADO' }));
    assert.equal(res.statusCode, 409);
  });

  it('un fallo (ERROR) no impide reintentar: ERROR -> GENERANDO es legal y limpia statusError', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('retry') });
    const created = await call(post(idToken, { action: 'create', projectId: 'PRO-5', conceptos: [conceptoFixture()] }));
    const id = created.body.conceptos[0].id;
    await call(post(idToken, { action: 'set-status', id, status: 'GENERANDO' }));
    const errored = await call(post(idToken, { action: 'set-status', id, status: 'ERROR', error: 'timeout de IA' }));
    assert.equal(errored.body.concepto.statusError, 'timeout de IA');
    const retried = await call(post(idToken, { action: 'set-status', id, status: 'GENERANDO' }));
    assert.equal(retried.statusCode, 200);
    assert.equal(retried.body.concepto.statusError, null);
  });
});

describe('POST action=associate-apu', () => {
  it('asocia un APU existente propio, estampa apuVersionId y status=ASOCIADO', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('assoc') });
    const db = getAdminDb();
    await db.collection('apus').doc('APU-EXISTENTE').set({ id: 'APU-EXISTENTE', ownerUid: uid, organizationId: null, currentVersion: 'V3', clave: 'ALB-001', concept: 'Muro de block' });
    const created = await call(post(idToken, { action: 'create', projectId: 'PRO-6', conceptos: [conceptoFixture()] }));
    const id = created.body.conceptos[0].id;
    const res = await call(post(idToken, { action: 'associate-apu', id, apuId: 'APU-EXISTENTE', matchConfidence: 0.97, matchMethod: 'descripcion_normalizada' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.concepto.status, 'ASOCIADO');
    assert.equal(res.body.concepto.apuId, 'APU-EXISTENTE');
    assert.equal(res.body.concepto.apuVersionId, 'V3');
    assert.equal(res.body.concepto.matchConfidence, 0.97);
  });

  it('no permite asociar un APU de OTRO usuario', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('apuowner') });
    const stranger = await createUserAndGetIdToken({ email: uniq('apustranger') });
    const db = getAdminDb();
    await db.collection('apus').doc('APU-AJENO').set({ id: 'APU-AJENO', ownerUid: owner.uid, organizationId: null, currentVersion: 'V1' });
    const created = await call(post(stranger.idToken, { action: 'create', projectId: 'PRO-7', conceptos: [conceptoFixture()] }));
    const id = created.body.conceptos[0].id;
    const res = await call(post(stranger.idToken, { action: 'associate-apu', id, apuId: 'APU-AJENO' }));
    assert.equal(res.statusCode, 403);
  });
});

describe('aislamiento multi-tenant y archive', () => {
  it('un usuario no puede editar/archivar el concepto de otro', async () => {
    const owner = await createUserAndGetIdToken({ email: uniq('ownerX') });
    const stranger = await createUserAndGetIdToken({ email: uniq('strangerX') });
    const created = await call(post(owner.idToken, { action: 'create', projectId: 'PRO-8', conceptos: [conceptoFixture()] }));
    const id = created.body.conceptos[0].id;
    const updateRes = await call(post(stranger.idToken, { action: 'update', id, patch: { qty: 999 } }));
    assert.equal(updateRes.statusCode, 403);
    const archiveRes = await call(post(stranger.idToken, { action: 'archive', id }));
    assert.equal(archiveRes.statusCode, 403);
  });

  it('archive nunca borra el documento, solo lo saca del listado por defecto', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('archive') });
    const created = await call(post(idToken, { action: 'create', projectId: 'PRO-9', conceptos: [conceptoFixture()] }));
    const id = created.body.conceptos[0].id;
    const archived = await call(post(idToken, { action: 'archive', id }));
    assert.equal(archived.statusCode, 200);
    assert.ok(archived.body.concepto.archivedAt);
    const list = await call(get(idToken, { projectId: 'PRO-9' }));
    assert.ok(!list.body.conceptos.some(c => c.id === id));
  });

  it('organizationId siempre se deriva del token/perfil, nunca del body', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('noorg') });
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-10', conceptos: [conceptoFixture()], organizationId: 'org-inventada' }));
    assert.equal(res.body.conceptos[0].organizationId, null);
    assert.equal(res.body.conceptos[0].ownerUid, uid);
  });
});
