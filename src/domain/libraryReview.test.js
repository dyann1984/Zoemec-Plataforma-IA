import test from 'node:test';
import assert from 'node:assert/strict';
import { INSUMO_STATES, isValidInsumoState, applyInsumoReview, toCatalogRow, extractValidatedCatalogRows } from './libraryReview.js';

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
  assert.deepEqual(row, { desc: 'Block hueco 15x20x40', unidad: 'pza', precio: 15.5 });
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
