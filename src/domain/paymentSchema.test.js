import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePayment, validatePayment, evaluatePaymentGuard } from './paymentSchema.js';

test('makePayment produce un registro con id/monto/usuario', () => {
  const p = makePayment({ projectId: 'PRO-1', monto: 5000, proveedor: 'Aceros SA', usuario: 'ana' });
  assert.ok(p.id.startsWith('PAY-'));
  assert.equal(p.monto, 5000);
});

test('validatePayment exige proveedor y monto > 0', () => {
  const p = makePayment({ projectId: 'PRO-1', monto: 100, proveedor: 'X' });
  assert.equal(validatePayment(p).valid, true);
  assert.equal(validatePayment({ ...p, monto: 0 }).valid, false);
  assert.equal(validatePayment({ ...p, proveedor: '' }).valid, false);
});

test('evaluatePaymentGuard: sin estimacion vinculada, nunca evalua exceso (no hay contra que comparar)', () => {
  const r = evaluatePaymentGuard({ montoPago: 1000, totalEstimado: undefined, totalPagadoPrevio: 0 });
  assert.equal(r.exceedsEstimate, false);
  assert.equal(r.reason, 'SIN_ESTIMACION');
});

test('evaluatePaymentGuard: pagado acumulado > estimado se marca, NUNCA bloquea (regla 16: excepcion documentada)', () => {
  const r = evaluatePaymentGuard({ montoPago: 600, totalEstimado: 1000, totalPagadoPrevio: 700 });
  assert.equal(r.exceedsEstimate, true);
  assert.equal(r.reason, 'PAGADO_MAYOR_A_ESTIMADO');
});

test('evaluatePaymentGuard: dentro del estimado, sin marca', () => {
  const r = evaluatePaymentGuard({ montoPago: 200, totalEstimado: 1000, totalPagadoPrevio: 700 });
  assert.equal(r.exceedsEstimate, false);
});
