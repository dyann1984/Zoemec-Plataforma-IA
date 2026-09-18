import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEstimateTotals, makeEmptyEstimate, validateEstimate, isLegalEstimateTransition, ESTIMATE_STATUS } from './estimateSchema.js';

test('computeEstimateTotals: importeBruto = suma cantidadPeriodo x P.U.', () => {
  const t = computeEstimateTotals({ conceptos: [{ cantidadPeriodo: 10, pu: 100 }, { cantidadPeriodo: 5, pu: 200 }], retencionPct: 0, amortizacionPct: 0, deducciones: 0 });
  assert.equal(t.importeBruto, 2000);
  assert.equal(t.totalEstimado, 2000);
});

test('computeEstimateTotals: retencion y amortizacion se restan como porcentaje del bruto, deducciones como monto fijo', () => {
  const t = computeEstimateTotals({ conceptos: [{ cantidadPeriodo: 10, pu: 1000 }], retencionPct: 5, amortizacionPct: 10, deducciones: 200 });
  assert.equal(t.importeBruto, 10000);
  assert.equal(t.retencion, 500);
  assert.equal(t.amortizacion, 1000);
  assert.equal(t.deducciones, 200);
  assert.equal(t.totalEstimado, 10000 - 500 - 1000 - 200);
});

test('makeEmptyEstimate arranca en BORRADOR con totales ya calculados', () => {
  const e = makeEmptyEstimate({ projectId: 'PRO-1', numero: 1, conceptos: [{ conceptoId: 'C1', cantidadPeriodo: 10, pu: 100 }] });
  assert.equal(e.status, ESTIMATE_STATUS.BORRADOR);
  assert.equal(e.totalEstimado, 1000);
  assert.ok(e.id.startsWith('EST-OBRA-'));
});

test('validateEstimate exige al menos un concepto', () => {
  const e = makeEmptyEstimate({ projectId: 'PRO-1', conceptos: [{ conceptoId: 'C1', cantidadPeriodo: 10, pu: 100 }] });
  assert.equal(validateEstimate(e).valid, true);
  assert.equal(validateEstimate({ ...e, conceptos: [] }).valid, false);
});

test('transicion BORRADOR -> AUTORIZADA es legal; AUTORIZADA es terminal', () => {
  assert.equal(isLegalEstimateTransition('BORRADOR', 'AUTORIZADA'), true);
  assert.equal(isLegalEstimateTransition('AUTORIZADA', 'BORRADOR'), false);
});
