/* server/api-lib/_route-commitments.mjs contra los emuladores REALES de
   Firebase Auth + Firestore. Cubre creacion (con y sin concepto ligado),
   transiciones de estado (ACTIVO->CERRADO/CANCELADO), y aislamiento
   multi-tenant. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/api-lib/_route-commitments.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/commitmentsApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:commitments`.');
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

async function seedOrgMember(db, uid, organizationId){
  await db.doc(`organizations/${organizationId}`).set({ id: organizationId, name: `Empresa ${organizationId}`, status: 'ACTIVE_TRIAL' });
  await db.doc(`organizations/${organizationId}/members/${uid}`).set({ uid, role: 'company_manager', status: 'active' });
  await db.doc(`users/${uid}`).set({ uid, organizationId, role: 'user', plan: 'Gratis', active: true }, { merge: true });
}
async function seedConcepto(db, { id, ownerUid, organizationId = null, projectId }){
  await db.collection('catalogConceptos').doc(id).set({ id, ownerUid, organizationId, projectId, clave: 'ALB-001', capitulo: 'ALBANILERIA', concept: 'Muro de block', unit: 'm²', qty: 10, status: 'PENDIENTE' });
}

describe('POST /api/commitments action=create', () => {
  it('crea un compromiso ligado a un concepto, arranca ACTIVO', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('cmt-create') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-CMT-1', ownerUid: uid, projectId: 'PRO-CMT-1' });
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-CMT-1', conceptoId: 'C-CMT-1', tipo: 'ORDEN_COMPRA', proveedor: 'Aceros SA', monto: 15000 }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.commitment.status, 'ACTIVO');
    assert.equal(res.body.commitment.monto, 15000);
    assert.equal(res.body.commitment.conceptoId, 'C-CMT-1');
    assert.equal(res.body.commitment.ownerUid, uid);
  });

  it('crea un compromiso SUELTO (solo por capitulo, sin concepto especifico)', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('cmt-loose') });
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-CMT-2', tipo: 'CONTRATO', proveedor: 'Constructora XYZ', monto: 500000, capitulo: 'CIMENTACION' }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.commitment.conceptoId, null);
    assert.equal(res.body.commitment.capitulo, 'CIMENTACION');
  });

  it('monto <= 0 o sin proveedor, 400', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('cmt-invalid') });
    const noMonto = await call(post(idToken, { action: 'create', projectId: 'PRO-CMT-3', proveedor: 'X', monto: 0 }));
    assert.equal(noMonto.statusCode, 400);
    const noProveedor = await call(post(idToken, { action: 'create', projectId: 'PRO-CMT-3', monto: 100 }));
    assert.equal(noProveedor.statusCode, 400);
  });

  it('no se puede crear un compromiso sobre un concepto ajeno', async () => {
    const db = getAdminDb();
    const owner = await createUserAndGetIdToken({ email: uniq('cmt-owner') });
    const stranger = await createUserAndGetIdToken({ email: uniq('cmt-stranger') });
    await seedConcepto(db, { id: 'C-CMT-4', ownerUid: owner.uid, projectId: 'PRO-CMT-4' });
    const res = await call(post(stranger.idToken, { action: 'create', projectId: 'PRO-CMT-4', conceptoId: 'C-CMT-4', proveedor: 'X', monto: 100 }));
    assert.equal(res.statusCode, 403);
  });

  it('sin token, 401', async () => {
    const res = await call(post(null, { action: 'create', projectId: 'PRO-X', proveedor: 'X', monto: 100 }));
    assert.equal(res.statusCode, 401);
  });
});

describe('POST action=set-status', () => {
  it('ACTIVO -> CERRADO es legal', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('cmt-close') });
    const created = await call(post(idToken, { action: 'create', projectId: 'PRO-CMT-5', proveedor: 'X', monto: 100 }));
    const res = await call(post(idToken, { action: 'set-status', id: created.body.commitment.id, status: 'CERRADO' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.commitment.status, 'CERRADO');
  });

  it('CERRADO -> ACTIVO es ilegal (terminal), 409', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('cmt-terminal') });
    const created = await call(post(idToken, { action: 'create', projectId: 'PRO-CMT-6', proveedor: 'X', monto: 100 }));
    await call(post(idToken, { action: 'set-status', id: created.body.commitment.id, status: 'CERRADO' }));
    const res = await call(post(idToken, { action: 'set-status', id: created.body.commitment.id, status: 'ACTIVO' }));
    assert.equal(res.statusCode, 409);
  });
});

describe('aislamiento multi-tenant', () => {
  it('un miembro de otra organizacion nunca puede leer/cerrar un compromiso ajeno por ID', async () => {
    const db = getAdminDb();
    const a = await createUserAndGetIdToken({ email: uniq('cmt-org-a') });
    const orgA = `org-cmt-a-${Date.now()}`;
    await seedOrgMember(db, a.uid, orgA);
    const b = await createUserAndGetIdToken({ email: uniq('cmt-org-b') });
    const orgB = `org-cmt-b-${Date.now()}`;
    await seedOrgMember(db, b.uid, orgB);

    const created = await call(post(a.idToken, { action: 'create', projectId: 'PRO-CMT-7', proveedor: 'X', monto: 100 }));
    const id = created.body.commitment.id;

    const listB = await call(get(b.idToken, { projectId: 'PRO-CMT-7' }));
    assert.equal(listB.body.commitments.length, 0);
    assert.equal((await call(post(b.idToken, { action: 'set-status', id, status: 'CERRADO' }))).statusCode, 403);
  });
});
