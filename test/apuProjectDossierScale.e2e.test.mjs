/* Fase 8.1 -- cierre del gap "proyecto grande" documentado en el reporte de
   Fase 8 Parte 2: el Dossier de Proyecto (PDF/XLSX) nunca se habia probado
   con mas de 6 APUs. Mismo criterio de mock de fetch que
   test/apuProjectDossier.xlsx.integration.test.mjs/
   test/apuProjectDossier.pdf.integration.test.mjs (mockea la capa HTTP con
   las MISMAS formas de respuesta reales -- la QA de aplicacion completa
   contra el emulador real cubre el flujo de UI). Foco: N APUs de entrada ->
   N hojas de concepto, sin fusion/perdida/duplicado, sin NaN/Infinity, sin
   timeout, sin crash, a escala real (50 APUs). */
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
import { exportProjectDossierPdf } from '../src/lib/apuProjectDossierPdf.js';

const DISCIPLINES = Object.keys(SYSTEM_RESOURCES);
const N = 50;

function apuFor(id, concept, disciplina){
  const a = makeEmptyAPUv2();
  const [descripcion, cantidadPorUnidad, , salarioBase, fsr] = SYSTEM_RESOURCES.tablaroca.labor[0];
  const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'Proveedor de prueba', fecha: '2026-01-01' };
  Object.assign(a, {
    id, clave: id, concept, unit: 'm²', cantidadObra: 100 + Number(id.replace(/\D/g, '')),
    proyecto: 'Proyecto Grande Fase 8.1', cliente: 'Cliente Escala Test',
    primaryActivity: disciplina, version: 'V1'
  });
  a.materials = [{ clave: 'MAT-1', descripcion: `Insumo de ${disciplina}`, unidad: 'pza', consumo: 2, desperdicioPct: 5, precioUnitario: 100 + Number(id.replace(/\D/g, '')), fuente }];
  a.labor = [{ clave: 'MO-1', descripcion, cuadrilla: 1, rendimiento: 1 / cantidadPorUnidad, jornada: 8, salarioBase, fsr, fuente, rendimientoFuente: 'PLANTILLA' }];
  return finalizeProfessionalAPU(a);
}

function bigApuDocs(count){
  return Array.from({ length: count }, (_, i) => {
    const id = `APU-${String(i + 1).padStart(3, '0')}`;
    const disciplina = DISCIPLINES[i % DISCIPLINES.length];
    const concept = `Concepto ${i + 1} -- ${disciplina}`;
    const snapshot = apuFor(id, concept, disciplina);
    return { id, ownerUid: 'uid-test', projectId: 'PRO-BIG', currentVersion: 'V1', snapshot, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
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
    '/api/projects?id=PRO-BIG': { project: { id: 'PRO-BIG', name: 'Proyecto Grande Fase 8.1', client: 'Cliente Escala Test' } },
    '/api/apus?projectId=PRO-BIG': { apus: bigApuDocs(N) },
    '/api/challenge-decisions': { decisions: [] },
    '/api/technical-memory': { entries: [] },
    '/api/export-events': { event: {} }
  };
});

function assertFiniteDeep(value, pathLabel){
  if(typeof value === 'number'){
    assert.ok(Number.isFinite(value), `${pathLabel} no es finito (NaN/Infinity): ${value}`);
  }
}

test(`CASO ESCALA: proyecto con ${N} APUs -> XLSX genera exactamente ${N} hojas de concepto, sin fusion/perdida/duplicado, sin NaN/Infinity, sin crash`, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-project-dossier-scale-xlsx-'));
  const before_ = process.cwd();
  process.chdir(dir);
  try{
    const t0 = Date.now();
    const { sheets, data } = await exportProjectDossierExcel({ projectId: 'PRO-BIG', writeXlsxFileImpl: writeXlsxFileNode, fileName: 'grande.xlsx' });
    const elapsedMs = Date.now() - t0;

    assert.equal(data.apuEntries.length, N, 'el dossier no proceso los N APUs de entrada');

    const generalSheetNames = new Set(['PORTADA', 'RESUMEN PROYECTO', 'RANKING RIESGO', 'AUDITORIA GLOBAL', 'CHALLENGE GLOBAL', 'CONFIDENCE', 'BID RISK', 'HISTORIAL Y VERSIONES', 'ESCENARIOS']);
    const conceptSheets = sheets.filter(s => !generalSheetNames.has(s.sheet));
    assert.equal(conceptSheets.length, N, `se esperaban ${N} hojas de concepto, hubo ${conceptSheets.length}`);

    const sheetNames = conceptSheets.map(s => s.sheet);
    assert.equal(new Set(sheetNames).size, sheetNames.length, 'hay nombres de hoja de concepto duplicados (colision sin desambiguar)');

    const inputIds = data.apuEntries.map(e => e.apuId);
    assert.equal(new Set(inputIds).size, N, 'hay apuId duplicados en la entrada procesada -- perdida/fusion real');

    for(const entry of data.apuEntries){
      assertFiniteDeep(entry.pu, `${entry.apuId}.pu`);
      assertFiniteDeep(entry.importeTotal, `${entry.apuId}.importeTotal`);
      assertFiniteDeep(entry.confidence?.score, `${entry.apuId}.confidence.score`);
      assertFiniteDeep(entry.bidRisk?.estimatedExposure, `${entry.apuId}.bidRisk.estimatedExposure`);
    }
    assertFiniteDeep(data.importeProyectoTotal, 'importeProyectoTotal');
    assert.ok(fs.statSync('grande.xlsx').size > 500);

    const zip = unzipSync(fs.readFileSync('grande.xlsx'));
    const wbXml = strFromU8(zip['xl/workbook.xml']);
    const zipSheetNames = [...wbXml.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map(m => m[1]);
    assert.equal(zipSheetNames.length, sheets.length, 'el XLSX real desempacado no tiene el mismo numero de hojas que reporto la funcion');
    assert.equal(new Set(zipSheetNames).size, zipSheetNames.length, 'el XLSX real tiene nombres de hoja duplicados en el archivo desempacado');

    console.log(`[ESCALA XLSX] ${N} APUs -> ${sheets.length} hojas totales (${conceptSheets.length} de concepto) en ${elapsedMs}ms`);
    assert.ok(elapsedMs < 30000, `generacion tardo ${elapsedMs}ms, excede un limite razonable de 30s`);
  }finally{ process.chdir(before_); fs.rmSync(dir, { recursive: true, force: true }); }
});

test(`CASO ESCALA: proyecto con ${N} APUs -> PDF genera 1 seccion de detalle por APU, sin NaN/Infinity, sin crash`, async () => {
  const t0 = Date.now();
  const { doc, data } = await exportProjectDossierPdf({ projectId: 'PRO-BIG', save: false });
  const elapsedMs = Date.now() - t0;

  assert.equal(data.apuEntries.length, N, 'el dossier no proceso los N APUs de entrada');
  const inputIds = data.apuEntries.map(e => e.apuId);
  assert.equal(new Set(inputIds).size, N, 'hay apuId duplicados en la entrada procesada -- perdida/fusion real');
  for(const entry of data.apuEntries) assertFiniteDeep(entry.pu, `${entry.apuId}.pu`);
  assertFiniteDeep(data.importeProyectoTotal, 'importeProyectoTotal');

  const totalPages = doc.internal.getNumberOfPages();
  assert.ok(totalPages > N, `se esperaban mas de ${N} paginas (1 portada de detalle + matriz por APU + secciones), hubo ${totalPages}`);

  const rawText = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  for(const entry of data.apuEntries.slice(0, 5)){
    assert.ok(rawText.includes(entry.apuId) || rawText.includes(entry.concept.slice(0, 15)), `no aparece rastro del APU ${entry.apuId} en el texto crudo del PDF`);
  }
  assert.ok(rawText.includes(`Pagina ${totalPages} de ${totalPages}`), 'el pie de pagina final no coincide con el total real de paginas');

  console.log(`[ESCALA PDF] ${N} APUs -> ${totalPages} paginas en ${elapsedMs}ms`);
  assert.ok(elapsedMs < 30000, `generacion tardo ${elapsedMs}ms, excede un limite razonable de 30s`);
});
