import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeProjectDataQuality, DATA_QUALITY_DIMENSIONS } from './projectDataQuality.js';

test('los pesos de las 8 dimensiones suman exactamente 100', () => {
  assert.equal(DATA_QUALITY_DIMENSIONS.reduce((s, d) => s + d.weight, 0), 100);
});

test('proyecto recien creado sin ningun dato: 0% completo, nunca lanza', () => {
  const r = computeProjectDataQuality({});
  assert.equal(r.overallPct, 0);
  assert.equal(r.missing.length, 8);
});

test('proyecto con TODO presente: 100% completo', () => {
  const r = computeProjectDataQuality({
    hasUbicacion: true, planosCount: 1, presupuestoHasBaseline: true, apusCount: 3,
    confidenceProject: { totalAPUs: 3, high: 2, medium: 1, low: 0, insufficientEvidence: 0 },
    avanceCount: 2, documentosCount: 1, responsablesCount: 1
  });
  assert.equal(r.overallPct, 100);
  assert.equal(r.missing.length, 0);
});

test('precios con evidencia requiere al menos un APU HIGH/MEDIUM, no basta con tener APUs', () => {
  const soloInsuficiente = computeProjectDataQuality({
    apusCount: 2, confidenceProject: { totalAPUs: 2, high: 0, medium: 0, low: 0, insufficientEvidence: 2 }
  });
  assert.ok(soloInsuficiente.dimensions.find(d => d.key === 'precios').present === false);

  const conEvidencia = computeProjectDataQuality({
    apusCount: 2, confidenceProject: { totalAPUs: 2, high: 1, medium: 0, low: 1, insufficientEvidence: 0 }
  });
  assert.ok(conEvidencia.dimensions.find(d => d.key === 'precios').present === true);
});

test('reporta exactamente que dimensiones faltan, por su label', () => {
  const r = computeProjectDataQuality({ hasUbicacion: true, planosCount: 1 });
  assert.ok(r.missing.includes('Presupuesto'));
  assert.ok(!r.missing.includes('Ubicación'));
});
