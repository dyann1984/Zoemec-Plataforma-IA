/* BUG REAL DE PRODUCCION (RC10): "Conceptos: 112 / Seleccionados: 112 /
   APUs generados: 112 / 0 errores" en pantalla, pero el XLSX descargado
   ("APU-PROFESIONAL-ZOEMEC (22).xlsx") solo traia 3 hojas (RESUMEN +
   CONTROL_REVISION + 1 APU real, no vacio).

   CAUSA RAIZ (auditada exhaustivamente, ver comentario extenso en
   src/domain/apuWorkspace.js#resolveBatchExportApus): ese nombre de archivo
   SOLO lo produce exportAPUExcelV2 sin fileName -- el UNICO llamador asi en
   TODO el codigo (grep exhaustivo de src/api/server) es el boton de UN SOLO
   APU del editor (ProfessionalApuEditor.onExcel). exportConceptBatch (el
   boton de lote real, "Descargar Excel profesional") SIEMPRE pasa
   fileName:'APU-POR-CONCEPTO-ZOEMEC.xlsx' -- no existe ningun camino de
   codigo donde ese boton reduzca 112 a 1. No se encontro ningun
   slice/find/take-the-first en exportConceptBatch/exportConceptsAPUWorkbook/
   exportAPUExcelV2.

   Aun sin evidencia de que el boton de lote estuviera roto, la sugerencia de
   arquitectura del reporte es correcta y se implemento: resolveBatchExportApus
   (src/domain/apuWorkspace.js) resuelve los APUs a exportar PRIMERO contra la
   fuente persistente del proyecto (apus, buscados por clave -- nunca contra
   unicamente el estado de React transitorio batchAPUs), y
   assertExpectedExportCount bloquea CUALQUIER exportacion parcial con un
   error explicito en vez de escribir un archivo incompleto en silencio.

   Este archivo prueba la escala real pedida (6/25/100/112) a traves de la
   MISMA logica que main.jsx#exportConceptBatch usa ahora (no una
   reimplementacion aparte), reproduciendo el flujo de estado de React real:
   generar -> persistir (setApus/useProjectScoped) -> resolver por clave ->
   guard de cantidad -> exportar -> reabrir y contar hojas/filas. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';
import { unzipSync, strFromU8 } from 'fflate';
import { parseConceptListText } from '../src/lib/excelImport.js';
import { defaultBatchSelection, resolveBatchSelection, scopedListView, mergeScopedUpdate, resolveBatchExportApus, assertExpectedExportCount, isExportableConceptItem } from '../src/domain/apuWorkspace.js';
import { templateFallbackAPU, applyConceptMetadataV2 } from '../src/domain/apuGeneration.js';
import { migrateLegacyApuToV2 } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { exportAPUExcelV2 } from '../src/lib/apuExportV2.js';

const ACTIVE_PROJECT_ID = 'proj-scale';
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

/* Replica exacta del cuerpo de exportConceptsAPUWorkbook (main.jsx) -- ver
   nota de arquitectura en los tests e2e previos: main.jsx no se puede
   importar en Node (ReactDOM.createRoot al final del modulo). */
async function exportConceptsAPUWorkbookMirror(concepts, preparedAPUs, outputName){
  const professional = concepts.map((item, idx) => {
    const base = preparedAPUs[idx];
    const v2Base = base?.schemaVersion === 2 ? base : migrateLegacyApuToV2(base);
    const sourceFile = base?.sourceFile || 'Catalogo de conceptos';
    const withMeta = applyConceptMetadataV2(v2Base, item, idx, sourceFile);
    return finalizeProfessionalAPU(withMeta);
  });
  return await exportAPUExcelV2(professional, { writeXlsxFileImpl: writeXlsxFileNode, fileName: outputName });
}

async function runFullBatchExportScenario(count){
  // 1) Segmentacion + seleccion (RC5/RC6, sin cambios).
  const { concepts } = parseConceptListText(buildConceptLines(count));
  assert.equal(concepts.length, count);
  const selection = defaultBatchSelection(concepts);
  const { selectedList, excludedConcepts } = resolveBatchSelection(concepts, selection);
  assert.equal(selectedList.length, count, `inputConceptCount(${count}) === selectedConceptCount(${selectedList.length})`);
  assert.equal(excludedConcepts.length, 0);

  // 2) Generacion + persistencia real via setApus/useProjectScoped (RC7):
  // replica exacta de runQueueJob (main.jsx) -- setApus(prev => [tagged,
  // ...prev.filter(x => x.clave !== tagged.clave)]) por cada item terminado.
  let rawApus = [];
  selectedList.forEach((item, idx) => {
    const v1 = templateFallbackAPU(item, [], idx, 'Texto pegado', `IA no disponible (prueba escala ${count})`);
    const v2 = finalizeProfessionalAPU(applyConceptMetadataV2(migrateLegacyApuToV2(v1), item, idx, 'Texto pegado'));
    v2.aiGenerated = false; v2.templateFallback = true; v2.family = v1.family;
    const tagged = { ...v2, projectId: ACTIVE_PROJECT_ID };
    const prevScoped = scopedListView(rawApus, ACTIVE_PROJECT_ID);
    const nextScoped = [tagged, ...prevScoped.filter(x => x.clave !== tagged.clave)];
    rawApus = mergeScopedUpdate(rawApus, ACTIVE_PROJECT_ID, nextScoped);
  });
  const persistedApus = scopedListView(rawApus, ACTIVE_PROJECT_ID);
  assert.equal(persistedApus.length, count, `generatedAPUs.length(${count}) === persistedApus.length(${persistedApus.length})`);

  // 3) "Recargar navegador" -- round-trip JSON simulando localStorage/Firestore.
  const persistedAfterReload = scopedListView(JSON.parse(JSON.stringify(rawApus)), ACTIVE_PROJECT_ID);
  assert.equal(persistedAfterReload.length, count);

  // 4) Click real de "Descargar Excel profesional": exactamente la logica
  // nueva de exportConceptBatch (main.jsx) -- resolveBatchExportApus primero
  // contra la fuente persistente, luego el guard de cantidad esperada.
  const list = concepts.filter(isExportableConceptItem);
  assert.equal(list.length, count);
  const apuList = resolveBatchExportApus({ concepts: list, persistedApus: persistedAfterReload, cachedApus: [] });
  assert.ok(apuList, 'debe resolver los APUs completos desde la fuente persistente por clave, sin regenerar');
  assert.equal(apuList.length, count, `resolveBatchExportApus debe devolver los ${count} APUs, devolvio ${apuList.length}`);
  assert.doesNotThrow(() => assertExpectedExportCount(list.length, apuList.length));

  // Orden preservado: apuList[i] debe corresponder al concepto list[i] (por clave/code).
  list.forEach((item, i) => assert.equal(apuList[i].clave, item.code, `orden del lote no preservado en la posicion ${i}`));

  // 5) Exportar y reabrir.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zoemec-export-scale-${count}-`));
  const outputName = `export-scale-${count}.xlsx`;
  const previousCwd = process.cwd();
  try{
    process.chdir(dir);
    await exportConceptsAPUWorkbookMirror(list, apuList, outputName);
    process.chdir(previousCwd);
    const outputPath = path.join(dir, outputName);
    const zip = unzipSync(new Uint8Array(fs.readFileSync(outputPath)));
    const workbookXml = strFromU8(zip['xl/workbook.xml']);
    const sheetTags = [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)].map(m => m[0]);
    const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
    const sheetEntries = sheetTags.map(tag => ({ name: attr(tag, 'name'), rid: attr(tag, 'r:id') }));
    const expectedSheets = count + 4;
    assert.equal(sheetEntries.length, expectedSheets, `lote de ${count}: se esperaban ${expectedSheets} hojas (PORTADA + RESUMEN + CONTROL_REVISION + PARAMETROS + ${count}), hubo ${sheetEntries.length}`);
    assert.equal(new Set(sheetEntries.map(s => s.name)).size, sheetEntries.length, 'ninguna hoja APU debe estar duplicada/sobrescrita');
    assert.ok(sheetEntries.every(s => s.name.length <= 31), 'ningun nombre de hoja debe exceder 31 caracteres (limite real de Excel)');

    const relsXml = strFromU8(zip['xl/_rels/workbook.xml.rels']);
    const relMap = new Map([...relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]));
    const rowCountOf = (name) => {
      const entry = sheetEntries.find(s => s.name === name);
      const xml = strFromU8(zip[`xl/${relMap.get(entry.rid)}`]);
      return [...(xml.match(/<sheetData>([\s\S]*?)<\/sheetData>/)?.[1] || '').matchAll(/<row\b/g)].length;
    };
    // RESUMEN: titulo + encabezado + N conceptos + TOTALES + acumulado = N+4.
    assert.equal(rowCountOf('RESUMEN'), count + 4, `RESUMEN debe tener ${count + 4} filas (titulo+encabezado+${count}+TOTALES+acumulado)`);
    // CONTROL_REVISION: titulo + encabezado + N conceptos = N+2.
    assert.equal(rowCountOf('CONTROL_REVISION'), count + 2, `CONTROL_REVISION debe tener ${count + 2} filas (titulo+encabezado+${count})`);

    const conceptSheets = sheetEntries.filter(s => s.name !== 'PORTADA' && s.name !== 'RESUMEN' && s.name !== 'CONTROL_REVISION' && s.name !== 'PARAMETROS');
    assert.equal(conceptSheets.length, count);
    conceptSheets.forEach(({ name }) => assert.ok(rowCountOf(name) > 20, `hoja "${name}" parece vacia/truncada`));
  }finally{
    process.chdir(previousCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('RC10 Escala 6: 6 detectados -> 6 seleccionados -> 6 persistidos -> 6 resueltos -> 10 hojas', async () => { await runFullBatchExportScenario(6); });
test('RC10 Escala 25: 25 -> 29 hojas, filas de RESUMEN/CONTROL_REVISION correctas', async () => { await runFullBatchExportScenario(25); });
test('RC10 Escala 100: 100 -> 104 hojas, filas de RESUMEN/CONTROL_REVISION correctas', async () => { await runFullBatchExportScenario(100); });
test('RC10 Escala 112 (caso real reportado): 112 -> 112 persistidos -> 112 resueltos -> 116 hojas, NUNCA 3', async () => { await runFullBatchExportScenario(112); });

test('RC10 unit: resolveBatchExportApus resuelve por clave desde la fuente persistente, preserva orden, ignora cachedApus si la persistente ya cubre todo', () => {
  const concepts = [{ code: 'CON-001', concept: 'A' }, { code: 'CON-002', concept: 'B' }, { code: 'CON-003', concept: 'C' }];
  const persistedApus = [
    { clave: 'CON-002', concept: 'B generado' },
    { clave: 'CON-003', concept: 'C generado' },
    { clave: 'CON-001', concept: 'A generado' },
    { clave: 'CON-999', concept: 'de otro lote, no pedido' }
  ];
  const resolved = resolveBatchExportApus({ concepts, persistedApus, cachedApus: [{ clave: 'NO-DEBERIA-USARSE' }] });
  assert.equal(resolved.length, 3);
  assert.deepEqual(resolved.map(a => a.clave), ['CON-001', 'CON-002', 'CON-003'], 'debe preservar el orden ORIGINAL del lote, no el orden de persistedApus');
});

test('RC10 unit: resolveBatchExportApus cae a cachedApus (sesion) solo si la fuente persistente NO cubre el lote completo', () => {
  const concepts = [{ code: 'CON-001' }, { code: 'CON-002' }];
  const persistedApus = [{ clave: 'CON-001' }]; // falta CON-002 en la fuente persistente
  const cachedApus = [{ clave: 'CACHE-1' }, { clave: 'CACHE-2' }];
  const resolved = resolveBatchExportApus({ concepts, persistedApus, cachedApus });
  assert.deepEqual(resolved, cachedApus);
});

test('RC10 unit: resolveBatchExportApus devuelve null si NINGUNA fuente cubre el lote completo (el llamador debe regenerar)', () => {
  const concepts = [{ code: 'CON-001' }, { code: 'CON-002' }, { code: 'CON-003' }];
  const resolved = resolveBatchExportApus({ concepts, persistedApus: [{ clave: 'CON-001' }], cachedApus: [{ clave: 'X' }] });
  assert.equal(resolved, null);
});

test('RC10 unit: assertExpectedExportCount nunca deja pasar una exportacion parcial (mensaje exacto pedido)', () => {
  assert.throws(() => assertExpectedExportCount(112, 1), /El lote contiene 112 APUs, pero solo 1 está disponible para exportación\. Recarga el proyecto o vuelve a generar el lote\./);
  assert.throws(() => assertExpectedExportCount(112, 0), /no hay ningún APU disponible/i);
  assert.doesNotThrow(() => assertExpectedExportCount(112, 112));
  assert.doesNotThrow(() => assertExpectedExportCount(6, 6));
});

/* Reproduccion directa del escenario reportado: la fuente persistente solo
   alcanzo a guardar 1 de 112 (ej. race real de persistencia, o un fallo
   parcial de red) -- el guard debe BLOQUEAR la exportacion completa, nunca
   entregar un archivo de 3 hojas en silencio. */
test('RC10: si la persistencia solo alcanzo 1 de 112, la exportacion se bloquea con el error exacto -- nunca genera un XLSX parcial', async () => {
  const { concepts } = parseConceptListText(buildConceptLines(112));
  const list = concepts.filter(isExportableConceptItem);
  const soloUnoPersistido = [{ clave: list[0].code, concept: list[0].concept, materials: [{ clave: 'M', descripcion: 'X', consumo: 1, precioUnitario: 1 }] }];
  const apuList = resolveBatchExportApus({ concepts: list, persistedApus: soloUnoPersistido, cachedApus: [] });
  assert.equal(apuList, null, 'no debe resolver desde una fuente incompleta como si fuera valida');
  // Simulando que tampoco habia cache de sesion, el llamador caeria a
  // regenerar; si esa regeneracion tambien fallara/devolviera solo 1
  // (reproduccion exacta del reporte), el guard debe bloquear:
  assert.throws(
    () => assertExpectedExportCount(list.length, soloUnoPersistido.length),
    /El lote contiene 112 APUs, pero solo 1 está disponible para exportación\./
  );
});
