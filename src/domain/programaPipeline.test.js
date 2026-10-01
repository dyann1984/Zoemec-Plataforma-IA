/* E2E de Fase 3 -- pipeline completo del Programa de Obra:
     Catalogo/APU -> Actividad -> Duracion -> Fechas (calendario L-S)
     -> Avance (progressEntries) -> Rendimiento real -> Proyeccion -> Alertas
     -> OC aprobada -> Divergencia de cantidad vigente -> Actualizacion
     -> Curva S con baseline + real
     -> Control Presupuestal (baseline intacto)
   Modulos puros, sin red.

   Caso principal (regla 23 del encargo): Excavacion 480 m³ / 60 m³/dia,
   inicio 2026-10-01 L-S. Ejecutado 240 m³ en 6 dias reales. Rendimiento
   real 40 (-33.33% del plan). Cantidad pendiente 240 m³ -> 6 dias mas a
   ritmo real. Riesgo de atraso.

   Caso secundario (regla 24): OC aprobada +40 m³ -> cantidad vigente 520,
   duracion sugerida 8.67 dias. Sin sobreescribir edicion manual. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCalendar } from './workingCalendar.js';
import { makeEmptyActivity, ACTIVITY_STATUS, ACTIVITY_ORIGIN } from './activitySchema.js';
import { scheduleActivities } from './activityScheduling.js';
import { computeActivityProgress, computeWeightedPhysicalProgress } from './activityProgress.js';
import { makeProgressEntry } from './progressEntrySchema.js';
import { computeAllAlerts, ALERT_CODE, ALERT_SEVERITY } from './activityAlerts.js';
import { generateActivitiesFromCatalog, detectVigentDivergence, applyVigentDivergence } from './programaFromCatalog.js';
import { makeEmptyChangeOrder, CHANGE_ORDER_STATUS } from './changeOrderSchema.js';
import { aggregateControlPresupuestal } from './controlPresupuestalAggregation.js';
import { buildSCurveWithBaseline } from './sCurveWithBaseline.js';

/* Fixture reutilizable */
const excavacionApu = {
  id: 'APU-EXC', laborDetails: [{ cuadrilla: 3, rendimiento: 60, jornada: 8, rendimientoFuente: 'PLANTILLA' }]
};
const excavacionRow = {
  conceptoId: 'CAT-EXC', apuId: 'APU-EXC', clave: 'EXC-01',
  concept: 'Excavacion mecanica', unit: 'm³', qty: 480, pu: 100, direct: 100,
  capitulo: 'CIMENTACION'
};

/* ========== FLUJO COMPLETO ========== */

test('§23 CASO OBLIGATORIO -- Excavacion 480 m³ / 60 = 8 dias L-S, inicio 2026-10-01 -> fin 2026-10-09', () => {
  const cal = makeCalendar();
  // 1) Generar actividad desde catalogo
  const { created } = generateActivitiesFromCatalog({
    rows: [excavacionRow], apusById: new Map([['APU-EXC', excavacionApu]]), projectId: 'PRJ-1'
  });
  assert.equal(created.length, 1);
  const activity = created[0];
  assert.equal(activity.cantidad, 480);
  assert.equal(activity.rendimiento, 60);
  assert.equal(activity.rendimientoFuente, 'APU');
  assert.equal(activity.cuadrilla, 3);
  assert.equal(activity.origen, ACTIVITY_ORIGIN.CATALOG);
  assert.equal(activity.status, ACTIVITY_STATUS.PLANIFICADA);

  // 2) Programar con calendario L-S y fecha inicio proyecto
  const { activities: [scheduled] } = scheduleActivities({ calendar: cal, projectStartDate: '2026-10-01', activities: [activity] });
  assert.equal(scheduled.duracion, 8);
  assert.equal(scheduled.fechaInicio, '2026-10-01');
  assert.equal(scheduled.fechaFin, '2026-10-09');
});

test('§23 despues del avance -- 240/480 en 6 dias reales -> avance 50%, rend real 40, desv -33.33%, atraso', () => {
  const cal = makeCalendar();
  const { created: [activity] } = generateActivitiesFromCatalog({ rows: [excavacionRow], apusById: new Map([['APU-EXC', excavacionApu]]), projectId: 'PRJ-1' });
  const { activities: [scheduled] } = scheduleActivities({ calendar: cal, projectStartDate: '2026-10-01', activities: [activity] });

  const progressEntries = [
    makeProgressEntry({ projectId: 'PRJ-1', conceptoId: 'CAT-EXC', delta: 240, pu: 100, fecha: '2026-10-07' })
  ];
  const p = computeActivityProgress({ activity: scheduled, progressEntries, calendar: cal, asOf: '2026-10-07' });
  assert.equal(p.avanceFisicoPct, 50);
  assert.equal(p.diasHabTranscurridos, 6);
  assert.equal(p.rendimientoReal, 40);
  assert.equal(Math.round(p.rendimientoDesviacionPct * 100) / 100, -33.33);
  assert.equal(p.cantidadPendiente, 240);
  assert.equal(Math.round(p.diasRestantesEstimados * 100) / 100, 6);
  assert.equal(p.riesgoAtraso, true);

  // Alertas: sin responsable + atraso + rendimiento bajo
  const alerts = computeAllAlerts({
    activities: [scheduled], progressByActivityId: new Map([[scheduled.id, p]])
  });
  const codes = alerts.map(a => a.code);
  assert.ok(codes.includes(ALERT_CODE.ACTIVIDAD_ATRASADA));
  assert.ok(codes.includes(ALERT_CODE.RENDIMIENTO_BAJO));
});

test('§24 CASO OC -- OC aprobada +40 m³ -> cantidad vigente 520, duracion sugerida 8.67 dias', () => {
  const cal = makeCalendar();
  const { created: [activity] } = generateActivitiesFromCatalog({ rows: [excavacionRow], apusById: new Map([['APU-EXC', excavacionApu]]), projectId: 'PRJ-1' });
  const { activities: [scheduled] } = scheduleActivities({ calendar: cal, projectStartDate: '2026-10-01', activities: [activity] });

  const oc = { ...makeEmptyChangeOrder({
    projectId: 'PRJ-1', conceptoId: 'CAT-EXC',
    cantidadAnterior: 480, cantidadNueva: 520, pu: 100,
    motivo: 'Ampliacion zapatas', descripcion: 'Se agregan 40 m³'
  }), status: CHANGE_ORDER_STATUS.APROBADA };

  const div = detectVigentDivergence({ activity: scheduled, changeOrders: [oc] });
  assert.ok(div);
  assert.equal(div.cantidadAnterior, 480);
  assert.equal(div.cantidadVigente, 520);
  assert.equal(div.delta, 40);
  assert.equal(div.duracionActual, 8);
  assert.equal(Math.round(div.duracionSugerida * 100) / 100, 8.67);
  assert.equal(div.puedeAutoActualizar, true);

  const updated = applyVigentDivergence(scheduled, div);
  assert.equal(updated.cantidad, 520);
  assert.equal(updated.cantidadVigenteSnapshot, 520);
  assert.equal(Math.round(updated.duracion * 100) / 100, 8.67);

  // Reprograma con la nueva duracion
  const { activities: [reprog] } = scheduleActivities({ calendar: cal, projectStartDate: '2026-10-01', activities: [updated] });
  // 8.67 dias -> se redondea a 9 dias laborables. L-S desde 2026-10-01: 01,02,03,05,06,07,08,09,10 = 9 dias -> fin 2026-10-10
  assert.equal(reprog.fechaFin, '2026-10-10');
});

test('§24 duracion editada manualmente NO se sobreescribe automaticamente', () => {
  const activity = makeEmptyActivity({ projectId: 'P', conceptoId: 'CAT-EXC', cantidad: 480, rendimiento: 60, duracion: 10 });
  activity.duracionEditadaManual = true;
  activity.cantidadVigenteSnapshot = 480;
  const oc = { ...makeEmptyChangeOrder({ projectId: 'P', conceptoId: 'CAT-EXC', cantidadAnterior: 480, cantidadNueva: 520, pu: 100, motivo: 'x', descripcion: 'y' }), status: CHANGE_ORDER_STATUS.APROBADA };
  const div = detectVigentDivergence({ activity, changeOrders: [oc] });
  assert.equal(div.puedeAutoActualizar, false);
});

test('OC aprobada -- baseline sigue intacto en Control Presupuestal (regla 20)', () => {
  const presupuestoRows = [{ ...excavacionRow, direct: excavacionRow.pu }];
  const ocAprobada = { ...makeEmptyChangeOrder({ projectId: 'P', conceptoId: 'CAT-EXC', cantidadAnterior: 480, cantidadNueva: 520, pu: 100, motivo: 'x', descripcion: 'y' }), status: CHANGE_ORDER_STATUS.APROBADA };
  const agg = aggregateControlPresupuestal({ presupuestoRows, changeOrders: [ocAprobada] });
  assert.equal(agg.totals.baseline, 48000, 'baseline = 480 * 100 = 48,000');
  assert.equal(agg.totals.cambiosAprobados, 4000, '(520-480) * 100 = 4,000');
  assert.equal(agg.totals.vigente, 52000);
});

test('curva S con baseline + real (progressEntries = avance; payments = costo real, separados por diseno)', () => {
  const cal = makeCalendar();
  const { created: [activity] } = generateActivitiesFromCatalog({ rows: [excavacionRow], apusById: new Map([['APU-EXC', excavacionApu]]), projectId: 'PRJ-1' });
  const { activities: [scheduled] } = scheduleActivities({ calendar: cal, projectStartDate: '2026-10-01', activities: [activity] });
  scheduled.importe = scheduled.cantidad * excavacionRow.pu; // 48000

  const progressEntries = [
    makeProgressEntry({ projectId: 'PRJ-1', conceptoId: 'CAT-EXC', delta: 240, pu: 100, fecha: '2026-10-15' }),
    makeProgressEntry({ projectId: 'PRJ-1', conceptoId: 'CAT-EXC', delta: 240, pu: 100, fecha: '2026-11-05' })
  ];
  // payments van aparte -- son la fuente de "costoReal" en la Curva S
  // (buildSCurveData los mantiene explicitamente separados del avance
  // fisico para que la comparacion fisico-financiero de la seccion 5 del
  // pedido de Fase E tenga sentido, no sea tautologica).
  const payments = [
    { fecha: '2026-10-20', monto: 24000 },
    { fecha: '2026-11-10', monto: 24000 }
  ];
  const s = buildSCurveWithBaseline({
    activities: [scheduled], progressEntries, payments, calendar: cal, presupuestoVigente: 48000
  });
  assert.equal(s.available, true);
  // Programado acumulado en el mes final = 48000 (todo el importe planificado)
  const lastProg = s.series.costoProgramado[s.series.costoProgramado.length - 1];
  assert.equal(Math.round(lastProg.value), 48000);
  // Real (payments) acumulado en el mes final = 48000
  const lastReal = s.series.costoReal[s.series.costoReal.length - 1];
  assert.equal(Math.round(lastReal.value), 48000);
  // Avance fisico acumulado (progressEntries): (240*100 + 240*100) / 48000 = 100%
  const lastFisicoPct = s.series.avanceRealPct[s.series.avanceRealPct.length - 1];
  assert.equal(Math.round(lastFisicoPct.value), 100);
});

test('avance ponderado con varias actividades -- pondera por importe', () => {
  const cal = makeCalendar();
  const activityA = makeEmptyActivity({ projectId: 'P', conceptoId: 'CAT-A', cantidad: 100, rendimiento: 10, name: 'A' });
  const activityB = makeEmptyActivity({ projectId: 'P', conceptoId: 'CAT-B', cantidad: 100, rendimiento: 10, name: 'B' });
  const progressEntries = [
    makeProgressEntry({ projectId: 'P', conceptoId: 'CAT-A', delta: 50, pu: 100 }), // 50% de A (importe 10000)
    makeProgressEntry({ projectId: 'P', conceptoId: 'CAT-B', delta: 20, pu: 500 })  // 20% de B (importe 50000)
  ];
  const rowsByConcept = new Map([
    ['CAT-A', { pu: 100 }],
    ['CAT-B', { pu: 500 }]
  ]);
  const pct = computeWeightedPhysicalProgress([activityA, activityB], progressEntries, rowsByConcept);
  // (10000 * 0.5 + 50000 * 0.2) / (10000 + 50000) = (5000 + 10000) / 60000 = 25%
  assert.equal(Math.round(pct * 100) / 100, 25);
});

test('dedupe -- generar dos veces desde el mismo catalogo no crea duplicados', () => {
  const { created: firstBatch } = generateActivitiesFromCatalog({ rows: [excavacionRow], apusById: new Map([['APU-EXC', excavacionApu]]), projectId: 'PRJ-1' });
  const { created: secondBatch, skipped } = generateActivitiesFromCatalog({
    rows: [excavacionRow], existingActivities: firstBatch, apusById: new Map([['APU-EXC', excavacionApu]]), projectId: 'PRJ-1'
  });
  assert.equal(secondBatch.length, 0);
  assert.equal(skipped[0], 'CAT-EXC');
});

test('persistencia -- actividades sobreviven round-trip JSON (recarga/logout)', () => {
  const { created: [activity] } = generateActivitiesFromCatalog({ rows: [excavacionRow], apusById: new Map([['APU-EXC', excavacionApu]]), projectId: 'PRJ-1' });
  const cal = makeCalendar();
  const { activities: [scheduled] } = scheduleActivities({ calendar: cal, projectStartDate: '2026-10-01', activities: [activity] });
  const restored = JSON.parse(JSON.stringify(scheduled));
  assert.equal(restored.conceptoId, 'CAT-EXC');
  assert.equal(restored.apuId, 'APU-EXC');
  assert.equal(restored.rendimiento, 60);
  assert.equal(restored.fechaInicio, '2026-10-01');
  assert.equal(restored.fechaFin, '2026-10-09');
  assert.equal(restored.cantidadVigenteSnapshot, 480);
});

test('§23 CHECKLIST INTEGRADO -- todos los puntos del brief §23 cumplidos', () => {
  const cal = makeCalendar();
  const { created: [activity] } = generateActivitiesFromCatalog({ rows: [excavacionRow], apusById: new Map([['APU-EXC', excavacionApu]]), projectId: 'PRJ-1' });
  const { activities: [scheduled] } = scheduleActivities({ calendar: cal, projectStartDate: '2026-10-01', activities: [activity] });
  const progressEntries = [makeProgressEntry({ projectId: 'PRJ-1', conceptoId: 'CAT-EXC', delta: 240, pu: 100, fecha: '2026-10-07' })];
  const p = computeActivityProgress({ activity: scheduled, progressEntries, calendar: cal, asOf: '2026-10-07' });

  // Cheque cheque cheque
  const checks = {
    duracion8: scheduled.duracion === 8,
    inicio: scheduled.fechaInicio === '2026-10-01',
    fin: scheduled.fechaFin === '2026-10-09',
    avance50: p.avanceFisicoPct === 50,
    rendReal40: p.rendimientoReal === 40,
    rendPlan60: p.rendimientoPlan === 60,
    desv33: Math.round(p.rendimientoDesviacionPct * 100) / 100 === -33.33,
    pendiente240: p.cantidadPendiente === 240,
    restante6: Math.round(p.diasRestantesEstimados * 100) / 100 === 6,
    riesgo: p.riesgoAtraso === true
  };
  const failed = Object.entries(checks).filter(([, v]) => !v);
  assert.equal(failed.length, 0, `Fallaron: ${failed.map(([k]) => k).join(', ')}`);
});
