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
async function call(req){
  const projectId = req.body?.projectId || req.query?.projectId;
  const authorization = req.headers?.authorization || '';
  if(projectId && authorization){
    const token = authorization.replace(/^Bearer\s+/i, '');
    const authz = await getAdminAuth().verifyIdToken(token);
    const db = getAdminDb();
    const projectRef = db.collection('projects').doc(String(projectId));
    const projectSnap = await projectRef.get();
    if(!projectSnap.exists){
      const userSnap = await db.collection('users').doc(authz.uid).get();
      await projectRef.set({
        id: String(projectId),
        projectId: String(projectId),
        ownerUid: authz.uid,
        organizationId: userSnap.exists ? (userSnap.data().organizationId || null) : null
      });
    }
  }
  const res = mockRes(); await handler(req, res); return res;
}
const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.zoemec`;
/* Id de proyecto UNICO por llamada: 'PRO-1'/'PRO-2' fijos colisionaban con
   los MISMOS ids fijos usados en test/projectsApi.test.mjs cuando
   `npm run test:security` corre ambos archivos contra un solo emulador
   compartido. */
const uniqId = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function seedOrgMember(db, uid, organizationId){
  await db.doc(`organizations/${organizationId}`).set({ id: organizationId, name: `Empresa ${organizationId}`, status: 'ACTIVE_TRIAL' });
  await db.doc(`organizations/${organizationId}/members/${uid}`).set({ uid, role: 'company_manager', status: 'active' });
  await db.doc(`users/${uid}`).set({ uid, organizationId, role: 'user', plan: 'Gratis', active: true }, { merge: true });
}

async function seedProject(db, projectId, uid, organizationId = null){
  await db.collection('projects').doc(projectId).set({
    id: projectId, projectId, ownerUid: uid, organizationId
  });
}

function conceptoFixture(overrides = {}){
  return { clave: 'ALB-001', capitulo: 'albañilería', concept: 'Muro de block hueco 15cm', unit: 'm²', qty: 24, ...overrides };
}

describe('POST /api/catalogo-conceptos action=create', () => {
  it('crea en lote, normaliza capitulo, arranca en PENDIENTE sin APU', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('create') });
    const projectId = uniqId('PRO-CATALOG-CREATE');
    await seedProject(getAdminDb(), projectId, uid);
    const res = await call(post(idToken, { action: 'create', projectId, conceptos: [conceptoFixture(), conceptoFixture({ clave: 'ALB-002', concept: 'Aplanado fino' })] }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.conceptos.length, 2);
    assert.equal(res.body.conceptos[0].capitulo, 'ALBANILERIA');
    assert.equal(res.body.conceptos[0].status, 'PENDIENTE');
    assert.equal(res.body.conceptos[0].apuId, null);
    assert.equal(res.body.conceptos[0].ownerUid, uid);
    assert.deepEqual(res.body.rejected, []);
  });

  it('un concepto invalido en el lote se rechaza SIN tumbar a los demas', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('partial') });
    const projectId = uniqId('PRO-CATALOG-PARTIAL');
    await seedProject(getAdminDb(), projectId, uid);
    const res = await call(post(idToken, { action: 'create', projectId, conceptos: [conceptoFixture(), { concept: 'sin unidad ni cantidad' }] }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.conceptos.length, 1);
    assert.equal(res.body.rejected.length, 1);
  });

  it('sin token, 401', async () => {
    const res = await call(post(null, { action: 'create', projectId: 'PRO-X', conceptos: [conceptoFixture()] }));
    assert.equal(res.statusCode, 401);
  });

  it('regionalizacion: sin ubicacion del proyecto, el concepto queda SIN ubicacion (nunca default silencioso de ciudad)', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('sinubic') });
    await seedProject(getAdminDb(), 'PRO-SIN-UBIC', uid);
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

describe('POST action=create -- deduplicacion por origenElementoId (Fase D.1, "Agregar al catalogo")', () => {
  it('el mismo elemento de origen enviado dos veces ACTUALIZA el concepto existente, nunca lo duplica', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('dedup') });
    await seedProject(getAdminDb(), 'PRO-DEDUP', uid);
    const origenElementoId = 'PLANO-123:el-1';
    const first = await call(post(idToken, {
      action: 'create', projectId: 'PRO-DEDUP',
      conceptos: [conceptoFixture({ origenElementoId, qty: 10, origenPlano: { origen: 'plano-takeoff-vector', planoTakeoffId: 'PLANO-123', page: 1 } })]
    }));
    assert.equal(first.statusCode, 201);
    assert.equal(first.body.created, 1);
    assert.equal(first.body.updated, 0);
    const firstId = first.body.conceptos[0].id;

    // Se reenvia el MISMO elemento con una cantidad corregida (ej. el usuario
    // volvio a validar en el plano) -- debe actualizar, no duplicar.
    const second = await call(post(idToken, {
      action: 'create', projectId: 'PRO-DEDUP',
      conceptos: [conceptoFixture({ origenElementoId, qty: 15, origenPlano: { origen: 'plano-takeoff-vector', planoTakeoffId: 'PLANO-123', page: 2 } })]
    }));
    assert.equal(second.statusCode, 201);
    assert.equal(second.body.created, 0);
    assert.equal(second.body.updated, 1);
    assert.equal(second.body.conceptos[0].id, firstId, 'debe ser EXACTAMENTE el mismo documento, no uno nuevo');
    assert.equal(second.body.conceptos[0].qty, 15);
    assert.equal(second.body.conceptos[0].origenPlano.page, 2);

    const list = await call(get(idToken, { projectId: 'PRO-DEDUP' }));
    assert.equal(list.body.conceptos.length, 1, 'el listado del proyecto debe seguir mostrando UN solo concepto');
  });

  it('actualizar por dedup NUNCA pisa un status/apuId ya avanzado (GENERADO/ASOCIADO se preservan)', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('dedup-status') });
    await seedProject(getAdminDb(), 'PRO-DEDUP-2', uid);
    const origenElementoId = 'PLANO-456:el-1';
    const created = await call(post(idToken, { action: 'create', projectId: 'PRO-DEDUP-2', conceptos: [conceptoFixture({ origenElementoId })] }));
    const id = created.body.conceptos[0].id;
    await call(post(idToken, { action: 'set-status', id, status: 'GENERANDO' }));
    await call(post(idToken, { action: 'set-status', id, status: 'GENERADO', apuId: 'APU-DEDUP-1' }));

    const resent = await call(post(idToken, { action: 'create', projectId: 'PRO-DEDUP-2', conceptos: [conceptoFixture({ origenElementoId, qty: 99 })] }));
    assert.equal(resent.body.updated, 1);
    assert.equal(resent.body.conceptos[0].status, 'GENERADO', 'reenviar el mismo elemento no debe revertir un concepto ya generado a PENDIENTE');
    assert.equal(resent.body.conceptos[0].apuId, 'APU-DEDUP-1', 'el APU ya asociado nunca se pierde por un reenvio del mismo elemento');
    assert.equal(resent.body.conceptos[0].qty, 99, 'los datos del elemento (cantidad corregida) si se actualizan');
  });

  it('dos elementos DISTINTOS (origenElementoId distinto) en el mismo proyecto nunca se fusionan', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('dedup-distinct') });
    const res = await call(post(idToken, {
      action: 'create', projectId: 'PRO-DEDUP-3',
      conceptos: [conceptoFixture({ origenElementoId: 'PLANO-A:el-1' }), conceptoFixture({ origenElementoId: 'PLANO-A:el-2', clave: 'ALB-002' })]
    }));
    assert.equal(res.body.created, 2);
    assert.equal(res.body.updated, 0);
  });

  it('sin origenElementoId (captura manual), reenviar datos similares SIEMPRE crea un concepto nuevo', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('dedup-manual') });
    const res1 = await call(post(idToken, { action: 'create', projectId: 'PRO-DEDUP-4', conceptos: [conceptoFixture()] }));
    const res2 = await call(post(idToken, { action: 'create', projectId: 'PRO-DEDUP-4', conceptos: [conceptoFixture()] }));
    assert.notEqual(res1.body.conceptos[0].id, res2.body.conceptos[0].id);
    const list = await call(get(idToken, { projectId: 'PRO-DEDUP-4' }));
    assert.equal(list.body.conceptos.length, 2);
  });

  it('el mismo origenElementoId repetido DENTRO de una sola llamada tambien deduplica', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('dedup-samebatch') });
    const res = await call(post(idToken, {
      action: 'create', projectId: 'PRO-DEDUP-5',
      conceptos: [conceptoFixture({ origenElementoId: 'PLANO-X:el-1', qty: 1 }), conceptoFixture({ origenElementoId: 'PLANO-X:el-1', qty: 2 })]
    }));
    assert.equal(res.body.created, 1);
    assert.equal(res.body.updated, 1);
    const list = await call(get(idToken, { projectId: 'PRO-DEDUP-5' }));
    assert.equal(list.body.conceptos.length, 1);
  });
});

describe('GET /api/catalogo-conceptos', () => {
  it('lista solo los conceptos del proyecto pedido, y solo los propios', async () => {
    const a = await createUserAndGetIdToken({ email: uniq('lista-a') });
    const b = await createUserAndGetIdToken({ email: uniq('lista-b') });
    await call(post(a.idToken, { action: 'create', projectId: 'PRO-LISTA', conceptos: [conceptoFixture({ clave: 'A1' })] }));
    await call(post(b.idToken, { action: 'create', projectId: 'PRO-LISTA-B', conceptos: [conceptoFixture({ clave: 'B1' })] }));
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

describe('PRUEBA ESPECIFICA -- aislamiento por ORGANIZACION (Fase D.1, punto 9), no solo por usuario individual', () => {
  it('un miembro de la Empresa B NUNCA puede leer/editar/asociar/archivar un catalogConcepto de la Empresa A por ID, aunque lo conozca', async () => {
    const db = getAdminDb();
    const { uid: uidA, idToken: tokenA } = await createUserAndGetIdToken({ email: uniq('org-a') });
    const orgA = `org-a-${Date.now()}`;
    await seedOrgMember(db, uidA, orgA);
    const { uid: uidB, idToken: tokenB } = await createUserAndGetIdToken({ email: uniq('org-b') });
    const orgB = `org-b-${Date.now()}`;
    await seedOrgMember(db, uidB, orgB);
    await seedProject(db, 'PRO-ORG-A', uidA, orgA);

    const created = await call(post(tokenA, { action: 'create', projectId: 'PRO-ORG-A', conceptos: [conceptoFixture()] }));
    assert.equal(created.body.conceptos[0].organizationId, orgA);
    const conceptoId = created.body.conceptos[0].id;

    // GET directo por projectId (Empresa B nunca ve nada de un proyecto de la Empresa A).
    const listB = await call(get(tokenB, { projectId: 'PRO-ORG-A' }));
    assert.equal(listB.statusCode, 403);

    // Acciones por ID directo -- todas deben rechazarse con 403, nunca 404
    // silencioso (que revelaria si el id existe) ni 200.
    assert.equal((await call(post(tokenB, { action: 'update', id: conceptoId, patch: { qty: 999 } }))).statusCode, 403);
    assert.equal((await call(post(tokenB, { action: 'set-status', id: conceptoId, status: 'GENERANDO' }))).statusCode, 403);
    assert.equal((await call(post(tokenB, { action: 'associate-apu', id: conceptoId, apuId: 'cualquier-apu' }))).statusCode, 403);
    assert.equal((await call(post(tokenB, { action: 'archive', id: conceptoId }))).statusCode, 403);

    // El concepto de la Empresa A sigue intacto (ningun intento ajeno lo modifico).
    const stillThere = await call(get(tokenA, { projectId: 'PRO-ORG-A' }));
    assert.equal(stillThere.body.conceptos[0].qty, conceptoFixture().qty);
    assert.equal(stillThere.body.conceptos[0].status, 'PENDIENTE');
  });

  it('OTRO miembro de la MISMA organizacion SI puede leer/operar el concepto (espacio de trabajo compartido, no por-usuario)', async () => {
    const db = getAdminDb();
    const { uid: uid1, idToken: token1 } = await createUserAndGetIdToken({ email: uniq('org-share-1') });
    const org = `org-share-${Date.now()}`;
    await seedOrgMember(db, uid1, org);
    const { uid: uid2, idToken: token2 } = await createUserAndGetIdToken({ email: uniq('org-share-2') });
    await seedOrgMember(db, uid2, org);
    await seedProject(db, 'PRO-ORG-SHARE', uid1, org);

    const created = await call(post(token1, { action: 'create', projectId: 'PRO-ORG-SHARE', conceptos: [conceptoFixture()] }));
    const conceptoId = created.body.conceptos[0].id;
    const updated = await call(post(token2, { action: 'update', id: conceptoId, patch: { qty: 42 } }));
    assert.equal(updated.statusCode, 200, 'un companero de la misma organizacion SI puede operar sobre el concepto -- es trabajo de equipo, no aislado por usuario individual');
    assert.equal(updated.body.concepto.qty, 42);
  });
});

describe('aislamiento por proyecto', () => {
  it('un usuario autenticado no puede usar projectId de otro propietario', async () => {
    const db = getAdminDb();
    const owner = await createUserAndGetIdToken({ email: uniq('project-owner') });
    const stranger = await createUserAndGetIdToken({ email: uniq('project-stranger') });
    await seedProject(db, 'PRO-PRIVATE-B', owner.uid);
    const res = await call(post(stranger.idToken, {
      action: 'create', projectId: 'PRO-PRIVATE-B', conceptos: [conceptoFixture({ origenElementoId: 'PLANO-B:el-1' })]
    }));
    assert.equal(res.statusCode, 403);
  });
});
