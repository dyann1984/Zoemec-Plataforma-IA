import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCostRows, classifyCostConcept, summarizeCosts } from './costStageModel.js';

test('CostStage calcula exclusivamente qty × calculated.pu', () => {
  const rows = buildCostRows([
    { id: 'C1', projectId: 'P1', concept: 'Muros netos', unit: 'm²', qty: 26, sourceType: 'survey', apuId: 'A1' }
  ], [{ id: 'A1', projectId: 'P1', calculated: { pu: 10, iva: 99 }, sourceQty: 999 }], 'P1');
  assert.equal(rows[0].importe, 260);
  assert.equal(summarizeCosts(rows).subtotal, 260);
});

test('CostStage distingue falta de APU, P.U. faltante y concepto listo', () => {
  assert.equal(classifyCostConcept({ qty: 10 }, null).status, 'falta-apu');
  assert.equal(classifyCostConcept({ qty: 10, apuId: 'A1' }, { id: 'A1', calculated: { pu: 0 } }).status, 'apu-incompleto');
  assert.equal(classifyCostConcept({ qty: 10, apuId: 'A1' }, { id: 'A1', calculated: { pu: 5 } }).status, 'listo');
  assert.equal(classifyCostConcept({ qty: 0, apuId: 'A1' }, { id: 'A1', calculated: { pu: 5 } }).status, 'sin-cantidad');
});

test('CostStage filtra projectId y conserva origen y región sin disparar consultas', () => {
  const [row] = buildCostRows([
    { id: 'C1', projectId: 'P1', qty: 91.71, sourceType: 'survey', surveyId: 'S1', apuId: 'A1', ubicacionEstructurada: { country: 'MX', state: 'CDMX', city: 'CDMX' } },
    { id: 'C2', projectId: 'P2', qty: 50, apuId: 'A1' }
  ], [{ id: 'A1', projectId: 'P1', calculated: { pu: 741.66 }, materials: [] }], 'P1');
  assert.equal(row.origin, 'Survey');
  assert.equal(row.regional.city, 'CDMX');
  assert.equal(row.importe, 91.71 * 741.66);
});
