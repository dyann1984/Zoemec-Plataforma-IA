/* server/api-lib/_route-progress.mjs contra los emuladores REALES de
   Firebase Auth + Firestore. Cubre el ledger append-only de avance fisico:
   acumulado calculado SIEMPRE server-side del historial real (nunca
   confiado del cliente), P.U. congelado del APU vigente al momento del
   renglon, warnings de guard (EXCESO_NEGATIVO/EXCEDE_CONTRATADO) que
   NUNCA bloquean, y aislamiento multi-tenant. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/api-lib/_route-progress.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/progressApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:progress`.');
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
async function seedConcepto(db, { id, ownerUid, organizationId = null, projectId, qty = 100, apuId = null }){
  await db.collection('catalogConceptos').doc(id).set({ id, ownerUid, organizationId, projectId, clave: 'ALB-001', capitulo: 'ALBANILERIA', concept: 'Muro de block', unit: 'm²', qty, apuId, status: 'PENDIENTE' });
}
async function seedApu(db, { id, ownerUid, organizationId = null, pu }){
  // El contenido real del APU (calculated/materials/etc.) vive en
  // `apus/{id}.snapshot`, mismo shape que _route-apus.mjs escribe
  // ("snapshot: built.apu") -- nunca al nivel del documento envoltorio.
  await db.collection('apus').doc(id).set({ id, ownerUid, organizationId, currentVersion: 'V1', snapshot: { calculated: { pu, direct: pu * 0.7, iva: pu * 0.16 } } });
}

describe('POST /api/progress action=create', () => {
  it('el primer renglon: accumulated = delta, P.U. congelado del APU vigente', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('prog-first') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-PROG-1', ownerUid: uid, projectId: 'PRO-PROG-1', qty: 100, apuId: 'APU-PROG-1' });
    await seedApu(db, { id: 'APU-PROG-1', ownerUid: uid, pu: 300 });
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-PROG-1', conceptoId: 'C-PROG-1', delta: 20, motivo: 'avance semana 1' }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.progressEntry.delta, 20);
    assert.equal(res.body.progressEntry.accumulated, 20);
    assert.equal(res.body.progressEntry.pu, 300);
    assert.equal(res.body.progressEntry.hasWarning, false);
  });

  it('el acumulado se calcula SIEMPRE del historial real, nunca de un valor mandado por el cliente', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('prog-accum') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-PROG-2', ownerUid: uid, projectId: 'PRO-PROG-2', qty: 100 });
    await call(post(idToken, { action: 'create', projectId: 'PRO-PROG-2', conceptoId: 'C-PROG-2', delta: 30, motivo: 'semana 1' }));
    const second = await call(post(idToken, { action: 'create', projectId: 'PRO-PROG-2', conceptoId: 'C-PROG-2', delta: 25, motivo: 'semana 2', accumulated: 9999 }));
    assert.equal(second.body.progressEntry.accumulated, 55, 'debe ignorar cualquier `accumulated` inventado en el body y sumar el historial real');
  });

  it('EXCEDE_CONTRATADO: un delta que supera la cantidad contratada genera warning pero NUNCA se bloquea', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('prog-excede') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-PROG-3', ownerUid: uid, projectId: 'PRO-PROG-3', qty: 100 });
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-PROG-3', conceptoId: 'C-PROG-3', delta: 150, motivo: 'sobre-avance' }));
    assert.equal(res.statusCode, 201, 'nunca se bloquea, solo se advierte');
    assert.equal(res.body.progressEntry.hasWarning, true);
    assert.ok(res.body.progressEntry.warnings.includes('EXCEDE_CONTRATADO'));
  });

  it('EXCESO_NEGATIVO: un delta negativo que dejaria el acumulado en negativo genera warning, nunca se bloquea', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('prog-negativo') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-PROG-4', ownerUid: uid, projectId: 'PRO-PROG-4', qty: 100 });
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-PROG-4', conceptoId: 'C-PROG-4', delta: -10, motivo: 'correccion sin avance previo' }));
    assert.equal(res.statusCode, 201);
    assert.ok(res.body.progressEntry.warnings.includes('EXCESO_NEGATIVO'));
  });

  it('cantidadContratada incluye deltas de ordenes de cambio APROBADA, no solo la cantidad base del concepto', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('prog-cambio') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-PROG-5', ownerUid: uid, projectId: 'PRO-PROG-5', qty: 100 });
    await db.collection('changeOrders').doc('CO-PROG-1').set({ id: 'CO-PROG-1', conceptoId: 'C-PROG-5', status: 'APROBADA', cantidadAnterior: 100, cantidadNueva: 200 });
    // 180 excede la cantidad BASE (100) pero no la VIGENTE (200) -- no debe marcar EXCEDE_CONTRATADO.
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-PROG-5', conceptoId: 'C-PROG-5', delta: 180, motivo: 'avance grande' }));
    assert.ok(!res.body.progressEntry.warnings.includes('EXCEDE_CONTRATADO'));
  });

  it('delta=0, 400', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('prog-zero') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-PROG-6', ownerUid: uid, projectId: 'PRO-PROG-6', qty: 100 });
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-PROG-6', conceptoId: 'C-PROG-6', delta: 0, motivo: 'x' }));
    assert.equal(res.statusCode, 400);
  });

  it('no se puede registrar avance sobre un concepto ajeno', async () => {
    const db = getAdminDb();
    const owner = await createUserAndGetIdToken({ email: uniq('prog-owner') });
    const stranger = await createUserAndGetIdToken({ email: uniq('prog-stranger') });
    await seedConcepto(db, { id: 'C-PROG-7', ownerUid: owner.uid, projectId: 'PRO-PROG-7', qty: 100 });
    const res = await call(post(stranger.idToken, { action: 'create', projectId: 'PRO-PROG-7', conceptoId: 'C-PROG-7', delta: 10, motivo: 'x' }));
    assert.equal(res.statusCode, 403);
  });

  it('sin token, 401', async () => {
    const res = await call(post(null, { action: 'create', projectId: 'PRO-X', conceptoId: 'C-X', delta: 10 }));
    assert.equal(res.statusCode, 401);
  });
});

describe('aislamiento multi-tenant', () => {
  it('un miembro de otra organizacion nunca ve el historial de avance ajeno', async () => {
    const db = getAdminDb();
    const a = await createUserAndGetIdToken({ email: uniq('prog-org-a') });
    const orgA = `org-prog-a-${Date.now()}`;
    await seedOrgMember(db, a.uid, orgA);
    const b = await createUserAndGetIdToken({ email: uniq('prog-org-b') });
    const orgB = `org-prog-b-${Date.now()}`;
    await seedOrgMember(db, b.uid, orgB);
    await seedConcepto(db, { id: 'C-PROG-8', ownerUid: a.uid, organizationId: orgA, projectId: 'PRO-PROG-8', qty: 100 });
    await call(post(a.idToken, { action: 'create', projectId: 'PRO-PROG-8', conceptoId: 'C-PROG-8', delta: 10, motivo: 'x' }));
    const listB = await call(get(b.idToken, { projectId: 'PRO-PROG-8' }));
    assert.equal(listB.body.progressEntries.length, 0);
  });
});
