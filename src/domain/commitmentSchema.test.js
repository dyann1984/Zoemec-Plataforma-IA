import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyCommitment, validateCommitment, isLegalCommitmentTransition, isActiveCommitment, COMMITMENT_STATUS, COMMITMENT_TYPE } from './commitmentSchema.js';

test('makeEmptyCommitment arranca ACTIVO', () => {
  const c = makeEmptyCommitment({ projectId: 'PRO-1', conceptoId: 'CAT-1', proveedor: 'Aceros SA', monto: 50000 });
  assert.equal(c.status, COMMITMENT_STATUS.ACTIVO);
  assert.equal(c.tipo, COMMITMENT_TYPE.ORDEN_COMPRA);
  assert.ok(c.id.startsWith('CMT-'));
});

test('validateCommitment exige proveedor y monto > 0', () => {
  const c = makeEmptyCommitment({ projectId: 'PRO-1', proveedor: 'Aceros SA', monto: 100 });
  assert.equal(validateCommitment(c).valid, true);
  assert.equal(validateCommitment({ ...c, proveedor: '' }).valid, false);
  assert.equal(validateCommitment({ ...c, monto: 0 }).valid, false);
});

test('isActiveCommitment solo es true para ACTIVO -- CERRADO/CANCELADO nunca cuentan como comprometido', () => {
  const c = makeEmptyCommitment({ projectId: 'PRO-1', proveedor: 'X', monto: 1 });
  assert.equal(isActiveCommitment(c), true);
  assert.equal(isActiveCommitment({ ...c, status: 'CERRADO' }), false);
  assert.equal(isActiveCommitment({ ...c, status: 'CANCELADO' }), false);
});

test('transiciones: ACTIVO -> CERRADO/CANCELADO; ambos terminales', () => {
  assert.equal(isLegalCommitmentTransition('ACTIVO', 'CERRADO'), true);
  assert.equal(isLegalCommitmentTransition('ACTIVO', 'CANCELADO'), true);
  assert.equal(isLegalCommitmentTransition('CERRADO', 'ACTIVO'), false);
  assert.equal(isLegalCommitmentTransition('CANCELADO', 'ACTIVO'), false);
});
