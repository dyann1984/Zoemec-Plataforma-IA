import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeProjectHealth, classifyProjectHealthScore, HEALTH_DIMENSION_WEIGHTS, HEALTH_LEVEL } from './projectHealth.js';

test('los pesos de las 8 dimensiones suman exactamente 100', () => {
  assert.equal(Object.values(HEALTH_DIMENSION_WEIGHTS).reduce((s, w) => s + w, 0), 100);
});

test('proyecto recien creado sin ningun dato: todas las dimensiones quedan neutrales (50), excepto Cambios (sin ordenes = legitimamente sano, no "sin datos")', () => {
  const r = computeProjectHealth({});
  Object.entries(r.dimensions).forEach(([key, d]) => {
    if(key === 'cambios') return;
    assert.equal(d.insufficientData, true, `${key} deberia ser insufficientData`);
    assert.equal(d.score, 50, `${key} deberia ser neutral (50)`);
  });
  assert.equal(r.dimensions.cambios.insufficientData, false);
  assert.equal(r.dimensions.cambios.score, 100, 'sin ninguna orden de cambio, el eje esta genuinamente sano, no indeterminado');
  // 7 dimensiones neutrales (50, peso 90) + Cambios sano (100, peso 10): (90*50 + 10*100) / 100 = 55.
  assert.equal(r.score, 55);
});

test('proyecto saludable: sin alertas, buen confidence, sin riesgo -> score alto y nivel SALUDABLE', () => {
  const r = computeProjectHealth({
    confidenceProject: { averageScore: 90, high: 5, medium: 0, low: 0, insufficientEvidence: 0 },
    bidRiskProject: { totalAPUs: 5, low: 5, medium: 0, high: 0, critical: 0 },
    controlPresupuestalTotals: { vigente: 100000, baseline: 100000, cambiosAprobados: 0, variacionPct: 0 },
    controlPresupuestalAlerts: [],
    changeOrders: [], progressEntries: [{ id: 'p1' }],
    dataQuality: { overallPct: 100, missing: [] }, documentosCount: 3
  });
  assert.ok(r.score >= 85, `esperaba >=85, obtuvo ${r.score}`);
  assert.equal(r.level, HEALTH_LEVEL.SALUDABLE);
});

test('proyecto en problemas: sobrepresupuesto CRITICAL + riesgo alto + forecast excedido -> score bajo y nivel RIESGO/CRITICO', () => {
  const r = computeProjectHealth({
    confidenceProject: { averageScore: 40, high: 0, medium: 1, low: 4, insufficientEvidence: 0 },
    bidRiskProject: { totalAPUs: 5, low: 0, medium: 0, high: 2, critical: 3 },
    controlPresupuestalTotals: { vigente: 100000, baseline: 90000, cambiosAprobados: 10000, variacionPct: 40 },
    controlPresupuestalAlerts: [{ type: 'SOBREPRESUPUESTO', severity: 'CRITICAL', message: 'x' }, { type: 'EJECUCION_MAYOR_PRESUPUESTO', severity: 'CRITICAL', message: 'y' }],
    changeOrders: [{ status: 'EN_REVISION' }], progressEntries: [{ id: 'p1' }],
    dataQuality: { overallPct: 30, missing: ['Documentos'] }, documentosCount: 0
  });
  assert.ok(r.score < 70, `esperaba <70, obtuvo ${r.score}`);
  assert.ok([HEALTH_LEVEL.RIESGO, HEALTH_LEVEL.CRITICO].includes(r.level));
});

test('classifyProjectHealthScore: umbrales documentados', () => {
  assert.equal(classifyProjectHealthScore(90).level, HEALTH_LEVEL.SALUDABLE);
  assert.equal(classifyProjectHealthScore(85).level, HEALTH_LEVEL.SALUDABLE);
  assert.equal(classifyProjectHealthScore(84).level, HEALTH_LEVEL.ATENCION);
  assert.equal(classifyProjectHealthScore(70).level, HEALTH_LEVEL.ATENCION);
  assert.equal(classifyProjectHealthScore(69).level, HEALTH_LEVEL.RIESGO);
  assert.equal(classifyProjectHealthScore(50).level, HEALTH_LEVEL.RIESGO);
  assert.equal(classifyProjectHealthScore(49).level, HEALTH_LEVEL.CRITICO);
  assert.equal(classifyProjectHealthScore(0).level, HEALTH_LEVEL.CRITICO);
});

test('drivers: identifica las dimensiones que MAS restan por deficit ponderado (peso x deficit), no solo el score mas bajo', () => {
  const r = computeProjectHealth({
    confidenceProject: { averageScore: 20, high: 0, medium: 0, low: 5, insufficientEvidence: 0 }, // peso 10, score muy bajo
    bidRiskProject: { totalAPUs: 5, low: 5, medium: 0, high: 0, critical: 0 }, // peso 15, sin riesgo
    controlPresupuestalTotals: { vigente: 100000, baseline: 100000, cambiosAprobados: 0, variacionPct: 0 },
    controlPresupuestalAlerts: [], changeOrders: [], progressEntries: [{ id: 'p1' }],
    dataQuality: { overallPct: 100, missing: [] }, documentosCount: 3
  });
  assert.ok(r.drivers.some(d => d.key === 'confianzaPrecios'), 'confianzaPrecios con score muy bajo debe aparecer como driver');
});

test('sin dinero comprometido/vigente, Costos y Forecast quedan neutrales explicitamente (nunca se fuerza un numero)', () => {
  const r = computeProjectHealth({ controlPresupuestalTotals: null });
  assert.equal(r.dimensions.costos.insufficientData, true);
  assert.equal(r.dimensions.forecast.insufficientData, true);
});

test('cambios: sin ninguna orden de cambio, score 100 (no penaliza la ausencia, solo el problema real si existe)', () => {
  const r = computeProjectHealth({ changeOrders: [] });
  assert.equal(r.dimensions.cambios.score, 100);
  assert.equal(r.dimensions.cambios.insufficientData, false);
});

test('documentacion: formula documentada 40 base + 10 por documento, capada a 100', () => {
  const uno = computeProjectHealth({ documentosCount: 1 });
  assert.equal(uno.dimensions.documentacion.score, 50);
  const muchos = computeProjectHealth({ documentosCount: 20 });
  assert.equal(muchos.dimensions.documentacion.score, 100, 'nunca debe pasar de 100');
});
