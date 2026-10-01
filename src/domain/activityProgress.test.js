import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyActivity } from './activitySchema.js';
import { makeCalendar } from './workingCalendar.js';
import { scheduleActivities } from './activityScheduling.js';
import { makeProgressEntry } from './progressEntrySchema.js';
import { computeActivityProgress, computeWeightedPhysicalProgress, computeActivityExecutedCost } from './activityProgress.js';

/* Caso obligatorio §23: 480 m³ / 60 m³/dia = 8 dias, inicio 2026-10-01.
   Ejecutado 240 en 6 dias reales -> avance 50%, rendimiento real 40,
   desviacion -33.33%, cantidad pendiente 240, restante 6 dias a rend real. */
test('caso Excavacion §23: 240/480, 6 dias reales -> avance 50%, rend real 40, desv -33.33%', () => {
  const cal = makeCalendar();
  const activity = makeEmptyActivity({ projectId: 'P', conceptoId: 'CAT-EXC', name: 'Excavacion', unit: 'm³', cantidad: 480, rendimiento: 60 });
  const sched = scheduleActivities({ calendar: cal, projectStartDate: '2026-10-01', activities: [activity] });
  const scheduled = sched.activities[0];
  const progressEntries = [
    makeProgressEntry({ projectId: 'P', conceptoId: 'CAT-EXC', delta: 240, pu: 100, fecha: '2026-10-08' })
  ];
  // asOf = 2026-10-08. Dias L-S desde 2026-10-01: 01,02,03,05,06,07,08 = 7. Corrijo el test a 2026-10-07 (6 dias).
  const p = computeActivityProgress({ activity: scheduled, progressEntries, calendar: cal, asOf: '2026-10-07' });
  assert.equal(p.cantidadEjecutada, 240);
  assert.equal(p.cantidadPendiente, 240);
  assert.equal(p.avanceFisicoPct, 50);
  assert.equal(p.diasHabTranscurridos, 6, 'dias L-S desde 2026-10-01 hasta 2026-10-07');
  assert.equal(p.rendimientoReal, 40, 'rendimiento real = 240/6');
  assert.equal(Math.round(p.rendimientoDesviacionPct * 100) / 100, -33.33);
});

test('caso Excavacion §23: fechaFinProyectada a rendimiento real', () => {
  const cal = makeCalendar();
  const activity = makeEmptyActivity({ projectId: 'P', conceptoId: 'CAT-EXC', name: 'x', cantidad: 480, rendimiento: 60 });
  const sched = scheduleActivities({ calendar: cal, projectStartDate: '2026-10-01', activities: [activity] });
  const scheduled = sched.activities[0];
  const progressEntries = [makeProgressEntry({ projectId: 'P', conceptoId: 'CAT-EXC', delta: 240, pu: 100 })];
  const p = computeActivityProgress({ activity: scheduled, progressEntries, calendar: cal, asOf: '2026-10-07' });
  // Cantidad pendiente 240, rend real 40 -> 6 dias -> desde asOf 07 + 6 dias L-S:
  //   asOf 07 (Mie), 07,08,09,10,12,13 = 6 dias L-S
  assert.ok(Number.isFinite(p.diasRestantesEstimados));
  assert.equal(Math.round(p.diasRestantesEstimados * 100) / 100, 6);
  assert.equal(p.fechaFinProyectada, '2026-10-13');
  assert.ok(p.riesgoAtraso, 'plan 2026-10-09 vs proyectada 2026-10-13 -> hay atraso');
});

test('sin avance -> rendimiento real null, proyeccion null (no inventar)', () => {
  const cal = makeCalendar();
  const activity = makeEmptyActivity({ projectId: 'P', conceptoId: 'CAT-X', name: 'x', cantidad: 100, rendimiento: 10, fechaInicio: '2026-10-01', fechaFin: '2026-10-10' });
  const p = computeActivityProgress({ activity, progressEntries: [], calendar: cal, asOf: '2026-10-05' });
  assert.equal(p.cantidadEjecutada, 0);
  assert.equal(p.rendimientoReal, null);
  assert.equal(p.fechaFinProyectada, null);
});

test('avance sin cantidad -> avanceFisicoPct = 0, no NaN', () => {
  const cal = makeCalendar();
  const activity = makeEmptyActivity({ projectId: 'P', conceptoId: 'CAT-X', name: 'x', cantidad: 0, rendimiento: 10 });
  const p = computeActivityProgress({ activity, progressEntries: [], calendar: cal, asOf: '2026-10-05' });
  assert.equal(p.avanceFisicoPct, 0);
});

test('computeWeightedPhysicalProgress: ponderado por importe', () => {
  const rows = new Map([
    ['CAT-A', { pu: 100 }],
    ['CAT-B', { pu: 200 }]
  ]);
  // A: 10 unidades * 100 = 1000, avance 50% (5 ejecutado)
  // B: 10 unidades * 200 = 2000, avance 25% (2.5 ejecutado)
  // ponderado = (1000*0.5 + 2000*0.25) / (1000+2000) = (500 + 500) / 3000 = 33.33%
  const activities = [
    makeEmptyActivity({ projectId: 'P', conceptoId: 'CAT-A', cantidad: 10, name: 'A' }),
    makeEmptyActivity({ projectId: 'P', conceptoId: 'CAT-B', cantidad: 10, name: 'B' })
  ];
  const progressEntries = [
    makeProgressEntry({ projectId: 'P', conceptoId: 'CAT-A', delta: 5, pu: 100 }),
    makeProgressEntry({ projectId: 'P', conceptoId: 'CAT-B', delta: 2.5, pu: 200 })
  ];
  const pct = computeWeightedPhysicalProgress(activities, progressEntries, rows);
  assert.equal(Math.round(pct * 100) / 100, 33.33);
});

test('computeActivityExecutedCost: suma delta*pu de sus progressEntries', () => {
  const activity = makeEmptyActivity({ projectId: 'P', conceptoId: 'CAT-X', cantidad: 100, name: 'x' });
  const entries = [
    makeProgressEntry({ projectId: 'P', conceptoId: 'CAT-X', delta: 20, pu: 100 }),
    makeProgressEntry({ projectId: 'P', conceptoId: 'CAT-X', delta: 30, pu: 100 }),
    makeProgressEntry({ projectId: 'P', conceptoId: 'CAT-OTRO', delta: 999, pu: 999 }) // no cuenta
  ];
  assert.equal(computeActivityExecutedCost(activity, entries), 50 * 100);
});
