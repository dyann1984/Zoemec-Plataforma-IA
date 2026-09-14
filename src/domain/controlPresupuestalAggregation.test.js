import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateControlPresupuestal } from './controlPresupuestalAggregation.js';

function baseRow(overrides = {}){
  return { conceptoId: 'C1', clave: 'ALB-001', capitulo: 'ALBANILERIA', concept: 'Muro de block', unit: 'm²', qty: 100, pu: 500, direct: 300, ...overrides };
}

test('PRUEBA ESPECIFICA (seccion 15): Baseline + Cambios aprobados = Presupuesto vigente', () => {
  const changeOrders = [{ conceptoId: 'C1', status: 'APROBADA', cantidadAnterior: 100, cantidadNueva: 120, pu: 500, impactoEconomico: 10000 }];
  const { rows } = aggregateControlPresupuestal({ presupuestoRows: [baseRow()], changeOrders });
  assert.equal(rows[0].presupuestoBase, 100 * 500);
  assert.equal(rows[0].cambiosAprobados, 10000);
  assert.equal(rows[0].presupuestoVigente, rows[0].presupuestoBase + rows[0].cambiosAprobados);
  assert.equal(rows[0].presupuestoVigente, 60000);
});

test('una orden de cambio EN_REVISION/RECHAZADA/BORRADOR/CANCELADA NUNCA mueve el presupuesto vigente', () => {
  const changeOrders = [
    { conceptoId: 'C1', status: 'EN_REVISION', cantidadAnterior: 100, cantidadNueva: 200, pu: 500, impactoEconomico: 50000 },
    { conceptoId: 'C1', status: 'RECHAZADA', cantidadAnterior: 100, cantidadNueva: 200, pu: 500, impactoEconomico: 50000 },
    { conceptoId: 'C1', status: 'BORRADOR', cantidadAnterior: 100, cantidadNueva: 200, pu: 500, impactoEconomico: 50000 },
    { conceptoId: 'C1', status: 'CANCELADA', cantidadAnterior: 100, cantidadNueva: 200, pu: 500, impactoEconomico: 50000 }
  ];
  const { rows } = aggregateControlPresupuestal({ presupuestoRows: [baseRow()], changeOrders });
  assert.equal(rows[0].cambiosAprobados, 0);
  assert.equal(rows[0].presupuestoVigente, rows[0].presupuestoBase);
});

test('PRUEBA ESPECIFICA: Ejecutado = cantidad ejecutada x P.U. (nunca otro numero)', () => {
  const progressEntries = [{ conceptoId: 'C1', delta: 40 }];
  const { rows } = aggregateControlPresupuestal({ presupuestoRows: [baseRow()], progressEntries });
  assert.equal(rows[0].cantidadEjecutada, 40);
  assert.equal(rows[0].ejecutado, 40 * 500);
});

test('comprometido solo suma compromisos ACTIVO, nunca CERRADO/CANCELADO', () => {
  const commitments = [
    { conceptoId: 'C1', status: 'ACTIVO', monto: 1000 },
    { conceptoId: 'C1', status: 'CERRADO', monto: 5000 },
    { conceptoId: 'C1', status: 'CANCELADO', monto: 9000 }
  ];
  const { rows } = aggregateControlPresupuestal({ presupuestoRows: [baseRow()], commitments });
  assert.equal(rows[0].comprometido, 1000);
});

test('estimado solo cuenta estimaciones AUTORIZADA, nunca BORRADOR (no fabricar avance financiero)', () => {
  const estimates = [
    { id: 'E1', status: 'AUTORIZADA', importeBruto: 20000, conceptos: [{ conceptoId: 'C1', cantidadPeriodo: 40, pu: 500 }] },
    { id: 'E2', status: 'BORRADOR', importeBruto: 20000, conceptos: [{ conceptoId: 'C1', cantidadPeriodo: 40, pu: 500 }] }
  ];
  const { rows } = aggregateControlPresupuestal({ presupuestoRows: [baseRow()], estimates });
  assert.equal(rows[0].estimado, 20000);
});

test('pagado se prorratea entre los conceptos de la estimacion referenciada, proporcional a su importe', () => {
  const estimates = [{
    id: 'E1', status: 'AUTORIZADA', importeBruto: 30000,
    conceptos: [{ conceptoId: 'C1', cantidadPeriodo: 40, pu: 500 }, { conceptoId: 'C2', cantidadPeriodo: 20, pu: 500 }]
  }];
  const payments = [{ estimacionId: 'E1', monto: 9000 }];
  const { rows } = aggregateControlPresupuestal({
    presupuestoRows: [baseRow(), baseRow({ conceptoId: 'C2', clave: 'ALB-002' })],
    estimates, payments
  });
  // C1 = 20000/30000 del importe, C2 = 10000/30000
  const c1 = rows.find(r => r.conceptoId === 'C1');
  const c2 = rows.find(r => r.conceptoId === 'C2');
  assert.ok(Math.abs(c1.pagado - 6000) < 1e-6);
  assert.ok(Math.abs(c2.pagado - 3000) < 1e-6);
});

test('un pago SIN estimacionId nunca se asigna a un concepto (no se inventa a cual pertenece), solo cuenta a nivel proyecto', () => {
  const payments = [{ estimacionId: null, monto: 5000 }];
  const { rows, totals } = aggregateControlPresupuestal({ presupuestoRows: [baseRow()], payments });
  assert.equal(rows[0].pagado, 0);
  assert.equal(totals.pagado, 5000);
});

test('PRUEBA ESPECIFICA: Saldo = Presupuesto vigente - Pagado (definicion unica documentada)', () => {
  const estimates = [{ id: 'E1', status: 'AUTORIZADA', importeBruto: 10000, conceptos: [{ conceptoId: 'C1', cantidadPeriodo: 20, pu: 500 }] }];
  const payments = [{ estimacionId: 'E1', monto: 4000 }];
  const { rows } = aggregateControlPresupuestal({ presupuestoRows: [baseRow()], estimates, payments });
  assert.equal(rows[0].saldo, rows[0].presupuestoVigente - rows[0].pagado);
  assert.equal(rows[0].saldo, 50000 - 4000);
});

test('avance fisico = cantidad ejecutada / cantidad vigente (formula dada, seccion 4)', () => {
  const progressEntries = [{ conceptoId: 'C1', delta: 25 }];
  const { rows } = aggregateControlPresupuestal({ presupuestoRows: [baseRow({ qty: 100 })], progressEntries });
  assert.equal(rows[0].avanceFisicoPct, 25);
});

test('avance financiero = estimado / presupuesto vigente (deliberadamente DISTINTO de ejecutado/vigente, para que la comparacion no sea tautologica)', () => {
  const progressEntries = [{ conceptoId: 'C1', delta: 80 }]; // 80% fisico
  const estimates = [{ id: 'E1', status: 'AUTORIZADA', importeBruto: 15000, conceptos: [{ conceptoId: 'C1', cantidadPeriodo: 30, pu: 500 }] }]; // 30% financiero
  const { rows } = aggregateControlPresupuestal({ presupuestoRows: [baseRow({ qty: 100 })], progressEntries, estimates });
  assert.equal(rows[0].avanceFisicoPct, 80);
  assert.equal(rows[0].avanceFinancieroPct, 30);
  assert.notEqual(rows[0].avanceFisicoPct, rows[0].avanceFinancieroPct);
  assert.equal(rows[0].desviacionFisicoFinanciero, 50);
});

test('PRUEBA ESPECIFICA: forecast EAC = ejecutado + (cantidad pendiente x P.U.), variacion = EAC - vigente', () => {
  const progressEntries = [{ conceptoId: 'C1', delta: 40 }]; // ejecuto 40 de 100
  const { rows } = aggregateControlPresupuestal({ presupuestoRows: [baseRow({ qty: 100, pu: 500 })], progressEntries });
  // ejecutado = 40*500=20000, pendiente=60, etc=60*500=30000, eac=50000
  assert.equal(rows[0].ejecutado, 20000);
  assert.equal(rows[0].cantidadPendiente, 60);
  assert.equal(rows[0].etc, 30000);
  assert.equal(rows[0].eac, 50000);
  assert.equal(rows[0].eac, rows[0].presupuestoVigente); // sin cambios de cantidad, EAC = vigente exactamente
  assert.equal(rows[0].variacion, 0);
});

test('con avance mas lento de lo presupuestado en unidades, el EAC nunca se infla arbitrariamente (misma tasa presupuestada, sin datos de desempeño se asume tasa plana)', () => {
  const changeOrders = [{ conceptoId: 'C1', status: 'APROBADA', cantidadAnterior: 100, cantidadNueva: 150, pu: 500, impactoEconomico: 25000 }];
  const progressEntries = [{ conceptoId: 'C1', delta: 50 }];
  const { rows } = aggregateControlPresupuestal({ presupuestoRows: [baseRow({ qty: 100, pu: 500 })], changeOrders, progressEntries });
  assert.equal(rows[0].cantidadVigente, 150);
  assert.equal(rows[0].cantidadPendiente, 100);
  assert.equal(rows[0].ejecutado, 25000);
  assert.equal(rows[0].etc, 100 * 500);
  assert.equal(rows[0].eac, 25000 + 50000);
});

test('comprometidoPendiente a nivel proyecto = max(0, comprometido - pagado)', () => {
  const commitments = [{ conceptoId: 'C1', status: 'ACTIVO', monto: 10000 }];
  const estimates = [{ id: 'E1', status: 'AUTORIZADA', importeBruto: 6000, conceptos: [{ conceptoId: 'C1', cantidadPeriodo: 12, pu: 500 }] }];
  const payments = [{ estimacionId: 'E1', monto: 6000 }];
  const { totals } = aggregateControlPresupuestal({ presupuestoRows: [baseRow()], commitments, estimates, payments });
  assert.equal(totals.comprometido, 10000);
  assert.equal(totals.pagado, 6000);
  assert.equal(totals.comprometidoPendiente, 4000);
});

test('comprometidoPendiente nunca es negativo (pagado > comprometido es un escenario valido, ej. mas conceptos pagados que este compromiso)', () => {
  const commitments = [{ conceptoId: 'C1', status: 'ACTIVO', monto: 1000 }];
  const estimates = [{ id: 'E1', status: 'AUTORIZADA', importeBruto: 6000, conceptos: [{ conceptoId: 'C1', cantidadPeriodo: 12, pu: 500 }] }];
  const payments = [{ estimacionId: 'E1', monto: 6000 }];
  const { totals } = aggregateControlPresupuestal({ presupuestoRows: [baseRow()], commitments, estimates, payments });
  assert.equal(totals.comprometidoPendiente, 0);
});

test('sin ningun insumo (proyecto recien creado), todo en 0, nunca lanza', () => {
  const { rows, totals } = aggregateControlPresupuestal({ presupuestoRows: [baseRow({ qty: 10 })] });
  assert.equal(rows[0].presupuestoVigente, rows[0].presupuestoBase);
  assert.equal(rows[0].comprometido, 0);
  assert.equal(rows[0].ejecutado, 0);
  assert.equal(rows[0].avanceFisicoPct, 0);
  assert.equal(totals.pagado, 0);
});

test('sin renglones de presupuesto, agregacion vacia no lanza', () => {
  const { rows, totals } = aggregateControlPresupuestal({});
  assert.deepEqual(rows, []);
  assert.equal(totals.vigente, 0);
});
