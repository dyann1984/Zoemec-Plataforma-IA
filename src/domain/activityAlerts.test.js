import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyActivity, ACTIVITY_STATUS } from './activitySchema.js';
import { computeActivityAlerts, computeAllAlerts, ALERT_CODE, ALERT_SEVERITY } from './activityAlerts.js';

test('actividad SIN rendimiento -> ALERT ACTIVIDAD_SIN_RENDIMIENTO', () => {
  const a = makeEmptyActivity({ projectId: 'P', name: 'x', status: ACTIVITY_STATUS.PLANIFICADA });
  const alerts = computeActivityAlerts({ activity: a });
  assert.ok(alerts.some(x => x.code === ALERT_CODE.ACTIVIDAD_SIN_RENDIMIENTO));
});

test('actividad PLANIFICADA sin responsable -> ALERT SIN_RESPONSABLE (MEDIA)', () => {
  const a = makeEmptyActivity({ projectId: 'P', name: 'x', rendimiento: 10, status: ACTIVITY_STATUS.PLANIFICADA });
  const alerts = computeActivityAlerts({ activity: a });
  const r = alerts.find(x => x.code === ALERT_CODE.ACTIVIDAD_SIN_RESPONSABLE);
  assert.ok(r);
  assert.equal(r.severity, ALERT_SEVERITY.MEDIA);
});

test('actividad EN_PROCESO sin fecha -> ALERT ALTA', () => {
  const a = makeEmptyActivity({ projectId: 'P', name: 'x', rendimiento: 10, status: ACTIVITY_STATUS.EN_PROCESO, responsable: 'ing' });
  const alerts = computeActivityAlerts({ activity: a });
  const r = alerts.find(x => x.code === ALERT_CODE.ACTIVIDAD_SIN_FECHA);
  assert.ok(r);
  assert.equal(r.severity, ALERT_SEVERITY.ALTA);
});

test('rendimiento real -20% vs plan -> RENDIMIENTO_BAJO ALTA', () => {
  const a = makeEmptyActivity({ projectId: 'P', name: 'x', rendimiento: 60, status: ACTIVITY_STATUS.EN_PROCESO, responsable: 'ing', fechaInicio: '2026-10-01', fechaFin: '2026-10-09', duracion: 8 });
  const progress = { avanceFisicoPct: 50, rendimientoPlan: 60, rendimientoReal: 48, rendimientoDesviacionPct: -20, diasHabTranscurridos: 5 };
  const alerts = computeActivityAlerts({ activity: a, progress });
  assert.ok(alerts.some(x => x.code === ALERT_CODE.RENDIMIENTO_BAJO));
});

test('actividad atrasada > 5 dias -> CRITICA', () => {
  const a = makeEmptyActivity({ projectId: 'P', name: 'x', rendimiento: 60, status: ACTIVITY_STATUS.EN_PROCESO, responsable: 'ing', fechaInicio: '2026-10-01', fechaFin: '2026-10-09', duracion: 8 });
  const progress = { avanceFisicoPct: 50, atrasoDias: 6, riesgoAtraso: true, fechaFinProyectada: '2026-10-15' };
  const alerts = computeActivityAlerts({ activity: a, progress });
  const r = alerts.find(x => x.code === ALERT_CODE.ACTIVIDAD_ATRASADA);
  assert.ok(r);
  assert.equal(r.severity, ALERT_SEVERITY.CRITICA);
});

test('CANCELADA nunca alerta', () => {
  const a = makeEmptyActivity({ projectId: 'P', name: 'x', status: ACTIVITY_STATUS.CANCELADA });
  const alerts = computeActivityAlerts({ activity: a });
  assert.equal(alerts.length, 0);
});

test('avance real < programado (5% tolerancia) -> alerta MEDIA', () => {
  const a = makeEmptyActivity({ projectId: 'P', name: 'x', rendimiento: 60, status: ACTIVITY_STATUS.EN_PROCESO, responsable: 'ing', fechaInicio: '2026-10-01', fechaFin: '2026-10-09', duracion: 8 });
  const progress = { avanceFisicoPct: 30, diasHabTranscurridos: 5 }; // esperado 5/8=62.5%
  const alerts = computeActivityAlerts({ activity: a, progress });
  assert.ok(alerts.some(x => x.code === ALERT_CODE.AVANCE_MENOR_A_PROGRAMADO));
});

test('costo ejecutado > presupuestado * avance + 5% -> COSTO_MAYOR', () => {
  const a = makeEmptyActivity({ projectId: 'P', name: 'x', rendimiento: 60, status: ACTIVITY_STATUS.EN_PROCESO, responsable: 'ing', fechaInicio: '2026-10-01', fechaFin: '2026-10-09' });
  const progress = { avanceFisicoPct: 50, diasHabTranscurridos: 4 };
  const cost = { presupuestado: 10000, ejecutado: 7000 };  // avance 50% -> esperado max = 10000*0.55 = 5500 < 7000
  const alerts = computeActivityAlerts({ activity: a, progress, costBreakdown: cost });
  assert.ok(alerts.some(x => x.code === ALERT_CODE.COSTO_MAYOR_A_ESPERADO));
});

test('computeAllAlerts: ordenadas por severity descendente', () => {
  const a1 = makeEmptyActivity({ projectId: 'P', id: 'A1', name: 'a1', status: ACTIVITY_STATUS.PLANIFICADA });
  const a2 = makeEmptyActivity({ projectId: 'P', id: 'A2', name: 'a2', status: ACTIVITY_STATUS.PLANIFICADA });
  const progA1 = { avanceFisicoPct: 10, atrasoDias: 8, riesgoAtraso: true, fechaFinProyectada: '2026-11-15' };
  const alerts = computeAllAlerts({ activities: [a1, a2], progressByActivityId: new Map([['A1', progA1]]) });
  assert.equal(alerts[0].severity, ALERT_SEVERITY.CRITICA);
});
