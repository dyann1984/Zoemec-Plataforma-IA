/* DEFECTO REAL reportado por el usuario: al pegar 6 conceptos de obra (uno
   por renglon, numerados "1-".."6-") en el panel "Generar APU desde un
   concepto" (textarea de texto libre, no un archivo Excel), ZOEMEC los
   fusionaba en UN SOLO concepto/APU generico parecido a "colocacion de
   loseta". Causa raiz: src/main.jsx#generate / generateAI mandaban el
   textarea COMPLETO a parseConceptText (disenado para UN concepto) sin
   ningun paso de segmentacion previo -- a diferencia del camino de Excel
   (extractConceptsFromWorkbookRows), que si separa fila por fila.

   Esta prueba corre el MISMO texto exacto del reporte a traves del pipeline
   real de produccion: parseConceptListText (segmentador nuevo) ->
   makeAPUFromConcept (motor de clasificacion real, src/domain/
   apuGeneration.js) -> migrateLegacyApuToV2 -> applyConceptMetadataV2 ->
   finalizeProfessionalAPU -> exportAPUExcelV2, y verifica programaticamente
   la salida: 6 conceptos de entrada -> 6 APUs -> 8 hojas en el XLSX
   (RESUMEN + CONTROL_REVISION + 6), sin fusion ni contaminacion cruzada de
   materiales entre conceptos. */
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

const REAL_CASE_TEXT = [
  '1-Movimiento de mueble',
  '2-demolicion de loseta 64m2',
  '3-acarreo 46 costales distancia 25m',
  '4-acarreo de loseta 1.5m3 distancia 25m',
  '5-aplicación de adhesivo 64m2',
  '6-colocación de loseta 64m2'
].join('\n');

test('E2E caso real de 6 conceptos pegados como texto: segmentacion -> 6 APUs independientes -> 9 hojas XLSX, sin fusion ni contaminacion', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-textbatch-e2e-'));
  const outputName = 'salida-lote-texto.xlsx';
  const outputPath = path.join(dir, outputName);
  const previousCwd = process.cwd();
  try{
    // 1) Segmentacion determinista del texto pegado: 6 renglones -> 6 conceptos.
    const { concepts } = parseConceptListText(REAL_CASE_TEXT);
    assert.equal(concepts.length, 6, 'el bloque de 6 renglones debe segmentarse en 6 conceptos, nunca 1');
    // RC5: la descripcion original NUNCA se recorta (Test M) -- cada
    // concepto conserva el texto completo tal como se pego, incluida
    // cualquier distancia/volumen que venga despues de la unidad detectada.
    assert.deepEqual(concepts.map(c => c.concept), [
      'Movimiento de mueble',
      'demolicion de loseta 64m2',
      'acarreo 46 costales distancia 25m',
      'acarreo de loseta 1.5m3 distancia 25m',
      'aplicación de adhesivo 64m2',
      'colocación de loseta 64m2'
    ]);
    assert.equal(concepts[1].qty, 64); assert.equal(concepts[1].unit, 'm²');
    assert.equal(concepts[2].qty, 46); assert.equal(concepts[2].unit, 'costal');
    assert.equal(concepts[3].qty, 1.5); assert.equal(concepts[3].unit, 'm³'); assert.equal(concepts[3].referencePU, 0);

    // Variables estructuradas (RC5, Tests N/O): nunca sustituyen unit/qty,
    // solo agregan tipado adicional cuando es detectable.
    assert.equal(concepts[2].variables.pieceCount, 46);
    assert.equal(concepts[2].variables.pieceUnit, 'costal');
    assert.equal(concepts[2].variables.distance, 25);
    assert.equal(concepts[3].variables.volume, 1.5);
    assert.equal(concepts[3].variables.volumeUnit, 'm³');
    assert.equal(concepts[3].variables.distance, 25);
    assert.equal(concepts[4].qty, 64); assert.equal(concepts[4].unit, 'm²');
    assert.equal(concepts[5].qty, 64); assert.equal(concepts[5].unit, 'm²');

    // 2) Motor real: un APU completo POR concepto, nunca uno solo para todo el bloque.
    const professional = concepts.map((item, idx) => {
      const v1 = makeAPUFromConcept(item.concept, []);
      const v2Base = migrateLegacyApuToV2(v1);
      const withMeta = applyConceptMetadataV2(v2Base, item, idx, 'Texto pegado');
      return finalizeProfessionalAPU(withMeta);
    });
    assert.equal(professional.length, 6, 'inputConceptCount === generatedAPUCount');

    // 3) Trazabilidad: cada APU conserva un id/clave propio y su concepto
    // original -- ningun concepto desaparece ni se fusiona silenciosamente.
    const ids = new Set(professional.map(a => a.id));
    assert.equal(ids.size, 6, 'cada APU debe tener un id propio, trazable');
    assert.deepEqual(professional.map(a => a.concept), concepts.map(c => c.concept));

    // 4) Sin contaminacion cruzada: el material "loseta" (colocacion) solo
    // debe aparecer en el ultimo APU (colocacion real); demolicion, los dos
    // acarreos, el movimiento de mobiliario y la aplicacion de adhesivo
    // aislada NUNCA deben traerlo.
    const materialText = (apu) => (apu.materials || []).map(r => String(r.descripcion || '').toLowerCase()).join(' | ');
    const [movimiento, demolicion, acarreoCostales, acarreoLoseta, adhesivo, colocacion] = professional;
    for (const apu of [movimiento, demolicion, acarreoCostales, acarreoLoseta, adhesivo]) {
      assert.ok(!materialText(apu).includes('loseta'), `contaminacion cruzada detectada en "${apu.concept}": ${materialText(apu)}`);
    }
    assert.ok(materialText(colocacion).includes('loseta'), 'el APU de colocacion si debe incluir loseta');

    // 5) Exportacion XLSX real y reapertura: RESUMEN + CONTROL_REVISION + 6
    // hojas de concepto -- nunca una sola hoja con los 6 concatenados.
    process.chdir(dir);
    await exportAPUExcelV2(professional, { writeXlsxFileImpl: writeXlsxFileNode, fileName: outputName });
    process.chdir(previousCwd);
    const zip = unzipSync(new Uint8Array(fs.readFileSync(outputPath)));
    const workbookXml = strFromU8(zip['xl/workbook.xml']);
    const sheetNames = [...workbookXml.matchAll(/<sheet\b[^>]*name="([^"]*)"/g)].map(m => m[1]);
    assert.ok(sheetNames.includes('RESUMEN'));
    assert.ok(sheetNames.includes('CONTROL_REVISION'));
    assert.equal(sheetNames.length, 4 + 6, `se esperaban 10 hojas (PORTADA + RESUMEN + CONTROL_REVISION + PARAMETROS + 6 conceptos), hubo ${sheetNames.length}: ${sheetNames.join(', ')}`);
    assert.equal(new Set(sheetNames).size, sheetNames.length, 'los nombres de hoja deben ser unicos');

    // 6) Test R: el XLSX exportado conserva la descripcion COMPLETA (incluida
    // la distancia) y muestra las variables detectadas como parametros
    // legibles -- nunca solo el numero limpio sin contexto.
    const sharedXml = zip['xl/sharedStrings.xml'] ? strFromU8(zip['xl/sharedStrings.xml']) : '';
    const sharedStrings = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => {
      const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]);
      return texts.join('');
    });
    const fullText = sharedStrings.join(' | ').toLowerCase();
    assert.ok(fullText.includes('distancia 25m'), 'la descripcion completa (con la distancia) debe aparecer literal en el libro exportado');
    assert.ok(fullText.includes('variables detectadas'), 'debe existir la seccion de variables detectadas en al menos una hoja');
    assert.ok(fullText.includes('distancia: 25 m'), 'la variable de distancia estructurada debe mostrarse legible en el libro');
    assert.ok(fullText.includes('piezas: 46') || fullText.includes('piezas: 46 costal'), 'la variable de pieceCount (46 costales) debe mostrarse');
    assert.ok(fullText.includes('volumen: 1.5'), 'la variable de volumen (1.5 m³) debe mostrarse');
  }finally{
    process.chdir(previousCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
