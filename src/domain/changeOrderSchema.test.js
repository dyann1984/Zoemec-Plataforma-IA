import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyChangeOrder, validateChangeOrder, isLegalChangeOrderTransition, isTerminalChangeOrderStatus, computeChangeOrderEconomicImpact, CHANGE_ORDER_STATUS } from './changeOrderSchema.js';

test('computeChangeOrderEconomicImpact: (nueva-anterior) x P.U., positivo si aumenta', () => {
  assert.equal(computeChangeOrderEconomicImpact({ cantidadAnterior: 10, cantidadNueva: 15, pu: 100 }), 500);
});

test('computeChangeOrderEconomicImpact: negativo si la cantidad se reduce (ahorro)', () => {
  assert.equal(computeChangeOrderEconomicImpact({ cantidadAnterior: 10, cantidadNueva: 6, pu: 100 }), -400);
});

test('makeEmptyChangeOrder arranca en BORRADOR con impactoEconomico ya calculado', () => {
  const co = makeEmptyChangeOrder({ projectId: 'PRO-1', conceptoId: 'CAT-1', motivo: 'Cambio de especificacion', cantidadAnterior: 10, cantidadNueva: 20, pu: 50 });
  assert.equal(co.status, CHANGE_ORDER_STATUS.BORRADOR);
  assert.equal(co.impactoEconomico, 500);
  assert.ok(co.id.startsWith('CO-'));
});

test('validateChangeOrder exige projectId/conceptoId/motivo y cantidad distinta', () => {
  const co = makeEmptyChangeOrder({ projectId: 'PRO-1', conceptoId: 'CAT-1', motivo: 'x', cantidadAnterior: 10, cantidadNueva: 20, pu: 50 });
  assert.equal(validateChangeOrder(co).valid, true);
  assert.equal(validateChangeOrder({ ...co, motivo: '' }).valid, false);
  assert.equal(validateChangeOrder({ ...co, cantidadAnterior: 20, cantidadNueva: 20 }).valid, false);
});

test('transiciones legales: BORRADOR->EN_REVISION->APROBADA/RECHAZADA, BORRADOR/EN_REVISION->CANCELADA', () => {
  assert.equal(isLegalChangeOrderTransition('BORRADOR', 'EN_REVISION'), true);
  assert.equal(isLegalChangeOrderTransition('EN_REVISION', 'APROBADA'), true);
  assert.equal(isLegalChangeOrderTransition('EN_REVISION', 'RECHAZADA'), true);
  assert.equal(isLegalChangeOrderTransition('BORRADOR', 'CANCELADA'), true);
  assert.equal(isLegalChangeOrderTransition('EN_REVISION', 'CANCELADA'), true);
});

test('estados terminales nunca aceptan otra transicion -- una orden aprobada/rechazada/cancelada es definitiva', () => {
  assert.equal(isLegalChangeOrderTransition('APROBADA', 'RECHAZADA'), false);
  assert.equal(isLegalChangeOrderTransition('APROBADA', 'EN_REVISION'), false);
  assert.equal(isLegalChangeOrderTransition('RECHAZADA', 'EN_REVISION'), false);
  assert.equal(isLegalChangeOrderTransition('CANCELADA', 'EN_REVISION'), false);
  assert.equal(isTerminalChangeOrderStatus('APROBADA'), true);
  assert.equal(isTerminalChangeOrderStatus('RECHAZADA'), true);
  assert.equal(isTerminalChangeOrderStatus('CANCELADA'), true);
  assert.equal(isTerminalChangeOrderStatus('BORRADOR'), false);
  assert.equal(isTerminalChangeOrderStatus('EN_REVISION'), false);
});

test('no se puede saltar BORRADOR -> APROBADA directo (debe pasar por EN_REVISION)', () => {
  assert.equal(isLegalChangeOrderTransition('BORRADOR', 'APROBADA'), false);
});
