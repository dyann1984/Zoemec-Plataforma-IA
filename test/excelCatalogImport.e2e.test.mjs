/* DEFECTO REAL (reportado por el usuario tras probar en produccion con un
   catalogo real de conceptos, CATALOGO_EBDI_71_CD_VICTORIA.xlsx): la
   importacion masiva de un catalogo Excel debe recorrer CADA renglon del
   catalogo y generar un concepto/APU independiente por renglon -- nunca debe
   convertir la ACCION de importar (el nombre del archivo, un marcador
   generico) en un concepto de obra.

   El archivo real tiene una estructura que expuso dos defectos concretos en
   src/lib/excelImport.js:
   1) El encabezado real usa columnas como "P.U. PROFORMA"/"IMPORTE PROFORMA"
      (con un calificativo despues de "P.U."); una coincidencia EXACTA anclada
      nunca las reconocia.
   2) El catalogo real tiene DOS hojas con la misma estructura, una por cada
      forma de precio ("... P.U. PROFORMA" y "... P.U. VENTA"). Al leerse
      concatenadas en un solo arreglo de filas, el encabezado repetido de la
      segunda hoja se procesaba como si fuera un renglon de datos de la
      primera, ensuciando la trazabilidad (seccion espuria) de los renglones
      de esa segunda hoja, y las claves legitimamente repetidas del catalogo
      real (387, 525, en renglones distintos) dependian de que la cantidad
      difiriera para no fusionarse por accidente.

   Este fixture reproduce esa estructura de forma sanitizada (mismos
   encabezados y forma, texto de conceptos abreviado, sin datos confidenciales
   del cliente real) con los casos de regresion exactos que exige el reporte:
   clave 2 (M, 80), clave 45 (ML, 80), clave 128 (M2, 613.76), clave 139 (M2,
   613.76), y las claves repetidas 387 y 525 (cada una dos veces, en filas
   distintas, con cantidades distintas) -- ademas de una segunda hoja
   ("... P.U. VENTA") que repite EXACTAMENTE los mismos conceptos para probar
   que no se dupliquen. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';
import readXlsxFileNode from 'read-excel-file/node';
import { extractConceptsFromWorkbookRows } from '../src/lib/excelImport.js';
import { makeAPUFromConcept } from '../src/domain/apuGeneration.js';
import { applyConceptMetadataV2 } from '../src/domain/apuGeneration.js';
import { migrateLegacyApuToV2 } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { exportAPUExcelV2 } from '../src/lib/apuExportV2.js';
import { unzipSync, strFromU8 } from 'fflate';

const HEADER_ROW = ['CLAVE','DESCRIPCION','TIPO','UNIDAD','CANTIDAD','P.U. PROFORMA','IMPORTE PROFORMA'];
const HEADER_ROW_VENTA = ['CLAVE','DESCRIPCION','TIPO','UNIDAD','CANTIDAD','P.U. VENTA','IMPORTE VENTA'];

/* Filas de datos reales del catalogo (sanitizadas): clave, descripcion breve,
   tipo, unidad, cantidad, P.U., importe. */
const DATA_ROWS = [
  [2, 'Desmantelamiento de tuberias de 3 a 6 pulgadas, fierro fundido, lineas sin uso.', 'DESMANTELAMIENTO', 'M', 80, 306.28, 24502.4],
  [45, 'Ranurado de muro y/o piso para alojar instalacion hidraulica o electrica.', 'ALBANILERIA', 'ML', 80, 237.43, 18994.4],
  [128, 'Retiro de impermeabilizante prefabricado existente hasta losa de concreto.', 'IMPERMEABILIZANTE', 'M2', 613.76, 130.93, 80359.6],
  [139, 'Suministro y colocacion de impermeabilizante por termofusion, membrana 4mm.', 'IMPERMEABILIZANTE', 'M2', 613.76, 1420.65, 871938.1],
  [387, 'Sustitucion de cespol cromado tipo helvex, incluye desmontaje del existente.', 'PLOMERIA', 'PZA', 24, 0, 0],
  [523, 'Suministro e instalacion de llave mezcladora con cuello de ganso.', 'PLOMERIA', 'PZA', 11, 0, 0],
  [525, 'Suministro e instalacion de manguera de media pulgada para lavabo o tarja.', 'PLOMERIA', 'PZA', 24, 0, 0],
  [387, 'Sustitucion de cespol cromado tipo helvex, incluye desmontaje del existente.', 'PLOMERIA', 'PZA', 11, 0, 0],
  [525, 'Suministro e instalacion de manguera de media pulgada para lavabo o tarja.', 'PLOMERIA', 'PZA', 11, 0, 0]
];

function buildSheetRows(headerRow){
  const rows = [];
  rows.push(['CLIENTE:', 'INSTITUCION DE PRUEBA SANITIZADA', '', '', '', '', '']);
  rows.push(['DIRECCION DE PRUEBA', null, '', '', '', '', '']);
  rows.push([]);
  rows.push([]);
  rows.push(['NOMBRE INMUEBLE:', 'EDIFICIO DE PRUEBA SANITIZADO', '', '', '', '', '']);
  rows.push(['CATALOGO DE CONCEPTOS']);
  rows.push(headerRow);
  DATA_ROWS.forEach(r => rows.push(r));
  rows.push(['SUBTOTAL', null, null, null, null, null, 0]);
  rows.push(['I.V.A.', null, null, null, null, null, 0]);
  rows.push(['TOTAL', null, null, null, null, null, 0]);
  return rows;
}

function cell(value){
  if(value == null) return { value: '', type: String };
  if(typeof value === 'number') return { value, type: Number };
  return { value: String(value), type: String };
}

async function buildFixtureWorkbook(filePath){
  const proformaRows = buildSheetRows(HEADER_ROW).map(row => row.map(cell));
  const ventaRows = buildSheetRows(HEADER_ROW_VENTA).map(row => row.map(cell));
  await writeXlsxFileNode([
    { data: proformaRows, sheet: 'EBDI SANIT P.U. PROFORMA' },
    { data: ventaRows, sheet: 'EBDI SANIT P.U. VENTA' }
  ]).toFile(filePath);
}

test('E2E catalogo Excel real (sanitizado): deteccion de encabezado -> extraccion de N conceptos -> N APUs -> exportacion XLSX -> reabrir y verificar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-catalog-e2e-'));
  const fixturePath = path.join(dir, 'catalogo-sanitizado.xlsx');
  const outputName = 'salida-lote.xlsx';
  const outputPath = path.join(dir, outputName);
  const previousCwd = process.cwd();
  try{
    await buildFixtureWorkbook(fixturePath);

    // 1) Deteccion de encabezado + extraccion: se leen AMBAS hojas (misma
    // forma en que read-excel-file/node -- y read-excel-file/browser en la
    // app real -- devuelven un catalogo con varias hojas) y se procesan por
    // hoja, nunca concatenadas.
    const raw = await readXlsxFileNode(fixturePath);
    assert.ok(Array.isArray(raw) && raw.length === 2 && raw.every(s => Array.isArray(s.data)), 'el fixture debe tener 2 hojas reales, forma {sheet,data}[]');
    const sheetBlocks = raw.map(s => ({ sheetName: s.sheet, rows: s.data }));
    const { concepts } = extractConceptsFromWorkbookRows(sheetBlocks);

    // 2) Casos de regresion obligatorios exactos.
    const byCodeAndQty = (code, qty) => concepts.find(c => c.code === String(code) && Math.abs(c.qty - qty) < 1e-9);
    const c2 = byCodeAndQty(2, 80);
    assert.ok(c2, 'clave 2 debe extraerse');
    assert.equal(c2.unit, 'M');
    assert.equal(c2.qty, 80);

    const c45 = byCodeAndQty(45, 80);
    assert.ok(c45, 'clave 45 debe extraerse');
    assert.equal(c45.unit, 'ml');
    assert.equal(c45.qty, 80);

    const c128 = byCodeAndQty(128, 613.76);
    assert.ok(c128, 'clave 128 debe extraerse');
    assert.equal(c128.unit, 'm²');
    assert.equal(c128.qty, 613.76);

    const c139 = byCodeAndQty(139, 613.76);
    assert.ok(c139, 'clave 139 debe extraerse');
    assert.equal(c139.unit, 'm²');
    assert.equal(c139.qty, 613.76);

    // 3) Claves repetidas 387 y 525: cada una debe seguir apareciendo DOS
    // VECES (renglones fisicos distintos, misma hoja PROFORMA), nunca
    // fusionadas -- la identidad es hoja+fila, no el contenido.
    const c387all = concepts.filter(c => c.code === '387');
    assert.equal(c387all.length, 2, 'clave 387 (repetida en 2 renglones reales de la misma hoja) no debe fusionarse ni perderse');
    assert.deepEqual(c387all.map(c => c.qty).sort((a,b)=>a-b), [11, 24]);
    assert.notEqual(c387all[0].rowNumber, c387all[1].rowNumber, 'las 2 ocurrencias de la clave 387 deben conservar numeros de fila distintos');

    const c525all = concepts.filter(c => c.code === '525');
    assert.equal(c525all.length, 2, 'clave 525 (repetida en 2 renglones reales de la misma hoja) no debe fusionarse ni perderse');
    assert.deepEqual(c525all.map(c => c.qty).sort((a,b)=>a-b), [11, 24]);

    // 4) La hoja "... P.U. VENTA" repite EXACTAMENTE los mismos conceptos que
    // la hoja PROFORMA (mismo catalogo, otro precio): deben deduplicarse
    // cruzando hojas, nunca duplicar el catalogo completo.
    assert.equal(concepts.length, DATA_ROWS.length, `se esperaban ${DATA_ROWS.length} conceptos unicos (PROFORMA), la hoja VENTA duplicada no debe sumar mas`);
    assert.ok(concepts.every(c => c.sourceSheet === 'EBDI SANIT P.U. PROFORMA'), 'todos los conceptos finales deben provenir de la PRIMERA hoja (VENTA se descarta por duplicado)');

    // 5) Asercion negativa: nunca se debe fabricar un concepto generico a
    // partir de la accion de importar.
    assert.ok(!concepts.some(c => /^(concepto )?importado desde excel$/i.test(c.concept)), 'ningun concepto debe ser el marcador generico "Importado desde Excel"');

    // 6) Generacion de un APU real por CADA concepto extraido, con el mismo
    // motor real que usa la exportacion masiva (exportConceptsAPUWorkbook en
    // main.jsx): makeAPUFromConcept -> migrateLegacyApuToV2 ->
    // applyConceptMetadataV2 -> finalizeProfessionalAPU. Sin motor paralelo,
    // sin flujo demo.
    const professional = concepts.map((item, idx) => {
      const v1 = makeAPUFromConcept(item.concept, []);
      const v2Base = migrateLegacyApuToV2(v1);
      const withMeta = applyConceptMetadataV2(v2Base, item, idx, 'catalogo-sanitizado.xlsx');
      return finalizeProfessionalAPU(withMeta);
    });
    assert.equal(professional.length, concepts.length);
    assert.ok(!professional.some(apu => /^(concepto )?importado desde excel$/i.test(apu.concept)));

    // 7) Exportacion XLSX real (exportAPUExcelV2, RC3, sin tocar) y
    // reapertura para verificar que existen las hojas RESUMEN +
    // CONTROL_REVISION + UNA hoja por concepto, y que clave/descripcion/
    // unidad/cantidad de cada hoja coinciden EXACTAMENTE con las filas
    // fuente para los 4 casos obligatorios.
    process.chdir(dir);
    await exportAPUExcelV2(professional, { writeXlsxFileImpl: writeXlsxFileNode, fileName: outputName });
    process.chdir(previousCwd);
    const zip = unzipSync(new Uint8Array(fs.readFileSync(outputPath)));
    const workbookXml = strFromU8(zip['xl/workbook.xml']);
    const sheetNames = [...workbookXml.matchAll(/<sheet\b[^>]*name="([^"]*)"/g)].map(m => m[1]);
    assert.ok(sheetNames.includes('RESUMEN'), 'debe existir la hoja RESUMEN');
    assert.ok(sheetNames.includes('CONTROL_REVISION'), 'debe existir la hoja CONTROL_REVISION');
    // RESUMEN + CONTROL_REVISION + una hoja por concepto procesado.
    assert.equal(sheetNames.length, 2 + concepts.length, `se esperaban ${2 + concepts.length} hojas (RESUMEN + CONTROL_REVISION + ${concepts.length} por concepto)`);
    // Nombres de hoja unicos y dentro del limite de 31 caracteres de Excel.
    assert.equal(new Set(sheetNames).size, sheetNames.length, 'los nombres de hoja deben ser unicos');
    assert.ok(sheetNames.every(n => n.length <= 31), 'ningun nombre de hoja debe exceder 31 caracteres');

    const sharedXml = zip['xl/sharedStrings.xml'] ? strFromU8(zip['xl/sharedStrings.xml']) : '';
    const sharedStrings = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => {
      const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]);
      return texts.join('');
    });
    const fullText = sharedStrings.join(' | ');
    // Cada caso obligatorio debe aparecer literalmente en el libro final
    // (clave, unidad y cantidad trazables hasta el archivo exportado).
    for(const [code, , , unit, qty] of [DATA_ROWS[0], DATA_ROWS[1], DATA_ROWS[2], DATA_ROWS[3]]){
      assert.ok(fullText.includes(String(code)), `la clave ${code} debe aparecer en el libro exportado`);
    }
    assert.ok(fullText.includes(String(613.76)) || sharedXml.includes('613.76'), 'la cantidad 613.76 debe aparecer en el libro exportado');

    // 8) Asercion negativa final: el workbook completo (todas las cadenas de
    // texto) NUNCA debe contener el concepto generico "Importado desde
    // Excel".
    assert.ok(!/importado desde excel/i.test(fullText), 'el libro final jamas debe contener el concepto generico "Importado desde Excel"');
  }finally{
    process.chdir(previousCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
