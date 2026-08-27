import test from 'node:test';
import assert from 'node:assert/strict';
import { INSUMO_STATES, isValidInsumoState, applyInsumoReview, toCatalogRow, extractValidatedCatalogRows, extractAllValidatedCatalogRows, mergeCatalogRows } from './libraryReview.js';

test('isValidInsumoState solo acepta PROPUESTO/VALIDADO/RECHAZADO', () => {
  assert.equal(isValidInsumoState('VALIDADO'), true);
  assert.equal(isValidInsumoState('PROPUESTO'), true);
  assert.equal(isValidInsumoState('RECHAZADO'), true);
  assert.equal(isValidInsumoState('PENDIENTE'), false);
  assert.equal(isValidInsumoState('verificado'), false);
});

test('applyInsumoReview exige usuario al validar o rechazar', () => {
  assert.throws(() => applyInsumoReview({ index: 0, state: 'PROPUESTO' }, { state: 'VALIDADO' }));
  assert.throws(() => applyInsumoReview({ index: 0, state: 'PROPUESTO' }, { state: 'RECHAZADO' }));
  const ok = applyInsumoReview({ index: 0, state: 'PROPUESTO' }, { state: 'VALIDADO', validatedBy: 'diana@zoemec.com' });
  assert.equal(ok.state, 'VALIDADO');
  assert.equal(ok.validatedBy, 'diana@zoemec.com');
  assert.ok(ok.validatedAt);
});

test('applyInsumoReview rechaza estados invalidos', () => {
  assert.throws(() => applyInsumoReview({ index: 0 }, { state: 'CONFIRMADO', validatedBy: 'x' }));
});

test('toCatalogRow: PROPUESTO nunca entra al catalogo/APU', () => {
  const insumo = { desc: 'Block hueco 15x20x40', unidad: 'pza', precio: 15.5 };
  const review = { index: 0, state: 'PROPUESTO', validatedBy: null, validatedAt: null };
  assert.equal(toCatalogRow(insumo, review), null);
});

test('toCatalogRow: RECHAZADO nunca entra al catalogo/APU', () => {
  const insumo = { desc: 'Block hueco 15x20x40', unidad: 'pza', precio: 15.5 };
  const review = { index: 0, state: 'RECHAZADO', validatedBy: 'diana@zoemec.com', validatedAt: '2026-08-21T10:00:00Z' };
  assert.equal(toCatalogRow(insumo, review), null);
});

test('toCatalogRow: VALIDADO si puede alimentar el catalogo/APU con el shape correcto', () => {
  const insumo = { desc: 'Block hueco 15x20x40', unidad: 'pza', precio: 15.5 };
  const review = { index: 0, state: 'VALIDADO', validatedBy: 'diana@zoemec.com', validatedAt: '2026-08-21T10:00:00Z' };
  const row = toCatalogRow(insumo, review);
  assert.deepEqual(row, { desc: 'Block hueco 15x20x40', unidad: 'pza', precio: 15.5, estado: 'BIBLIOTECA' });
});

test('toCatalogRow: preserva clave/categoria/sinonimos SOLO cuando el insumo ya los trae (nunca los inventa)', () => {
  const review = { index: 0, state: 'VALIDADO', validatedBy: 'diana@zoemec.com', validatedAt: '2026-08-21T10:00:00Z' };
  const sinPlus = toCatalogRow({ desc: 'Block hueco 15x20x40', unidad: 'pza', precio: 15.5 }, review);
  assert.equal('clave' in sinPlus, false);
  assert.equal('categoria' in sinPlus, false);
  assert.equal('sinonimos' in sinPlus, false);
  const conPlus = toCatalogRow({
    desc: 'Block hueco 15x20x40', unidad: 'pza', precio: 15.5,
    clave: 'MAT-BLOCK-15', categoria: 'Mamposteria', sinonimos: ['Tabique hueco 15cm']
  }, review);
  assert.equal(conPlus.clave, 'MAT-BLOCK-15');
  assert.equal(conPlus.categoria, 'Mamposteria');
  assert.deepEqual(conPlus.sinonimos, ['Tabique hueco 15cm']);
});

test('toCatalogRow: sin review (nunca revisado) no entra al catalogo', () => {
  const insumo = { desc: 'Block hueco 15x20x40', unidad: 'pza', precio: 15.5 };
  assert.equal(toCatalogRow(insumo, undefined), null);
});

test('toCatalogRow: insumo VALIDADO pero sin precio positivo no entra', () => {
  const insumo = { desc: 'Item sin precio', unidad: 'pza', precio: 0 };
  const review = { index: 0, state: 'VALIDADO', validatedBy: 'diana@zoemec.com', validatedAt: '2026-08-21T10:00:00Z' };
  assert.equal(toCatalogRow(insumo, review), null);
});

test('extractValidatedCatalogRows: filtra un documento completo dejando solo VALIDADO, con trazabilidad', () => {
  const doc = {
    id: 'LIB-001',
    name: 'FASAR OPUS.xlsx',
    contentInsumos: [
      { desc: 'Cemento portland 50kg', unidad: 'bulto', precio: 180, rowRef: 5 },
      { desc: 'Arena lavada m3', unidad: 'm3', precio: 450, rowRef: 6 },
      { desc: 'Descartado por el usuario', unidad: 'pza', precio: 999, rowRef: 7 }
    ],
    insumosReview: [
      { index: 0, state: 'VALIDADO', validatedBy: 'diana@zoemec.com', validatedAt: '2026-08-21T10:00:00Z' },
      { index: 1, state: 'PROPUESTO', validatedBy: null, validatedAt: null },
      { index: 2, state: 'RECHAZADO', validatedBy: 'diana@zoemec.com', validatedAt: '2026-08-21T10:05:00Z' }
    ]
  };
  const rows = extractValidatedCatalogRows(doc);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].desc, 'Cemento portland 50kg');
  assert.equal(rows[0].precio, 180);
  assert.equal(rows[0].traceability.sourceDocId, 'LIB-001');
  assert.equal(rows[0].traceability.sourceDocName, 'FASAR OPUS.xlsx');
  assert.equal(rows[0].traceability.rowRef, 5);
  assert.equal(rows[0].traceability.validatedBy, 'diana@zoemec.com');
});

test('extractValidatedCatalogRows: documento sin ningun VALIDADO regresa arreglo vacio', () => {
  const doc = {
    id: 'LIB-002', name: 'x.xlsx',
    contentInsumos: [{ desc: 'a', unidad: 'pza', precio: 10 }],
    insumosReview: [{ index: 0, state: 'PROPUESTO', validatedBy: null, validatedAt: null }]
  };
  assert.deepEqual(extractValidatedCatalogRows(doc), []);
});

test('INSUMO_STATES expone exactamente los 3 estados esperados', () => {
  assert.deepEqual(Object.values(INSUMO_STATES).sort(), ['PROPUESTO', 'RECHAZADO', 'VALIDADO']);
});

test('extractAllValidatedCatalogRows: agrega VALIDADOS de varios documentos, no solo el abierto', () => {
  const docs = [
    {
      id: 'LIB-001', name: 'A.xlsx',
      contentInsumos: [{ desc: 'Cemento portland 50kg', unidad: 'bulto', precio: 180 }],
      insumosReview: [{ index: 0, state: 'VALIDADO', validatedBy: 'diana@zoemec.com', validatedAt: '2026-08-21T10:00:00Z' }]
    },
    {
      id: 'LIB-002', name: 'B.xlsx',
      contentInsumos: [{ desc: 'Arena lavada m3', unidad: 'm3', precio: 450 }],
      insumosReview: [{ index: 0, state: 'VALIDADO', validatedBy: 'diana@zoemec.com', validatedAt: '2026-08-21T10:01:00Z' }]
    },
    { id: 'LIB-003', name: 'C.xlsx', contentInsumos: [], insumosReview: [] }
  ];
  const rows = extractAllValidatedCatalogRows(docs);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.desc).sort(), ['Arena lavada m3', 'Cemento portland 50kg']);
});

test('mergeCatalogRows: dedup por clave, conserva trazabilidad (no la tira como la fusion anterior)', () => {
  const existing = [{ desc: 'Cemento gris', unidad: 'saco', precio: 170, clave: 'MAT-001' }];
  const incoming = [
    { desc: 'Cemento gris', unidad: 'saco', precio: 182, clave: 'MAT-001', traceability: { sourceDocId: 'LIB-1' } },
    { desc: 'Arena lavada', unidad: 'm3', precio: 450, traceability: { sourceDocId: 'LIB-1' } }
  ];
  const merged = mergeCatalogRows(existing, incoming);
  assert.equal(merged.length, 2);
  const cemento = merged.find(r => r.clave === 'MAT-001');
  assert.equal(cemento.precio, 182);
  assert.equal(cemento.traceability.sourceDocId, 'LIB-1');
  const arena = merged.find(r => r.desc === 'Arena lavada');
  assert.ok(arena.traceability);
});

test('mergeCatalogRows: dedup por desc+unidad normalizada cuando no hay clave', () => {
  const existing = [{ desc: 'Arena lavada', unidad: 'M3', precio: 400 }];
  const incoming = [{ desc: ' arena lavada ', unidad: 'm3', precio: 450 }];
  const merged = mergeCatalogRows(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].precio, 450);
});

test('mergeCatalogRows: sin catalogo previo, simplemente adopta las filas nuevas', () => {
  const merged = mergeCatalogRows(null, [{ desc: 'x', unidad: 'pza', precio: 1 }]);
  assert.equal(merged.length, 1);
});
