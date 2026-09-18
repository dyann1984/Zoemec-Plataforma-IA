/* server/api-lib/_route-estimates.mjs contra los emuladores REALES de
   Firebase Auth + Firestore. Cubre creacion (P.U. resuelto server-side por
   renglon, numero secuencial, retencion/amortizacion/deducciones como
   porcentajes/montos declarados -- nunca una tasa fiscal inventada),
   transicion BORRADOR->AUTORIZADA con derechos de aprobacion, y aislamiento
   multi-tenant. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../server/api-lib/_route-estimates.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/estimatesApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:estimates`.');
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
async function seedConcepto(db, { id, ownerUid, organizationId = null, projectId, apuId = null }){
  await db.collection('catalogConceptos').doc(id).set({ id, ownerUid, organizationId, projectId, clave: 'ALB-001', capitulo: 'ALBANILERIA', concept: 'Muro de block', unit: 'm²', qty: 100, apuId, status: 'PENDIENTE' });
}
async function seedApu(db, { id, ownerUid, organizationId = null, pu }){
  // El contenido real del APU (calculated/materials/etc.) vive en
  // `apus/{id}.snapshot`, mismo shape que _route-apus.mjs escribe
  // ("snapshot: built.apu") -- nunca al nivel del documento envoltorio.
  await db.collection('apus').doc(id).set({ id, ownerUid, organizationId, currentVersion: 'V1', snapshot: { calculated: { pu, direct: pu * 0.7, iva: pu * 0.16 } } });
}

describe('POST /api/estimates action=create', () => {
  it('resuelve P.U. server-side por renglon y calcula totales (retencion/amortizacion/deducciones)', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('est-create') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-EST-1', ownerUid: uid, projectId: 'PRO-EST-1', apuId: 'APU-EST-1' });
    await seedApu(db, { id: 'APU-EST-1', ownerUid: uid, pu: 1000 });
    const res = await call(post(idToken, {
      action: 'create', projectId: 'PRO-EST-1', periodoDesde: '2026-01-01', periodoHasta: '2026-01-31',
      conceptos: [{ conceptoId: 'C-EST-1', cantidadPeriodo: 10 }], retencionPct: 5, amortizacionPct: 10, deducciones: 200
    }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.estimate.conceptos[0].pu, 1000, 'P.U. resuelto del APU real, nunca del cliente');
    assert.equal(res.body.estimate.importeBruto, 10000);
    assert.equal(res.body.estimate.retencion, 500);
    assert.equal(res.body.estimate.amortizacion, 1000);
    assert.equal(res.body.estimate.totalEstimado, 10000 - 500 - 1000 - 200);
    assert.equal(res.body.estimate.status, 'BORRADOR');
    assert.equal(res.body.estimate.numero, 1);
  });

  it('numero se asigna secuencial por proyecto', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('est-numero') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-EST-2', ownerUid: uid, projectId: 'PRO-EST-2' });
    const r1 = await call(post(idToken, { action: 'create', projectId: 'PRO-EST-2', conceptos: [{ conceptoId: 'C-EST-2', cantidadPeriodo: 5 }] }));
    const r2 = await call(post(idToken, { action: 'create', projectId: 'PRO-EST-2', conceptos: [{ conceptoId: 'C-EST-2', cantidadPeriodo: 5 }] }));
    assert.equal(r1.body.estimate.numero, 1);
    assert.equal(r2.body.estimate.numero, 2);
  });

  it('un renglon con concepto ajeno se rechaza SIN tumbar los demas renglones validos', async () => {
    const db = getAdminDb();
    const owner = await createUserAndGetIdToken({ email: uniq('est-owner') });
    const stranger = await createUserAndGetIdToken({ email: uniq('est-stranger') });
    await seedConcepto(db, { id: 'C-EST-3', ownerUid: owner.uid, projectId: 'PRO-EST-3' });
    await seedConcepto(db, { id: 'C-EST-4', ownerUid: stranger.uid, projectId: 'PRO-EST-3' });
    const res = await call(post(stranger.idToken, { action: 'create', projectId: 'PRO-EST-3', conceptos: [{ conceptoId: 'C-EST-3', cantidadPeriodo: 5 }, { conceptoId: 'C-EST-4', cantidadPeriodo: 5 }] }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.estimate.conceptos.length, 1);
    assert.equal(res.body.rejected.length, 1);
  });

  it('sin ningun concepto valido, 400', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('est-empty') });
    const res = await call(post(idToken, { action: 'create', projectId: 'PRO-EST-5', conceptos: [] }));
    assert.equal(res.statusCode, 400);
  });

  it('sin token, 401', async () => {
    const res = await call(post(null, { action: 'create', projectId: 'PRO-X', conceptos: [{ conceptoId: 'C-X', cantidadPeriodo: 1 }] }));
    assert.equal(res.statusCode, 401);
  });
});

describe('POST action=set-status -- autorizacion', () => {
  it('BORRADOR -> AUTORIZADA es legal; dueno individual puede autorizar su propia estimacion', async () => {
    const { uid, email, idToken } = await createUserAndGetIdToken({ email: uniq('est-auth-solo') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-EST-6', ownerUid: uid, projectId: 'PRO-EST-6' });
    const created = await call(post(idToken, { action: 'create', projectId: 'PRO-EST-6', conceptos: [{ conceptoId: 'C-EST-6', cantidadPeriodo: 5 }] }));
    const res = await call(post(idToken, { action: 'set-status', id: created.body.estimate.id, status: 'AUTORIZADA' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.estimate.status, 'AUTORIZADA');
    assert.equal(res.body.estimate.authorizedBy, email, 'authorizedBy prefiere el email del usuario autenticado (mismo criterio que el resto de la app)');
  });

  it('AUTORIZADA es terminal: AUTORIZADA -> BORRADOR se rechaza con 409', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('est-terminal') });
    const db = getAdminDb();
    await seedConcepto(db, { id: 'C-EST-7', ownerUid: uid, projectId: 'PRO-EST-7' });
    const created = await call(post(idToken, { action: 'create', projectId: 'PRO-EST-7', conceptos: [{ conceptoId: 'C-EST-7', cantidadPeriodo: 5 }] }));
    await call(post(idToken, { action: 'set-status', id: created.body.estimate.id, status: 'AUTORIZADA' }));
    const res = await call(post(idToken, { action: 'set-status', id: created.body.estimate.id, status: 'BORRADOR' }));
    assert.equal(res.statusCode, 409);
  });

  it('un miembro de organizacion SIN rol de responsable no puede autorizar (403)', async () => {
    const db = getAdminDb();
    const manager = await createUserAndGetIdToken({ email: uniq('est-manager') });
    const org = `org-est-${Date.now()}`;
    await seedOrgMember(db, manager.uid, org, 'company_manager');
    const member = await createUserAndGetIdToken({ email: uniq('est-member') });
    await seedOrgMember(db, member.uid, org, 'member');
    await seedConcepto(db, { id: 'C-EST-8', ownerUid: manager.uid, organizationId: org, projectId: 'PRO-EST-8' });
    const created = await call(post(manager.idToken, { action: 'create', projectId: 'PRO-EST-8', conceptos: [{ conceptoId: 'C-EST-8', cantidadPeriodo: 5 }] }));
    const denied = await call(post(member.idToken, { action: 'set-status', id: created.body.estimate.id, status: 'AUTORIZADA' }));
    assert.equal(denied.statusCode, 403);
    const ok = await call(post(manager.idToken, { action: 'set-status', id: created.body.estimate.id, status: 'AUTORIZADA' }));
    assert.equal(ok.statusCode, 200);
  });
});

describe('aislamiento multi-tenant', () => {
  it('un miembro de otra organizacion nunca puede leer/autorizar una estimacion ajena por ID', async () => {
    const db = getAdminDb();
    const a = await createUserAndGetIdToken({ email: uniq('est-org-a') });
    const orgA = `org-est-a-${Date.now()}`;
    await seedOrgMember(db, a.uid, orgA);
    const b = await createUserAndGetIdToken({ email: uniq('est-org-b') });
    const orgB = `org-est-b-${Date.now()}`;
    await seedOrgMember(db, b.uid, orgB);
    await seedConcepto(db, { id: 'C-EST-9', ownerUid: a.uid, organizationId: orgA, projectId: 'PRO-EST-9' });
    const created = await call(post(a.idToken, { action: 'create', projectId: 'PRO-EST-9', conceptos: [{ conceptoId: 'C-EST-9', cantidadPeriodo: 5 }] }));
    const listB = await call(get(b.idToken, { projectId: 'PRO-EST-9' }));
    assert.equal(listB.body.estimates.length, 0);
    assert.equal((await call(post(b.idToken, { action: 'set-status', id: created.body.estimate.id, status: 'AUTORIZADA' }))).statusCode, 403);
  });
});
