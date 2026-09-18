import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRecordHealthSnapshot, makeHealthSnapshot, summarizeHealthTrend } from './projectHealthHistory.js';

test('sin snapshot previo, siempre se guarda el primero', () => {
  assert.equal(shouldRecordHealthSnapshot(null, { score: 80, level: 'ATENCION' }), true);
});

test('mismo score y nivel que el ultimo snapshot -> no vale la pena guardar de nuevo', () => {
  assert.equal(shouldRecordHealthSnapshot({ score: 80, level: 'ATENCION' }, { score: 80, level: 'ATENCION' }), false);
});

test('cambio de score aunque sea 1 punto -> se guarda', () => {
  assert.equal(shouldRecordHealthSnapshot({ score: 80, level: 'ATENCION' }, { score: 79, level: 'ATENCION' }), true);
});

test('cambio de nivel aunque el score no cambie -> se guarda', () => {
  assert.equal(shouldRecordHealthSnapshot({ score: 85, level: 'SALUDABLE' }, { score: 85, level: 'ATENCION' }), true);
});

test('makeHealthSnapshot extrae score/level/label y aplana las dimensiones a solo su score', () => {
  const health = { score: 78, level: 'ATENCION', label: 'Atención', dimensions: { costos: { score: 90, weight: 15 }, riesgo: { score: 60, weight: 15 } } };
  const snap = makeHealthSnapshot({ projectId: 'PRO-1', health, at: '2026-03-01T00:00:00.000Z' });
  assert.equal(snap.score, 78);
  assert.deepEqual(snap.dimensions, { costos: 90, riesgo: 60 });
});

test('summarizeHealthTrend: arma la flecha de scores en orden cronologico', () => {
  const history = [
    { at: '2026-03-01T00:00:00.000Z', score: 74, dimensions: {} },
    { at: '2026-01-01T00:00:00.000Z', score: 85, dimensions: {} },
    { at: '2026-02-01T00:00:00.000Z', score: 82, dimensions: {} },
    { at: '2026-04-01T00:00:00.000Z', score: 78, dimensions: {} }
  ];
  const trend = summarizeHealthTrend(history);
  assert.equal(trend.scoresLabel, '85 → 82 → 74 → 78');
});

test('summarizeHealthTrend: con menos de 2 puntos, sin cambios de dimension (nunca inventa una causa)', () => {
  const trend = summarizeHealthTrend([{ at: '2026-01-01T00:00:00.000Z', score: 80, dimensions: { costos: 90 } }]);
  assert.deepEqual(trend.dimensionChanges, []);
});

test('summarizeHealthTrend: identifica que dimensiones cambiaron mas entre el penultimo y el ultimo snapshot', () => {
  const history = [
    { at: '2026-01-01T00:00:00.000Z', score: 85, dimensions: { costos: 90, riesgo: 80, datos: 100 } },
    { at: '2026-02-01T00:00:00.000Z', score: 70, dimensions: { costos: 90, riesgo: 30, datos: 95 } }
  ];
  const trend = summarizeHealthTrend(history);
  assert.equal(trend.dimensionChanges[0].key, 'riesgo', 'riesgo tuvo el mayor cambio absoluto (-50)');
  assert.equal(trend.dimensionChanges[0].delta, -50);
  assert.ok(!trend.dimensionChanges.some(c => c.key === 'costos'), 'costos no cambio, no aparece');
});
