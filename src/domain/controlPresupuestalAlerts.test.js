import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateControlPresupuestal } from './controlPresupuestalAggregation.js';
import { computeControlPresupuestalAlerts, ALERT_TYPE } from './controlPresupuestalAlerts.js';

function baseRow(overrides = {}){
  return { conceptoId: 'C1', clave: 'ALB-001', capitulo: 'ALBANILERIA', concept: 'Muro de block', unit: 'm²', qty: 100, pu: 500, direct: 300, ...overrides };
}

test('sin ningun dato, sin alertas', () => {
  const aggregation = aggregateControlPresupuestal({ presupuestoRows: [baseRow()] });
  const alerts = computeControlPresupuestalAlerts({ aggregation });
  assert.deepEqual(alerts, []);
});

test('CONCEPTO_AGOTADO: cuando vigente - comprometido - ejecutado <= 0', () => {
  const commitments = [{ conceptoId: 'C1', status: 'ACTIVO', monto: 30000 }];
  const progressEntries = [{ conceptoId: 'C1', delta: 40 }]; // ejecutado 20000
  const aggregation = aggregateControlPresupuestal({ presupuestoRows: [baseRow()], commitments, progressEntries });
  const alerts = computeControlPresupuestalAlerts({ aggregation });
  assert.ok(alerts.some(a => a.type === ALERT_TYPE.CONCEPTO_AGOTADO));
});

test('EJECUCION_MAYOR_PRESUPUESTO: ejecutado > vigente', () => {
  const progressEntries = [{ conceptoId: 'C1', delta: 200 }]; // 200*500=100000 > vigente 50000
  const aggregation = aggregateControlPresupuestal({ presupuestoRows: [baseRow()], progressEntries });
  const alerts = computeControlPresupuestalAlerts({ aggregation });
  assert.ok(alerts.some(a => a.type === ALERT_TYPE.EJECUCION_MAYOR_PRESUPUESTO && a.severity === 'CRITICAL'));
});

test('COMPROMETIDO_EXCESIVO: comprometido > restante por ejecutar', () => {
  const commitments = [{ conceptoId: 'C1', status: 'ACTIVO', monto: 60000 }]; // vigente=50000, ejecutado=0 -> restante=50000
  const aggregation = aggregateControlPresupuestal({ presupuestoRows: [baseRow()], commitments });
  const alerts = computeControlPresupuestalAlerts({ aggregation });
  assert.ok(alerts.some(a => a.type === ALERT_TYPE.COMPROMETIDO_EXCESIVO));
});

test('ORDEN_CAMBIO_PENDIENTE: cualquier orden EN_REVISION genera alerta', () => {
  const aggregation = aggregateControlPresupuestal({ presupuestoRows: [baseRow()] });
  const changeOrders = [{ id: 'CO-1', folio: 'CO-001', conceptoId: 'C1', concept: 'Muro de block', status: 'EN_REVISION' }];
  const alerts = computeControlPresupuestalAlerts({ aggregation, changeOrders });
  assert.ok(alerts.some(a => a.type === ALERT_TYPE.ORDEN_CAMBIO_PENDIENTE));
});

test('una orden BORRADOR/APROBADA/RECHAZADA/CANCELADA nunca genera la alerta de pendiente', () => {
  const aggregation = aggregateControlPresupuestal({ presupuestoRows: [baseRow()] });
  const changeOrders = [
    { id: 'CO-1', conceptoId: 'C1', status: 'BORRADOR' }, { id: 'CO-2', conceptoId: 'C1', status: 'APROBADA' },
    { id: 'CO-3', conceptoId: 'C1', status: 'RECHAZADA' }, { id: 'CO-4', conceptoId: 'C1', status: 'CANCELADA' }
  ];
  const alerts = computeControlPresupuestalAlerts({ aggregation, changeOrders });
  assert.ok(!alerts.some(a => a.type === ALERT_TYPE.ORDEN_CAMBIO_PENDIENTE));
});

test('PAGO_SIN_ESTIMACION: un pago sin estimacionId genera alerta', () => {
  const aggregation = aggregateControlPresupuestal({ presupuestoRows: [baseRow()] });
  const payments = [{ estimacionId: null, monto: 1000, proveedor: 'X' }];
  const alerts = computeControlPresupuestalAlerts({ aggregation, payments });
  assert.ok(alerts.some(a => a.type === ALERT_TYPE.PAGO_SIN_ESTIMACION));
});

test('un pago CON estimacionId nunca genera esa alerta', () => {
  const aggregation = aggregateControlPresupuestal({ presupuestoRows: [baseRow()] });
  const payments = [{ estimacionId: 'E1', monto: 1000, proveedor: 'X' }];
  const alerts = computeControlPresupuestalAlerts({ aggregation, payments });
  assert.ok(!alerts.some(a => a.type === ALERT_TYPE.PAGO_SIN_ESTIMACION));
});

test('DESVIACION_FISICO_FINANCIERO: solo si supera el umbral', () => {
  const progressEntries = [{ conceptoId: 'C1', delta: 90 }]; // 90% fisico
  const estimates = [{ id: 'E1', status: 'AUTORIZADA', importeBruto: 5000, conceptos: [{ conceptoId: 'C1', cantidadPeriodo: 10, pu: 500 }] }]; // 10% financiero -> 80pp desviacion
  const aggregation = aggregateControlPresupuestal({ presupuestoRows: [baseRow()], progressEntries, estimates });
  const alerts = computeControlPresupuestalAlerts({ aggregation, deviationThresholdPct: 15 });
  assert.ok(alerts.some(a => a.type === ALERT_TYPE.DESVIACION_FISICO_FINANCIERO));
});

test('FORECAST_SOBRE_PRESUPUESTO y SOBREPRESUPUESTO a nivel proyecto', () => {
  const progressEntries = [{ conceptoId: 'C1', delta: 300 }]; // ejecutado 150000 >> vigente 50000
  const aggregation = aggregateControlPresupuestal({ presupuestoRows: [baseRow()], progressEntries });
  const alerts = computeControlPresupuestalAlerts({ aggregation });
  assert.ok(alerts.some(a => a.type === ALERT_TYPE.FORECAST_SOBRE_PRESUPUESTO));
  assert.ok(alerts.some(a => a.type === ALERT_TYPE.SOBREPRESUPUESTO));
});

test('las alertas se ordenan por severidad, CRITICAL primero', () => {
  const progressEntries = [{ conceptoId: 'C1', delta: 300 }];
  const aggregation = aggregateControlPresupuestal({ presupuestoRows: [baseRow()], progressEntries });
  const changeOrders = [{ id: 'CO-1', conceptoId: 'C1', status: 'EN_REVISION' }];
  const alerts = computeControlPresupuestalAlerts({ aggregation, changeOrders });
  const severities = alerts.map(a => a.severity);
  const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  for(let i = 1; i < severities.length; i++) assert.ok(rank[severities[i - 1]] >= rank[severities[i]]);
});
