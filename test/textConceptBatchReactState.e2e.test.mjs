/* BUG REAL DE PRODUCCION (RC8): el usuario descargo un XLSX real
   ("APU-PROFESIONAL-ZOEMEC (21).xlsx") con 3 hojas, 1 solo APU vacio
   (concept="", 0 renglones en todas las secciones, PU=$0, confianza 4%).

   CAUSA RAIZ (confirmada, no el pipeline de lote): ese nombre de archivo
   SOLO lo produce exportAPUExcelV2 sin fileName explicito -- el UNICO punto
   del codigo que llama asi es exportExcel() en src/main.jsx, el boton
   "Descargar Excel" del editor de UN SOLO APU (ProfessionalApuEditor),
   que exporta `professionalApu` (derivado de apuV2) tal cual esta en
   pantalla. exportConceptBatch (el boton de lote, "Descargar Excel
   profesional") SIEMPRE pasa fileName:'APU-POR-CONCEPTO-ZOEMEC.xlsx' y
   ademas solo aparece cuando conceptBatch.concepts.length>0 -- nunca puede
   producir ese nombre de archivo ni ese boton vacio.

   El escenario real: el usuario genero el lote de 6 conceptos en una
   sesion anterior (persistidos correctamente en `apus`, ver RC6/RC7), y
   en una sesion NUEVA (conceptBatch reiniciado a null, apuV2 en su valor
   por defecto vacio) entro solo a revisar la Bandeja de revision tecnica y
   presiono el boton equivocado (el de UN SOLO APU, que sigue visible
   siempre) -- exportando el APU vacio por defecto, nunca los 6 reales.

   Este archivo prueba DOS cosas:
   1) El guard nuevo (isStructurallyEmptyApu / assertExportableApus,
      src/domain/apuProfessional.js + src/lib/apuExportV2.js): un APU
      vacio como el reportado YA NO genera ningun archivo, nunca en
      silencio.
   2) El flujo de lote real completo -- generar -> persistir via
      setApus/useProjectScoped (scopedListView/mergeScopedUpdate) ->
      reconstruir la vista del proyecto (simulando F5) -> exportar (mismo
      cuerpo que exportConceptsAPUWorkbook, main.jsx) -- SIGUE produciendo
      8 hojas con contenido tecnico real por concepto, nunca vacio. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';
import { unzipSync, strFromU8 } from 'fflate';
import { parseConceptListText } from '../src/lib/excelImport.js';
import { defaultBatchSelection, resolveBatchSelection, scopedListView, mergeScopedUpdate } from '../src/domain/apuWorkspace.js';
import { templateFallbackAPU, applyConceptMetadataV2 } from '../src/domain/apuGeneration.js';
import { migrateLegacyApuToV2 } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU, isStructurallyEmptyApu } from '../src/domain/apuProfessional.js';
import { exportAPUExcelV2, exportAPUPdfV2 } from '../src/lib/apuExportV2.js';
import { makeEmptyAPUv2 } from '../src/domain/apuSchema.js';

const REAL_CASE_TEXT = [
  '1-Movimiento de mueble',
  '2-demolición de loseta 64m2',
  '3-acarreo 46 costales distancia 25m',
  '4-acarreo de loseta 1.5m3 distancia 25m',
  '5-aplicación de adhesivo 64m2',
  '6-colocación de loseta 64 m2'
].join('\n');
const ACTIVE_PROJECT_ID = 'proj-real-case';
const OTHER_PROJECT_ID = 'proj-other';

/* --- Parte 1: el guard nunca vuelve a dejar salir el archivo vacio reportado --- */

test('RC8 Test guard: el APU EXACTO reportado en produccion (concept vacio, 0 renglones) ya no genera archivo', () => {
  const apuVacioReportado = { ...makeEmptyAPUv2(), unit: 'm²', cantidadObra: 1 }; // concept:'' por defecto en makeEmptyAPUv2
  assert.equal(apuVacioReportado.concept, '');
  assert.ok(isStructurallyEmptyApu(apuVacioReportado));
  assert.throws(() => { exportAPUPdfV2(apuVacioReportado, { save: false }); }, /no contiene información técnica/i);
});

test('RC8 Test guard (async): exportAPUExcelV2 rechaza un APU estructuralmente vacio con el mensaje exacto pedido', async () => {
  const apuVacio = makeEmptyAPUv2();
  await assert.rejects(
    () => exportAPUExcelV2(apuVacio, { writeXlsxFileImpl: writeXlsxFileNode, fileName: 'no-deberia-escribirse.xlsx' }),
    (err) => { assert.match(err.message, /No se puede generar el Excel profesional porque el APU no contiene información técnica\./); return true; }
  );
});

test('RC8 Test guard: un APU con datos reales pero solo "REQUIERE REVISION" (precio sin fuente) SI se exporta -- revision no es exclusion', () => {
  const apuConDatos = {
    ...makeEmptyAPUv2(),
    concept: 'Concepto real con datos',
    unit: 'm²',
    cantidadObra: 10,
    materials: [{ clave: 'MAT-001', descripcion: 'Insumo real', unidad: 'pza', consumo: 1, precioUnitario: 100, fuente: {} }],
    labor: [{ clave: 'MO-001', descripcion: 'Oficial', unidad: 'jor', cuadrilla: 1, rendimiento: 10, salarioBase: 300, fsr: 1.85, fuente: {} }]
  };
  assert.equal(isStructurallyEmptyApu(apuConDatos), false);
  assert.doesNotThrow(() => { exportAPUPdfV2(apuConDatos, { save: false }); });
});

test('RC8 Test guard: batch con al menos un item vacio se rechaza completo, listando cual', async () => {
  const bueno = { ...makeEmptyAPUv2(), concept: 'Concepto bueno', clave: 'CON-001', materials: [{ clave: 'M1', descripcion: 'X', consumo: 1, precioUnitario: 1 }] };
  const vacio = { ...makeEmptyAPUv2(), clave: 'CON-002' };
  await assert.rejects(
    () => exportAPUExcelV2([bueno, vacio], { writeXlsxFileImpl: writeXlsxFileNode, fileName: 'no-deberia-escribirse-2.xlsx' }),
    (err) => { assert.match(err.message, /CON-002/); return true; }
  );
});

/* --- Parte 2: flujo de lote real -- generar -> persistir (React state real) ->
   reconstruir (F5) -> exportar -- sigue produciendo 6 APUs reales, 8 hojas. --- */

/* Replica exacta del cuerpo de exportConceptsAPUWorkbook (src/main.jsx,
   funcion NO exportable porque main.jsx no puede importarse en Node sin
   DOM/React -- ver comentario de arquitectura en src/domain/apuWorkspace.test.js
   y las pruebas e2e previas). Usa las MISMAS funciones compartidas
   (applyConceptMetadataV2/migrateLegacyApuToV2/finalizeProfessionalAPU/
   exportAPUExcelV2) que el codigo real -- ningun calculo se reimplementa. */
async function exportConceptsAPUWorkbookMirror(concepts, preparedAPUs = []) {
  const professional = concepts.map((item, idx) => {
    const base = preparedAPUs[idx];
    const v2Base = base?.schemaVersion === 2 ? base : migrateLegacyApuToV2(base);
    const sourceFile = base?.sourceFile || 'Catalogo de conceptos';
    const withMeta = applyConceptMetadataV2(v2Base, item, idx, sourceFile);
    return finalizeProfessionalAPU(withMeta);
  });
  return await exportAPUExcelV2(professional, { writeXlsxFileImpl: writeXlsxFileNode, fileName: 'APU-POR-CONCEPTO-ZOEMEC.xlsx' });
}

test('RC8 END-TO-END: generar -> setApus/useProjectScoped (React real) -> reconstruir tras "F5" -> exportar -> 6 APUs reales, 8 hojas, sin vacios', async () => {
  // 1) TEXTAREA -> parseConceptListText -> conceptBatch
  const { concepts } = parseConceptListText(REAL_CASE_TEXT);
  assert.equal(concepts.length, 6);

  // 2) Seleccion/revision (misma capa real de RC6)
  const selection = defaultBatchSelection(concepts);
  const { selectedList, excludedConcepts } = resolveBatchSelection(concepts, selection);
  assert.equal(selectedList.length, 6);
  assert.equal(excludedConcepts.length, 0);

  // 3) Generacion (equivalente a runQueueJob -> generateBatchAPU cuando la IA
  // no responde: templateFallbackAPU, mismo motor real) + persistencia via
  // setApus/useProjectScoped -- replica EXACTA de runQueueJob (main.jsx):
  //   const tagged = { ...v2, projectId: activeProjectId };
  //   setApus(prev => [tagged, ...prev.filter(x => x.clave !== tagged.clave)]);
  // donde setApus = useProjectScoped(rawApus, setRawApus, activeProjectId)[1],
  // construido sobre scopedListView/mergeScopedUpdate (RC7, mismas funciones).
  let rawApus = [
    // Control: proyecto DISTINTO con un APU previo, no debe alterarse.
    { id: 'OTRO-1', clave: 'OTRO-1', projectId: OTHER_PROJECT_ID, concept: 'APU de otro proyecto', materials: [{ clave: 'M', descripcion: 'X', consumo: 1, precioUnitario: 1 }] }
  ];
  const generatedInOrder = [];
  selectedList.forEach((item, idx) => {
    const v1 = templateFallbackAPU(item, [], idx, 'Texto pegado', 'IA no disponible (prueba RC8)');
    const v2 = finalizeProfessionalAPU(applyConceptMetadataV2(migrateLegacyApuToV2(v1), item, idx, 'Texto pegado'));
    v2.aiGenerated = false; v2.templateFallback = true; v2.family = v1.family;
    const tagged = { ...v2, projectId: ACTIVE_PROJECT_ID };
    generatedInOrder.push(tagged);
    const prevScoped = scopedListView(rawApus, ACTIVE_PROJECT_ID);
    const nextScoped = [tagged, ...prevScoped.filter(x => x.clave !== tagged.clave)];
    rawApus = mergeScopedUpdate(rawApus, ACTIVE_PROJECT_ID, nextScoped);
  });
  assert.equal(scopedListView(rawApus, ACTIVE_PROJECT_ID).length, 6, '6 generados -> 6 persistidos');
  assert.equal(scopedListView(rawApus, OTHER_PROJECT_ID).length, 1, 'el otro proyecto no debe verse afectado por la generacion');

  // 4) "Recargar navegador": releer desde la fuente persistida (round-trip
  // JSON, simulando localStorage/Firestore) y reconstruir la vista del
  // proyecto activo -- exactamente lo que useProjectScoped hace en cada render.
  const rawApusAfterReload = JSON.parse(JSON.stringify(rawApus));
  const projectView = scopedListView(rawApusAfterReload, ACTIVE_PROJECT_ID);
  assert.equal(projectView.length, 6, '6 recuperados tras "F5"');
  // El orden de useProjectScoped's setScoped antepone el mas reciente
  // (prepend): projectView queda en orden inverso a selectedList. Se
  // reordena por clave para comparar contenido, no posicion.
  const byClave = new Map(projectView.map(a => [a.clave, a]));
  selectedList.forEach((item, idx) => {
    const clave = generatedInOrder[idx].clave;
    assert.ok(byClave.has(clave), `el APU generado para "${item.concept}" debe seguir presente tras recargar`);
  });

  // 5) Exportar: 6 enviados al exportador (mismo cuerpo que exportConceptBatch
  // -> exportConceptsAPUWorkbook, reusando lo ya generado -- preparedAPUs).
  const preparedAPUs = selectedList.map((item, idx) => byClave.get(generatedInOrder[idx].clave));
  assert.ok(preparedAPUs.every(Boolean), '6 enviados al exportador, ninguno undefined');
  preparedAPUs.forEach((apu, i) => assert.equal(isStructurallyEmptyApu(apu), false, `APU ${i + 1} ("${apu.concept}") no debe estar estructuralmente vacio`));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-reactstate-e2e-'));
  const previousCwd = process.cwd();
  try {
    process.chdir(dir);
    await exportConceptsAPUWorkbookMirror(selectedList, preparedAPUs);
    process.chdir(previousCwd);
    const outputPath = path.join(dir, 'APU-POR-CONCEPTO-ZOEMEC.xlsx');
    const zip = unzipSync(new Uint8Array(fs.readFileSync(outputPath)));
    const workbookXml = strFromU8(zip['xl/workbook.xml']);
    const sheetTags = [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)].map(m => m[0]);
    const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
    const sheetEntries = sheetTags.map(tag => ({ name: attr(tag, 'name'), rid: attr(tag, 'r:id') }));
    assert.equal(sheetEntries.length, 8, `se esperaban 8 hojas (RESUMEN + CONTROL_REVISION + 6), hubo ${sheetEntries.length}: ${sheetEntries.map(s => s.name).join(', ')}`);
    assert.ok(sheetEntries.some(s => s.name === 'RESUMEN'));
    assert.ok(sheetEntries.some(s => s.name === 'CONTROL_REVISION'));

    // 6) Contenido real por hoja: sin renglones vacios, texto completo
    // conservado, sin contaminacion cruzada entre conceptos.
    const relsXml = strFromU8(zip['xl/_rels/workbook.xml.rels']);
    const relMap = new Map([...relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]));
    const sharedXml = zip['xl/sharedStrings.xml'] ? strFromU8(zip['xl/sharedStrings.xml']) : '';
    const sharedStrings = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''));
    const fullText = sharedStrings.join(' | ');

    const conceptSheets = sheetEntries.filter(s => s.name !== 'RESUMEN' && s.name !== 'CONTROL_REVISION');
    assert.equal(conceptSheets.length, 6);
    conceptSheets.forEach(({ name, rid }) => {
      const target = relMap.get(rid);
      const xml = strFromU8(zip[`xl/${target}`]);
      const sheetData = xml.match(/<sheetData>([\s\S]*?)<\/sheetData>/)?.[1] || '';
      const rowCount = [...sheetData.matchAll(/<row\b/g)].length;
      assert.ok(rowCount > 20, `hoja "${name}" parece vacia/truncada (${rowCount} filas XML)`);
    });

    // Descripciones completas conservadas literalmente (incluida distancia).
    ['Movimiento de mueble', 'demolición de loseta 64m2', 'acarreo 46 costales distancia 25m', 'acarreo de loseta 1.5m3 distancia 25m', 'aplicación de adhesivo 64m2', 'colocación de loseta 64 m2']
      .forEach(txt => assert.ok(fullText.includes(txt), `descripcion completa ausente del workbook: "${txt}"`));

    // Sin contaminacion cruzada: el material "Loseta cerámica" (colocacion)
    // solo debe referenciarse desde la hoja de colocacion, nunca desde
    // demolicion/movimiento/acarreo/adhesivo aislado. Las celdas de texto
    // referencian sharedStrings.xml por INDICE (t="s"), asi que se ubica el
    // indice de esa cadena y se busca ese indice, no el texto literal, en
    // cada hoja de concepto por separado.
    const losetaIndex = sharedStrings.findIndex(s => s.includes('Loseta cerámica'));
    assert.ok(losetaIndex >= 0, 'el material "Loseta cerámica" debe existir en sharedStrings (lo produce la hoja de colocacion)');
    const sheetsReferencingLoseta = conceptSheets.filter(({ rid, name }) => {
      const target = relMap.get(rid);
      const xml = strFromU8(zip[`xl/${target}`]);
      return new RegExp(`<c[^>]*t="s"[^>]*><v>${losetaIndex}</v></c>`).test(xml) ? name : false;
    });
    assert.equal(sheetsReferencingLoseta.length, 1, `"Loseta cerámica" debe aparecer en exactamente 1 hoja (colocacion), aparecio en: ${sheetsReferencingLoseta.map(s => s.name).join(', ')}`);
    assert.ok(sheetsReferencingLoseta[0].name.includes('colocaci'), `la unica hoja con loseta debe ser la de colocacion, fue: ${sheetsReferencingLoseta[0].name}`);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* --- Parte 3: contenido tecnico por concepto (MO/materiales/equipo reales,
   sin cruzarse), verificado directamente sobre los APUs generados por el
   mismo motor real (templateFallbackAPU), antes de exportar. --- */
test('RC8 Test de contenido: cada uno de los 6 conceptos trae MO/equipo/materiales propios y correctos', () => {
  const { concepts } = parseConceptListText(REAL_CASE_TEXT);
  const professional = concepts.map((item, idx) => {
    const v1 = templateFallbackAPU(item, [], idx, 'Texto pegado', 'prueba');
    return finalizeProfessionalAPU(applyConceptMetadataV2(migrateLegacyApuToV2(v1), item, idx, 'Texto pegado'));
  });
  const [movimiento, demolicion, acarreoCostales, acarreoLoseta, adhesivo, colocacion] = professional;
  const matText = apu => (apu.materials || []).map(r => r.descripcion.toLowerCase()).join(' | ');
  const laborCount = apu => (apu.labor || []).length;
  const equipCount = apu => (apu.equipment || []).length;

  // Movimiento de mueble: MO/equipo, sin loseta/adhesivo.
  assert.ok(laborCount(movimiento) > 0 && equipCount(movimiento) > 0);
  assert.ok(!matText(movimiento).includes('loseta') && !matText(movimiento).includes('adhesivo'));

  // Demolicion: MO/equipo de demolicion, sin loseta nueva.
  assert.ok(laborCount(demolicion) > 0 && equipCount(demolicion) > 0);
  assert.ok(!matText(demolicion).includes('loseta'));
  assert.ok(demolicion.labor.some(r => /demolici/i.test(r.descripcion)) || demolicion.equipment.some(r => /demolici|rotomartillo/i.test(r.descripcion)));

  // Acarreo 46 costales: concepto conserva "46 costales" y "distancia 25m";
  // MO/equipo/rendimiento presentes.
  assert.ok(acarreoCostales.concept.includes('46 costales') && acarreoCostales.concept.includes('distancia 25m'));
  assert.ok(laborCount(acarreoCostales) > 0 && equipCount(acarreoCostales) > 0);
  // Plantillas migradas de v1 (templateFallbackAPU) traen el coeficiente
  // jornales/unidad en `cantidad` (rendimiento/cuadrilla detallados son
  // exclusivos de la IA v2 real) -- debe ser > 0, no solo texto sin numero.
  assert.ok(acarreoCostales.labor.every(r => Number(r.cantidad) > 0), 'debe traer un coeficiente de mano de obra real (cantidad > 0), no solo texto');

  // Acarreo 1.5 m3: concepto conserva "1.5m3" y "distancia 25m".
  assert.ok(acarreoLoseta.concept.includes('1.5m3') && acarreoLoseta.concept.includes('distancia 25m'));
  assert.ok(laborCount(acarreoLoseta) > 0 && equipCount(acarreoLoseta) > 0);

  // Aplicacion de adhesivo: adhesivo + MO, sin boquilla (eso es colocacion).
  assert.ok(matText(adhesivo).includes('adhesivo'));
  assert.ok(laborCount(adhesivo) > 0);
  assert.ok(!matText(adhesivo).includes('boquilla'));

  // Colocacion: matriz propia (loseta + adhesivo + boquilla), MO propia.
  assert.ok(matText(colocacion).includes('loseta') && matText(colocacion).includes('boquilla'));
  assert.ok(laborCount(colocacion) > 0);

  // Ninguno de los 6 esta estructuralmente vacio (guard RC8).
  professional.forEach((apu, i) => assert.equal(isStructurallyEmptyApu(apu), false, `concepto ${i + 1} ("${apu.concept}") no debe quedar vacio`));
});
