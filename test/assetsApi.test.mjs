/* server/api-lib/_route-assets.mjs contra los emuladores REALES de
   Firebase Auth + Firestore. Cubre create-from-project (marca el proyecto
   como entregado), add-component (con garantia), CapEx/plan de renovacion
   calculados en vivo, trazabilidad, y aislamiento multi-tenant. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import assetsHandler from '../server/api-lib/_route-assets.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/assetsApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:assets`.');
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
async function call(req){ const res = mockRes(); await assetsHandler(req, res); return res; }
const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.zoemec`;

async function seedOrgMember(db, uid, organizationId){
  await db.doc(`organizations/${organizationId}`).set({ id: organizationId, name: `Empresa ${organizationId}`, status: 'ACTIVE_TRIAL' });
  await db.doc(`organizations/${organizationId}/members/${uid}`).set({ uid, role: 'company_manager', status: 'active' });
  await db.doc(`users/${uid}`).set({ uid, organizationId, role: 'user', plan: 'Gratis', active: true }, { merge: true });
}
async function seedProject(db, { id, ownerUid, organizationId = null }){
  await db.collection('projects').doc(id).set({ id, ownerUid, organizationId, name: 'Obra QA Asset', status: 'En ejecucion' });
}

describe('POST /api/assets action=create-from-project (seccion 11)', () => {
  it('crea el activo SOLO cuando se llama explicitamente, marca el proyecto como Entregado, referencia projectId sin duplicar datos', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('asset-create') });
    const db = getAdminDb();
    const projectId = 'PRO-ASSET-1';
    await seedProject(db, { id: projectId, ownerUid: uid });

    const res = await call(post(idToken, { action: 'create-from-project', projectId, nombre: 'Torre QA', ubicacion: 'Monterrey', superficie: '1200 m²' }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.asset.projectId, projectId);
    assert.equal(res.body.asset.nombre, 'Torre QA');
    assert.equal(res.body.created, true);

    const projectSnap = await db.collection('projects').doc(projectId).get();
    assert.equal(projectSnap.data().status, 'Entregado', 'el proyecto debe marcarse como entregado como efecto de crear el activo');
    assert.ok(projectSnap.data().fechaEntrega);
  });

  it('es idempotente por projectId -- reintentar no duplica el activo', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('asset-idempotent') });
    const db = getAdminDb();
    const projectId = 'PRO-ASSET-IDEM';
    await seedProject(db, { id: projectId, ownerUid: uid });
    const first = await call(post(idToken, { action: 'create-from-project', projectId, nombre: 'Torre' }));
    assert.equal(first.body.created, true);
    const second = await call(post(idToken, { action: 'create-from-project', projectId, nombre: 'Torre' }));
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.created, false);
  });

  it('proyecto inexistente, 404', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('asset-noproj') });
    const res = await call(post(idToken, { action: 'create-from-project', projectId: 'PRO-NO-EXISTE' }));
    assert.equal(res.statusCode, 404);
  });
});

describe('POST action=add-component + garantias (secciones 13-14)', () => {
  it('registra un componente con garantia, calcula garantiaVigenciaHasta derivada y su estado (VIGENTE)', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('asset-comp') });
    const db = getAdminDb();
    const projectId = 'PRO-ASSET-COMP';
    await seedProject(db, { id: projectId, ownerUid: uid });
    await call(post(idToken, { action: 'create-from-project', projectId, nombre: 'Torre' }));

    const res = await call(post(idToken, {
      action: 'add-component', assetId: projectId, tipo: 'HVAC', nombre: 'Aire acondicionado central',
      fechaInstalacion: new Date().toISOString(), fabricante: 'Carrier', modelo: 'X100', proveedor: 'HVAC Mty',
      garantiaMeses: 24, vidaUtilAnios: 15, costo: 80000
    }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.component.tipo, 'HVAC');
    assert.ok(res.body.component.garantiaVigenciaHasta);
    assert.equal(res.body.component.warrantyStatus, 'VIGENTE');
  });

  it('un componente con garantia por vencer (<=60 dias) se refleja en GET con warrantyStatus POR_VENCER', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('asset-porvencer') });
    const db = getAdminDb();
    const projectId = 'PRO-ASSET-PORVENCER';
    await seedProject(db, { id: projectId, ownerUid: uid });
    await call(post(idToken, { action: 'create-from-project', projectId, nombre: 'Torre' }));
    const in30Days = new Date(Date.now() + 30 * 86400000).toISOString();
    await call(post(idToken, { action: 'add-component', assetId: projectId, tipo: 'BOMBAS', nombre: 'Bomba principal', garantiaVigenciaHasta: in30Days, vidaUtilAnios: 8, costo: 15000 }));

    const list = await call(get(idToken, { projectId }));
    assert.equal(list.statusCode, 200);
    const bomba = list.body.components.find(c => c.nombre === 'Bomba principal');
    assert.equal(bomba.warrantyStatus, 'POR_VENCER');
  });

  it('agregar componente a un activo inexistente, 404', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('asset-nocomp') });
    const res = await call(post(idToken, { action: 'add-component', assetId: 'PRO-NO-EXISTE', tipo: 'HVAC', nombre: 'x' }));
    assert.equal(res.statusCode, 404);
  });
});

describe('CapEx y plan de renovacion (secciones 15-16, calculados en vivo)', () => {
  it('con datos suficientes, produce una proyeccion confiable y un plan de renovacion con totales', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('asset-capex') });
    const db = getAdminDb();
    const projectId = 'PRO-ASSET-CAPEX';
    await seedProject(db, { id: projectId, ownerUid: uid });
    await call(post(idToken, { action: 'create-from-project', projectId, nombre: 'Torre' }));
    await call(post(idToken, {
      action: 'add-component', assetId: projectId, tipo: 'ELEVADORES', nombre: 'Elevador principal',
      fechaInstalacion: '2020-01-01T00:00:00.000Z', vidaUtilAnios: 5, costo: 300000
    }));

    const res = await call(get(idToken, { projectId }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.capex.length, 1);
    assert.equal(res.body.capex[0].confiable, true);
    assert.ok(res.body.renewalPlan);
  });

  it('sin datos suficientes (sin vida util/costo), CapEx queda "Sin proyección confiable" -- nunca inventa un numero', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('asset-capex-sin') });
    const db = getAdminDb();
    const projectId = 'PRO-ASSET-CAPEX-SIN';
    await seedProject(db, { id: projectId, ownerUid: uid });
    await call(post(idToken, { action: 'create-from-project', projectId, nombre: 'Torre' }));
    await call(post(idToken, { action: 'add-component', assetId: projectId, tipo: 'ACABADOS', nombre: 'Pintura exterior' }));

    const res = await call(get(idToken, { projectId }));
    assert.equal(res.body.capex[0].confiable, false);
    assert.ok(res.body.capex[0].reason.includes('Sin proyección confiable'));
  });
});

describe('trazabilidad (seccion 17)', () => {
  it('resuelve la cadena Activo -> Componente -> Proyecto (sin APU/concepto/DNA vinculados, esos eslabones simplemente se omiten)', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('asset-trace') });
    const db = getAdminDb();
    const projectId = 'PRO-ASSET-TRACE';
    await seedProject(db, { id: projectId, ownerUid: uid });
    await call(post(idToken, { action: 'create-from-project', projectId, nombre: 'Torre Trazable' }));
    const comp = await call(post(idToken, { action: 'add-component', assetId: projectId, tipo: 'ESTRUCTURA', nombre: 'Columna principal' }));

    const trace = await call(get(idToken, { componentId: comp.body.component.id }));
    assert.equal(trace.statusCode, 200);
    assert.deepEqual(trace.body.chain.map(l => l.level), ['ACTIVO', 'COMPONENTE', 'PROYECTO']);
    assert.equal(trace.body.chain[0].label, 'Torre Trazable');
  });
});

describe('aislamiento multi-tenant', () => {
  it('un miembro de otra organizacion no puede crear/leer/agregar componentes a un activo ajeno', async () => {
    const db = getAdminDb();
    const a = await createUserAndGetIdToken({ email: uniq('asset-org-a') });
    const orgA = `org-asset-a-${Date.now()}`;
    await seedOrgMember(db, a.uid, orgA);
    const b = await createUserAndGetIdToken({ email: uniq('asset-org-b') });
    const orgB = `org-asset-b-${Date.now()}`;
    await seedOrgMember(db, b.uid, orgB);

    const projectId = 'PRO-ASSET-ORG-A';
    await seedProject(db, { id: projectId, ownerUid: a.uid, organizationId: orgA });
    await call(post(a.idToken, { action: 'create-from-project', projectId, nombre: 'Torre A' }));

    assert.equal((await call(post(b.idToken, { action: 'create-from-project', projectId, nombre: 'Torre B' }))).statusCode, 403);
    assert.equal((await call(get(b.idToken, { projectId }))).statusCode, 403);
    assert.equal((await call(post(b.idToken, { action: 'add-component', assetId: projectId, tipo: 'HVAC', nombre: 'x' }))).statusCode, 403);
  });
});
