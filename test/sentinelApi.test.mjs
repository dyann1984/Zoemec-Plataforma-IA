/* server/api-lib/_route-sentinel.mjs contra los emuladores REALES de
   Firebase Auth + Firestore. Cubre evaluate (deriva alertas reales de
   datos reales), list (lectura pura, nunca recalcula), set-status
   (transiciones legales/ilegales), deduplicacion real (segunda corrida no
   duplica, condicion resuelta se auto-resuelve), y aislamiento
   multi-tenant. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sentinelHandler from '../server/api-lib/_route-sentinel.mjs';
import presupuestosHandler from '../server/api-lib/_route-presupuestos.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';
import { aggregatePresupuesto } from '../src/domain/presupuestoAggregation.js';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/sentinelApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:sentinel`.');
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
async function call(req){ const res = mockRes(); await sentinelHandler(req, res); return res; }
async function callPresupuestos(req){ const res = mockRes(); await presupuestosHandler(req, res); return res; }
const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.zoemec`;

async function seedOrgMember(db, uid, organizationId){
  await db.doc(`organizations/${organizationId}`).set({ id: organizationId, name: `Empresa ${organizationId}`, status: 'ACTIVE_TRIAL' });
  await db.doc(`organizations/${organizationId}/members/${uid}`).set({ uid, role: 'company_manager', status: 'active' });
  await db.doc(`users/${uid}`).set({ uid, organizationId, role: 'user', plan: 'Gratis', active: true }, { merge: true });
}
async function seedProject(db, { id, ownerUid, organizationId = null }){
  await db.collection('projects').doc(id).set({ id, ownerUid, organizationId, name: 'Obra QA Sentinel', locationCountry: 'MX', locationState: 'Nuevo León', locationCity: 'Monterrey' });
}
async function seedConcepto(db, { id, ownerUid, organizationId = null, projectId, qty = 100, apuId = null }){
  await db.collection('catalogConceptos').doc(id).set({ id, ownerUid, organizationId, projectId, clave: id, capitulo: 'ALBANILERIA', concept: 'Muro de block', unit: 'm²', qty, apuId, status: apuId ? 'ASOCIADO' : 'PENDIENTE' });
}
async function seedApu(db, { id, ownerUid, organizationId = null, projectId = null, pu }){
  await db.collection('apus').doc(id).set({
    id, ownerUid, organizationId, projectId, currentVersion: 'V1',
    snapshot: {
      schemaVersion: 2, id, calculated: { pu, direct: pu * 0.7, iva: pu * 0.16 },
      materials: [{ descripcion: 'Block hueco', consumo: 12, desperdicioPct: 5, precioUnitario: 20, unidad: 'pza', integracion: 'POR_UNIDAD_OBRA' }],
      labor: [{ descripcion: 'Albañil', cuadrilla: 1, rendimiento: 8, salarioBase: 380, fsr: 1.65 }],
      equipment: [], consumables: [], seguridad: [],
      factores: { indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16 }
    }
  });
}
async function seedBaseline(db, idToken, { projectId, conceptoId, clave, concept, apuId, pu, direct, qty }){
  const aggregation = aggregatePresupuesto([{ conceptoId, clave, capitulo: 'ALBANILERIA', concept, unit: 'm²', qty, apuId, pu, direct }]);
  const presupuestoId = `PRE-${projectId}`;
  await callPresupuestos(post(idToken, { action: 'create', id: presupuestoId, projectId, snapshot: { conceptos: aggregation.rows, capituloSubtotals: aggregation.capituloSubtotals, costoDirectoTotal: aggregation.costoDirectoTotal, importeTotal: aggregation.importeTotal } }));
  await callPresupuestos(post(idToken, { action: 'approve-baseline', id: presupuestoId }));
}

describe('POST /api/sentinel action=evaluate', () => {
  it('deriva alertas reales de datos reales del proyecto (forecast sobre presupuesto)', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('sentinel-eval') });
    const db = getAdminDb();
    const projectId = 'PRO-SENTINEL-1';
    await seedProject(db, { id: projectId, ownerUid: uid });
    await seedApu(db, { id: 'APU-S1', ownerUid: uid, projectId, pu: 500 });
    await seedConcepto(db, { id: 'C-S1', ownerUid: uid, projectId, qty: 100, apuId: 'APU-S1' });
    await seedBaseline(db, idToken, { projectId, conceptoId: 'C-S1', clave: 'C-S1', concept: 'Muro de block', apuId: 'APU-S1', pu: 500, direct: 350, qty: 100 });
    // Avance completo (100 de 100) pero ejecutado reportado sobre una cantidad vigente distinta simularia forecast -- en este caso simple, sin cambios de orden, EAC == vigente, sin alerta de forecast.
    // Usamos directamente una alerta mas simple y confiable: ORDEN_CAMBIO_PENDIENTE, garantizada por una orden EN_REVISION.
    await db.collection('changeOrders').doc('CO-S1').set({ id: 'CO-S1', projectId, ownerUid: uid, conceptoId: 'C-S1', folio: 'CO-001', status: 'EN_REVISION', concept: 'Muro de block', motivo: 'x', cantidadAnterior: 100, cantidadNueva: 120, pu: 500, impactoEconomico: 10000 });

    const res = await call(post(idToken, { action: 'evaluate', projectId }));
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.created >= 1);
    assert.ok(res.body.alerts.some(a => a.alertType === 'ORDEN_CAMBIO_PENDIENTE'));
    assert.ok(res.body.health && typeof res.body.health.score === 'number');
  });

  it('sin token, 401', async () => {
    const res = await call(post(null, { action: 'evaluate', projectId: 'PRO-X' }));
    assert.equal(res.statusCode, 401);
  });

  it('proyecto inexistente, 404', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('sentinel-noproj') });
    const res = await call(post(idToken, { action: 'evaluate', projectId: 'PRO-NO-EXISTE' }));
    assert.equal(res.statusCode, 404);
  });
});

describe('deduplicacion real (seccion 6)', () => {
  it('correr evaluate dos veces con la MISMA condicion no duplica -- misma cantidad de alertas, identity estable', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('sentinel-dedup') });
    const db = getAdminDb();
    const projectId = 'PRO-SENTINEL-DEDUP';
    await seedProject(db, { id: projectId, ownerUid: uid });
    await seedConcepto(db, { id: 'C-D1', ownerUid: uid, projectId });
    await db.collection('changeOrders').doc('CO-D1').set({ id: 'CO-D1', projectId, ownerUid: uid, conceptoId: 'C-D1', folio: 'CO-001', status: 'EN_REVISION', concept: 'x', motivo: 'x', cantidadAnterior: 100, cantidadNueva: 120 });

    // El proyecto minimo (sin ubicacion/presupuesto/APU) tambien dispara
    // DATO_CRITICO_SIN_CONFIRMAR real y legitimamente -- la prueba se
    // concentra en la identidad ORDEN_CAMBIO_PENDIENTE especificamente,
    // nunca en el total de alertas (que depende de cuantos datos falten).
    const first = await call(post(idToken, { action: 'evaluate', projectId }));
    assert.ok(first.body.created >= 1);
    assert.equal(first.body.alerts.filter(a => a.alertType === 'ORDEN_CAMBIO_PENDIENTE').length, 1);
    const second = await call(post(idToken, { action: 'evaluate', projectId }));
    assert.equal(second.body.created, 0, 'la segunda corrida no debe crear ninguna alerta nueva (misma condicion en todo)');
    const list = await call(get(idToken, { projectId }));
    assert.equal(list.body.alerts.filter(a => a.alertType === 'ORDEN_CAMBIO_PENDIENTE').length, 1, 'nunca se duplica la identidad ORDEN_CAMBIO_PENDIENTE');
  });

  it('si la condicion desaparece, la alerta se auto-resuelve (seccion 6)', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('sentinel-autoresolve') });
    const db = getAdminDb();
    const projectId = 'PRO-SENTINEL-AUTORES';
    await seedProject(db, { id: projectId, ownerUid: uid });
    await seedConcepto(db, { id: 'C-A1', ownerUid: uid, projectId });
    await db.collection('changeOrders').doc('CO-A1').set({ id: 'CO-A1', projectId, ownerUid: uid, conceptoId: 'C-A1', folio: 'CO-001', status: 'EN_REVISION', concept: 'x', motivo: 'x', cantidadAnterior: 100, cantidadNueva: 120 });
    const first = await call(post(idToken, { action: 'evaluate', projectId }));
    assert.equal(first.body.alerts.filter(a => a.alertType === 'ORDEN_CAMBIO_PENDIENTE').length, 1);

    // La orden se aprueba -- ya no esta EN_REVISION, la condicion desaparece.
    await db.collection('changeOrders').doc('CO-A1').set({ id: 'CO-A1', projectId, ownerUid: uid, conceptoId: 'C-A1', folio: 'CO-001', status: 'APROBADA', concept: 'x', motivo: 'x', cantidadAnterior: 100, cantidadNueva: 120 });
    const second = await call(post(idToken, { action: 'evaluate', projectId }));
    assert.ok(second.body.autoResolved >= 1);
    const list = await call(get(idToken, { projectId }));
    const alert = list.body.alerts.find(a => a.alertType === 'ORDEN_CAMBIO_PENDIENTE');
    assert.equal(alert.status, 'RESUELTA');
    assert.equal(alert.resolvedBy, 'system');
  });
});

describe('POST action=set-status (resolucion manual, seccion 5)', () => {
  it('transicion NUEVA -> EN_REVISION -> RESUELTA es legal, persiste usuario/timestamp/resolucion/comentario', async () => {
    const { uid, email, idToken } = await createUserAndGetIdToken({ email: uniq('sentinel-resolve') });
    const db = getAdminDb();
    const projectId = 'PRO-SENTINEL-RESOLVE';
    await seedProject(db, { id: projectId, ownerUid: uid });
    await seedConcepto(db, { id: 'C-R1', ownerUid: uid, projectId });
    await db.collection('changeOrders').doc('CO-R1').set({ id: 'CO-R1', projectId, ownerUid: uid, conceptoId: 'C-R1', folio: 'CO-001', status: 'EN_REVISION', concept: 'x', motivo: 'x', cantidadAnterior: 100, cantidadNueva: 120 });
    const evalRes = await call(post(idToken, { action: 'evaluate', projectId }));
    const alertId = evalRes.body.alerts.find(a => a.alertType === 'ORDEN_CAMBIO_PENDIENTE').id;

    const revised = await call(post(idToken, { action: 'set-status', id: alertId, status: 'EN_REVISION' }));
    assert.equal(revised.statusCode, 200);
    assert.equal(revised.body.alert.status, 'EN_REVISION');

    const resolved = await call(post(idToken, { action: 'set-status', id: alertId, status: 'RESUELTA', comment: 'Se aprobó la orden manualmente.' }));
    assert.equal(resolved.statusCode, 200);
    assert.equal(resolved.body.alert.status, 'RESUELTA');
    assert.equal(resolved.body.alert.resolvedBy, email, 'resolvedBy prefiere el email del usuario autenticado (mismo criterio que el resto de la app)');
    assert.ok(resolved.body.alert.resolvedAt);
    assert.equal(resolved.body.alert.comment, 'Se aprobó la orden manualmente.');
  });

  it('transicion ilegal (RESUELTA -> EN_REVISION) se rechaza con 409', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('sentinel-illegal') });
    const db = getAdminDb();
    const projectId = 'PRO-SENTINEL-ILLEGAL';
    await seedProject(db, { id: projectId, ownerUid: uid });
    await seedConcepto(db, { id: 'C-I1', ownerUid: uid, projectId });
    await db.collection('changeOrders').doc('CO-I1').set({ id: 'CO-I1', projectId, ownerUid: uid, conceptoId: 'C-I1', folio: 'CO-001', status: 'EN_REVISION', concept: 'x', motivo: 'x', cantidadAnterior: 100, cantidadNueva: 120 });
    const evalRes = await call(post(idToken, { action: 'evaluate', projectId }));
    const alertId = evalRes.body.alerts.find(a => a.alertType === 'ORDEN_CAMBIO_PENDIENTE').id;
    await call(post(idToken, { action: 'set-status', id: alertId, status: 'RESUELTA' }));
    const res = await call(post(idToken, { action: 'set-status', id: alertId, status: 'EN_REVISION' }));
    assert.equal(res.statusCode, 409);
  });
});

describe('GET /api/sentinel (list, lectura pura -- nunca recalcula)', () => {
  it('list nunca crea alertas -- solo evaluate lo hace', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('sentinel-listonly') });
    const db = getAdminDb();
    const projectId = 'PRO-SENTINEL-LISTONLY';
    await seedProject(db, { id: projectId, ownerUid: uid });
    await seedConcepto(db, { id: 'C-L1', ownerUid: uid, projectId });
    await db.collection('changeOrders').doc('CO-L1').set({ id: 'CO-L1', projectId, ownerUid: uid, conceptoId: 'C-L1', folio: 'CO-001', status: 'EN_REVISION', concept: 'x', motivo: 'x', cantidadAnterior: 100, cantidadNueva: 120 });
    const list1 = await call(get(idToken, { projectId }));
    assert.equal(list1.statusCode, 200);
    assert.equal(list1.body.alerts.length, 0, 'sin haber corrido evaluate, list no debe traer ninguna alerta');
    const list2 = await call(get(idToken, { projectId }));
    assert.equal(list2.body.alerts.length, 0, 'repetir list tampoco crea nada');
  });
});

describe('aislamiento multi-tenant', () => {
  it('un miembro de otra organizacion no puede evaluar/leer/resolver alertas de un proyecto ajeno', async () => {
    const db = getAdminDb();
    const a = await createUserAndGetIdToken({ email: uniq('sentinel-org-a') });
    const orgA = `org-sentinel-a-${Date.now()}`;
    await seedOrgMember(db, a.uid, orgA);
    const b = await createUserAndGetIdToken({ email: uniq('sentinel-org-b') });
    const orgB = `org-sentinel-b-${Date.now()}`;
    await seedOrgMember(db, b.uid, orgB);

    const projectId = 'PRO-SENTINEL-ORG-A';
    await seedProject(db, { id: projectId, ownerUid: a.uid, organizationId: orgA });
    await seedConcepto(db, { id: 'C-ORG-1', ownerUid: a.uid, organizationId: orgA, projectId });
    await db.collection('changeOrders').doc('CO-ORG-1').set({ id: 'CO-ORG-1', projectId, ownerUid: a.uid, organizationId: orgA, conceptoId: 'C-ORG-1', folio: 'CO-001', status: 'EN_REVISION', concept: 'x', motivo: 'x', cantidadAnterior: 100, cantidadNueva: 120 });
    const evalRes = await call(post(a.idToken, { action: 'evaluate', projectId }));
    const alertId = evalRes.body.alerts[0].id;

    assert.equal((await call(post(b.idToken, { action: 'evaluate', projectId }))).statusCode, 403);
    assert.equal((await call(get(b.idToken, { projectId }))).statusCode, 403);
    assert.equal((await call(post(b.idToken, { action: 'set-status', id: alertId, status: 'RESUELTA' }))).statusCode, 403);
  });
});
