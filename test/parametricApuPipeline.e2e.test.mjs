/* Fase B (Cuantificador Parametrico ZOEMEC) -- prueba end-to-end real:
   demuestra que un APU generado por el Cuantificador recorre EXACTAMENTE
   el mismo pipeline que cualquier otro APU (IA, plantilla de texto,
   manual), sin ninguna condicion `if origin==='ai'` ni gate equivalente
   que lo excluya. Corre con `npm run test:parametricpipeline`.

   Reutiliza el MISMO handler HTTP real (server/api-lib/_route-apus.mjs,
   server/api-lib/_route-projects.mjs) que usa produccion -- nunca un mock
   del guardado -- y las MISMAS funciones de dominio
   (finalizeProfessionalAPU/runApuConfidence/runBidRisk/exportAPUPdfV2/
   exportAPUExcelV2) que ya usan main.jsx y apuExportV2.integration.test.mjs.
   Mismo patron de arnes que test/apusApi.test.mjs y test/projectsApi.test.mjs
   (createUserAndGetIdToken/seedOrgMember/mockRes/post/get/call). */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';

import apusHandler from '../server/api-lib/_route-apus.mjs';
import projectsHandler from '../server/api-lib/_route-projects.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';

import { PARAMETRIC_ELEMENTS } from '../src/domain/parametricElements.js';
import { assembleAPUFromParametricResult } from '../src/domain/parametricApuAssembler.js';
import { buildBaseAuxiliaries } from '../src/domain/auxiliaries.js';
import { migrateLegacyApuToV2 } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { runApuConfidence } from '../src/domain/apuConfidence.js';
import { runBidRisk } from '../src/domain/bidRisk.js';
import { calcMaterialRow } from '../src/lib/apuCalc.js';
import { exportAPUPdfV2, exportAPUExcelV2 } from '../src/lib/apuExportV2.js';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/parametricApuPipeline.e2e.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:parametricpipeline`.');
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
const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.zoemec`;

// Mismo helper que test/apusApi.test.mjs#seedOrgMember -- captureRegionalPriceObservations
// exige organizationId real (nunca del body del cliente, ver _orgGuard.mjs#loadOrgContext).
async function seedOrgMember(db, uid, organizationId){
  await db.doc(`organizations/${organizationId}`).set({ id: organizationId, name: 'Empresa QA Cuantificador', status: 'ACTIVE_TRIAL' });
  await db.doc(`organizations/${organizationId}/members/${uid}`).set({ uid, role: 'company_manager', status: 'active' });
  await db.doc(`users/${uid}`).set({ uid, organizationId, role: 'user', plan: 'Gratis', active: true }, { merge: true });
}

// Cemento con estado VERIFICADO (unico estado, junto con IMPORTADO, elegible
// para generar una observacion de precio -- ver isEligibleForObservation en
// src/domain/priceObservation.js) -- confirma que la captura de inteligencia
// regional SI se dispara para un renglon que vino de un AUXILIAR, no solo de
// un renglon de material "plano".
const FAKE_CATALOG = [
  { desc: 'Cemento gris CPC 30R', unidad: 'saco', precio: 248, estado: 'VERIFICADO', tipo: 'material' },
  { desc: 'Arena de río', unidad: 'm³', precio: 465, tipo: 'material' },
  { desc: 'Grava 3/4"', unidad: 'm³', precio: 505, tipo: 'material' },
  { desc: 'Block hueco de concreto 15x20x40 cm', unidad: 'pza', precio: 17.2, tipo: 'material' },
  { desc: 'Piedra bola/brasa para cimiento', unidad: 'm³', precio: 380, tipo: 'material' }
];

const CASES = [
  { id: 'zapata_aislada', inputs: { largo: 1.2, ancho: 1.2, peralte: 0.4 } },
  { id: 'zapata_corrida', inputs: { largo: 3, ancho: 0.6, peralte: 0.3 } },
  { id: 'losa_cimentacion', inputs: { largo: 5, ancho: 4, espesor: 0.15 } },
  { id: 'cimiento_piedra', inputs: { largo: 4, anchoBase: 0.6, anchoCorona: 0.3, altura: 0.5 } },
  { id: 'plantilla', inputs: { largo: 3, ancho: 2, espesor: 0.05 } },
  { id: 'columna', inputs: { base: 0.3, peralte: 0.3, altura: 3 } },
  { id: 'muro', inputs: { largo: 4, altura: 2.5, areaVanos: 1 } }
];

CASES.forEach(({ id: elementId, inputs }) => {
  describe(`Pipeline end-to-end real: ${elementId} (Cuantificador -> APU -> ubicacion -> inteligencia regional -> Confidence -> Bid Risk -> presupuesto -> exportacion)`, () => {
    it('recorre las 8 etapas sin ninguna condicion de origen que lo excluya', async () => {
      const elementDef = PARAMETRIC_ELEMENTS[elementId];
      const auxiliaries = buildBaseAuxiliaries();

      // ---- 1. El cuantificador calcula las cantidades ----
      const calcResult = elementDef.calculate(inputs, {});
      assert.ok(calcResult.consumos.length > 0, '1. el cuantificador debe producir al menos un consumo');

      // ---- 2. El assembler genera el APU (v1) ----
      const v1 = assembleAPUFromParametricResult({ elementDef, inputs, params: {}, calcResult, catalog: FAKE_CATALOG, auxiliaries });
      assert.equal(v1.parametricGenerated, true);
      assert.equal(v1.aiGenerated, false);

      // ---- PARIDAD 1: cantidad del cuantificador == cantidadBase del renglon del APU (antes de desperdicio) ----
      const consumoAuxiliarCemento = calcResult.consumos.find(c => c.tipo === 'auxiliar');
      assert.ok(consumoAuxiliarCemento, `${elementId}: debe consumir al menos un auxiliar`);
      const auxUsado = auxiliaries.find(a => a.clave === consumoAuxiliarCemento.clave);
      const ingredienteCemento = auxUsado.composicion.find(c => c.desc === 'Cemento gris CPC 30R');
      assert.ok(ingredienteCemento, `${elementId}: el auxiliar usado debe traer cemento en su composicion`);
      const cantidadBaseEsperada = ingredienteCemento.cantidadPorUnidad * consumoAuxiliarCemento.cantidad;
      const renglonCemento = v1.materials.find(r => r[0] === 'Cemento gris CPC 30R');
      assert.ok(renglonCemento, `${elementId}: debe existir un renglon de cemento en el APU`);
      assert.ok(Math.abs(renglonCemento[1] - cantidadBaseEsperada) < 1e-9,
        `1<->2. cantidad del cuantificador (${cantidadBaseEsperada}) debe ser EXACTAMENTE la cantidadBase del renglon del APU (${renglonCemento[1]}), antes de aplicar desperdicio`);
      assert.equal(renglonCemento[4], ingredienteCemento.desperdicioPct, 'el desperdicioPct del renglon debe venir intacto del auxiliar, nunca ya aplicado a la cantidad');

      // ---- migracion v1->v2 (MISMA funcion que usan main.jsx#generateAI y los dos flujos de lote) ----
      const v2Draft = migrateLegacyApuToV2(v1);

      // ---- setup de organizacion + proyecto con ubicacion real ----
      const { uid, idToken } = await createUserAndGetIdToken({ email: uniq(`quant-${elementId}`) });
      const db = getAdminDb();
      const organizationId = `org-quant-${elementId}-${Date.now()}`;
      await seedOrgMember(db, uid, organizationId);
      const projectId = `PRO-QUANT-${elementId}-${Date.now()}`;
      const projectRes = await callProjects(post(idToken, {
        action: 'create', id: projectId, name: `Obra QA ${elementId}`,
        locationCountry: 'MX', locationState: 'Nuevo León', locationCity: 'Monterrey'
      }));
      assert.equal(projectRes.statusCode, 201);

      // ---- guardado real via el MISMO endpoint que usa produccion (ningun mock) ----
      const apuId = `APU-QUANT-${elementId}-${Date.now()}`;
      const createRes = await callApus(post(idToken, { action: 'create', id: apuId, projectId, apu: v2Draft }));
      assert.equal(createRes.statusCode, 201, `${elementId}: el guardado real debe aceptar un APU parametrico exactamente igual que cualquier otro`);

      // ---- 3. El APU conserva organizationId, projectId y ubicacion ----
      const savedApu = createRes.body.apu;
      assert.equal(savedApu.ownerUid, uid);
      assert.equal(savedApu.organizationId, organizationId, '3. organizationId debe conservarse -- resuelto del token real, no del origen del APU');
      assert.equal(savedApu.projectId, projectId, '3. projectId debe conservarse');
      assert.deepEqual(savedApu.snapshot.ubicacionEstructurada, { country: 'MX', state: 'Nuevo León', city: 'Monterrey' },
        '3. el servidor debe sembrar la ubicacion desde el proyecto real (ensureApuLocationSnapshot), igual que para cualquier otro origen');
      assert.equal(savedApu.snapshot.ubicacion, 'Monterrey, Nuevo León, México');

      // ---- 4. Se adjunta inteligencia regional (captura de observacion de precio) ----
      const obsSnap = await db.collection('priceObservations').where('organizationId', '==', organizationId).get();
      assert.ok(obsSnap.size >= 1, `4. debe haberse capturado al menos 1 observacion de precio regional para ${elementId} (renglon VERIFICADO de cemento)`);
      const cementoObs = obsSnap.docs.find(d => d.data().conceptoNormalizado === 'cemento gris cpc 30r');
      assert.ok(cementoObs, '4. la observacion debe corresponder al insumo real (cemento), no un placeholder');
      assert.equal(cementoObs.data().precio, 248);

      // ---- reconstruir lo que main.jsx hace con el snapshot ya guardado ----
      const professionalApu = finalizeProfessionalAPU(savedApu.snapshot);

      // ---- 5. Confidence Engine lo procesa ----
      const confidence = runApuConfidence(professionalApu);
      assert.ok(confidence && typeof confidence.score !== 'undefined', `5. Confidence Engine debe procesar el APU de ${elementId} sin lanzar`);
      assert.ok('regionalEvidence' in confidence.dimensions, '5. debe incluir la dimension regionalEvidence, igual que cualquier otro origen');

      // ---- 6. Bid Risk lo procesa ----
      assert.doesNotThrow(() => runBidRisk(professionalApu), `6. Bid Risk debe procesar el APU de ${elementId} sin lanzar`);
      const bidRisk = runBidRisk(professionalApu);
      assert.ok(Array.isArray(bidRisk.findings), '6. Bid Risk debe regresar un arreglo de findings, igual que para cualquier otro origen');

      // ---- 7. El presupuesto recibe el APU (misma forma que main.jsx#addBudget) ----
      const budgetItem = { concept: professionalApu.concept, unit: professionalApu.unit, qty: 1, pu: professionalApu.calculated.pu };
      assert.ok(budgetItem.concept, '7. el renglon de presupuesto debe traer un concepto real');
      assert.ok(budgetItem.pu > 0, '7. el precio unitario calculado debe ser positivo para poder entrar a un presupuesto');

      // ---- 8. PDF/Excel lo pueden exportar ----
      const { doc } = exportAPUPdfV2(professionalApu, { save: false });
      const pdfBytes = Buffer.from(doc.output('arraybuffer'));
      assert.ok(pdfBytes.length > 1000, `8. el PDF exportado de ${elementId} debe tener contenido real`);

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zoemec-quant-${elementId}-`));
      const before = process.cwd();
      process.chdir(dir);
      try{
        await exportAPUExcelV2(professionalApu, { writeXlsxFileImpl: writeXlsxFileNode, fileName: 'quant.xlsx' });
        assert.ok(fs.statSync('quant.xlsx').size > 1000, `8. el Excel exportado de ${elementId} debe tener contenido real`);
      } finally {
        process.chdir(before);
        fs.rmSync(dir, { recursive: true, force: true });
      }

      // ---- PARIDAD 2: cantidad final del APU == cantidadBase x (1 + desperdicioPct/100), UNA sola vez ----
      const renglonV2Cemento = professionalApu.materials.find(r => r.descripcion === 'Cemento gris CPC 30R');
      assert.ok(renglonV2Cemento, `${elementId}: el renglon de cemento debe sobrevivir la migracion a v2`);
      assert.ok(Math.abs(renglonV2Cemento.consumo - cantidadBaseEsperada) < 1e-9, 'el consumo v2 debe seguir siendo la cantidadBase neta');
      const importeCalculado = calcMaterialRow(renglonV2Cemento);
      const importeEsperadoUnaVez = cantidadBaseEsperada * (1 + renglonV2Cemento.desperdicioPct / 100) * renglonV2Cemento.precioUnitario;
      assert.ok(Math.abs(importeCalculado - importeEsperadoUnaVez) < 1e-6,
        `cantidad final del APU debe ser cantidadBase x (1+desperdicioPct/100) exactamente UNA vez: esperado ${importeEsperadoUnaVez}, calculado ${importeCalculado}`);
    });
  });
});
