import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregatePresupuesto } from './presupuestoAggregation.js';

test('importe = cantidad x precio unitario por renglon', () => {
  const { rows } = aggregatePresupuesto([
    { conceptoId: 'C1', capitulo: 'CIMENTACION', qty: 10, pu: 500, direct: 300, apuId: 'A1' }
  ]);
  assert.equal(rows[0].importe, 5000);
  assert.equal(rows[0].directoImporte, 3000);
  assert.equal(rows[0].hasApu, true);
});

test('costoDirectoTotal e importeTotal suman sobre TODOS los renglones', () => {
  const { costoDirectoTotal, importeTotal } = aggregatePresupuesto([
    { capitulo: 'CIMENTACION', qty: 10, pu: 500, direct: 300, apuId: 'A1' },
    { capitulo: 'ALBANILERIA', qty: 20, pu: 200, direct: 120, apuId: 'A2' }
  ]);
  assert.equal(costoDirectoTotal, 10 * 300 + 20 * 120);
  assert.equal(importeTotal, 10 * 500 + 20 * 200);
});

test('subtotales agrupados por capitulo, en el orden fijo de PRESUPUESTO_CAPITULOS', () => {
  const { capituloSubtotals } = aggregatePresupuesto([
    { capitulo: 'ALBANILERIA', qty: 1, pu: 100, direct: 60, apuId: 'A1' },
    { capitulo: 'CIMENTACION', qty: 1, pu: 200, direct: 120, apuId: 'A2' },
    { capitulo: 'CIMENTACION', qty: 1, pu: 50, direct: 30, apuId: 'A3' }
  ]);
  assert.deepEqual(capituloSubtotals.map(c => c.capitulo), ['CIMENTACION', 'ALBANILERIA']);
  const cim = capituloSubtotals.find(c => c.capitulo === 'CIMENTACION');
  assert.equal(cim.importe, 250);
  assert.equal(cim.conceptCount, 2);
});

test('un concepto sin APU asociado (PENDIENTE) aparece con importe 0, nunca se excluye', () => {
  const { rows, capituloSubtotals } = aggregatePresupuesto([
    { capitulo: 'ACABADOS', qty: 5, apuId: null }
  ]);
  assert.equal(rows[0].hasApu, false);
  assert.equal(rows[0].importe, 0);
  assert.equal(capituloSubtotals.find(c => c.capitulo === 'ACABADOS').conceptCount, 1);
});

test('un capitulo desconocido/texto libre cae en OTROS, nunca rompe la agregacion', () => {
  const { capituloSubtotals } = aggregatePresupuesto([
    { capitulo: 'algo raro', qty: 1, pu: 10, direct: 5, apuId: 'A1' }
  ]);
  assert.deepEqual(capituloSubtotals.map(c => c.capitulo), ['OTROS']);
});

test('sin renglones, totales en 0 y sin subtotales', () => {
  const result = aggregatePresupuesto([]);
  assert.equal(result.costoDirectoTotal, 0);
  assert.equal(result.importeTotal, 0);
  assert.deepEqual(result.capituloSubtotals, []);
});

test('valores no numericos (NaN/undefined) nunca se propagan como NaN', () => {
  const { rows } = aggregatePresupuesto([
    { capitulo: 'CIMENTACION', qty: 'x', pu: undefined, direct: null, apuId: 'A1' }
  ]);
  assert.equal(rows[0].qty, 0);
  assert.equal(rows[0].importe, 0);
  assert.ok(Number.isFinite(rows[0].importe));
});
