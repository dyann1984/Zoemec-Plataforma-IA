/* server/api-lib/_route-payments.mjs contra los emuladores REALES de
   Firebase Auth + Firestore. Cubre pagos sin estimacion vinculada (validos,
   nunca rechazados), guard de "pagado > estimado" (marca, nunca bloquea),
   y aislamiento multi-tenant. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/api-lib/_route-payments.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/paymentsApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:payments`.');
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
async function seedEstimate(db, { id, ownerUid, organizationId = null, projectId, totalEstimado }){
  await db.collection('estimates').doc(id).set({ id, ownerUid, organizationId, projectId, status: 'AUTORIZADA', totalEstimado, conceptos: [] });
}

describe('POST /api/payments action=create', () => {
  it('un pago SIN estimacionId es valido y nunca marca exceso (no hay contra que comparar)', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('pay-noest') });
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-PAY-1', monto: 5000, proveedor: 'Aceros SA' }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.payment.exceedsEstimate, false);
    assert.equal(res.body.payment.exceedsEstimateReason, 'SIN_ESTIMACION');
    assert.equal(res.body.payment.ownerUid, uid);
  });

  it('un pago CON estimacionId, dentro del estimado, no marca exceso', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('pay-dentro') });
    const db = getAdminDb();
    await seedEstimate(db, { id: 'EST-PAY-1', ownerUid: uid, projectId: 'PRO-PAY-2', totalEstimado: 10000 });
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-PAY-2', estimacionId: 'EST-PAY-1', monto: 4000, proveedor: 'X' }));
    assert.equal(res.body.payment.exceedsEstimate, false);
  });

  it('el pagado acumulado superando el estimado se marca (PAGADO_MAYOR_A_ESTIMADO), nunca se bloquea', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('pay-excede') });
    const db = getAdminDb();
    await seedEstimate(db, { id: 'EST-PAY-2', ownerUid: uid, projectId: 'PRO-PAY-3', totalEstimado: 1000 });
    const first = await call(post(idToken, { action: 'create', projectId: 'PRO-PAY-3', estimacionId: 'EST-PAY-2', monto: 700, proveedor: 'X' }));
    assert.equal(first.body.payment.exceedsEstimate, false);
    const second = await call(post(idToken, { action: 'create', projectId: 'PRO-PAY-3', estimacionId: 'EST-PAY-2', monto: 600, proveedor: 'X' }));
    assert.equal(second.statusCode, 201, 'nunca se bloquea, aunque exceda el estimado');
    assert.equal(second.body.payment.exceedsEstimate, true);
    assert.equal(second.body.payment.exceedsEstimateReason, 'PAGADO_MAYOR_A_ESTIMADO');
  });

  it('monto <= 0 o sin proveedor, 400', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('pay-invalid') });
    const noMonto = await call(post(idToken, { action: 'create', projectId: 'PRO-PAY-4', monto: 0, proveedor: 'X' }));
    assert.equal(noMonto.statusCode, 400);
    const noProveedor = await call(post(idToken, { action: 'create', projectId: 'PRO-PAY-4', monto: 100 }));
    assert.equal(noProveedor.statusCode, 400);
  });

  it('estimacionId inexistente, 404', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('pay-noestexist') });
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-PAY-5', estimacionId: 'EST-NOPE', monto: 100, proveedor: 'X' }));
    assert.equal(res.statusCode, 404);
  });

  it('no se puede registrar un pago contra la estimacion de otro usuario', async () => {
    const db = getAdminDb();
    const owner = await createUserAndGetIdToken({ email: uniq('pay-estowner') });
    const stranger = await createUserAndGetIdToken({ email: uniq('pay-eststranger') });
    await seedEstimate(db, { id: 'EST-PAY-3', ownerUid: owner.uid, projectId: 'PRO-PAY-6', totalEstimado: 1000 });
    const res = await call(post(stranger.idToken, { action: 'create', projectId: 'PRO-PAY-6', estimacionId: 'EST-PAY-3', monto: 100, proveedor: 'X' }));
    assert.equal(res.statusCode, 403);
  });

  it('sin token, 401', async () => {
    const res = await call(post(null, { action: 'create', projectId: 'PRO-X', monto: 100, proveedor: 'X' }));
    assert.equal(res.statusCode, 401);
  });
});

describe('aislamiento multi-tenant', () => {
  it('un miembro de otra organizacion nunca ve los pagos ajenos', async () => {
    const db = getAdminDb();
    const a = await createUserAndGetIdToken({ email: uniq('pay-org-a') });
    const orgA = `org-pay-a-${Date.now()}`;
    await seedOrgMember(db, a.uid, orgA);
    const b = await createUserAndGetIdToken({ email: uniq('pay-org-b') });
    const orgB = `org-pay-b-${Date.now()}`;
    await seedOrgMember(db, b.uid, orgB);
    await call(post(a.idToken, { action: 'create', projectId: 'PRO-PAY-7', monto: 100, proveedor: 'X' }));
    const listB = await call(get(b.idToken, { projectId: 'PRO-PAY-7' }));
    assert.equal(listB.body.payments.length, 0);
  });
});
