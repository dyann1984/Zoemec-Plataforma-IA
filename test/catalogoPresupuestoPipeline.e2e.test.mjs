/* Fase D (Catalogo -> APU -> Presupuesto) -- prueba end-to-end real: recorre
   el flujo completo PDF -> Cuantificacion -> Catalogo -> Generacion de APU
   -> Presupuesto -> Explosiones usando los MISMOS handlers HTTP reales que
   usa produccion (server/api-lib/_route-projects.mjs, _route-apus.mjs,
   _route-catalogo-conceptos.mjs, _route-presupuestos.mjs), sin ningun mock
   de guardado -- mismo patron de arnes que test/parametricApuPipeline.e2e.test.mjs
   y test/apusApi.test.mjs. Corre con `npm run test:presupuestos` +
   `npm run test:catalogconceptos` para las piezas por separado, y aqui para
   el flujo completo integrado (`npm --test test/catalogoPresupuestoPipeline.e2e.test.mjs`
   vía el emulador, ver package.json).

   Cubre explicitamente lo pedido en el QA de Fase D: APU existente asociado,
   APU parametrico (mismo pipeline v1->v2 que main.jsx, sin llamar OpenAI
   real -- igual criterio que parametricApuPipeline.e2e.test.mjs), concepto
   pendiente, error de un concepto + retry (sin perder los demas), ubicacion
   regional (nunca default silencioso de ciudad), refresh/reingreso (GET
   fresco tras cada escritura), Baseline set-once, Explosiones (Fase A, mismo
   motor), exportacion PDF/Excel, y aislamiento multi-tenant. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';

import apusHandler from '../server/api-lib/_route-apus.mjs';
import projectsHandler from '../server/api-lib/_route-projects.mjs';
import catalogoConceptosHandler from '../server/api-lib/_route-catalogo-conceptos.mjs';
import presupuestosHandler from '../server/api-lib/_route-presupuestos.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

import { PARAMETRIC_ELEMENTS } from '../src/domain/parametricElements.js';
import { assembleAPUFromParametricResult } from '../src/domain/parametricApuAssembler.js';
import { buildBaseAuxiliaries } from '../src/domain/auxiliaries.js';
import { migrateLegacyApuToV2 } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { runApuConfidence } from '../src/domain/apuConfidence.js';
import { runBidRisk } from '../src/domain/bidRisk.js';
import { calcAPUv2 } from '../src/lib/apuCalc.js';
import { aggregatePresupuesto } from '../src/domain/presupuestoAggregation.js';
import { computeExplosionData } from '../src/domain/explosionData.js';
import { exportPresupuestoExcel, exportPresupuestoPDF } from '../src/lib/presupuestoExport.js';
import { findApuMatches } from '../src/domain/apuMatchLookup.js';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/catalogoPresupuestoPipeline.e2e.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:presupuestos` (o un script equivalente con firestore,auth).');
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
async function callApus(req){ const res = mockRes(); await apusHandler(req, res); return res; }
async function callProjects(req){ const res = mockRes(); await projectsHandler(req, res); return res; }
async function callCatalogo(req){ const res = mockRes(); await catalogoConceptosHandler(req, res); return res; }
async function callPresupuestos(req){ const res = mockRes(); await presupuestosHandler(req, res); return res; }
const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.zoemec`;

async function seedOrgMember(db, uid, organizationId){
  await db.doc(`organizations/${organizationId}`).set({ id: organizationId, name: 'Empresa QA Fase D', status: 'ACTIVE_TRIAL' });
  await db.doc(`organizations/${organizationId}/members/${uid}`).set({ uid, role: 'company_manager', status: 'active' });
  await db.doc(`users/${uid}`).set({ uid, organizationId, role: 'user', plan: 'Gratis', active: true }, { merge: true });
}

// APU "ya generado" (simula un APU IA previo, sin llamar OpenAI real -- el
// contrato del motor de IA ya esta cubierto por test/openaiApuCore.test.mjs)
// para el caso "asociar APU existente".
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

describe('Fase D end-to-end: PDF -> Cuantificacion -> Catalogo -> APU -> Presupuesto -> Explosiones', () => {
  it('recorre el flujo completo con las 4 vias de un concepto (asociado/parametrico/pendiente/error+retry), regionalizacion real, Baseline y Explosiones', async () => {
    const { uid, idToken } = await createUserAndGetIdToken({ email: uniq('fase-d') });
    const db = getAdminDb();
    const organizationId = `org-fase-d-${Date.now()}`;
    await seedOrgMember(db, uid, organizationId);

    // ---- 0. Proyecto con ubicacion real (regionalizacion, nunca default) ----
    const projectId = `PRO-FASE-D-${Date.now()}`;
    const projectRes = await callProjects(post(idToken, {
      action: 'create', id: projectId, name: 'Obra QA Fase D',
      locationCountry: 'MX', locationState: 'Nuevo León', locationCity: 'Monterrey'
    }));
    assert.equal(projectRes.statusCode, 201);

    // ---- 1. "PDF -> Cuantificacion -> Catalogo": creacion en lote de 4 conceptos ----
    const createRes = await callCatalogo(post(idToken, {
      action: 'create', projectId,
      conceptos: [
        { clave: 'ALB-EXIST', capitulo: 'ALBANILERIA', concept: 'Muro de block hueco de concreto 15x20x40 cm', unit: 'm²', qty: 30,
          origenPlano: { origen: 'plano-takeoff', fileName: 'planta-arq.pdf', pagina: 2, evidencia: 'muro norte', validatedBy: uid } },
        { clave: 'CIM-PARAM', capitulo: 'CIMENTACION', concept: 'Zapata aislada de concreto armado 1.2x1.2', unit: 'pza', qty: 4 },
        { clave: 'ACB-PEND', capitulo: 'ACABADOS', concept: 'Aplanado fino en muros', unit: 'm²', qty: 50 },
        { clave: 'EST-ERR', capitulo: 'ESTRUCTURA', concept: 'Castillo de concreto armado', unit: 'ml', qty: 20 }
      ]
    }));
    assert.equal(createRes.statusCode, 201);
    assert.equal(createRes.body.conceptos.length, 4);
    // Regionalizacion: ningun concepto trajo ubicacion propia -- todos deben
    // heredar la del proyecto real, NUNCA una ciudad por default.
    assert.ok(createRes.body.conceptos.every(c => c.ubicacionEstructurada?.city === 'Monterrey'),
      'todo concepto sin ubicacion propia debe heredar la del proyecto, nunca quedar con una ciudad inventada');

    const conceptoAsociar = createRes.body.conceptos.find(c => c.clave === 'ALB-EXIST');
    const conceptoParametrico = createRes.body.conceptos.find(c => c.clave === 'CIM-PARAM');
    const conceptoPendiente = createRes.body.conceptos.find(c => c.clave === 'ACB-PEND');
    const conceptoError = createRes.body.conceptos.find(c => c.clave === 'EST-ERR');

    // ---- 2a. VIA "Asociar APU existente" ----
    const existingApuId = `APU-EXIST-${Date.now()}`;
    const existingApuRes = await callApus(post(idToken, {
      action: 'create', id: existingApuId, projectId,
      apu: preexistingApuV2({ id: existingApuId, clave: 'ALB-EXIST', concept: 'Muro de block hueco de concreto 15x20x40', unit: 'm²' })
    }));
    assert.equal(existingApuRes.statusCode, 201);

    // El motor de matching (apuMatchLookup.js) debe encontrar este APU como
    // buena coincidencia ANTES de asociar -- mismo criterio que la UI.
    const allApusRes = await callApus(get(idToken, { projectId }));
    const apusForMatching = allApusRes.body.apus.map(a => ({ ...a.snapshot, id: a.id }));
    const match = findApuMatches(apusForMatching, { desc: conceptoAsociar.concept, unidad: conceptoAsociar.unit, capitulo: conceptoAsociar.capitulo });
    assert.ok(match, 'debe encontrarse una coincidencia real antes de asociar (nunca se asocia a ciegas)');
    assert.equal(match.match.id, existingApuId);

    const associateRes = await callCatalogo(post(idToken, {
      action: 'associate-apu', id: conceptoAsociar.id, apuId: existingApuId, matchConfidence: match.confidence, matchMethod: match.matchMethod
    }));
    assert.equal(associateRes.statusCode, 200);
    assert.equal(associateRes.body.concepto.status, 'ASOCIADO');
    assert.equal(associateRes.body.concepto.apuVersionId, 'V1');

    // ---- 2b. VIA "Generar con cuantificador parametrico" (sin llamar IA real) ----
    const elementDef = PARAMETRIC_ELEMENTS.zapata_aislada;
    const auxiliaries = buildBaseAuxiliaries();
    const calcResult = elementDef.calculate({ largo: 1.2, ancho: 1.2, peralte: 0.4 }, {});
    const catalogForAssembler = [
      { desc: 'Cemento gris CPC 30R', unidad: 'saco', precio: 248, tipo: 'material' },
      { desc: 'Arena de río', unidad: 'm³', precio: 465, tipo: 'material' },
      { desc: 'Grava 3/4"', unidad: 'm³', precio: 505, tipo: 'material' }
    ];
    const v1Draft = assembleAPUFromParametricResult({ elementDef, inputs: { largo: 1.2, ancho: 1.2, peralte: 0.4 }, params: {}, calcResult, catalog: catalogForAssembler, auxiliaries });
    assert.equal(v1Draft.parametricGenerated, true);
    // Mismo paso que CatalogoModule.jsx#handleParametricGenerated: el assembler
    // entrega v1 (renglones-array), se migra a v2 antes de finalizar/guardar.
    const v2Draft = migrateLegacyApuToV2(v1Draft);
    const paramApuId = `APU-PARAM-${Date.now()}`;
    await callCatalogo(post(idToken, { action: 'set-status', id: conceptoParametrico.id, status: 'GENERANDO' }));
    const paramApuRes = await callApus(post(idToken, { action: 'create', id: paramApuId, projectId, apu: { ...v2Draft, id: paramApuId, projectId } }));
    assert.equal(paramApuRes.statusCode, 201);
    assert.deepEqual(paramApuRes.body.apu.snapshot.ubicacionEstructurada, { country: 'MX', state: 'Nuevo León', city: 'Monterrey' },
      'el APU parametrico tambien debe regionalizarse con la ubicacion real del proyecto');
    const paramSetStatus = await callCatalogo(post(idToken, { action: 'set-status', id: conceptoParametrico.id, status: 'GENERADO', apuId: paramApuId }));
    assert.equal(paramSetStatus.statusCode, 200);
    assert.equal(paramSetStatus.body.concepto.status, 'GENERADO');

    // ---- 2c. VIA "Dejar pendiente": conceptoPendiente nunca se toca ----
    // (se verifica mas abajo, en el refresh/reingreso, que sigue PENDIENTE)

    // ---- 2d. VIA "Generacion masiva -- error de 1 concepto + retry, sin perder los demas" ----
    await callCatalogo(post(idToken, { action: 'set-status', id: conceptoError.id, status: 'GENERANDO', batchId: 'BATCH-QA-1' }));
    const erroredRes = await callCatalogo(post(idToken, { action: 'set-status', id: conceptoError.id, status: 'ERROR', error: 'Timeout simulado de IA', batchId: 'BATCH-QA-1' }));
    assert.equal(erroredRes.body.concepto.statusError, 'Timeout simulado de IA');
    // "Reintentar solo fallidos": los otros 3 conceptos (asociado/parametrico/pendiente)
    // deben seguir EXACTAMENTE como estaban -- un fallo nunca los toca.
    const midListRes = await callCatalogo(get(idToken, { projectId }));
    const midByClave = Object.fromEntries(midListRes.body.conceptos.map(c => [c.clave, c]));
    assert.equal(midByClave['ALB-EXIST'].status, 'ASOCIADO', 'el fallo de otro concepto no debe tocar el ya asociado');
    assert.equal(midByClave['CIM-PARAM'].status, 'GENERADO', 'el fallo de otro concepto no debe tocar el ya generado');
    assert.equal(midByClave['ACB-PEND'].status, 'PENDIENTE', 'el fallo de otro concepto no debe tocar el pendiente');
    // Retry: ERROR -> GENERANDO es legal, se reintenta y esta vez "funciona".
    await callCatalogo(post(idToken, { action: 'set-status', id: conceptoError.id, status: 'GENERANDO', batchId: 'BATCH-QA-2' }));
    const retryApuId = `APU-RETRY-${Date.now()}`;
    await callApus(post(idToken, {
      action: 'create', id: retryApuId, projectId,
      apu: preexistingApuV2({ id: retryApuId, clave: 'EST-ERR', concept: 'Castillo de concreto armado', unit: 'ml' })
    }));
    const retriedRes = await callCatalogo(post(idToken, { action: 'set-status', id: conceptoError.id, status: 'GENERADO', apuId: retryApuId, batchId: 'BATCH-QA-2' }));
    assert.equal(retriedRes.body.concepto.status, 'GENERADO');
    assert.equal(retriedRes.body.concepto.statusError, null, 'reintentar con exito debe limpiar el error anterior');

    // ---- 3. "Refresh/reingreso": peticion GET completamente nueva, como si el usuario recargara la pagina ----
    const reloadedRes = await callCatalogo(get(idToken, { projectId }));
    assert.equal(reloadedRes.statusCode, 200);
    const byClave = Object.fromEntries(reloadedRes.body.conceptos.map(c => [c.clave, c]));
    assert.equal(byClave['ALB-EXIST'].status, 'ASOCIADO');
    assert.equal(byClave['CIM-PARAM'].status, 'GENERADO');
    assert.equal(byClave['ACB-PEND'].status, 'PENDIENTE');
    assert.equal(byClave['EST-ERR'].status, 'GENERADO');
    assert.equal(byClave['ACB-PEND'].apuId, null, 'un concepto pendiente debe mostrarse claramente sin APU, nunca con uno inventado');

    // ---- 4. Presupuesto: agrega los 4 conceptos con su APU (o sin el) ----
    const finalApusRes = await callApus(get(idToken, { projectId }));
    const apuById = new Map(finalApusRes.body.apus.map(a => [a.id, { ...a.snapshot, id: a.id }]));
    const rows = reloadedRes.body.conceptos.map(c => {
      const apu = c.apuId ? apuById.get(c.apuId) : null;
      const totals = apu ? (apu.calculated || calcAPUv2(apu)) : null;
      return {
        conceptoId: c.id, clave: c.clave, capitulo: c.capitulo, concept: c.concept, unit: c.unit, qty: c.qty,
        apuId: c.apuId, pu: totals?.pu ?? 0, direct: totals?.direct ?? 0, iva: totals?.iva ?? 0,
        confidenceStatus: apu ? runApuConfidence(finalizeProfessionalAPU(apu)).status : null,
        bidRiskSeverity: apu ? runBidRisk(finalizeProfessionalAPU(apu)).severity : null,
        origenCantidad: c.origenPlano ? 'Plano' : 'Manual', origenPrecio: c.status === 'ASOCIADO' ? 'APU asociado' : (apu ? 'Generado' : '—')
      };
    });
    const aggregation = aggregatePresupuesto(rows);
    assert.equal(aggregation.rows.length, 4);
    assert.ok(aggregation.importeTotal > 0, 'debe haber importe real de los 3 conceptos con APU');
    // El pendiente no aporta importe pero SI aparece (nunca se pierde de la vista).
    const pendienteRow = aggregation.rows.find(r => r.clave === 'ACB-PEND');
    assert.equal(pendienteRow.importe, 0);
    assert.equal(pendienteRow.hasApu, false);
    // Costo directo total: formula unica Cantidad x costo directo del APU, sin recalcular merma aqui.
    const expectedDirect = aggregation.rows.reduce((s, r) => s + r.qty * r.direct, 0);
    assert.ok(Math.abs(aggregation.costoDirectoTotal - expectedDirect) < 1e-6);

    const presupuestoId = `PRE-FASE-D-${Date.now()}`;
    const snapshot = { conceptos: aggregation.rows, capituloSubtotals: aggregation.capituloSubtotals, costoDirectoTotal: aggregation.costoDirectoTotal, importeTotal: aggregation.importeTotal };
    const presuCreateRes = await callPresupuestos(post(idToken, { action: 'create', id: presupuestoId, projectId, snapshot }));
    assert.equal(presuCreateRes.statusCode, 201);
    assert.equal(presuCreateRes.body.presupuesto.currentVersion, 'V1');
    assert.equal(presuCreateRes.body.presupuesto.baselineVersion, null);

    // ---- 5. Baseline: set-once ----
    const baselineRes = await callPresupuestos(post(idToken, { action: 'approve-baseline', id: presupuestoId }));
    assert.equal(baselineRes.statusCode, 200);
    assert.equal(baselineRes.body.presupuesto.baselineVersion, 'V1');
    const secondBaselineRes = await callPresupuestos(post(idToken, { action: 'approve-baseline', id: presupuestoId }));
    assert.equal(secondBaselineRes.statusCode, 409, 'el Baseline nunca se reasigna una vez aprobado');

    // Un cambio posterior crea version nueva sin mover el Baseline.
    const saveVersionRes = await callPresupuestos(post(idToken, {
      action: 'save-version', id: presupuestoId, snapshot: { ...snapshot, importeTotal: snapshot.importeTotal + 1 },
      expectedParentVersionId: 'V1'
    }));
    assert.equal(saveVersionRes.body.presupuesto.currentVersion, 'V2');
    assert.equal(saveVersionRes.body.presupuesto.baselineVersion, 'V1', 'el Baseline queda fijo aunque se guarden versiones nuevas despues');

    // Refresh/reingreso del presupuesto tambien.
    const reopenedPresu = await callPresupuestos(get(idToken, { id: presupuestoId }));
    assert.equal(reopenedPresu.body.versions.length, 2);
    assert.equal(reopenedPresu.body.presupuesto.snapshot.importeTotal, snapshot.importeTotal + 1);

    // ---- 6. Explosiones (Fase A, MISMO motor, ver "Ver explosiones") ----
    const explosionData = computeExplosionData(finalApusRes.body.apus);
    assert.ok(explosionData.materials, 'la explosion de materiales debe calcularse a partir de los APUs reales del proyecto');
    assert.ok(Array.isArray(explosionData.labor.rows) || Array.isArray(explosionData.labor), 'la explosion de mano de obra debe producirse sin lanzar');

    // ---- 7. Exportacion PDF/Excel del Presupuesto ----
    const pdfDoc = exportPresupuestoPDF({ presupuesto: baselineRes.body.presupuesto, aggregation, projectName: 'Obra QA Fase D', save: false });
    const pdfBytes = Buffer.from(pdfDoc.output('arraybuffer'));
    assert.ok(pdfBytes.length > 500, 'el PDF del presupuesto debe tener contenido real');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-presupuesto-'));
    const before = process.cwd();
    process.chdir(dir);
    try{
      await exportPresupuestoExcel({ presupuesto: baselineRes.body.presupuesto, aggregation, projectName: 'Obra QA Fase D', writeXlsxFileImpl: writeXlsxFileNode });
      assert.ok(fs.statSync(`${projectId}-PRESUPUESTO-ZOEMEC.xlsx`).size > 500, 'el Excel del presupuesto debe tener contenido real');
    } finally {
      process.chdir(before);
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // ---- 8. Multi-tenancy: un usuario ajeno no ve nada de este proyecto ----
    const stranger = await createUserAndGetIdToken({ email: uniq('fase-d-stranger') });
    assert.equal((await callCatalogo(get(stranger.idToken, { projectId }))).body.conceptos.length, 0);
    assert.equal((await callPresupuestos(get(stranger.idToken, { id: presupuestoId }))).statusCode, 403);
    assert.equal((await callCatalogo(post(stranger.idToken, { action: 'associate-apu', id: conceptoPendiente.id, apuId: existingApuId }))).statusCode, 403);
  });

  it('regionalizacion: un proyecto SIN ubicacion nunca defaultea silenciosamente a ninguna ciudad', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('fase-d-sinubic') });
    const projectId = `PRO-SIN-UBIC-${Date.now()}`;
    await callProjects(post(idToken, { action: 'create', id: projectId, name: 'Obra sin ubicacion' }));
    const res = await callCatalogo(post(idToken, {
      action: 'create', projectId, conceptos: [{ clave: 'X-1', capitulo: 'OTROS', concept: 'Concepto sin ubicacion de proyecto', unit: 'pza', qty: 1 }]
    }));
    assert.equal(res.body.conceptos[0].ubicacionEstructurada, null, 'sin ubicacion de proyecto, el concepto NUNCA debe quedar con una ciudad inventada (ej. CDMX)');
  });
});
