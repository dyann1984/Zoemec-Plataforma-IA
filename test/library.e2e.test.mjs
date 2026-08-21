/* E2E real (sin mocks de red/Firebase) de la cadena de valor de Biblioteca
   RC4, de punta a punta a traves de codigo real, no simulado:

   EXTRAER (xlsx real) -> REVISAR (PROPUESTO/RECHAZADO/VALIDADO) ->
   VALIDAR -> BUSCAR MATRIZ SIMILAR -> fusionar con catalogo real
   (matchPrice, el UNICO motor de matching, sin duplicarlo) -> MOTOR APU v2
   real (calcAPUv2) -> exportadores RC3 reales (XLSX/PDF), con el precio
   validado visible en el archivo exportado.

   La unica pieza que este test NO puede ejercer sin credenciales reales es
   el salto de red hacia Google Drive/Firebase (ya cubierto por separado:
   decideImportMode, buildDriveBreadcrumb con mocks de fetch no aplica aqui
   por diseno -- no se mockea Drive, se prueba con datos ya extraidos). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';
import { extractExcelInsumos } from '../server/api-lib/_libraryExtract.mjs';
import { searchLibrary, findSimilarMatrices } from '../server/api-lib/_librarySearch.mjs';
import { applyInsumoReview, extractValidatedCatalogRows, INSUMO_STATES } from '../src/domain/libraryReview.js';
import { matchPrice } from '../src/lib/excelImport.js';
import { makeEmptyAPUv2, APU_DATA_STATE } from '../src/domain/apuSchema.js';
import { calcAPUv2 } from '../src/lib/apuCalc.js';
import { exportAPUExcelV2, exportAPUPdfV2 } from '../src/lib/apuExportV2.js';

async function buildFasarLikeXlsxBuffer(){
  const rows = [
    ['Clave', 'Descripcion', 'Unidad', 'Precio'],
    ['MO-FASAR-001', 'Cuadrilla de albaniles para muro de block hueco', 'jor', 620.5],
    ['MAT-FASAR-002', 'Cemento portland tipo I bolsa 50 kg', 'bulto', 180]
  ];
  const data = rows.map(row => row.map(cell => ({ value: cell })));
  const writer = await writeXlsxFileNode(data);
  return writer.toBuffer();
}

test('E2E Biblioteca: Drive/Excel -> extraer -> revisar -> validar -> matriz similar -> catalogo real -> APU v2 -> XLSX/PDF', async () => {
  // 1) IMPORTAR + EXTRAER (contenido real, xlsx real, sin inventar datos)
  const buffer = await buildFasarLikeXlsxBuffer();
  const extraction = await extractExcelInsumos(buffer);
  assert.equal(extraction.status, 'done');
  assert.equal(extraction.contentInsumos.length, 2);

  const libraryDoc = {
    id: 'LIB-FASAR-E2E',
    name: 'FASAR OPUS.xlsx',
    cat: 'Costos',
    family: 'Bases tecnicas (OPUS/NEODATA)',
    source: 'google-drive',
    status: 'Subido e indexado',
    driveParentPath: ['06 - FASAR OPUS'],
    contentInsumos: extraction.contentInsumos,
    insumosReview: extraction.contentInsumos.map((_, index) => ({ index, state: INSUMO_STATES.PROPUESTO, validatedBy: null, validatedAt: null }))
  };

  // 2) REVISION HUMANA: un insumo se VALIDA, el otro se RECHAZA -- ninguno
  // llega al catalogo/APU sin pasar por aqui explicitamente.
  const validatorId = 'diana@zoemec.com';
  libraryDoc.insumosReview[0] = applyInsumoReview(libraryDoc.insumosReview[0], { state: INSUMO_STATES.VALIDADO, validatedBy: validatorId });
  libraryDoc.insumosReview[1] = applyInsumoReview(libraryDoc.insumosReview[1], { state: INSUMO_STATES.RECHAZADO, validatedBy: validatorId });

  // 3) BUSCAR MATRIZ SIMILAR (evidencia explicable, no un score opaco)
  const otherDocs = [
    { id: 'OTHER-1', name: 'Muro de block hueco 15cm.xlsx', cat: 'Matrices APU', contentInsumos: [] }
  ];
  const similar = findSimilarMatrices([libraryDoc, ...otherDocs], { name: 'Muro de block hueco 20cm', concept: 'muro de block hueco', contentInsumos: [] });
  assert.ok(similar.some(r => r.id === 'OTHER-1'), 'debe encontrar la matriz relacionada por termino compartido "block hueco"');
  assert.ok(similar[0].matchedTerms.length > 0, 'la coincidencia debe ser explicable con terminos, no un numero opaco');

  // Busqueda por contenido tambien debe encontrar el documento por el insumo VALIDADO
  const searchResults = searchLibrary([libraryDoc], 'cuadrilla albaniles muro');
  assert.ok(searchResults.length >= 1);
  assert.equal(searchResults[0].id, 'LIB-FASAR-E2E');

  // 4) PUENTE Biblioteca -> catalogo: SOLO el insumo VALIDADO pasa
  const catalogRows = extractValidatedCatalogRows(libraryDoc);
  assert.equal(catalogRows.length, 1, 'el insumo RECHAZADO nunca debe llegar al catalogo');
  assert.equal(catalogRows[0].desc, 'Cuadrilla de albaniles para muro de block hueco');
  assert.equal(catalogRows[0].traceability.sourceDocName, 'FASAR OPUS.xlsx');
  assert.equal(catalogRows[0].traceability.validatedBy, validatorId);
  const catalog = catalogRows.map(({ traceability, ...row }) => row);

  // 5) MOTOR REAL DE MATCHING (matchPrice, sin duplicarlo): el concepto del
  // APU debe emparejar semanticamente con el insumo validado y adoptar su
  // precio real, exactamente como ya hacen domain/apuGeneration.js y el
  // prompt de _openaiApuCore.mjs.
  const match = matchPrice('cuadrilla de albaniles para colocacion de muro de block hueco', catalog);
  assert.ok(match, 'matchPrice debe encontrar el insumo validado');
  assert.equal(match.precio, 620.5);

  // 6) MOTOR APU v2 REAL (calcAPUv2) usando el precio que vino de Biblioteca
  const apu = makeEmptyAPUv2();
  Object.assign(apu, {
    clave: 'APU-E2E-LIB', concept: 'Muro de block hueco de concreto 15x20x40, mano de obra de biblioteca validada',
    unit: 'm²', cantidadObra: 10, version: 'V2'
  });
  const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'Biblioteca RC4 (FASAR OPUS.xlsx, validado por diana@zoemec.com)' };
  apu.labor = [{ clave: 'MO-001', descripcion: match.desc, unidad: 'jor', cuadrilla: 1, rendimiento: 10, jornada: 8, salarioBase: match.precio, fsr: 1, fuente }];
  apu.materials = [{ clave: 'MAT-001', descripcion: 'Block hueco de concreto', unidad: 'pza', consumo: 12.5, desperdicioPct: 2, precioUnitario: 15.5, fuente }];
  const totals = calcAPUv2(apu);
  assert.ok(totals.pu > 0, 'el motor real debe calcular un precio unitario positivo');

  // 7) EXPORTADORES RC3 REALES (sin tocarlos): el precio que vino de
  // Biblioteca debe ser trazable hasta el XLSX/PDF final.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-library-e2e-'));
  const before = process.cwd();
  process.chdir(dir);
  try{
    await exportAPUExcelV2(apu, { writeXlsxFileImpl: writeXlsxFileNode, fileName: 'library-e2e.xlsx' });
    assert.ok(fs.statSync('library-e2e.xlsx').size > 1000);
    const { doc } = exportAPUPdfV2(apu, { fileName: 'library-e2e.pdf' });
    assert.ok(fs.statSync('library-e2e.pdf').size > 1000);
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    const pdfMoney = v => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(v).replace('MX$', '$');
    assert.ok(raw.includes(`(${pdfMoney(totals.pu)})`), 'el PDF debe mostrar el precio unitario calculado a partir del insumo validado de Biblioteca');
    assert.ok(raw.includes('MO-001'), 'la clave de mano de obra proveniente de Biblioteca debe quedar trazable en el PDF');
  } finally {
    process.chdir(before);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
