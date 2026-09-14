/* Fase G end-to-end: Project Sentinel + ciclo de vida del activo, contra
   los emuladores REALES de Firebase Auth + Firestore. Cubre el QA de la
   seccion 20 del pedido: (1) sobrepresupuesto, (2) desviacion
   fisico-financiera, (3) cambio de Project Health, (6) persistencia,
   (7) navegacion desde alerta (actionRoute), (8) proyecto terminado ->
   asset, (13) cross-org. (Los items 4/5/9/10/11/12 ya se cubren a fondo en
   test/sentinelApi.test.mjs y test/assetsApi.test.mjs -- aqui se enlazan
   en un solo escenario continuo, como el resto de los e2e de fases
   anteriores.) */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import apusHandler from '../server/api-lib/_route-apus.mjs';
import projectsHandler from '../server/api-lib/_route-projects.mjs';
import catalogoConceptosHandler from '../server/api-lib/_route-catalogo-conceptos.mjs';
import presupuestosHandler from '../server/api-lib/_route-presupuestos.mjs';
import changeOrdersHandler from '../server/api-lib/_route-change-orders.mjs';
import progressHandler from '../server/api-lib/_route-progress.mjs';
import sentinelHandler from '../server/api-lib/_route-sentinel.mjs';
import assetsHandler from '../server/api-lib/_route-assets.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

import { aggregatePresupuesto } from '../src/domain/presupuestoAggregation.js';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/projectSentinelPipeline.e2e.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:sentinelpipeline`.');
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
async function callWith(handler, req){ const res = mockRes(); await handler(req, res); return res; }
const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.zoemec`;

async function seedOrgMember(db, uid, organizationId){
  await db.doc(`organizations/${organizationId}`).set({ id: organizationId, name: 'Empresa QA Fase G', status: 'ACTIVE_TRIAL' });
  await db.doc(`organizations/${organizationId}/members/${uid}`).set({ uid, role: 'company_manager', status: 'active' });
  await db.doc(`users/${uid}`).set({ uid, organizationId, role: 'user', plan: 'Gratis', active: true }, { merge: true });
}
function preexistingApuV2({ id, clave, concept, unit }){
  return {
    schemaVersion: 2, id, clave, concept, unit, cantidadObra: 1, moneda: 'MXN',
    materials: [{ descripcion: 'Block hueco de concreto 15x20x40 cm', consumo: 12.5, desperdicioPct: 5, precioUnitario: 17.2, unidad: 'pza', integracion: 'POR_UNIDAD_OBRA' }],
    labor: [{ descripcion: 'Albañil', cuadrilla: 1, rendimiento: 8, salarioBase: 380, fsr: 1.65 }],
    equipment: [], consumables: [], seguridad: [],
    factores: { indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16 },
    primaryActivity: 'albanileria'
  };
}

describe('Fase G end-to-end: Project Sentinel detecta condiciones reales y el proyecto entregado se convierte en activo', () => {
  it('recorre sobrepresupuesto, desviacion fisico-financiera, cambio de Project Health, persistencia, navegacion, entrega y cross-org', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('sentinel-e2e') });
    const db = getAdminDb();
    const organizationId = `org-sentinel-e2e-${Date.now()}`;
    await seedOrgMember(db, uid, organizationId);

    const projectId = `PRO-SENTINEL-E2E-${Date.now()}`;
    await callWith(projectsHandler, post(idToken, { action: 'create', id: projectId, name: 'Obra QA Fase G', locationCountry: 'MX', locationState: 'Nuevo León', locationCity: 'Monterrey' }));

    const created = await callWith(catalogoConceptosHandler, post(idToken, {
      action: 'create', projectId, conceptos: [{ clave: 'ALB-SENTINEL', capitulo: 'ALBANILERIA', concept: 'Muro de block hueco de concreto 15x20x40 cm', unit: 'm²', qty: 100 }]
    }));
    const concepto = created.body.conceptos[0];
    const apuId = `APU-SENTINEL-${Date.now()}`;
    const apuRes = await callWith(apusHandler, post(idToken, { action: 'create', id: apuId, projectId, apu: preexistingApuV2({ id: apuId, clave: 'ALB-SENTINEL', concept: concepto.concept, unit: 'm²' }) }));
    const pu = apuRes.body.apu.snapshot.calculated.pu;
    await callWith(catalogoConceptosHandler, post(idToken, { action: 'associate-apu', id: concepto.id, apuId, matchConfidence: 1, matchMethod: 'manual' }));

    const aggregation = aggregatePresupuesto([{ conceptoId: concepto.id, clave: 'ALB-SENTINEL', capitulo: 'ALBANILERIA', concept: concepto.concept, unit: 'm²', qty: 100, apuId, pu, direct: apuRes.body.apu.snapshot.calculated.direct }]);
    const presupuestoId = `PRE-SENTINEL-${Date.now()}`;
    await callWith(presupuestosHandler, post(idToken, { action: 'create', id: presupuestoId, projectId, snapshot: { conceptos: aggregation.rows, capituloSubtotals: aggregation.capituloSubtotals, costoDirectoTotal: aggregation.costoDirectoTotal, importeTotal: aggregation.importeTotal } }));
    await callWith(presupuestosHandler, post(idToken, { action: 'approve-baseline', id: presupuestoId }));

    // ---- 1. SOBREPRESUPUESTO / forecast: se reporta MAS avance del que la cantidad vigente permite (100 vigente, se reporta 130 ejecutado) ----
    await callWith(progressHandler, post(idToken, { action: 'create', projectId, conceptoId: concepto.id, delta: 130, fecha: '2026-07-15', motivo: 'Sobre-ejecucion real reportada' }));

    // ---- Snapshot de Health "anterior" sembrado directo, para probar el CAMBIO_PROJECT_HEALTH (item 3) de forma no fragil ----
    await db.collection('healthHistory').doc(`HH-${projectId}-PREVIO`).set({ id: `HH-${projectId}-PREVIO`, projectId, ownerUid: uid, organizationId, score: 95, level: 'SALUDABLE', label: 'Saludable', dimensions: {}, at: '2026-06-01T00:00:00.000Z' });

    // ---- Orden de cambio EN_REVISION (para navegacion/actionRoute, item 7) ----
    await callWith(changeOrdersHandler, post(idToken, { action: 'create', projectId, conceptoId: concepto.id, motivo: 'Ajuste pendiente de decidir', cantidadNueva: 140 }));

    const evalRes = await callWith(sentinelHandler, post(idToken, { action: 'evaluate', projectId }));
    assert.equal(evalRes.statusCode, 200);
    const alerts = evalRes.body.alerts;

    // ---- 1. Sobrepresupuesto real (ejecutado > vigente) ----
    const sobrepresupuesto = alerts.find(a => a.alertType === 'FORECAST_SOBRE_PRESUPUESTO' || a.alertType === 'PRESUPUESTO_POR_AGOTARSE');
    assert.ok(sobrepresupuesto, 'debe detectar una condicion real de sobrepresupuesto/forecast');

    // ---- 2. Desviacion fisico-financiera (avance fisico alto, avance financiero 0 -- nunca se estimo/pago nada) ----
    const desviacion = alerts.find(a => a.alertType === 'AVANCE_FINANCIERO_DESALINEADO' || a.alertType === 'AVANCE_FISICO_RETRASADO');
    assert.ok(desviacion, 'debe detectar la desviacion fisico-financiera real (avance sin estimar/pagar)');

    // ---- 3. Cambio de Project Health (contra el snapshot sembrado de 95, muy distinto del real con tantos problemas) ----
    const cambioHealth = alerts.find(a => a.alertType === 'CAMBIO_PROJECT_HEALTH');
    assert.ok(cambioHealth, 'debe detectar un cambio significativo de Project Health contra el snapshot anterior');
    assert.equal(cambioHealth.evidence.anterior, 95);

    // ---- 6. Persistencia: una lectura fresca (GET) trae las MISMAS alertas, sin recalcular ----
    const freshList = await callWith(sentinelHandler, get(idToken, { projectId }));
    assert.equal(freshList.body.alerts.length, alerts.length);
    assert.ok(freshList.body.alerts.every(a => alerts.some(x => x.id === a.id)));

    // ---- 7. Navegacion: TODA alerta trae actionRoute con modulo real ----
    alerts.forEach(a => assert.ok(a.actionRoute?.module, `la alerta ${a.alertType} debe traer una ruta de accion (seccion 8)`));

    // ---- 8. Proyecto terminado -> Activo (seccion 11), con componente y garantia (secciones 9/10 de QA) ----
    const assetRes = await callWith(assetsHandler, post(idToken, { action: 'create-from-project', projectId, nombre: 'Torre QA Fase G' }));
    assert.equal(assetRes.statusCode, 201);
    const projectAfter = await db.collection('projects').doc(projectId).get();
    assert.equal(projectAfter.data().status, 'Entregado');

    const in20Days = new Date(Date.now() + 20 * 86400000).toISOString();
    const compRes = await callWith(assetsHandler, post(idToken, {
      action: 'add-component', assetId: projectId, tipo: 'HVAC', nombre: 'Aire acondicionado',
      garantiaVigenciaHasta: in20Days, vidaUtilAnios: 10, costo: 60000
    }));
    assert.equal(compRes.statusCode, 201);
    assert.equal(compRes.body.component.warrantyStatus, 'POR_VENCER');

    // Reevaluar Sentinel: ahora debe aparecer GARANTIA_POR_VENCER (mismo motor, seccion 14).
    const evalAfterAsset = await callWith(sentinelHandler, post(idToken, { action: 'evaluate', projectId }));
    assert.ok(evalAfterAsset.body.alerts.some(a => a.alertType === 'GARANTIA_POR_VENCER'), 'el mismo motor Sentinel debe detectar la garantia proxima a vencer');

    // ---- 13. Aislamiento cross-organizacion: un miembro de otra empresa no ve nada de este proyecto/activo ----
    const stranger = await createUserAndGetIdToken({ email: uniq('sentinel-e2e-stranger') });
    const orgStranger = `org-sentinel-e2e-stranger-${Date.now()}`;
    await seedOrgMember(db, stranger.uid, orgStranger);
    assert.equal((await callWith(sentinelHandler, get(stranger.idToken, { projectId }))).statusCode, 403);
    assert.equal((await callWith(assetsHandler, get(stranger.idToken, { projectId }))).statusCode, 403);
    assert.equal((await callWith(sentinelHandler, post(stranger.idToken, { action: 'evaluate', projectId }))).statusCode, 403);
  });
});
