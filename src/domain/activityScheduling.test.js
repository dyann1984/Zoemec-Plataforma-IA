import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCalendar } from './workingCalendar.js';
import { makeEmptyActivity, makePredecessor, ACTIVITY_ORIGIN } from './activitySchema.js';
import { scheduleActivities, topologicalOrder, recomputeActivityEnd, elapsedWorkingDays, SCHEDULE_ISSUE } from './activityScheduling.js';

/* Caso obligatorio §23: Excavacion 480 m³ / 60 = 8 dias, inicio 2026-10-01
   L-S -> fin 2026-10-09 */
test('scheduleActivities: excavacion 480/60=8 dias, inicio 2026-10-01 L-S -> fin 2026-10-09', () => {
  const cal = makeCalendar();
  const a = makeEmptyActivity({ projectId: 'P', id: 'ACT-1', name: 'Excavacion', unit: 'm³', cantidad: 480, rendimiento: 60 });
  const r = scheduleActivities({ calendar: cal, projectStartDate: '2026-10-01', activities: [a] });
  assert.equal(r.activities[0].fechaInicio, '2026-10-01');
  assert.equal(r.activities[0].duracion, 8);
  assert.equal(r.activities[0].fechaFin, '2026-10-09');
  assert.equal(r.issues.length, 0);
});

test('scheduleActivities: dependencia FS Excavacion -> Cimentacion arranca al SIGUIENTE laborable', () => {
  const cal = makeCalendar();
  const exc = makeEmptyActivity({ projectId: 'P', id: 'A1', name: 'Excavacion', cantidad: 480, rendimiento: 60 });
  const cim = makeEmptyActivity({ projectId: 'P', id: 'A2', name: 'Cimentacion', cantidad: 120, rendimiento: 15,
    predecessoras: [makePredecessor({ activityId: 'A1' })] });
  const r = scheduleActivities({ calendar: cal, projectStartDate: '2026-10-01', activities: [exc, cim] });
  const scheduledExc = r.activities.find(a => a.id === 'A1');
  const scheduledCim = r.activities.find(a => a.id === 'A2');
  assert.equal(scheduledExc.fechaFin, '2026-10-09');
  // Cimentacion arranca 2026-10-10 (sabado, L-S laborable)
  assert.equal(scheduledCim.fechaInicio, '2026-10-10');
  // 120 / 15 = 8 dias -> 2026-10-10 + 8 dias L-S = 10,12,13,14,15,16,17,19
  assert.equal(scheduledCim.fechaFin, '2026-10-19');
});

test('scheduleActivities: cadena FS Excavacion -> Cimentacion -> Estructura', () => {
  const cal = makeCalendar();
  const a1 = makeEmptyActivity({ projectId: 'P', id: 'A1', name: 'Exc', cantidad: 480, rendimiento: 60 });
  const a2 = makeEmptyActivity({ projectId: 'P', id: 'A2', name: 'Cim', cantidad: 120, rendimiento: 15, predecessoras: [makePredecessor({ activityId: 'A1' })] });
  const a3 = makeEmptyActivity({ projectId: 'P', id: 'A3', name: 'Est', cantidad: 200, rendimiento: 20, predecessoras: [makePredecessor({ activityId: 'A2' })] });
  const r = scheduleActivities({ calendar: cal, projectStartDate: '2026-10-01', activities: [a1, a2, a3] });
  const cim = r.activities.find(a => a.id === 'A2');
  const est = r.activities.find(a => a.id === 'A3');
  assert.equal(cim.fechaFin, '2026-10-19');
  // Est arranca al siguiente laborable de 19 -> 20 (Mar); duracion 10 dias L-S
  assert.equal(est.fechaInicio, '2026-10-20');
});

test('scheduleActivities: fecha manual respetada cuando no hay predecesoras (fecha hábil)', () => {
  const cal = makeCalendar();
  // 2026-11-16 = Lunes (día hábil L-S)
  const a = makeEmptyActivity({ projectId: 'P', id: 'A1', name: 'x', cantidad: 100, rendimiento: 10, fechaInicio: '2026-11-16' });
  const r = scheduleActivities({ calendar: cal, projectStartDate: '2026-10-01', activities: [a] });
  assert.equal(r.activities[0].fechaInicio, '2026-11-16');
});

test('scheduleActivities: fecha manual INCONSISTENTE con predecesora -> se ajusta + issue', () => {
  const cal = makeCalendar();
  const a1 = makeEmptyActivity({ projectId: 'P', id: 'A1', name: 'Exc', cantidad: 480, rendimiento: 60 });
  const a2 = makeEmptyActivity({ projectId: 'P', id: 'A2', name: 'Cim', cantidad: 120, rendimiento: 15,
    fechaInicio: '2026-10-05', // ANTES del fin de A1 (2026-10-09)
    predecessoras: [makePredecessor({ activityId: 'A1' })] });
  const r = scheduleActivities({ calendar: cal, projectStartDate: '2026-10-01', activities: [a1, a2] });
  const cim = r.activities.find(a => a.id === 'A2');
  assert.equal(cim.fechaInicio, '2026-10-10', 'debe ajustarse al siguiente laborable de A1');
  assert.ok(r.issues.some(i => i.activityId === 'A2' && i.code === SCHEDULE_ISSUE.INCONSISTENT_START));
});

test('scheduleActivities: ciclo -> se detecta, no stackoverflow, issue reportado', () => {
  const cal = makeCalendar();
  const a1 = makeEmptyActivity({ projectId: 'P', id: 'A1', name: 'x', cantidad: 10, rendimiento: 10, predecessoras: [makePredecessor({ activityId: 'A2' })] });
  const a2 = makeEmptyActivity({ projectId: 'P', id: 'A2', name: 'y', cantidad: 10, rendimiento: 10, predecessoras: [makePredecessor({ activityId: 'A1' })] });
  const r = scheduleActivities({ calendar: cal, projectStartDate: '2026-10-01', activities: [a1, a2] });
  assert.deepEqual(r.cycles.sort(), ['A1', 'A2']);
  assert.equal(r.issues.filter(i => i.code === SCHEDULE_ISSUE.CYCLE).length, 2);
});

test('scheduleActivities: rendimiento faltante -> issue DURATION_UNKNOWN, fechaFin null', () => {
  const cal = makeCalendar();
  const a = makeEmptyActivity({ projectId: 'P', id: 'A1', name: 'x', cantidad: 100, rendimiento: null });
  const r = scheduleActivities({ calendar: cal, projectStartDate: '2026-10-01', activities: [a] });
  assert.equal(r.activities[0].fechaFin, null);
  assert.ok(r.issues.some(i => i.code === SCHEDULE_ISSUE.DURATION_UNKNOWN));
});

test('scheduleActivities: sin fecha proyecto ni fecha manual -> issue MISSING_START', () => {
  const cal = makeCalendar();
  const a = makeEmptyActivity({ projectId: 'P', id: 'A1', name: 'x', cantidad: 100, rendimiento: 10 });
  const r = scheduleActivities({ calendar: cal, projectStartDate: null, activities: [a] });
  assert.ok(r.issues.some(i => i.code === SCHEDULE_ISSUE.MISSING_START));
});

test('topologicalOrder: cadena simple A1->A2->A3', () => {
  const list = [
    { id: 'A3', predecessoras: [{ activityId: 'A2' }] },
    { id: 'A1', predecessoras: [] },
    { id: 'A2', predecessoras: [{ activityId: 'A1' }] }
  ];
  const { order, cycles } = topologicalOrder(list);
  assert.deepEqual(order, ['A1', 'A2', 'A3']);
  assert.deepEqual(cycles, []);
});

test('recomputeActivityEnd: aplica nueva duracion sin repropagar', () => {
  const cal = makeCalendar();
  const a = { fechaInicio: '2026-10-01', duracion: 8, fechaFin: '2026-10-09' };
  const next = recomputeActivityEnd(cal, a, 9);
  assert.equal(next.duracion, 9);
  assert.equal(next.fechaFin, '2026-10-10');
});

test('elapsedWorkingDays: entre fechaInicio y asOf L-S', () => {
  const cal = makeCalendar();
  // 2026-10-01 (Jue) -> 2026-10-06 (Mar): 01,02,03,05,06 = 5 dias L-S (dom 04 excluido)
  assert.equal(elapsedWorkingDays(cal, '2026-10-01', '2026-10-06'), 5);
});
