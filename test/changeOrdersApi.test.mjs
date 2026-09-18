/* server/api-lib/_route-change-orders.mjs contra los emuladores REALES de
   Firebase Auth + Firestore. Mismo patron que test/catalogConceptosApi.test.mjs.
   Cubre creacion (P.U./cantidadAnterior resueltos server-side del concepto/APU
   reales), encadenamiento de cantidadAnterior entre ordenes sucesivas
   aprobadas, transiciones de estado legales/ilegales, derechos de
   aprobacion (responsable de empresa vs. miembro comun vs. dueno
   individual) y aislamiento multi-tenant. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/api-lib/_route-change-orders.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/changeOrdersApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:changeorders`.');
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

async function seedOrgMember(db, uid, organizationId, role = 'company_manager'){
  await db.doc(`organizations/${organizationId}`).set({ id: organizationId, name: `Empresa ${organizationId}`, status: 'ACTIVE_TRIAL' });
  await db.doc(`organizations/${organizationId}/members/${uid}`).set({ uid, role, status: 'active' });
  await db.doc(`users/${uid}`).set({ uid, organizationId, role: 'user', plan: 'Gratis', active: true }, { merge: true });
}

async function seedConcepto(db, { id, ownerUid, organizationId = null, projectId, qty = 100, apuId = null }){
  await db.collection('catalogConceptos').doc(id).set({
    id, ownerUid, organizationId, projectId, clave: 'ALB-001', capitulo: 'ALBANILERIA', concept: 'Muro de block', unit: 'm²', qty, apuId, status: 'PENDIENTE'
  });
}
async function seedApu(db, { id, ownerUid, organizationId = null, pu }){
  // El contenido real del APU (calculated/materials/etc.) vive en
  // `apus/{id}.snapshot`, mismo shape que _route-apus.mjs escribe
  // ("snapshot: built.apu") -- nunca al nivel del documento envoltorio.
  await db.collection('apus').doc(id).set({ id, ownerUid, organizationId, currentVersion: 'V1', snapshot: { calculated: { pu, direct: pu * 0.7, iva: pu * 0.16 } } });
}

describe('POST /api/change-orders action=create', () => {
  it('resuelve cantidadAnterior/P.U. server-side (del concepto/APU reales) y calcula impactoEconomico', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('co-create') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-CO-1', ownerUid: uid, projectId: 'PRO-CO-1', qty: 100, apuId: 'APU-CO-1' });
    await seedApu(db, { id: 'APU-CO-1', ownerUid: uid, pu: 500 });

    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-CO-1', conceptoId: 'C-CO-1', motivo: 'Ajuste de obra', cantidadNueva: 120 }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.changeOrder.cantidadAnterior, 100);
    assert.equal(res.body.changeOrder.pu, 500);
    assert.equal(res.body.changeOrder.impactoEconomico, 20 * 500);
    assert.equal(res.body.changeOrder.status, 'BORRADOR');
    assert.ok(res.body.changeOrder.folio.startsWith('CO-'));
  });

  it('sin APU vinculado todavia, P.U.=0 e impactoEconomico=0 (nunca inventa un precio)', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('co-noapu') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-CO-2', ownerUid: uid, projectId: 'PRO-CO-2', qty: 50 });
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-CO-2', conceptoId: 'C-CO-2', motivo: 'Sin apu', cantidadNueva: 60 }));
    assert.equal(res.body.changeOrder.pu, 0);
    assert.equal(res.body.changeOrder.impactoEconomico, 0);
  });

  it('folio se asigna secuencial por proyecto (CO-001, CO-002...)', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('co-folio') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-CO-3', ownerUid: uid, projectId: 'PRO-CO-3', qty: 10 });
    const r1 = await call(post(idToken, { action: 'create', projectId: 'PRO-CO-3', conceptoId: 'C-CO-3', motivo: 'm1', cantidadNueva: 20 }));
    const r2 = await call(post(idToken, { action: 'create', projectId: 'PRO-CO-3', conceptoId: 'C-CO-3', motivo: 'm2', cantidadNueva: 30 }));
    assert.equal(r1.body.changeOrder.folio, 'CO-001');
    assert.equal(r2.body.changeOrder.folio, 'CO-002');
  });

  it('cantidadAnterior de una orden nueva encadena sobre las ordenes YA aprobadas del mismo concepto', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('co-chain') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-CO-4', ownerUid: uid, projectId: 'PRO-CO-4', qty: 100, apuId: 'APU-CO-4' });
    await seedApu(db, { id: 'APU-CO-4', ownerUid: uid, pu: 200 });
    const first = await call(post(idToken, { action: 'create', projectId: 'PRO-CO-4', conceptoId: 'C-CO-4', motivo: 'primera', cantidadNueva: 130 }));
    assert.equal(first.body.changeOrder.cantidadAnterior, 100);
    await call(post(idToken, { action: 'set-status', id: first.body.changeOrder.id, status: 'EN_REVISION' }));
    await call(post(idToken, { action: 'set-status', id: first.body.changeOrder.id, status: 'APROBADA' }));

    const second = await call(post(idToken, { action: 'create', projectId: 'PRO-CO-4', conceptoId: 'C-CO-4', motivo: 'segunda', cantidadNueva: 150 }));
    assert.equal(second.body.changeOrder.cantidadAnterior, 130, 'debe partir de la cantidad VIGENTE (100 + 30 ya aprobados), no de la cantidad base original');
  });

  it('motivo faltante o cantidad igual a la anterior, 400', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('co-invalid') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-CO-5', ownerUid: uid, projectId: 'PRO-CO-5', qty: 10 });
    const noMotivo = await call(post(idToken, { action: 'create', projectId: 'PRO-CO-5', conceptoId: 'C-CO-5', cantidadNueva: 20 }));
    assert.equal(noMotivo.statusCode, 400);
    const sameQty = await call(post(idToken, { action: 'create', projectId: 'PRO-CO-5', conceptoId: 'C-CO-5', motivo: 'x', cantidadNueva: 10 }));
    assert.equal(sameQty.statusCode, 400);
  });

  it('sin token, 401', async () => {
    const res = await call(post(null, { action: 'create', projectId: 'PRO-X', conceptoId: 'C-X', motivo: 'x', cantidadNueva: 1 }));
    assert.equal(res.statusCode, 401);
  });
});

describe('POST action=set-status -- transiciones y derechos de aprobacion', () => {
  it('BORRADOR -> EN_REVISION -> APROBADA es legal; un dueno individual (sin organizacion) puede aprobar su propia orden', async () => {
    const { uid, email, idToken } = await createUserAndGetIdToken({ email: uniq('co-approve-solo') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-CO-6', ownerUid: uid, projectId: 'PRO-CO-6', qty: 10 });
    const created = await call(post(idToken, { action: 'create', projectId: 'PRO-CO-6', conceptoId: 'C-CO-6', motivo: 'x', cantidadNueva: 20 }));
    const id = created.body.changeOrder.id;
    await call(post(idToken, { action: 'set-status', id, status: 'EN_REVISION' }));
    const approved = await call(post(idToken, { action: 'set-status', id, status: 'APROBADA' }));
    assert.equal(approved.statusCode, 200);
    assert.equal(approved.body.changeOrder.status, 'APROBADA');
    assert.equal(approved.body.changeOrder.approvedBy, email, 'approvedBy prefiere el email del usuario autenticado (mismo criterio que el resto de la app)');
  });

  it('transicion ilegal (BORRADOR -> APROBADA, saltandose EN_REVISION) se rechaza con 409', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('co-badtrans') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-CO-7', ownerUid: uid, projectId: 'PRO-CO-7', qty: 10 });
    const created = await call(post(idToken, { action: 'create', projectId: 'PRO-CO-7', conceptoId: 'C-CO-7', motivo: 'x', cantidadNueva: 20 }));
    const res = await call(post(idToken, { action: 'set-status', id: created.body.changeOrder.id, status: 'APROBADA' }));
    assert.equal(res.statusCode, 409);
  });

  it('un miembro de organizacion SIN rol de responsable no puede aprobar/rechazar (403)', async () => {
    const db = getAdminDb();
    const manager = await createUserAndGetIdToken({ email: uniq('co-manager') });
    const org = `org-co-${Date.now()}`;
    await seedOrgMember(db, manager.uid, org, 'company_manager');
    const member = await createUserAndGetIdToken({ email: uniq('co-member') });
    await seedOrgMember(db, member.uid, org, 'member');

    await seedConcepto(db, { id: 'C-CO-8', ownerUid: manager.uid, organizationId: org, projectId: 'PRO-CO-8', qty: 10 });
    const created = await call(post(manager.idToken, { action: 'create', projectId: 'PRO-CO-8', conceptoId: 'C-CO-8', motivo: 'x', cantidadNueva: 20 }));
    const id = created.body.changeOrder.id;
    await call(post(manager.idToken, { action: 'set-status', id, status: 'EN_REVISION' }));

    const deniedApprove = await call(post(member.idToken, { action: 'set-status', id, status: 'APROBADA' }));
    assert.equal(deniedApprove.statusCode, 403);

    const okApprove = await call(post(manager.idToken, { action: 'set-status', id, status: 'APROBADA' }));
    assert.equal(okApprove.statusCode, 200, 'el responsable de la empresa SI puede aprobar');
  });
});

describe('aislamiento multi-tenant', () => {
  it('un miembro de otra organizacion nunca puede leer/aprobar/rechazar una orden de cambio ajena por ID', async () => {
    const db = getAdminDb();
    const a = await createUserAndGetIdToken({ email: uniq('co-org-a') });
    const orgA = `org-co-a-${Date.now()}`;
    await seedOrgMember(db, a.uid, orgA);
    const b = await createUserAndGetIdToken({ email: uniq('co-org-b') });
    const orgB = `org-co-b-${Date.now()}`;
    await seedOrgMember(db, b.uid, orgB);

    await seedConcepto(db, { id: 'C-CO-9', ownerUid: a.uid, organizationId: orgA, projectId: 'PRO-CO-9', qty: 10 });
    const created = await call(post(a.idToken, { action: 'create', projectId: 'PRO-CO-9', conceptoId: 'C-CO-9', motivo: 'x', cantidadNueva: 20 }));
    const id = created.body.changeOrder.id;

    const listB = await call(get(b.idToken, { projectId: 'PRO-CO-9' }));
    assert.equal(listB.body.changeOrders.length, 0);
    assert.equal((await call(post(b.idToken, { action: 'set-status', id, status: 'EN_REVISION' }))).statusCode, 403);
  });

  it('no se puede crear una orden sobre un concepto ajeno', async () => {
    const db = getAdminDb();
    const owner = await createUserAndGetIdToken({ email: uniq('co-concowner') });
    const stranger = await createUserAndGetIdToken({ email: uniq('co-concstranger') });
    await seedConcepto(db, { id: 'C-CO-10', ownerUid: owner.uid, projectId: 'PRO-CO-10', qty: 10 });
    const res = await call(post(stranger.idToken, { action: 'create', projectId: 'PRO-CO-10', conceptoId: 'C-CO-10', motivo: 'x', cantidadNueva: 20 }));
    assert.equal(res.statusCode, 403);
  });
});
