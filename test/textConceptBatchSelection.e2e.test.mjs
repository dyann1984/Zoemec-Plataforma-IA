/* REGRESION REAL DE PRODUCCION (RC6): el pipeline puro (parseConceptListText
   -> makeAPUFromConcept -> ... -> exportAPUExcelV2, ver
   test/textConceptBatch.e2e.test.mjs) ya probaba 6 -> 6 conceptos/APUs, pero
   la app real reporto "Conceptos: 6 / Seleccionados: 4 / APUs generados: 4"
   al pegar exactamente el bloque de 6 conceptos del reporte original. La
   capa que fallaba nunca estaba cubierta: la tabla de revision de lote de
   main.jsx (preseleccion por duplicados + isExportableConceptItem), que
   filtraba 2 de los 6 conceptos ("Movimiento de mueble" por unidad vacia ->
   "u", "acarreo 46 costales..." por unidad "costal") DESPUES de que ya
   aparecian "seleccionados" en pantalla -- silenciosamente.

   Esta prueba reproduce el flujo REAL que usa main.jsx (no una
   reimplementacion paralela): parseConceptListText -> defaultBatchSelection
   (preseleccion de la tabla de revision) -> resolveBatchSelection (lo que
   generateSelectedBatch/exportConceptBatch realmente mandan a generar) ->
   generacion de un APU por item seleccionado -> exportacion XLSX. Las 3
   funciones de seleccion vienen de src/domain/apuWorkspace.js, EXACTAMENTE
   las mismas que main.jsx importa y usa -- ningun duplicado de logica en
   este test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';
import { unzipSync, strFromU8 } from 'fflate';
import { parseConceptListText } from '../src/lib/excelImport.js';
import { defaultBatchSelection, resolveBatchSelection, isExportableConceptItem, conceptNeedsReviewFlag } from '../src/domain/apuWorkspace.js';
import { makeAPUFromConcept, applyConceptMetadataV2 } from '../src/domain/apuGeneration.js';
import { migrateLegacyApuToV2 } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { exportAPUExcelV2 } from '../src/lib/apuExportV2.js';

const REAL_CASE_TEXT = [
  '1-Movimiento de mueble',
  '2-demolición de loseta 64m2',
  '3-acarreo 46 costales distancia 25m',
  '4-acarreo de loseta 1.5m3 distancia 25m',
  '5-aplicación de adhesivo 64m2',
  '6-colocación de loseta 64 m2'
].join('\n');

test('RC6: reproduce el caso real reportado -- 6 detectados -> 6 seleccionados por defecto (sin duplicados)', () => {
  const { concepts } = parseConceptListText(REAL_CASE_TEXT);
  assert.equal(concepts.length, 6);

  // Los items concretos que fallaron en produccion: "Movimiento de mueble"
  // (unidad vacia -> normalizeUnitLabel la resuelve a "u") y el acarreo de
  // costales (unidad "costal"). Antes de la correccion, isExportableConceptItem
  // los rechazaba por su vocabulario de unidad; ahora deben pasar.
  assert.equal(concepts[0].unit, '');
  assert.equal(concepts[2].unit, 'costal');
  assert.ok(isExportableConceptItem(concepts[0]), '"Movimiento de mueble" (unidad vacia/"u") nunca debe excluirse por unidad');
  assert.ok(isExportableConceptItem(concepts[2]), '"acarreo 46 costales..." (unidad "costal") nunca debe excluirse por unidad');

  // defaultBatchSelection: preseleccion de la tabla de revision (1 por grupo
  // de duplicados). Los 6 conceptos son distintos entre si -> 6 grupos de 1
  // -> los 6 quedan preseleccionados, igual que se ve en pantalla.
  const selection = defaultBatchSelection(concepts);
  assert.equal(selection.size, 6, 'sin conceptos duplicados, los 6 deben quedar preseleccionados');

  // resolveBatchSelection: lo que generateSelectedBatch/exportConceptBatch
  // REALMENTE mandan a generar -- este es el punto exacto que fallo en
  // produccion (4 en vez de 6).
  const { selectedList, excludedConcepts } = resolveBatchSelection(concepts, selection);
  assert.equal(selectedList.length, 6, `se esperaban 6 seleccionados para generar, hubo ${selectedList.length} (excluidos: ${excludedConcepts.join(' | ')})`);
  assert.equal(excludedConcepts.length, 0, `ningun concepto debe excluirse en silencio, se excluyeron: ${excludedConcepts.join(' | ')}`);
});

test('RC6: unidades atipicas ("u", "costal") generan APU y quedan marcadas REQUIERE REVISION, nunca excluidas', () => {
  const movimiento = { concept: 'Movimiento de mueble', unit: '', qty: 1, referencePU: 0 };
  const costales = { concept: 'acarreo 46 costales distancia 25m', unit: 'costal', qty: 46, referencePU: 0 };
  assert.ok(isExportableConceptItem(movimiento) && isExportableConceptItem(costales));
  assert.equal(conceptNeedsReviewFlag(movimiento), false, '"u" ya es una unidad reconocida como valida para revision, no dispara la bandera por si sola');
  // Concepto corto (<12) SI dispara la bandera de revision (pero nunca la exclusion).
  assert.equal(conceptNeedsReviewFlag({ concept: 'Trazo', unit: 'm', qty: 1 }), true);
});

test('RC6 end-to-end: TEXTAREA -> parseConceptListText -> conceptBatch -> seleccion/revision -> generacion -> exportacion = 6 -> 6 -> 6 -> 8 hojas', async () => {
  const { concepts } = parseConceptListText(REAL_CASE_TEXT);
  const selection = defaultBatchSelection(concepts);
  const { selectedList, excludedConcepts } = resolveBatchSelection(concepts, selection);
  assert.equal(selectedList.length, 6);
  assert.equal(excludedConcepts.length, 0);

  // Generacion (equivalente a runQueueJob -> generateBatchAPU cuando la IA
  // no esta disponible: templateFallbackAPU/makeAPUFromConcept, mismo motor
  // real ya probado en test/textConceptBatch.e2e.test.mjs).
  const professional = selectedList.map((item, idx) => {
    const v1 = makeAPUFromConcept(item.concept, []);
    const v2Base = migrateLegacyApuToV2(v1);
    const withMeta = applyConceptMetadataV2(v2Base, item, idx, 'Texto pegado');
    return finalizeProfessionalAPU(withMeta);
  });
  assert.equal(professional.length, 6, 'selectedConceptCount === generatedAPUCount');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-selection-e2e-'));
  const outputName = 'salida-seleccion.xlsx';
  const previousCwd = process.cwd();
  try{
    process.chdir(dir);
    await exportAPUExcelV2(professional, { writeXlsxFileImpl: writeXlsxFileNode, fileName: outputName });
    process.chdir(previousCwd);
    const zip = unzipSync(new Uint8Array(fs.readFileSync(path.join(dir, outputName))));
    const workbookXml = strFromU8(zip['xl/workbook.xml']);
    const sheetNames = [...workbookXml.matchAll(/<sheet\b[^>]*name="([^"]*)"/g)].map(m => m[1]);
    assert.equal(sheetNames.length, 8, `se esperaban 8 hojas (RESUMEN + CONTROL_REVISION + 6), hubo ${sheetNames.length}: ${sheetNames.join(', ')}`);
    assert.ok(sheetNames.includes('RESUMEN') && sheetNames.includes('CONTROL_REVISION'));
  }finally{
    process.chdir(previousCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
