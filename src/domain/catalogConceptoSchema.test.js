import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyCatalogConcepto, validateCatalogConcepto, isLegalStatusTransition, reclassifyStaleGenerando, STALE_GENERANDO_MS, CATALOG_CONCEPTO_STATUS } from './catalogConceptoSchema.js';

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

/* PRUEBA ESPECIFICA (Fase D.1): un concepto GENERANDO huerfano (proceso que
   lo disparo murio sin reportar) debe reclasificarse a ERROR -- nunca
   quedarse girando para siempre, nunca fingir GENERADO. Mismo criterio que
   AiJobsContext.jsx#markInterruptedOnLoad, aplicado al estado durable del
   concepto en vez del registro efimero de jobs. */
test('reclassifyStaleGenerando: un GENERANDO mas viejo que el umbral se reclasifica a ERROR', () => {
  const now = Date.now();
  const stale = { id: 'CAT-1', status: 'GENERANDO', updatedAt: new Date(now - STALE_GENERANDO_MS - 1000).toISOString() };
  const { conceptos, reclassified } = reclassifyStaleGenerando([stale], now);
  assert.equal(conceptos[0].status, 'ERROR');
  assert.ok(conceptos[0].statusError);
  assert.equal(reclassified.length, 1);
  assert.equal(reclassified[0].id, 'CAT-1');
});

test('reclassifyStaleGenerando: un GENERANDO reciente (dentro del umbral) se deja intacto', () => {
  const now = Date.now();
  const fresh = { id: 'CAT-2', status: 'GENERANDO', updatedAt: new Date(now - 5000).toISOString() };
  const { conceptos, reclassified } = reclassifyStaleGenerando([fresh], now);
  assert.equal(conceptos[0], fresh, 'el objeto debe ser EXACTAMENTE el mismo, sin clonar, cuando no cambia');
  assert.equal(reclassified.length, 0);
});

test('reclassifyStaleGenerando: nunca toca conceptos en otros estados, sin importar la edad', () => {
  const now = Date.now();
  const veryOldButDone = { id: 'CAT-3', status: 'GENERADO', updatedAt: new Date(now - 999999999).toISOString() };
  const { conceptos, reclassified } = reclassifyStaleGenerando([veryOldButDone], now);
  assert.equal(conceptos[0].status, 'GENERADO');
  assert.equal(reclassified.length, 0);
});

test('reclassifyStaleGenerando: una lista mixta solo reclasifica los GENERANDO viejos, preserva orden', () => {
  const now = Date.now();
  const list = [
    { id: 'A', status: 'PENDIENTE', updatedAt: new Date(now - 999999).toISOString() },
    { id: 'B', status: 'GENERANDO', updatedAt: new Date(now - STALE_GENERANDO_MS - 1).toISOString() },
    { id: 'C', status: 'GENERANDO', updatedAt: new Date(now - 1000).toISOString() },
    { id: 'D', status: 'ASOCIADO', updatedAt: new Date(now - 999999).toISOString() }
  ];
  const { conceptos, reclassified } = reclassifyStaleGenerando(list, now);
  assert.deepEqual(conceptos.map(c => c.id), ['A', 'B', 'C', 'D']);
  assert.equal(conceptos[1].status, 'ERROR');
  assert.equal(conceptos[2].status, 'GENERANDO');
  assert.deepEqual(reclassified.map(c => c.id), ['B']);
});

test('reclassifyStaleGenerando: nunca lanza con updatedAt ausente/invalido (edad se trata como maxima)', () => {
  const now = Date.now();
  const noUpdatedAt = { id: 'CAT-4', status: 'GENERANDO' };
  const badDate = { id: 'CAT-5', status: 'GENERANDO', updatedAt: 'no-es-fecha' };
  const { conceptos } = reclassifyStaleGenerando([noUpdatedAt, badDate], now);
  assert.equal(conceptos[0].status, 'ERROR');
  assert.equal(conceptos[1].status, 'ERROR');
});
