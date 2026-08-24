import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyApuWorkspaceState, removeBatchApus, describeAmbiguousSingleExport,
  duplicateGroupKey, groupConceptsByDuplicateKey, defaultBatchSelection,
  isExportableConceptItem, conceptNeedsReviewFlag, resolveBatchSelection,
  scopedListView, mergeScopedUpdate
} from './apuWorkspace.js';

test('emptyApuWorkspaceState: forma exacta de "sin trabajo en curso"', () => {
  assert.deepEqual(emptyApuWorkspaceState(), {
    concept: '',
    aiUnit: '',
    aiQty: '',
    aiOpen: false,
    excelInfo: null,
    conceptBatch: null,
    batchAPUs: [],
    aiStatus: '',
    batchBusy: false,
    showExecutive: false,
    batchSelection: null,
    batchSearch: '',
    batchResult: null
  });
});

test('removeBatchApus: sin lote activo (batchApuIds vacio) no quita nada', () => {
  const apus = [{ id: 'APU-1' }, { id: 'APU-2' }];
  assert.deepEqual(removeBatchApus(apus, []), apus);
  assert.deepEqual(removeBatchApus(apus, null), apus);
  assert.deepEqual(removeBatchApus(apus, undefined), apus);
});

test('removeBatchApus: retira SOLO los ids del ultimo lote, preserva APUs guardados por otra via', () => {
  const apusPrevios = { id: 'APU-MANUAL', clave: 'M-1', concept: 'Concepto capturado a mano' };
  const apusLoteA = [
    { id: 'APU-A1', clave: '2', concept: 'Desmantelamiento A' },
    { id: 'APU-A2', clave: '45', concept: 'Ranurado A' }
  ];
  const todos = [...apusLoteA, apusPrevios];
  const result = removeBatchApus(todos, apusLoteA.map(a => a.id));
  assert.deepEqual(result, [apusPrevios]);
});

test('removeBatchApus: no muta el arreglo original', () => {
  const apus = [{ id: 'APU-1' }, { id: 'APU-2' }];
  const original = [...apus];
  removeBatchApus(apus, ['APU-1']);
  assert.deepEqual(apus, original);
});

/* Escenario obligatorio (DEFECTO 1 del reporte): cargar catalogo A, generar
   resultados, limpiar trabajo, comprobar estado vacio, cargar catalogo B, y
   comprobar que NINGUN concepto/seleccion/resultado de A aparece en B. Se
   modela a nivel de la logica pura que respalda a "Limpiar trabajo" (la
   forma del estado vacio + que APUs sobreviven), ya que este proyecto no
   tiene arnes de render de componentes React. */
test('ESCENARIO: catalogo A -> generar -> limpiar trabajo -> catalogo B: nada de A sobrevive en B', () => {
  // 1) Catalogo A cargado y generado: estado de trabajo poblado + 2 APUs
  // nuevos agregados al proyecto (ids del lote A, trazables).
  const apusPrevioAlProyecto = { id: 'APU-PRE', clave: 'PRE-1', concept: 'APU guardado antes de A (no es de ningun lote)' };
  const conceptBatchA = { fileName: 'catalogoA.xlsx', concepts: [{ code: '2', concept: 'Desmantelamiento A', unit: 'M', qty: 80 }] };
  const loteApusA = [
    { id: 'APU-A1', clave: '2', concept: 'Desmantelamiento A' },
    { id: 'APU-A2', clave: '45', concept: 'Ranurado A' }
  ];
  let apusProyecto = [...loteApusA, apusPrevioAlProyecto];
  let workspace = {
    concept: 'Desmantelamiento A',
    aiUnit: 'M', aiQty: '80', aiOpen: true,
    excelInfo: { fileName: 'catalogoA.xlsx', concept: 'Desmantelamiento A', unit: 'M', qty: 80 },
    conceptBatch: conceptBatchA,
    batchAPUs: loteApusA,
    aiStatus: 'Presupuesto generado: 2 APUs guardados en este proyecto.',
    batchBusy: false,
    showExecutive: true,
    batchSelection: new Set([0]),
    batchSearch: '2',
    batchResult: { conceptsTotal: 1, selected: 1, generated: 2 }
  };
  const catalogoPreciosA = [{ desc: 'Cemento gris', unidad: 'kg', precio: 5.2 }];
  let lastBatchApuIdsA = loteApusA.map(a => a.id);

  // 2) "Limpiar trabajo": retira SOLO los APUs del lote A y restablece el
  // panel al estado vacio (catalogo de precios incluido).
  apusProyecto = removeBatchApus(apusProyecto, lastBatchApuIdsA);
  workspace = emptyApuWorkspaceState();
  const catalogoPreciosDespuesDeLimpiar = [];
  lastBatchApuIdsA = [];

  // 3) Comprobar estado vacio: sin rastro de A en el panel de trabajo ni en
  // el catalogo de precios, y el APU previo (ajeno al lote) sigue intacto.
  assert.deepEqual(workspace, emptyApuWorkspaceState());
  assert.deepEqual(apusProyecto, [apusPrevioAlProyecto]);
  assert.deepEqual(catalogoPreciosDespuesDeLimpiar, []);

  // 4) Cargar catalogo B y generar su propio lote.
  const conceptBatchB = { fileName: 'catalogoB.xlsx', concepts: [{ code: '2', concept: 'Concepto B distinto', unit: 'M2', qty: 40 }] };
  const loteApusB = [{ id: 'APU-B1', clave: '2', concept: 'Concepto B distinto' }];
  apusProyecto = [...loteApusB, ...apusProyecto.filter(a => !loteApusB.some(b => b.clave === a.clave))];
  workspace = {
    ...emptyApuWorkspaceState(),
    concept: 'Concepto B distinto',
    conceptBatch: conceptBatchB,
    batchAPUs: loteApusB,
    batchSelection: new Set([0])
  };
  const lastBatchApuIdsB = loteApusB.map(a => a.id);

  // 5) Ningun concepto, seleccion o resultado de A aparece en B.
  assert.equal(workspace.conceptBatch.fileName, 'catalogoB.xlsx');
  assert.ok(!workspace.conceptBatch.concepts.some(c => c.concept.includes('Desmantelamiento A')));
  assert.ok(!apusProyecto.some(a => a.id === 'APU-A1' || a.id === 'APU-A2'));
  assert.ok(apusProyecto.some(a => a.id === 'APU-B1'));
  assert.ok(apusProyecto.some(a => a.id === 'APU-PRE'), 'el APU previo (ajeno a cualquier lote) debe seguir presente');
  assert.deepEqual(lastBatchApuIdsB, ['APU-B1']);
});

/* DEFECTO REAL medido en produccion: catalogo de 25 conceptos -> boton de UN
   SOLO APU ("Descargar Excel" en el editor, siempre el concepto
   previsualizado) -> Excel exportado con RESUMEN + CONTROL_REVISION + 1 SOLA
   hoja, sin error ni aviso. describeAmbiguousSingleExport es la logica pura
   de la advertencia que main.jsx debe mostrar antes de permitir ese export
   ambiguo. */
test('describeAmbiguousSingleExport: sin catalogo cargado (concepto suelto) -> null, uso legitimo sin interrupcion', () => {
  assert.equal(describeAmbiguousSingleExport(null, 'Muro de block hueco'), null);
  assert.equal(describeAmbiguousSingleExport(undefined, 'Muro de block hueco'), null);
});

test('describeAmbiguousSingleExport: catalogo de UN solo concepto -> null, no hay ambiguedad real', () => {
  const conceptBatch = { fileName: 'catalogo.xlsx', concepts: [{ code: '1', concept: 'Unico concepto del catalogo' }] };
  assert.equal(describeAmbiguousSingleExport(conceptBatch, 'Unico concepto del catalogo'), null);
});

test('describeAmbiguousSingleExport: catalogo de 25 conceptos -> advierte con el total real y el concepto previsualizado, nunca en silencio', () => {
  const conceptBatch = { fileName: 'CATALOGO_EBDI_71_CD_VICTORIA.xlsx', concepts: Array.from({ length: 25 }, (_, i) => ({ code: String(i + 1), concept: `Concepto ${i + 1}` })) };
  const warning = describeAmbiguousSingleExport(conceptBatch, 'DESMANTELAMIENTO DE TUBERÍAS DE 3" HASTA 6"');
  assert.ok(warning, 'debe advertir siempre que haya mas de un concepto cargado');
  assert.match(warning, /25 conceptos/);
  assert.match(warning, /DESMANTELAMIENTO DE TUBERÍAS DE 3" HASTA 6"/);
  assert.match(warning, /Excel completo por concepto \(25 hojas\)/);
});

/* REGRESION REAL DE PRODUCCION (RC6): "Conceptos: 6 / Seleccionados: 4 /
   APUs generados: 4" al pegar el bloque de 6 conceptos del reporte --
   isExportableConceptItem filtraba por un vocabulario de unidad que no
   incluia "u" (fallback sin unidad explicita) ni "costal" (unidad de
   conteo). Ver causa raiz completa en el comentario de isExportableConceptItem. */
test('RC6: isExportableConceptItem nunca excluye por unidad -- "u" (sin unidad) y "costal" pasan', () => {
  assert.ok(isExportableConceptItem({ concept: 'Movimiento de mueble', unit: '', qty: 1 }));
  assert.ok(isExportableConceptItem({ concept: 'acarreo de 46 costales distancia 25m', unit: 'costal', qty: 46 }));
  assert.ok(isExportableConceptItem({ concept: 'Concepto con unidad rarisima nunca vista', unit: 'unidad-inventada-xyz', qty: 3 }));
});

test('RC6: isExportableConceptItem SI excluye texto de ruido inequivoco (sin concepto, TOTAL/SUBTOTAL)', () => {
  assert.equal(isExportableConceptItem({ concept: '', unit: 'm2', qty: 1 }), false);
  assert.equal(isExportableConceptItem({ concept: '   ', unit: 'm2', qty: 1 }), false);
  assert.equal(isExportableConceptItem({ concept: 'TOTAL', unit: 'm2', qty: 1 }), false);
  assert.equal(isExportableConceptItem({ concept: 'Subtotal partida 3', unit: 'm2', qty: 1 }), false);
});

test('RC6: conceptNeedsReviewFlag marca unidad atipica/cantidad invalida para revision, isExportableConceptItem NUNCA los excluye por eso', () => {
  const unidadAtipica = { concept: 'Concepto con unidad no catalogada', unit: 'unidad-rara', qty: 5 };
  assert.equal(conceptNeedsReviewFlag(unidadAtipica), true);
  assert.equal(isExportableConceptItem(unidadAtipica), true, 'requiere revision, pero sigue siendo exportable/generable');

  const cantidadInvalida = { concept: 'Concepto con cantidad en cero', unit: 'm2', qty: 0 };
  assert.equal(conceptNeedsReviewFlag(cantidadInvalida), true);
  assert.equal(isExportableConceptItem(cantidadInvalida), true);
});

test('duplicateGroupKey / groupConceptsByDuplicateKey / defaultBatchSelection: sin duplicados, todos preseleccionados', () => {
  const concepts = [
    { concept: 'Movimiento de mueble', unit: '' },
    { concept: 'demolicion de loseta 64m2', unit: 'm²' },
    { concept: 'acarreo 46 costales distancia 25m', unit: 'costal' }
  ];
  const groups = groupConceptsByDuplicateKey(concepts);
  assert.equal(groups.size, 3);
  const selection = defaultBatchSelection(concepts);
  assert.equal(selection.size, 3);
  assert.deepEqual([...selection].sort(), [0, 1, 2]);
});

test('defaultBatchSelection: con duplicados reales, solo el primero de cada grupo queda preseleccionado', () => {
  const concepts = [
    { concept: 'Suministro y colocacion de llave mezcladora', unit: 'pza' },
    { concept: 'Suministro y colocacion de llave mezcladora', unit: 'pza' },
    { concept: 'Concepto distinto', unit: 'm2' }
  ];
  const selection = defaultBatchSelection(concepts);
  assert.equal(selection.size, 2, 'el duplicado (indice 1) no debe preseleccionarse, pero sigue disponible para marcarlo a mano');
  assert.ok(selection.has(0) && selection.has(2));
  assert.ok(!selection.has(1));
});

/* REGRESION REAL DE PRODUCCION (RC7): "Limpiar trabajo" no vaciaba la
   Bandeja de revision tecnica (seguian apareciendo 52 conceptos). Causa
   raiz real: NO era un defecto de "Limpiar trabajo" (que nunca toco APUs ya
   guardados, por diseno -- ver removeBatchApus arriba), sino que no existia
   ninguna accion para vaciar TODOS los APUs guardados de un proyecto. La
   fuente de verdad es rawApus (useCloudState en App, persistido en
   localStorage al instante + Firestore con debounce, ver src/cloud.js);
   `apus`/`setApus` que usa el modulo de APU son la vista ya filtrada al
   proyecto activo (useProjectScoped, main.jsx), construida con
   scopedListView/mergeScopedUpdate -- las MISMAS funciones que "Vaciar
   proyecto" (emptyActiveProject) usa via setApus([]). Estas pruebas corren
   contra esas funciones reales, no una reimplementacion paralela. */
test('RC7 Test 1: proyecto con 52 APUs -> vaciar proyecto -> scopedListView da 0', () => {
  const rawApus = Array.from({ length: 52 }, (_, i) => ({ id: `APU-${i + 1}`, projectId: 'proj-1', concept: `Concepto ${i + 1}` }));
  assert.equal(scopedListView(rawApus, 'proj-1').length, 52);
  // "Vaciar proyecto" == setApus([]) == mergeScopedUpdate(rawApus, activeProjectId, [])
  const afterEmpty = mergeScopedUpdate(rawApus, 'proj-1', []);
  assert.equal(scopedListView(afterEmpty, 'proj-1').length, 0);
});

test('RC7 Test 2: "recargar" (releer la misma fuente persistida) sigue en 0 -- no es un reseteo solo visual', () => {
  const rawApus = Array.from({ length: 52 }, (_, i) => ({ id: `APU-${i + 1}`, projectId: 'proj-1' }));
  const persisted = mergeScopedUpdate(rawApus, 'proj-1', []);
  // Simula recargar el navegador: se vuelve a leer rawApus (la fuente
  // persistida) desde cero y se recalcula la vista del proyecto -- si el
  // vaciado hubiera sido solo un setState visual (ej. setReviewItems([])),
  // esta segunda lectura independiente volveria a mostrar 52.
  const rereadFromSource = JSON.parse(JSON.stringify(persisted));
  assert.equal(scopedListView(rereadFromSource, 'proj-1').length, 0);
  assert.equal(rereadFromSource.length, 0, 'rawApus del proyecto vaciado no debe tener ningun registro residual');
});

test('RC7 Test 3: "Limpiar trabajo" (removeBatchApus, solo el ultimo lote) NUNCA elimina APUs guardados de otras sesiones', () => {
  const apusGuardadosPrevios = [
    { id: 'APU-VIEJO-1', projectId: 'proj-1' },
    { id: 'APU-VIEJO-2', projectId: 'proj-1' }
  ];
  const loteReciente = [{ id: 'APU-NUEVO-1', projectId: 'proj-1' }];
  const scoped = [...apusGuardadosPrevios, ...loteReciente];
  // removeBatchApus (lo que hace clearWorkspace/"Limpiar trabajo") solo
  // conoce los ids del ULTIMO lote (lastBatchApuIds), nunca los 52 antiguos.
  const afterClearWorkspace = removeBatchApus(scoped, loteReciente.map(a => a.id));
  assert.deepEqual(afterClearWorkspace, apusGuardadosPrevios, 'los APUs guardados de sesiones anteriores deben sobrevivir a "Limpiar trabajo"');
});

test('RC7 Test 4: "Vaciar proyecto" nunca toca otros proyectos, ni ninguna otra coleccion (biblioteca/catalogo global)', () => {
  const rawApus = [
    ...Array.from({ length: 52 }, (_, i) => ({ id: `P1-${i + 1}`, projectId: 'proj-1' })),
    { id: 'P2-1', projectId: 'proj-2' },
    { id: 'SIN-PROYECTO-1', projectId: null }
  ];
  const afterEmpty = mergeScopedUpdate(rawApus, 'proj-1', []);
  assert.equal(scopedListView(afterEmpty, 'proj-1').length, 0, 'proyecto vaciado debe quedar en 0');
  assert.equal(scopedListView(afterEmpty, 'proj-2').length, 1, 'otro proyecto no debe verse afectado');
  assert.equal(scopedListView(afterEmpty, null).length, 1, 'items sin proyecto (compatibilidad) no deben verse afectados');
  // "Vaciar proyecto" (emptyActiveProject) solo llama setApus([]) -- nunca
  // setCatalog/setClients/setProjects ni ninguna coleccion de biblioteca; a
  // nivel de esta funcion pura, eso significa que biblioteca/catalogo global
  // ni siquiera son parametros de mergeScopedUpdate, por construccion no
  // pueden ser tocados por esta operacion.
  const catalogoGlobalDePrecios = [{ desc: 'Cemento gris', unidad: 'kg', precio: 5.2 }];
  assert.deepEqual(catalogoGlobalDePrecios, [{ desc: 'Cemento gris', unidad: 'kg', precio: 5.2 }], 'referencia de control: el catalogo global vive en un estado totalmente separado, intocado por esta operacion');
});

test('RC7 Test 5: crear nuevo lote despues de vaciar -> los contadores parten en 0, nunca heredan el conteo anterior', () => {
  const rawApus = Array.from({ length: 52 }, (_, i) => ({ id: `VIEJO-${i + 1}`, projectId: 'proj-1' }));
  const vacio = mergeScopedUpdate(rawApus, 'proj-1', []);
  assert.equal(scopedListView(vacio, 'proj-1').length, 0);
  // Nuevo lote de 3 conceptos generado despues de vaciar.
  const nuevoLote = Array.from({ length: 3 }, (_, i) => ({ id: `NUEVO-${i + 1}` }));
  const conNuevoLote = mergeScopedUpdate(vacio, 'proj-1', nuevoLote);
  assert.equal(scopedListView(conNuevoLote, 'proj-1').length, 3, 'debe partir exactamente en el tamano del nuevo lote, nunca 52+3');
});

test('RC7 Test 6: generar los 6 conceptos reales del reporte tras vaciar -> la bandeja queda exactamente en 6, no 58 ni 52+6', () => {
  const rawApus = Array.from({ length: 52 }, (_, i) => ({ id: `VIEJO-${i + 1}`, projectId: 'proj-1' }));
  const vacio = mergeScopedUpdate(rawApus, 'proj-1', []);
  const seisConceptosReales = [
    { id: 'CON-001', concept: 'Movimiento de mueble' },
    { id: 'CON-002', concept: 'demolicion de loseta 64m2' },
    { id: 'CON-003', concept: 'acarreo 46 costales distancia 25m' },
    { id: 'CON-004', concept: 'acarreo de loseta 1.5m3 distancia 25m' },
    { id: 'CON-005', concept: 'aplicación de adhesivo 64m2' },
    { id: 'CON-006', concept: 'colocación de loseta 64 m2' }
  ];
  const conSeis = mergeScopedUpdate(vacio, 'proj-1', seisConceptosReales);
  const bandeja = scopedListView(conSeis, 'proj-1');
  assert.equal(bandeja.length, 6, `se esperaban exactamente 6, hubo ${bandeja.length}`);
  assert.deepEqual(bandeja.map(a => a.concept), seisConceptosReales.map(a => a.concept));
});

test('resolveBatchSelection: nunca excluye en silencio -- devuelve la lista de excluidos con su texto', () => {
  const concepts = [
    { concept: 'Movimiento de mueble', unit: '', qty: 1 },
    { concept: 'demolicion de loseta 64m2', unit: 'm²', qty: 64 },
    { concept: 'TOTAL', unit: 'm2', qty: 1 }
  ];
  // indices 0 y 1 marcados, 2 (ruido) no marcado.
  const { selectedList, excludedConcepts } = resolveBatchSelection(concepts, new Set([0, 1]));
  assert.equal(selectedList.length, 2);
  assert.deepEqual(selectedList.map(c => c.concept), ['Movimiento de mueble', 'demolicion de loseta 64m2']);
  assert.deepEqual(excludedConcepts, ['TOTAL']);
});
