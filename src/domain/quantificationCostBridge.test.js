import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfirmedQuantity,
  toCatalogConceptInput,
  syncQuantificationToCatalog,
  isManualOrImportedQuantity
} from './quantificationCostBridge.js';
import { aggregatePresupuesto } from './presupuestoAggregation.js';

const takeoff = (qty = 24.5, projectId = 'PRO-1') => ({
  projectId, concept: 'Muro neto', unit: 'm2', qty,
  sourceType: 'takeoff', sourceRecordId: 'PLANO-1', sourceElementId: 'wall-1',
  planId: 'PLANO-1', confirmedBy: 'qa@example.test'
});

test('Takeoff confirmado crea un concepto económico con procedencia', () => {
  const concept = toCatalogConceptInput(takeoff());
  assert.equal(concept.projectId, 'PRO-1');
  assert.equal(concept.qty, 24.5);
  assert.equal(concept.origenElementoId, 'PLANO-1:wall-1');
  assert.equal(concept.origenPlano.planoTakeoffId, 'PLANO-1');
  assert.equal(concept.sourceType, 'takeoff');
});

test('repetir la sincronización conserva la identidad idempotente', async () => {
  const requests = [];
  const request = async (_path, body) => { requests.push(body); return { created: 1, updated: 1, conceptos: body.conceptos }; };
  await syncQuantificationToCatalog([takeoff()], { request });
  await syncQuantificationToCatalog([takeoff()], { request });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].conceptos[0].origenElementoId, requests[1].conceptos[0].origenElementoId);
});

test('cambiar qty actualiza el mismo concepto, sin cambiar su identidad', () => {
  const before = normalizeConfirmedQuantity(takeoff(24.5));
  const after = normalizeConfirmedQuantity(takeoff(26));
  assert.equal(before.origenElementoId, after.origenElementoId);
  assert.equal(after.qty, 26);
});

test('una entrada de otro projectId no se mezcla en un lote', async () => {
  await assert.rejects(
    syncQuantificationToCatalog([takeoff(1, 'PRO-1'), takeoff(2, 'PRO-2')], { request: async () => ({}) }),
    /projectId/
  );
});

test('Survey confirmado conserva procedencia propia', () => {
  const concept = toCatalogConceptInput({
    projectId: 'PRO-1', concept: 'Muros netos', unit: 'm2', qty: 91.71,
    sourceType: 'survey', sourceRecordId: 'SUR-1', sourceElementId: 'wallNet',
    surveyId: 'SUR-1'
  });
  assert.equal(concept.origenElementoId, 'survey:SUR-1:wallNet');
  assert.equal(concept.origenPlano.surveyId, 'SUR-1');
  assert.equal(concept.qty, 91.71);
});

test('APU sourceQty y cantidadObra no sustituyen la cantidad del catálogo', () => {
  const concept = toCatalogConceptInput({ ...takeoff(24.5), sourceQty: 99, cantidadObra: 99 });
  assert.equal(concept.qty, 24.5);
});

test('referencePU no sobreescribe el calculated.pu del APU', () => {
  const result = aggregatePresupuesto([{
    conceptoId: 'CAT-1', capitulo: 'OTROS', qty: 2, pu: 12.5,
    direct: 8, iva: 2, apuId: 'APU-1', referencePU: 999
  }]);
  assert.equal(result.rows[0].pu, 12.5);
  assert.equal(result.rows[0].importe, 25);
});

test('Presupuesto conserva qty por calculated.pu', () => {
  const result = aggregatePresupuesto([{ capitulo: 'OTROS', qty: 26, pu: 10, direct: 7 }]);
  assert.equal(result.importeTotal, 260);
});

test('cantidad manual/importada no representa cuantificación confirmada', () => {
  assert.equal(isManualOrImportedQuantity({ sourceType: 'manual' }), true);
  assert.equal(isManualOrImportedQuantity({ sourceType: 'import' }), true);
  assert.equal(isManualOrImportedQuantity({ sourceType: 'takeoff' }), false);
});

test('regresión de Muros netos 91.71 m² llega intacta al concepto económico', () => {
  const concept = toCatalogConceptInput({
    projectId: 'PRO-1', concept: 'Muros netos', unit: 'm2', qty: 96 - 1.89 - 2.4,
    sourceType: 'survey', sourceRecordId: 'SUR-1', sourceElementId: 'wallNet', surveyId: 'SUR-1'
  });
  assert.equal(concept.qty, 91.71);
});
