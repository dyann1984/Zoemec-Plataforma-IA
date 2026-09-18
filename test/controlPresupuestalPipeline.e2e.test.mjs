/* Fase E (Control Presupuestal) -- prueba end-to-end real: recorre el flujo
   completo Presupuesto baseline -> Presupuesto vigente -> Comprometido ->
   Ejecutado -> Estimado -> Pagado -> Forecast usando los MISMOS handlers
   HTTP reales que usa produccion (_route-catalogo-conceptos.mjs,
   _route-presupuestos.mjs, _route-change-orders.mjs, _route-commitments.mjs,
   _route-progress.mjs, _route-estimates.mjs, _route-payments.mjs), sin
   ningun mock de guardado -- mismo patron de arnes que
   test/catalogoPresupuestoPipeline.e2e.test.mjs.

   Cubre explicitamente el QA de la seccion 15 del pedido de Fase E: (1)
   baseline, (2) orden de cambio aprobada, (3) orden de cambio rechazada
   (nunca mueve el vigente), (4) comprometido, (5) avance fisico, (6)
   ejecutado, (7) estimacion, (8) pago parcial, (9) forecast, (10)
   variacion, (11) refresh/reingreso, (12) multi-tenant -- con las
   formulas UNICAS y documentadas: Baseline + Cambios aprobados =
   Presupuesto vigente; Ejecutado = cantidad ejecutada x P.U.; Saldo =
   Presupuesto vigente - Pagado. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import apusHandler from '../server/api-lib/_route-apus.mjs';
import projectsHandler from '../server/api-lib/_route-projects.mjs';
import catalogoConceptosHandler from '../server/api-lib/_route-catalogo-conceptos.mjs';
import presupuestosHandler from '../server/api-lib/_route-presupuestos.mjs';
import changeOrdersHandler from '../server/api-lib/_route-change-orders.mjs';
import commitmentsHandler from '../server/api-lib/_route-commitments.mjs';
import progressHandler from '../server/api-lib/_route-progress.mjs';
import estimatesHandler from '../server/api-lib/_route-estimates.mjs';
import paymentsHandler from '../server/api-lib/_route-payments.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

import { calcAPUv2 } from '../src/lib/apuCalc.js';
import { aggregatePresupuesto } from '../src/domain/presupuestoAggregation.js';
import { aggregateControlPresupuestal } from '../src/domain/controlPresupuestalAggregation.js';
import { computeControlPresupuestalAlerts, ALERT_TYPE } from '../src/domain/controlPresupuestalAlerts.js';
import { buildSCurveData } from '../src/domain/sCurveData.js';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/controlPresupuestalPipeline.e2e.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:controlpresupuestalpipeline`.');
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
  await db.doc(`organizations/${organizationId}`).set({ id: organizationId, name: 'Empresa QA Fase E', status: 'ACTIVE_TRIAL' });
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

describe('Fase E end-to-end: Baseline -> Vigente -> Comprometido -> Ejecutado -> Estimado -> Pagado -> Forecast', () => {
  it('recorre el flujo completo con orden aprobada + rechazada, comprometido, avance, estimacion, pago parcial, forecast y variacion', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('fase-e') });
    const db = getAdminDb();
    const organizationId = `org-fase-e-${Date.now()}`;
    await seedOrgMember(db, uid, organizationId);

    // ---- 0. Proyecto + concepto + APU real (P.U. real, sin inventar precio) ----
    const projectId = `PRO-FASE-E-${Date.now()}`;
    await callWith(projectsHandler, post(idToken, { action: 'create', id: projectId, name: 'Obra QA Fase E', locationCountry: 'MX', locationState: 'Nuevo León', locationCity: 'Monterrey' }));

    const createConceptoRes = await callWith(catalogoConceptosHandler, post(idToken, {
      action: 'create', projectId,
      conceptos: [{ clave: 'ALB-CTRL', capitulo: 'ALBANILERIA', concept: 'Muro de block hueco de concreto 15x20x40 cm', unit: 'm²', qty: 100 }]
    }));
    assert.equal(createConceptoRes.statusCode, 201);
    const concepto = createConceptoRes.body.conceptos[0];

    const apuId = `APU-CTRL-${Date.now()}`;
    const apuRes = await callWith(apusHandler, post(idToken, { action: 'create', id: apuId, projectId, apu: preexistingApuV2({ id: apuId, clave: 'ALB-CTRL', concept: concepto.concept, unit: 'm²' }) }));
    assert.equal(apuRes.statusCode, 201);
    const pu = apuRes.body.apu.snapshot.calculated.pu;
    assert.ok(pu > 0, 'el APU real debe traer un P.U. calculado positivo');

    const associateRes = await callWith(catalogoConceptosHandler, post(idToken, { action: 'associate-apu', id: concepto.id, apuId, matchConfidence: 1, matchMethod: 'manual' }));
    assert.equal(associateRes.statusCode, 200);
    assert.equal(associateRes.body.concepto.status, 'ASOCIADO');

    // ---- 1. Presupuesto: crear + aprobar como Baseline ----
    const apuById = new Map([[apuId, { ...apuRes.body.apu.snapshot, id: apuId }]]);
    const buildRows = (conceptos) => conceptos.map(c => {
      const apu = c.apuId ? apuById.get(c.apuId) : null;
      const totals = apu ? (apu.calculated || calcAPUv2(apu)) : null;
      return { conceptoId: c.id, clave: c.clave, capitulo: c.capitulo, concept: c.concept, unit: c.unit, qty: c.qty, apuId: c.apuId, pu: totals?.pu ?? 0, direct: totals?.direct ?? 0 };
    });
    const aggregation1 = aggregatePresupuesto(buildRows([associateRes.body.concepto]));
    const presupuestoId = `PRE-FASE-E-${Date.now()}`;
    const presuCreateRes = await callWith(presupuestosHandler, post(idToken, {
      action: 'create', id: presupuestoId, projectId,
      snapshot: { conceptos: aggregation1.rows, capituloSubtotals: aggregation1.capituloSubtotals, costoDirectoTotal: aggregation1.costoDirectoTotal, importeTotal: aggregation1.importeTotal }
    }));
    assert.equal(presuCreateRes.statusCode, 201);
    const baselineRes = await callWith(presupuestosHandler, post(idToken, { action: 'approve-baseline', id: presupuestoId }));
    assert.equal(baselineRes.statusCode, 200);
    assert.equal(baselineRes.body.presupuesto.baselineVersion, 'V1');

    // ---- 2. Orden de cambio APROBADA: mueve el presupuesto VIGENTE, nunca el baseline ----
    const coApprovedRes = await callWith(changeOrdersHandler, post(idToken, { action: 'create', projectId, conceptoId: concepto.id, motivo: 'Ajuste real de obra', cantidadNueva: 120 }));
    assert.equal(coApprovedRes.statusCode, 201);
    assert.equal(coApprovedRes.body.changeOrder.cantidadAnterior, 100);
    assert.equal(coApprovedRes.body.changeOrder.pu, pu);
    const coApprovedId = coApprovedRes.body.changeOrder.id;
    await callWith(changeOrdersHandler, post(idToken, { action: 'set-status', id: coApprovedId, status: 'EN_REVISION' }));
    const coApproved = await callWith(changeOrdersHandler, post(idToken, { action: 'set-status', id: coApprovedId, status: 'APROBADA' }));
    assert.equal(coApproved.statusCode, 200);

    // ---- 3. Orden de cambio RECHAZADA: NUNCA debe mover el presupuesto vigente ----
    const coRejectedRes = await callWith(changeOrdersHandler, post(idToken, { action: 'create', projectId, conceptoId: concepto.id, motivo: 'Cambio descartado', cantidadNueva: 500 }));
    const coRejectedId = coRejectedRes.body.changeOrder.id;
    await callWith(changeOrdersHandler, post(idToken, { action: 'set-status', id: coRejectedId, status: 'EN_REVISION' }));
    const coRejected = await callWith(changeOrdersHandler, post(idToken, { action: 'set-status', id: coRejectedId, status: 'RECHAZADA' }));
    assert.equal(coRejected.body.changeOrder.status, 'RECHAZADA');

    // ---- 4. Comprometido: orden de compra ligada al concepto ----
    const commitmentRes = await callWith(commitmentsHandler, post(idToken, { action: 'create', projectId, conceptoId: concepto.id, tipo: 'ORDEN_COMPRA', proveedor: 'Materiales del Norte', monto: 8000 }));
    assert.equal(commitmentRes.statusCode, 201);
    assert.equal(commitmentRes.body.commitment.status, 'ACTIVO');

    // ---- 5/6. Avance fisico -> ejecutado (dos periodos reales, para Curva S) ----
    const progress1 = await callWith(progressHandler, post(idToken, { action: 'create', projectId, conceptoId: concepto.id, delta: 40, fecha: '2026-01-15', motivo: 'Avance enero' }));
    assert.equal(progress1.statusCode, 201);
    assert.equal(progress1.body.progressEntry.accumulated, 40);
    assert.equal(progress1.body.progressEntry.pu, pu);
    const progress2 = await callWith(progressHandler, post(idToken, { action: 'create', projectId, conceptoId: concepto.id, delta: 20, fecha: '2026-02-15', motivo: 'Avance febrero' }));
    assert.equal(progress2.body.progressEntry.accumulated, 60);

    // ---- 7. Estimacion de obra AUTORIZADA (P.U. resuelto server-side) ----
    const estimateRes = await callWith(estimatesHandler, post(idToken, {
      action: 'create', projectId, periodoDesde: '2026-01-01', periodoHasta: '2026-01-31',
      conceptos: [{ conceptoId: concepto.id, cantidadPeriodo: 40 }], retencionPct: 5
    }));
    assert.equal(estimateRes.statusCode, 201);
    assert.equal(estimateRes.body.estimate.conceptos[0].pu, pu);
    const estimateId = estimateRes.body.estimate.id;
    const estimateAuthorized = await callWith(estimatesHandler, post(idToken, { action: 'set-status', id: estimateId, status: 'AUTORIZADA' }));
    assert.equal(estimateAuthorized.statusCode, 200);

    // ---- 8. Pago PARCIAL contra esa estimacion ----
    const totalEstimado = estimateAuthorized.body.estimate.totalEstimado;
    const montoPago = totalEstimado * 0.5;
    const paymentRes = await callWith(paymentsHandler, post(idToken, { action: 'create', projectId, estimacionId: estimateId, monto: montoPago, fecha: '2026-01-20', proveedor: 'Constructora QA' }));
    assert.equal(paymentRes.statusCode, 201);
    assert.equal(paymentRes.body.payment.exceedsEstimate, false, 'un pago del 50% del estimado nunca debe marcarse como excedido');

    // ---- 9/10/11. Refresh/reingreso: GET fresco de TODAS las colecciones, como si el usuario recargara la pagina ----
    const [conceptosList, changeOrdersList, commitmentsList, progressList, estimatesList, paymentsList, apusList] = await Promise.all([
      callWith(catalogoConceptosHandler, get(idToken, { projectId })),
      callWith(changeOrdersHandler, get(idToken, { projectId })),
      callWith(commitmentsHandler, get(idToken, { projectId })),
      callWith(progressHandler, get(idToken, { projectId })),
      callWith(estimatesHandler, get(idToken, { projectId })),
      callWith(paymentsHandler, get(idToken, { projectId })),
      callWith(apusHandler, get(idToken, { projectId }))
    ]);
    assert.equal(conceptosList.body.conceptos.length, 1);
    assert.equal(changeOrdersList.body.changeOrders.length, 2);
    assert.equal(commitmentsList.body.commitments.length, 1);
    assert.equal(progressList.body.progressEntries.length, 2);
    assert.equal(estimatesList.body.estimates.length, 1);
    assert.equal(paymentsList.body.payments.length, 1);

    const freshApuById = new Map(apusList.body.apus.map(a => [a.id, { ...a.snapshot, id: a.id }]));
    const presupuestoRows = buildRows(conceptosList.body.conceptos).map(r => ({ ...r, pu: (freshApuById.get(r.apuId)?.calculated || {}).pu ?? r.pu }));

    // ---- PRUEBAS ESPECIFICAS (seccion 15): formulas unicas y documentadas ----
    const { rows, totals } = aggregateControlPresupuestal({
      presupuestoRows, changeOrders: changeOrdersList.body.changeOrders, commitments: commitmentsList.body.commitments,
      progressEntries: progressList.body.progressEntries, estimates: estimatesList.body.estimates, payments: paymentsList.body.payments
    });
    const row = rows.find(r => r.conceptoId === concepto.id);

    // Baseline + Cambios aprobados = Presupuesto vigente
    assert.equal(row.presupuestoBase, 100 * pu);
    assert.equal(row.cambiosAprobados, (120 - 100) * pu, 'solo la orden APROBADA (120) cuenta -- la RECHAZADA (500) nunca debe sumar');
    assert.equal(row.presupuestoVigente, row.presupuestoBase + row.cambiosAprobados);
    assert.equal(row.cantidadVigente, 120, 'la cantidad vigente debe reflejar SOLO la orden aprobada, nunca la rechazada');

    // Ejecutado = cantidad ejecutada x P.U. (nunca otro numero)
    assert.equal(row.cantidadEjecutada, 60);
    assert.equal(row.ejecutado, 60 * pu);

    // Comprometido = solo compromisos ACTIVO
    assert.equal(row.comprometido, 8000);

    // Estimado = suma del importeBruto (cantidadPeriodo x P.U.) de las
    // estimaciones AUTORIZADA que referencian el concepto -- SIN restar
    // retencion/amortizacion/deducciones (esas solo afectan totalEstimado,
    // ver controlPresupuestalAggregation.js#sumAuthorizedEstimateByConcepto).
    assert.equal(row.estimado, 40 * pu);

    // Pagado <= estimado (excepcion documentada solo si se marca exceedsEstimate)
    assert.ok(row.pagado <= row.estimado + 1e-6, 'un pago del 50% del estimado nunca debe superar el estimado en este escenario');
    assert.ok(Math.abs(row.pagado - montoPago) < 1e-6, 'el pago debe prorratearse integro a este unico concepto (unico renglon de la estimacion)');

    // Saldo = Presupuesto vigente - Pagado (definicion unica documentada)
    assert.equal(row.saldo, row.presupuestoVigente - row.pagado);

    // Forecast: EAC = ejecutado + ETC (cantidad pendiente x P.U.), variacion = EAC - vigente
    const cantidadPendiente = row.cantidadVigente - row.cantidadEjecutada;
    assert.equal(row.cantidadPendiente, cantidadPendiente);
    assert.equal(row.etc, cantidadPendiente * pu);
    assert.equal(row.eac, row.ejecutado + row.etc);
    assert.equal(row.variacion, row.eac - row.presupuestoVigente);

    // Avance fisico vs financiero: deliberadamente distintos (no tautologicos)
    assert.equal(row.avanceFisicoPct, (60 / 120) * 100);
    assert.notEqual(row.avanceFisicoPct, row.avanceFinancieroPct);

    // Totales a nivel proyecto
    assert.equal(totals.vigente, row.presupuestoVigente);
    assert.equal(totals.comprometidoPendiente, Math.max(0, totals.comprometido - totals.pagado));

    // ---- Alertas (Fase E, seccion 10): base para el futuro "Project Sentinel", nunca construido aqui ----
    const alerts = computeControlPresupuestalAlerts({ aggregation: { rows, totals }, changeOrders: changeOrdersList.body.changeOrders, payments: paymentsList.body.payments });
    assert.ok(Array.isArray(alerts), 'el calculo de alertas nunca debe lanzar, aunque el escenario este saludable');
    assert.ok(!alerts.some(a => a.type === ALERT_TYPE.ORDEN_CAMBIO_PENDIENTE), 'ninguna orden quedo EN_REVISION al final del flujo');

    // ---- Curva S (Fase E, seccion 11): con 2 periodos reales, arma series reales, nunca fabrica avance programado ----
    const sCurve = buildSCurveData({ progressEntries: progressList.body.progressEntries, payments: paymentsList.body.payments, presupuestoVigente: row.presupuestoVigente });
    assert.equal(sCurve.available, true);
    assert.deepEqual(sCurve.periods, ['2026-01', '2026-02']);
    assert.equal(sCurve.series.avanceProgramadoPct, null, 'nunca se fabrica una linea base de programa sin datos reales');

    // ---- 12. Multi-tenancy: un usuario ajeno no ve/opera nada de este proyecto ----
    const stranger = await createUserAndGetIdToken({ email: uniq('fase-e-stranger') });
    assert.equal((await callWith(changeOrdersHandler, get(stranger.idToken, { projectId }))).body.changeOrders.length, 0);
    assert.equal((await callWith(commitmentsHandler, get(stranger.idToken, { projectId }))).body.commitments.length, 0);
    assert.equal((await callWith(progressHandler, get(stranger.idToken, { projectId }))).body.progressEntries.length, 0);
    assert.equal((await callWith(estimatesHandler, get(stranger.idToken, { projectId }))).body.estimates.length, 0);
    assert.equal((await callWith(paymentsHandler, get(stranger.idToken, { projectId }))).body.payments.length, 0);
    assert.equal((await callWith(changeOrdersHandler, post(stranger.idToken, { action: 'set-status', id: coApprovedId, status: 'EN_REVISION' }))).statusCode, 403);
    assert.equal((await callWith(commitmentsHandler, post(stranger.idToken, { action: 'set-status', id: commitmentRes.body.commitment.id, status: 'CERRADO' }))).statusCode, 403);
    assert.equal((await callWith(estimatesHandler, post(stranger.idToken, { action: 'set-status', id: estimateId, status: 'AUTORIZADA' }))).statusCode, 403);
  });
});
