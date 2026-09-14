import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyCatalogConcepto, validateCatalogConcepto, isLegalStatusTransition, CATALOG_CONCEPTO_STATUS } from './catalogConceptoSchema.js';

test('makeEmptyCatalogConcepto arranca en PENDIENTE, sin APU, capitulo normalizado', () => {
  const c = makeEmptyCatalogConcepto({ projectId: 'PRO-1', concept: 'Muro de block', unit: 'm²', qty: 12, capitulo: 'albañilería' });
  assert.equal(c.status, CATALOG_CONCEPTO_STATUS.PENDIENTE);
  assert.equal(c.apuId, null);
  assert.equal(c.capitulo, 'ALBANILERIA');
  assert.ok(c.id.startsWith('CAT-'));
});

test('validateCatalogConcepto exige projectId/concept/unit/qty>0', () => {
  const c = makeEmptyCatalogConcepto({ projectId: 'PRO-1', concept: 'Muro', unit: 'm²', qty: 5 });
  assert.equal(validateCatalogConcepto(c).valid, true);
  assert.equal(validateCatalogConcepto({ ...c, projectId: null }).valid, false);
  assert.equal(validateCatalogConcepto({ ...c, qty: 0 }).valid, false);
  assert.equal(validateCatalogConcepto({ ...c, concept: '' }).valid, false);
});

test('transiciones legales de estado', () => {
  assert.equal(isLegalStatusTransition('PENDIENTE', 'GENERANDO'), true);
  assert.equal(isLegalStatusTransition('GENERANDO', 'GENERADO'), true);
  assert.equal(isLegalStatusTransition('GENERANDO', 'ERROR'), true);
  assert.equal(isLegalStatusTransition('ERROR', 'GENERANDO'), true);
  assert.equal(isLegalStatusTransition('ASOCIADO', 'ASOCIADO'), true);
});

test('transiciones ilegales de estado se rechazan', () => {
  assert.equal(isLegalStatusTransition('PENDIENTE', 'GENERADO'), false);
  assert.equal(isLegalStatusTransition('GENERADO', 'ERROR'), false);
});
