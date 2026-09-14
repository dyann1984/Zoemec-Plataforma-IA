import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareBaselineVsActual } from './projectVaultBaselineComparison.js';

test('sin presupuesto ni control presupuestal, todo queda null (nunca inventa)', () => {
  const r = compareBaselineVsActual({});
  assert.equal(r.presupuestoBase, null);
  assert.equal(r.presupuestoVigente, null);
  assert.equal(r.variacion, null);
  assert.equal(r.plazo.impactoTiempoDiasTotal, null);
  assert.deepEqual(r.cantidadesModificadas, []);
});

test('variacion y variacionPct se calculan del baseline/vigente ya agregados por Fase E', () => {
  const r = compareBaselineVsActual({ controlPresupuestalTotals: { baseline: 100000, vigente: 120000 } });
  assert.equal(r.variacion, 20000);
  assert.equal(r.variacionPct, 20);
});

test('solo las ordenes de cambio APROBADA cuentan -- EN_REVISION/RECHAZADA/BORRADOR/CANCELADA nunca aparecen', () => {
  const changeOrders = [
    { conceptoId: 'C1', status: 'APROBADA', cantidadAnterior: 100, cantidadNueva: 120, impactoTiempoDias: 5, folio: 'CO-001' },
    { conceptoId: 'C2', status: 'RECHAZADA', cantidadAnterior: 50, cantidadNueva: 200, impactoTiempoDias: 30, folio: 'CO-002' },
    { conceptoId: 'C3', status: 'EN_REVISION', cantidadAnterior: 10, cantidadNueva: 20, impactoTiempoDias: 2, folio: 'CO-003' }
  ];
  const r = compareBaselineVsActual({ changeOrders });
  assert.equal(r.cantidadesModificadas.length, 1);
  assert.equal(r.cantidadesModificadas[0].folio, 'CO-001');
  assert.equal(r.plazo.impactoTiempoDiasTotal, 5, 'solo la orden aprobada suma al impacto de plazo');
});

test('plazo: sin ninguna orden aprobada, impactoTiempoDiasTotal es null (nunca 0 fingido)', () => {
  const r = compareBaselineVsActual({ changeOrders: [{ conceptoId: 'C1', status: 'BORRADOR', impactoTiempoDias: 10 }] });
  assert.equal(r.plazo.impactoTiempoDiasTotal, null);
});

test('las cantidades modificadas enriquecen clave/concept desde los renglones de control presupuestal si la orden no los trae', () => {
  const changeOrders = [{ conceptoId: 'C1', status: 'APROBADA', cantidadAnterior: 100, cantidadNueva: 120 }];
  const controlPresupuestalRows = [{ conceptoId: 'C1', clave: 'ALB-001', concept: 'Muro de block' }];
  const r = compareBaselineVsActual({ changeOrders, controlPresupuestalRows });
  assert.equal(r.cantidadesModificadas[0].clave, 'ALB-001');
  assert.equal(r.cantidadesModificadas[0].concept, 'Muro de block');
});
