import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDurationDays, extractApuRendimiento, shouldAdoptApuRendimiento, DURATION_ISSUE } from './activityDuration.js';
import { makeEmptyActivity, ACTIVITY_ORIGIN, ACTIVITY_STATUS, validateActivity, isLegalActivityTransition } from './activitySchema.js';

/* Caso obligatorio del brief §23: 480 m³ / 60 m³/dia = 8 dias. */
test('computeDurationDays: 480 / 60 = 8 dias', () => {
  const r = computeDurationDays({ cantidad: 480, rendimiento: 60 });
  assert.equal(r.days, 8);
  assert.equal(r.reason, null);
});

test('computeDurationDays: decimal (520 / 60 = 8.6666...)', () => {
  const r = computeDurationDays({ cantidad: 520, rendimiento: 60 });
  assert.equal(Math.round(r.days * 100) / 100, 8.67);
});

test('computeDurationDays: rendimiento 0 -> null y RENDIMIENTO_REQUERIDO (nunca NaN/Infinity)', () => {
  const r = computeDurationDays({ cantidad: 480, rendimiento: 0 });
  assert.equal(r.days, null);
  assert.equal(r.reason, DURATION_ISSUE.RENDIMIENTO_REQUERIDO);
});

test('computeDurationDays: rendimiento null -> null y RENDIMIENTO_REQUERIDO', () => {
  const r = computeDurationDays({ cantidad: 480, rendimiento: null });
  assert.equal(r.days, null);
  assert.equal(r.reason, DURATION_ISSUE.RENDIMIENTO_REQUERIDO);
});

test('computeDurationDays: cantidad cero -> 0 dias y razon CANTIDAD_CERO', () => {
  const r = computeDurationDays({ cantidad: 0, rendimiento: 60 });
  assert.equal(r.days, 0);
  assert.equal(r.reason, DURATION_ISSUE.CANTIDAD_CERO);
});

test('computeDurationDays: cantidad NaN/null -> null y CANTIDAD_REQUERIDA', () => {
  assert.equal(computeDurationDays({ cantidad: null, rendimiento: 60 }).reason, DURATION_ISSUE.CANTIDAD_REQUERIDA);
  assert.equal(computeDurationDays({ cantidad: undefined, rendimiento: 60 }).reason, DURATION_ISSUE.CANTIDAD_REQUERIDA);
  assert.equal(computeDurationDays({ cantidad: 'abc', rendimiento: 60 }).reason, DURATION_ISSUE.CANTIDAD_REQUERIDA);
});

test('computeDurationDays: crewMultiplier=2 divide la duracion (medio equipo el doble)', () => {
  const r = computeDurationDays({ cantidad: 480, rendimiento: 60, crewMultiplier: 2 });
  assert.equal(r.days, 4);
});

test('extractApuRendimiento: laborDetails con rendimiento > 0 -> APU', () => {
  const apu = { laborDetails: [{ cuadrilla: 1, rendimiento: 60, jornada: 8 }] };
  const r = extractApuRendimiento(apu);
  assert.equal(r.rendimiento, 60);
  assert.equal(r.cuadrilla, 1);
  assert.equal(r.fuente, 'APU');
});

test('extractApuRendimiento: fallback a apu.labor v2 (row-object con rendimiento)', () => {
  const apu = { laborDetails: [], labor: [{ clave: 'x', rendimiento: 40, cuadrilla: 2 }] };
  const r = extractApuRendimiento(apu);
  assert.equal(r.rendimiento, 40);
  assert.equal(r.cuadrilla, 2);
});

test('extractApuRendimiento: sin rendimiento -> null (nunca inventa)', () => {
  assert.equal(extractApuRendimiento({}).rendimiento, null);
  assert.equal(extractApuRendimiento({ laborDetails: [] }).rendimiento, null);
  assert.equal(extractApuRendimiento(null).rendimiento, null);
});

test('shouldAdoptApuRendimiento: actividad CATALOG sin rendimiento -> aplica', () => {
  const a = makeEmptyActivity({ projectId: 'P', name: 'x', origen: ACTIVITY_ORIGIN.CATALOG });
  const r = shouldAdoptApuRendimiento(a, { rendimiento: 60 });
  assert.equal(r.shouldApply, true);
});

test('shouldAdoptApuRendimiento: actividad con rendimiento MANUAL -> NO sobreescribe', () => {
  const a = makeEmptyActivity({ projectId: 'P', name: 'x', origen: ACTIVITY_ORIGIN.CATALOG, rendimiento: 55, rendimientoFuente: 'MANUAL' });
  const r = shouldAdoptApuRendimiento(a, { rendimiento: 60 });
  assert.equal(r.shouldApply, false);
  assert.equal(r.reason, 'USER_OVERRIDE');
});

test('shouldAdoptApuRendimiento: actividad MANUAL_ORIGIN -> nunca auto-aplica (usuario decide)', () => {
  const a = makeEmptyActivity({ projectId: 'P', name: 'x', origen: ACTIVITY_ORIGIN.MANUAL, rendimiento: 55 });
  assert.equal(shouldAdoptApuRendimiento(a, { rendimiento: 60 }).shouldApply, false);
});

test('makeEmptyActivity: crea con defaults seguros y valida', () => {
  const a = makeEmptyActivity({ projectId: 'P-1', name: 'Excavacion', unit: 'm³', cantidad: 480 });
  assert.equal(a.projectId, 'P-1');
  assert.equal(a.status, ACTIVITY_STATUS.BORRADOR);
  assert.equal(a.cantidad, 480);
  assert.equal(a.duracionEditadaManual, false);
  const v = validateActivity(a);
  assert.equal(v.valid, true);
});

test('validateActivity: rendimiento negativo -> invalido', () => {
  const a = makeEmptyActivity({ projectId: 'P-1', name: 'x', rendimiento: -5 });
  const v = validateActivity(a);
  assert.equal(v.valid, false);
});

test('isLegalActivityTransition: BORRADOR -> PLANIFICADA -> EN_PROCESO -> TERMINADA', () => {
  assert.equal(isLegalActivityTransition('BORRADOR', 'PLANIFICADA'), true);
  assert.equal(isLegalActivityTransition('PLANIFICADA', 'EN_PROCESO'), true);
  assert.equal(isLegalActivityTransition('EN_PROCESO', 'TERMINADA'), true);
  assert.equal(isLegalActivityTransition('TERMINADA', 'EN_PROCESO'), false);
  assert.equal(isLegalActivityTransition('TERMINADA', 'CANCELADA'), false);
  assert.equal(isLegalActivityTransition('EN_PROCESO', 'CANCELADA'), false); // regla: en proceso -> detenida antes
});
