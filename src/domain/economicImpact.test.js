import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGeometryImpact, formatImpactSummary } from './economicImpact.js';

/* Caso obligatorio del brief §39 y §5: cantidad 11.295 -> 12.51 con
   P.U. $748.15/m2 debe dar variacion +1.215 m2 e impacto +$909.00
   (redondeado a 2 decimales de matematicas reales, no copiado del brief). */
test('computeGeometryImpact: 11.295 -> 12.51 @ 748.15 = +1.215 / +$909.00', () => {
  const r = computeGeometryImpact({ previousQty: 11.295, currentQty: 12.51, pu: 748.15 });
  assert.equal(r.deltaQty, 1.215);
  assert.equal(r.direction, 'increase');
  // Cifra real: 1.215 * 748.15 = 909.00225 -> redondeo a 2 = 909.00
  assert.equal(r.deltaAmount, 909.00);
});

test('computeGeometryImpact: decremento se reporta como direction=decrease y monto negativo', () => {
  const r = computeGeometryImpact({ previousQty: 12.51, currentQty: 11.295, pu: 748.15 });
  assert.equal(r.deltaQty, -1.215);
  assert.equal(r.direction, 'decrease');
  assert.equal(r.deltaAmount, -909.00);
});

test('computeGeometryImpact: PU inexistente NO produce NaN (impacto queda null, delta se conserva)', () => {
  const r = computeGeometryImpact({ previousQty: 10, currentQty: 12, pu: null });
  assert.equal(r.deltaQty, 2);
  assert.equal(r.pu, null);
  assert.equal(r.deltaAmount, null);
  assert.equal(r.direction, 'increase');
});

test('computeGeometryImpact: PU no numerico (string vacio, NaN, undefined) no rompe', () => {
  ['', undefined, NaN, 'abc'].forEach(pu => {
    const r = computeGeometryImpact({ previousQty: 10, currentQty: 12, pu });
    assert.equal(r.deltaAmount, null, `pu=${JSON.stringify(pu)} no debe dar NaN`);
  });
});

test('computeGeometryImpact: cantidad anterior null se trata como 0 (alta inicial)', () => {
  const r = computeGeometryImpact({ previousQty: null, currentQty: 12.51, pu: 100 });
  assert.equal(r.previousQty, 0);
  assert.equal(r.deltaQty, 12.51);
  assert.equal(r.deltaAmount, 1251.00);
});

test('computeGeometryImpact: sin cambio (misma cantidad) reporta direction=unchanged y monto 0', () => {
  const r = computeGeometryImpact({ previousQty: 11.295, currentQty: 11.295, pu: 748.15 });
  assert.equal(r.deltaQty, 0);
  assert.equal(r.direction, 'unchanged');
  assert.equal(r.deltaAmount, 0);
});

test('computeGeometryImpact: cambio menor a la tolerancia (< 0.000001) es unchanged', () => {
  const r = computeGeometryImpact({ previousQty: 11.29500001, currentQty: 11.29500002, pu: 100 });
  assert.equal(r.direction, 'unchanged');
});

test('formatImpactSummary: pinta cifras en es-MX con unidad y moneda', () => {
  const impact = computeGeometryImpact({ previousQty: 11.295, currentQty: 12.51, pu: 748.15 });
  const s = formatImpactSummary(impact, { unit: 'm²', currency: 'MXN' });
  assert.match(s.previousQtyText, /11\.295 m²/);
  assert.match(s.currentQtyText, /12\.510 m²/);
  assert.match(s.deltaQtyText, /\+1\.215 m²/);
  assert.match(s.puText, /\$748\.15/);
  assert.match(s.deltaAmountText, /\+\$909\.00/);
  assert.equal(s.hasCostImpact, true);
});

test('formatImpactSummary: sin P.U. reporta texto claro, no simula un $0.00', () => {
  const impact = computeGeometryImpact({ previousQty: 10, currentQty: 12, pu: null });
  const s = formatImpactSummary(impact, { unit: 'm²' });
  assert.equal(s.puText, 'Sin P.U.');
  assert.match(s.deltaAmountText, /Sin P\.U\./);
  assert.equal(s.hasCostImpact, false);
});
