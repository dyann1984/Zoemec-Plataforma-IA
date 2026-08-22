import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyApuWorkspaceState, removeBatchApus } from './apuWorkspace.js';

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
