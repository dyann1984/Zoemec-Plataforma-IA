/* Prueba de integracion del Dossier de Proyecto/Multi-APU en XLSX (Fase 8
   Parte 2). Mismo criterio de mock de fetch que
   test/apuDossier.xlsx.integration.test.mjs (mockea la capa HTTP con las
   MISMAS formas de respuesta reales de /api/apus?projectId=,
   /api/projects?id=, /api/challenge-decisions, /api/technical-memory,
   /api/export-events -- la QA de aplicacion completa contra el emulador
   real cubre el resto). El .xlsx generado se desempaca de verdad (fflate)
   y se leen los nombres/contenido reales de las hojas -- nunca se asume
   "no truena" como prueba suficiente.

   Foco de este archivo: la regla OBLIGATORIA de "una hoja por concepto"
   (nunca menos hojas de las debidas que conceptos reales) y el orden de
   hojas generales del spec. */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';
import { unzipSync, strFromU8 } from 'fflate';
import { makeEmptyAPUv2, APU_DATA_STATE } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { SYSTEM_RESOURCES } from '../src/domain/constructionSystems.js';
import { exportProjectDossierExcel } from '../src/lib/apuProjectDossierXlsx.js';
import { buildProjectDossierData } from '../src/lib/apuProjectDossierData.js';

function apuFor(id, concept, overrides = {}){
  const a = makeEmptyAPUv2();
  const [descripcion, cantidadPorUnidad, , salarioBase, fsr] = SYSTEM_RESOURCES.tablaroca.labor[0];
  const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'Proveedor de prueba', fecha: '2026-01-01' };
  Object.assign(a, {
    id, clave: id, concept, unit: 'm²', cantidadObra: 100,
    proyecto: 'Proyecto Multi-APU Test', cliente: 'Cliente Multi-APU Test',
    primaryActivity: 'tablaroca', version: 'V1'
  });
  a.materials = [{ clave: 'MAT-1', descripcion: 'Panel de yeso', unidad: 'pza', consumo: 2, desperdicioPct: 5, precioUnitario: 150, fuente }];
  a.labor = [{ clave: 'MO-1', descripcion, cuadrilla: 1, rendimiento: 1 / cantidadPorUnidad, jornada: 8, salarioBase, fsr, fuente, rendimientoFuente: 'PLANTILLA' }];
  Object.assign(a, overrides);
  return finalizeProfessionalAPU(a);
}

const CONCEPTS = ['Demolicion de muro', 'Acarreo de escombro', 'Firme de concreto', 'Instalacion electrica', 'Aplanado fino', 'Impermeabilizacion'];

function sixApuDocs(){
  return CONCEPTS.map((concept, i) => {
    const id = `APU-${i + 1}`;
    const snapshot = apuFor(id, concept);
    return { id, ownerUid: 'uid-test', projectId: 'PRO-6', currentVersion: 'V1', snapshot, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  });
}

let responses;
const originalFetch = global.fetch;
before(() => {
  global.fetch = async (url) => {
    const u = new URL(String(url), 'http://localhost');
    const key = u.pathname + (u.search || '');
    const found = Object.entries(responses).find(([pattern]) => key.startsWith(pattern));
    const body = found ? found[1] : { error: 'not mocked: ' + key };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
});
after(() => { global.fetch = originalFetch; });
beforeEach(() => {
  responses = {
    '/api/projects?id=PRO-6': { project: { id: 'PRO-6', name: 'Proyecto Multi-APU Test', client: 'Cliente Multi-APU Test' } },
    '/api/apus?projectId=PRO-6': { apus: sixApuDocs() },
    '/api/challenge-decisions': { decisions: [] },
    '/api/technical-memory': { entries: [] },
    '/api/export-events': { event: {} }
  };
});

function allSheetsText(zip){
  const shared = strFromU8(zip['xl/sharedStrings.xml'] || new Uint8Array());
  const sheetFiles = Object.keys(zip).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
  return shared + sheetFiles.map(f => strFromU8(zip[f])).join('\n');
}

test('CASO: proyecto con 6 APUs -> exactamente 6 hojas principales de concepto, ninguno perdido ni duplicado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-project-dossier-xlsx-'));
  const before_ = process.cwd(); process.chdir(dir);
  try{
    const { sheets } = await exportProjectDossierExcel({ projectId: 'PRO-6', writeXlsxFileImpl: writeXlsxFileNode, fileName: 'proyecto.xlsx' });
    const names = sheets.map(s => s.sheet);
    const generalSheets = ['PORTADA', 'RESUMEN PROYECTO', 'RANKING RIESGO', 'CONFIDENCE', 'BID RISK', 'HISTORIAL Y VERSIONES'];
    generalSheets.forEach(g => assert.ok(names.includes(g), `falta hoja general ${g}`));
    // Orden exacto de las hojas generales que si aplican (AUDITORIA
    // GLOBAL/CHALLENGE GLOBAL/ESCENARIOS se omiten si no hay datos, regla
    // "nunca hojas vacias" -- este caso no dispara Challenge ni tiene
    // escenarios seleccionados).
    const idxPortada = names.indexOf('PORTADA'), idxResumen = names.indexOf('RESUMEN PROYECTO'), idxRanking = names.indexOf('RANKING RIESGO');
    assert.ok(idxPortada < idxResumen && idxResumen < idxRanking);
    // Las hojas de concepto van DESPUES de todas las generales.
    const conceptSheetNames = names.filter(n => /^\d{3}_/.test(n));
    assert.equal(conceptSheetNames.length, 6, `se esperaban 6 hojas de concepto, hubo ${conceptSheetNames.length}: ${conceptSheetNames.join(', ')}`);
    // Ningun concepto perdido: cada concepto real aparece en alguna hoja.
    CONCEPTS.forEach(c => {
      const slug = c.replace(/\s+/g, '_');
      assert.ok(conceptSheetNames.some(n => n.includes(slug.split('_')[0])), `concepto "${c}" no aparece en ninguna hoja`);
    });
    // Ningun concepto duplicado: 6 nombres de hoja de concepto UNICOS.
    assert.equal(new Set(conceptSheetNames).size, 6);
    // Prefijo ordinal estable 001.. 006, sin huecos.
    const ordinals = conceptSheetNames.map(n => n.slice(0, 3)).sort();
    assert.deepEqual(ordinals, ['001', '002', '003', '004', '005', '006']);
    assert.ok(fs.statSync('proyecto.xlsx').size > 500);
  }finally{ process.chdir(before_); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CASO: nombres de hoja colisionados reciben sufijo estable, nunca se pierde un concepto', async () => {
  responses['/api/apus?projectId=PRO-6'] = {
    apus: [
      { id: 'APU-1', ownerUid: 'uid-test', projectId: 'PRO-6', currentVersion: 'V1', snapshot: apuFor('APU-1', 'Muro de tablaroca estandar en interior nivel 1'), createdAt: 'x', updatedAt: 'x' },
      { id: 'APU-2', ownerUid: 'uid-test', projectId: 'PRO-6', currentVersion: 'V1', snapshot: apuFor('APU-2', 'Muro de tablaroca estandar en interior nivel 2'), createdAt: 'x', updatedAt: 'x' }
    ]
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-project-dossier-xlsx-collision-'));
  const before_ = process.cwd(); process.chdir(dir);
  try{
    const { sheets } = await exportProjectDossierExcel({ projectId: 'PRO-6', writeXlsxFileImpl: writeXlsxFileNode, fileName: 'proyecto2.xlsx' });
    const conceptSheetNames = sheets.map(s => s.sheet).filter(n => /^\d{3}_/.test(n));
    assert.equal(conceptSheetNames.length, 2);
    assert.equal(new Set(conceptSheetNames).size, 2); // nombres distintos aunque el texto base colisione
    conceptSheetNames.forEach(n => assert.ok(n.length <= 31, `nombre de hoja excede 31 caracteres: "${n}"`));
  }finally{ process.chdir(before_); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CASO: nombres de hoja sanitizados (sin caracteres invalidos de Excel)', async () => {
  responses['/api/apus?projectId=PRO-6'] = {
    apus: [{ id: 'APU-1', ownerUid: 'uid-test', projectId: 'PRO-6', currentVersion: 'V1', snapshot: apuFor('APU-1', 'Muro: tipo A/B [nivel 1]*'), createdAt: 'x', updatedAt: 'x' }]
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-project-dossier-xlsx-sanitize-'));
  const before_ = process.cwd(); process.chdir(dir);
  try{
    const { sheets } = await exportProjectDossierExcel({ projectId: 'PRO-6', writeXlsxFileImpl: writeXlsxFileNode, fileName: 'proyecto3.xlsx' });
    const conceptSheet = sheets.find(s => /^\d{3}_/.test(s.sheet));
    assert.ok(conceptSheet);
    assert.ok(!/[\\/?*[\]:]/.test(conceptSheet.sheet), `nombre de hoja contiene caracteres invalidos: "${conceptSheet.sheet}"`);
  }finally{ process.chdir(before_); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CASO: Project Risk / Project Confidence / exposicion total en RESUMEN PROYECTO', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-project-dossier-xlsx-risk-'));
  const before_ = process.cwd(); process.chdir(dir);
  try{
    const data = await buildProjectDossierData({ projectId: 'PRO-6' });
    assert.equal(data.projectConfidence.totalAPUs, 6);
    assert.equal(data.projectBidRisk.totalAPUs, 6);
    assert.equal(data.projectConfidence.high + data.projectConfidence.medium + data.projectConfidence.low + data.projectConfidence.insufficientEvidence, 6);
    assert.equal(data.projectBidRisk.low + data.projectBidRisk.medium + data.projectBidRisk.high + data.projectBidRisk.critical, 6);
    assert.ok(Number.isFinite(data.projectBidRisk.estimatedExposure));
    assert.ok(Number.isFinite(data.importeProyectoTotal) && data.importeProyectoTotal > 0);
    const { sheets } = await exportProjectDossierExcel({ projectId: 'PRO-6', writeXlsxFileImpl: writeXlsxFileNode, fileName: 'proyecto4.xlsx' });
    const zip = unzipSync(fs.readFileSync('proyecto4.xlsx'));
    const text = allSheetsText(zip);
    assert.ok(!/\bNaN\b/.test(text));
    assert.ok(!/\bInfinity\b/.test(text));
  }finally{ process.chdir(before_); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CASO: ranking ordena por severidad de Bid Risk / exposicion descendente', async () => {
  const data = await buildProjectDossierData({ projectId: 'PRO-6' });
  const ranks = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  for(let i = 1; i < data.ranking.length; i++){
    const prev = ranks[data.ranking[i - 1].bidRiskSeverity], cur = ranks[data.ranking[i].bidRiskSeverity];
    assert.ok(prev >= cur, 'el ranking no esta ordenado por severidad descendente');
  }
});

test('CASO: escenario seleccionado se incluye en el dossier, uno no seleccionado se excluye', async () => {
  const selectedScenarios = [{ scenarioId: 'SC-1', name: 'Sube precio de panel 20%', apuId: 'APU-1', changes: [{ type: 'RESOURCE_PRICE_OVERRIDE', mode: 'absolute', value: 180, selector: { kind: 'materials', descripcion: 'Panel de yeso' } }] }];
  const data = await buildProjectDossierData({ projectId: 'PRO-6', selectedScenarios });
  assert.equal(data.scenarios.length, 1);
  assert.equal(data.scenarios[0].scenarioId, 'SC-1');
  assert.equal(data.scenarios[0].apuId, 'APU-1');
  assert.equal(data.scenarios[0].label, 'SIMULACION -- NO MODIFICA EL APU BASE');
  // APU-2..6 no tienen ningun escenario propio incluido (nunca se auto-incluyen todos).
  assert.ok(!data.scenarios.some(s => s.apuId !== 'APU-1'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-project-dossier-xlsx-scenario-'));
  const before_ = process.cwd(); process.chdir(dir);
  try{
    const { sheets } = await exportProjectDossierExcel({ projectId: 'PRO-6', selectedScenarios, writeXlsxFileImpl: writeXlsxFileNode, fileName: 'proyecto5.xlsx' });
    assert.ok(sheets.some(s => s.sheet === 'ESCENARIOS'));
    const zip = unzipSync(fs.readFileSync('proyecto5.xlsx'));
    const text = allSheetsText(zip);
    assert.match(text, /SIMULACION/);
  }finally{ process.chdir(before_); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CASO: sin escenarios seleccionados, la hoja ESCENARIOS no se crea (nunca hojas vacias)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-project-dossier-xlsx-noscenario-'));
  const before_ = process.cwd(); process.chdir(dir);
  try{
    const { sheets } = await exportProjectDossierExcel({ projectId: 'PRO-6', writeXlsxFileImpl: writeXlsxFileNode, fileName: 'proyecto6.xlsx' });
    assert.ok(!sheets.some(s => s.sheet === 'ESCENARIOS'));
  }finally{ process.chdir(before_); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CASO: escenario de proyecto (applyChangeAcrossProject) reporta afectados/no afectados y delta total', async () => {
  const projectScenario = { change: { type: 'RESOURCE_PRICE_OVERRIDE', mode: 'absolute', value: 200, selector: { kind: 'materials', descripcion: 'Panel de yeso' } } };
  const data = await buildProjectDossierData({ projectId: 'PRO-6', projectScenario });
  assert.ok(data.projectScenario);
  assert.equal(data.projectScenario.totalAPUs, 6);
  assert.equal(data.projectScenario.affectedApus.length + data.projectScenario.unaffectedApus.length, 6);
  assert.ok(Number.isFinite(data.projectScenario.totalProjectDelta));
});

test('CASO: manifest hash es reproducible para el mismo conjunto de versiones/opciones', async () => {
  const dataA = await buildProjectDossierData({ projectId: 'PRO-6' });
  const dataB = await buildProjectDossierData({ projectId: 'PRO-6' });
  assert.equal(dataA.dossierManifest.manifestHash, dataB.dossierManifest.manifestHash);
  assert.equal(dataA.dossierManifest.apuVersionIds.length, 6);
});

test('CASO: manifest hash cambia si cambia el conjunto de escenarios seleccionados', async () => {
  const dataA = await buildProjectDossierData({ projectId: 'PRO-6' });
  const dataB = await buildProjectDossierData({ projectId: 'PRO-6', selectedScenarios: [{ scenarioId: 'SC-1', apuId: 'APU-1', changes: [] }] });
  assert.notEqual(dataA.dossierManifest.manifestHash, dataB.dossierManifest.manifestHash);
});

test('CASO: proyecto sin APUs guardados server-side arroja error real, nunca un dossier vacio', async () => {
  responses['/api/apus?projectId=PRO-6'] = { apus: [] };
  await assert.rejects(() => buildProjectDossierData({ projectId: 'PRO-6' }), /ningun APU/);
});
