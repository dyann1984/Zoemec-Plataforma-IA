import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isConceptInApprovedBudget, detectSpecChange, BASELINE_STATUS } from './budgetBaselineLookup.js';

function makePresupuesto({ id, baselineVersion = null, currentVersion = 'V1', archivedAt = null, rows = [], name = null }){
  return {
    id, baselineVersion, currentVersion, archivedAt,
    name,
    snapshot: { rows }
  };
}
function row({ conceptoId, capitulo = 'ALBANILERIA', qty = 10, pu = 100, unit = 'm²', apuId = 'APU-1', apuVersionId = 'V1' } = {}){
  return { conceptoId, clave: conceptoId, capitulo, concept: `Concepto ${conceptoId}`, unit, qty, pu, direct: pu, iva: pu*0.16, apuId, apuVersionId };
}

test('isConceptInApprovedBudget: sin presupuestos -> NO_BUDGET', () => {
  const r = isConceptInApprovedBudget([], 'CAT-1');
  assert.equal(r.status, BASELINE_STATUS.NO_BUDGET);
  assert.equal(r.presupuestoId, null);
});

test('isConceptInApprovedBudget: concepto NO listado en ningun presupuesto -> NO_BUDGET', () => {
  const p = makePresupuesto({ id: 'PRES-1', rows: [row({ conceptoId: 'CAT-OTRO' })] });
  const r = isConceptInApprovedBudget([p], 'CAT-1');
  assert.equal(r.status, BASELINE_STATUS.NO_BUDGET);
});

test('isConceptInApprovedBudget: concepto en presupuesto borrador -> DRAFT con contexto', () => {
  const p = makePresupuesto({ id: 'PRES-1', baselineVersion: null, rows: [row({ conceptoId: 'CAT-1', qty: 11.295, pu: 748.15 })] });
  const r = isConceptInApprovedBudget([p], 'CAT-1');
  assert.equal(r.status, BASELINE_STATUS.DRAFT);
  assert.equal(r.presupuestoId, 'PRES-1');
  assert.equal(r.cantidadContractual, 11.295);
  assert.equal(r.puContractual, 748.15);
  assert.equal(r.isApproved, false);
});

test('isConceptInApprovedBudget: concepto en presupuesto aprobado -> APPROVED con baselineVersion', () => {
  const p = makePresupuesto({ id: 'PRES-1', baselineVersion: 'V2', currentVersion: 'V3', rows: [row({ conceptoId: 'CAT-1', qty: 11.295, pu: 748.15 })] });
  const r = isConceptInApprovedBudget([p], 'CAT-1');
  assert.equal(r.status, BASELINE_STATUS.APPROVED);
  assert.equal(r.baselineVersion, 'V2');
  assert.equal(r.presupuestoVersion, 'V3');
  assert.equal(r.cantidadContractual, 11.295);
  assert.equal(r.puContractual, 748.15);
  assert.equal(r.isApproved, true);
});

test('isConceptInApprovedBudget: cuando hay borrador y aprobado, gana APPROVED', () => {
  const draft = makePresupuesto({ id: 'PRES-DRAFT', baselineVersion: null, rows: [row({ conceptoId: 'CAT-1', qty: 5, pu: 500 })] });
  const approved = makePresupuesto({ id: 'PRES-BASE', baselineVersion: 'V1', rows: [row({ conceptoId: 'CAT-1', qty: 11.295, pu: 748.15 })] });
  const r = isConceptInApprovedBudget([draft, approved], 'CAT-1');
  assert.equal(r.status, BASELINE_STATUS.APPROVED);
  assert.equal(r.presupuestoId, 'PRES-BASE');
  assert.equal(r.otherAppearances.length, 1);
  assert.equal(r.otherAppearances[0].presupuestoId, 'PRES-DRAFT');
});

test('isConceptInApprovedBudget: presupuesto archivado se ignora aunque tenga baselineVersion', () => {
  const p = makePresupuesto({ id: 'PRES-ARC', baselineVersion: 'V1', archivedAt: '2026-01-01', rows: [row({ conceptoId: 'CAT-1' })] });
  const r = isConceptInApprovedBudget([p], 'CAT-1');
  assert.equal(r.status, BASELINE_STATUS.NO_BUDGET);
});

test('isConceptInApprovedBudget: renglon con qty=0 no protege (no cuenta)', () => {
  const p = makePresupuesto({ id: 'PRES-1', baselineVersion: 'V1', rows: [row({ conceptoId: 'CAT-1', qty: 0 })] });
  const r = isConceptInApprovedBudget([p], 'CAT-1');
  assert.equal(r.status, BASELINE_STATUS.NO_BUDGET);
});

test('isConceptInApprovedBudget: conceptoId null/undefined -> NO_BUDGET sin romper', () => {
  const p = makePresupuesto({ id: 'PRES-1', baselineVersion: 'V1', rows: [row({ conceptoId: 'CAT-1' })] });
  assert.equal(isConceptInApprovedBudget([p], null).status, BASELINE_STATUS.NO_BUDGET);
  assert.equal(isConceptInApprovedBudget([p], undefined).status, BASELINE_STATUS.NO_BUDGET);
  assert.equal(isConceptInApprovedBudget(null, 'CAT-1').status, BASELINE_STATUS.NO_BUDGET);
});

test('detectSpecChange: misma unidad + mismo apuId -> requiresNewApu=false', () => {
  const r = detectSpecChange({ contractualUnit: 'm²', currentUnit: 'm²', contractualApuId: 'APU-1', currentApuId: 'APU-1' });
  assert.equal(r.requiresNewApu, false);
  assert.deepEqual(r.changedFields, []);
});

test('detectSpecChange: unidad distinta (m² vs pza) -> requiresNewApu=true', () => {
  const r = detectSpecChange({ contractualUnit: 'm²', currentUnit: 'pza' });
  assert.equal(r.requiresNewApu, true);
  assert.deepEqual(r.changedFields, ['unidad']);
  assert.match(r.reason, /extraordinario/);
});

test('detectSpecChange: mismo unit pero apuId distinto -> requiresNewApu=true', () => {
  const r = detectSpecChange({ contractualUnit: 'm²', currentUnit: 'm²', contractualApuId: 'APU-1', currentApuId: 'APU-2' });
  assert.equal(r.requiresNewApu, true);
  assert.deepEqual(r.changedFields, ['apu']);
});
