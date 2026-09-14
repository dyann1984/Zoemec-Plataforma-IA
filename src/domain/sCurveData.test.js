import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSCurveData } from './sCurveData.js';

test('sin suficientes periodos distintos, available:false y series:null -- nunca se inventa una curva', () => {
  const r = buildSCurveData({ progressEntries: [{ conceptoId: 'C1', delta: 10, pu: 100, fecha: '2026-01-15' }], payments: [] });
  assert.equal(r.available, false);
  assert.equal(r.series, null);
});

test('con 2+ periodos reales, arma series acumuladas de avance real y costo real', () => {
  const progressEntries = [
    { conceptoId: 'C1', delta: 20, pu: 500, fecha: '2026-01-10' },
    { conceptoId: 'C1', delta: 30, pu: 500, fecha: '2026-02-10' }
  ];
  const payments = [{ monto: 4000, fecha: '2026-01-20' }, { monto: 6000, fecha: '2026-02-20' }];
  const r = buildSCurveData({ progressEntries, payments, presupuestoVigente: 50000 });
  assert.equal(r.available, true);
  assert.deepEqual(r.periods, ['2026-01', '2026-02']);
  // acumulado real: mes1 = 20*500=10000 (20% de 50000), mes2 = +30*500=15000 -> 25000 acumulado (50%)
  assert.equal(r.series.avanceRealPct[0].value, 20);
  assert.equal(r.series.avanceRealPct[1].value, 50);
  assert.equal(r.series.costoReal[0].value, 4000);
  assert.equal(r.series.costoReal[1].value, 10000);
});

test('las series "programado" siempre son null -- no existe linea base de programa en esta fase, nunca se fabrica', () => {
  const progressEntries = [
    { conceptoId: 'C1', delta: 10, pu: 100, fecha: '2026-01-10' },
    { conceptoId: 'C1', delta: 10, pu: 100, fecha: '2026-02-10' }
  ];
  const r = buildSCurveData({ progressEntries, payments: [], presupuestoVigente: 10000 });
  assert.equal(r.series.avanceProgramadoPct, null);
  assert.equal(r.series.costoProgramado, null);
});
