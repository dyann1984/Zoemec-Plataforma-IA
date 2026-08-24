/* Prueba de escala (validacion de release, RC5): el segmentador de texto
   pegado (parseConceptListText) y el pipeline completo que arma sobre el
   deben sostener catalogos grandes, no solo el caso de 6 conceptos del
   reporte original. Corre con 25 y 100 renglones sinteticos (mezcla de
   familias tecnicas reales, algunos con distancia/piezas/dimensiones para
   seguir ejercitando las variables estructuradas) a traves del MISMO
   pipeline de produccion: parseConceptListText -> makeAPUFromConcept ->
   migrateLegacyApuToV2 -> applyConceptMetadataV2 -> finalizeProfessionalAPU
   -> exportAPUExcelV2, y verifica el invariante obligatorio
   inputConceptCount === generatedAPUCount, ademas de: ningun concepto
   perdido/fusionado, ninguna hoja duplicada, exportacion XLSX sin error. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';
import { unzipSync, strFromU8 } from 'fflate';
import { parseConceptListText } from '../src/lib/excelImport.js';
import { makeAPUFromConcept, applyConceptMetadataV2 } from '../src/domain/apuGeneration.js';
import { migrateLegacyApuToV2 } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { exportAPUExcelV2 } from '../src/lib/apuExportV2.js';

const TEMPLATES = [
  n => `Movimiento de mueble en area ${n}`,
  n => `Demolicion de loseta ${n}m2`,
  n => `Acarreo ${n} costales distancia 25m`,
  n => `Acarreo de loseta 1.5m3 distancia ${n}m`,
  n => `Aplicacion de adhesivo ${n}m2`,
  n => `Colocacion de loseta ${n}m2`,
  n => `Suministro y colocacion de muro de block hueco de 15 x 20 x 40 cm, area ${n}m2`,
  n => `Aplanado fino en muros, ${n}m2`,
  n => `Excavacion manual, ${n}m3`,
  n => `Suministro y aplicacion de pintura vinilica en muros, ${n}m2`
];
function buildConceptLines(count){
  return Array.from({ length: count }, (_, i) => `${i + 1}-${TEMPLATES[i % TEMPLATES.length](i + 1)}`).join('\n');
}

async function runScaleCase(count){
  const text = buildConceptLines(count);
  const { concepts } = parseConceptListText(text);
  assert.equal(concepts.length, count, `inputConceptCount(${count}) === segmentedConceptCount(${concepts.length})`);
  // Sin duplicados de contenido: cada linea sintetica es unica por construccion,
  // asi que cada concepto segmentado tambien debe serlo (ninguna fusion).
  assert.equal(new Set(concepts.map(c => c.concept)).size, count, 'ningun concepto debe fusionarse ni perderse su texto propio');

  const professional = concepts.map((item, idx) => {
    const v1 = makeAPUFromConcept(item.concept, []);
    const v2Base = migrateLegacyApuToV2(v1);
    const withMeta = applyConceptMetadataV2(v2Base, item, idx, `catalogo-texto-${count}.txt`);
    return finalizeProfessionalAPU(withMeta);
  });
  assert.equal(professional.length, count, 'inputConceptCount === generatedAPUCount');
  assert.equal(new Set(professional.map(a => a.id)).size, count, 'cada APU debe tener id propio trazable');
  assert.equal(new Set(professional.map(a => a.clave)).size, count, 'cada APU debe tener clave propia (ninguna colision)');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zoemec-scale-${count}-`));
  const outputName = `escala-${count}.xlsx`;
  const previousCwd = process.cwd();
  try{
    process.chdir(dir);
    await exportAPUExcelV2(professional, { writeXlsxFileImpl: writeXlsxFileNode, fileName: outputName });
    process.chdir(previousCwd);
    const outputPath = path.join(dir, outputName);
    assert.ok(fs.statSync(outputPath).size > 1000, 'el XLSX exportado no debe estar vacio/corrupto');
    const zip = unzipSync(new Uint8Array(fs.readFileSync(outputPath)));
    const workbookXml = strFromU8(zip['xl/workbook.xml']);
    const sheetNames = [...workbookXml.matchAll(/<sheet\b[^>]*name="([^"]*)"/g)].map(m => m[1]);
    assert.equal(sheetNames.length, count + 2, `se esperaban ${count + 2} hojas (RESUMEN + CONTROL_REVISION + ${count}), hubo ${sheetNames.length}`);
    assert.equal(new Set(sheetNames).size, sheetNames.length, 'ninguna hoja duplicada');
    assert.ok(sheetNames.includes('RESUMEN') && sheetNames.includes('CONTROL_REVISION'));
    // Ninguna hoja de worksheet debe faltar/estar vacia en el zip real.
    const sheetFiles = Object.keys(zip).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
    assert.equal(sheetFiles.length, sheetNames.length, 'debe existir un archivo de hoja real por cada nombre declarado');
    sheetFiles.forEach(f => assert.ok(zip[f].length > 0, `hoja vacia en el zip: ${f}`));
  }finally{
    process.chdir(previousCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return professional;
}

test('Escala 25 conceptos: segmentacion -> 25 APUs -> 27 hojas, sin fusion/perdida/duplicado', async () => {
  const start = Date.now();
  await runScaleCase(25);
  assert.ok(Date.now() - start < 15000, 'no deberia tardar mas de 15s (sin llamadas de red en este pipeline determinista)');
});

test('Escala 100 conceptos: segmentacion -> 100 APUs -> 102 hojas, sin fusion/perdida/duplicado, sin timeout', async () => {
  const start = Date.now();
  await runScaleCase(100);
  assert.ok(Date.now() - start < 30000, 'no deberia tardar mas de 30s (sin llamadas de red en este pipeline determinista)');
});
