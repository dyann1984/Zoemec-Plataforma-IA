import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCalendar } from './workingCalendar.js';
import { buildSCurveWithBaseline } from './sCurveWithBaseline.js';
import { makeProgressEntry } from './progressEntrySchema.js';

test('sin actividades ni datos reales -> available false (delega a sCurveData)', () => {
  const r = buildSCurveWithBaseline({});
  assert.equal(r.available, false);
});

test('actividades con fechas + importe -> genera avanceProgramadoPct y costoProgramado por mes', () => {
  const cal = makeCalendar();
  const activities = [
    { id: 'A1', fechaInicio: '2026-10-01', fechaFin: '2026-10-31', importe: 100000 },
    { id: 'A2', fechaInicio: '2026-11-01', fechaFin: '2026-11-30', importe: 200000 }
  ];
  const r = buildSCurveWithBaseline({ activities, calendar: cal, progressEntries: [], payments: [], presupuestoVigente: 300000 });
  assert.equal(r.available, true);
  assert.ok(r.series.avanceProgramadoPct.length >= 2);
  const last = r.series.avanceProgramadoPct[r.series.avanceProgramadoPct.length - 1];
  assert.equal(Math.round(last.value), 100, 'la curva programada llega al 100% al final');
  const lastCost = r.series.costoProgramado[r.series.costoProgramado.length - 1];
  assert.equal(Math.round(lastCost.value), 300000, 'costo programado acumulado = importe total');
});

test('actividades + progressEntries reales: coexisten en periodos distintos', () => {
  const cal = makeCalendar();
  const activities = [
    { id: 'A1', fechaInicio: '2026-10-01', fechaFin: '2026-10-31', importe: 100000 }
  ];
  const progressEntries = [
    makeProgressEntry({ projectId: 'P', conceptoId: 'CAT-X', delta: 10, pu: 5000, fecha: '2026-10-15' }),
    makeProgressEntry({ projectId: 'P', conceptoId: 'CAT-X', delta: 10, pu: 5000, fecha: '2026-11-15' })
  ];
  const r = buildSCurveWithBaseline({ activities, progressEntries, calendar: cal, presupuestoVigente: 100000 });
  assert.equal(r.available, true);
  assert.ok(r.series.avanceRealPct?.length >= 2);
  assert.ok(r.series.avanceProgramadoPct?.length >= 1);
});

test('sin calendario o sin actividades -> comportamiento Fase E: solo real, programado null', () => {
  const progressEntries = [
    makeProgressEntry({ projectId: 'P', conceptoId: 'X', delta: 5, pu: 100, fecha: '2026-10-01' }),
    makeProgressEntry({ projectId: 'P', conceptoId: 'X', delta: 5, pu: 100, fecha: '2026-11-01' })
  ];
  const r = buildSCurveWithBaseline({ activities: [], progressEntries, presupuestoVigente: 10000 });
  assert.equal(r.available, true);
  assert.equal(r.series.avanceProgramadoPct, null, 'programado no se inventa');
  assert.ok(r.series.avanceRealPct.length >= 2);
});
