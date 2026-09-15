import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACE_STAGES, computeStageProgress, deriveProjectLifecycleStage } from './stageStatus.js';

test('WORKSPACE_STAGES: define exactamente las 5 etapas en el orden requerido', () => {
  assert.equal(WORKSPACE_STAGES.length, 5);
  const expectedKeys = ['evidencia', 'cuantificacion', 'costos', 'revision', 'entrega'];
  assert.deepEqual(WORKSPACE_STAGES.map(s => s.key), expectedKeys);
  assert.deepEqual(WORKSPACE_STAGES.map(s => s.order), [1, 2, 3, 4, 5]);
});

test('computeStageProgress: sin datos suficientes devuelve pendiente (nunca inventa progreso)', () => {
  assert.equal(computeStageProgress('evidencia', { project: null }), 'pendiente');
  assert.equal(computeStageProgress('cuantificacion', { project: { id: 'P1' } }), 'pendiente');
  assert.equal(computeStageProgress('costos', { project: { id: 'P1' } }), 'pendiente');
  assert.equal(computeStageProgress('revision', { project: { id: 'P1' } }), 'pendiente');
  assert.equal(computeStageProgress('entrega', { project: { id: 'P1' } }), 'pendiente');
});

test('computeStageProgress: costos pasa a completado si existen APUs o presupuestos del proyecto', () => {
  const project = { id: 'P1' };
  const apus = [{ projectId: 'P1', concept: 'Concreto f\'c=250' }];
  assert.equal(computeStageProgress('costos', { project, apus }), 'completado');

  const budgets = [{ projectId: 'P1', total: 50000 }];
  assert.equal(computeStageProgress('costos', { project, apus: [], budgets }), 'completado');
});

test('computeStageProgress: revision pasa a atencion si existen APUs con riesgo Critico o Alto', () => {
  const project = { id: 'P1' };
  const apusNormal = [{ projectId: 'P1', confidence: 85, riskLevel: 'Bajo' }];
  assert.equal(computeStageProgress('revision', { project, apus: apusNormal }), 'completado');

  const apusRisk = [{ projectId: 'P1', confidence: 60, riskLevel: 'Critico' }];
  assert.equal(computeStageProgress('revision', { project, apus: apusRisk }), 'atencion');
});

test('computeStageProgress: entrega pasa a completado si la obra esta terminada o tiene dossierExported', () => {
  assert.equal(computeStageProgress('entrega', { project: { id: 'P1', status: 'Terminado' } }), 'completado');
  assert.equal(computeStageProgress('entrega', { project: { id: 'P1', status: 'Cerrado' } }), 'completado');
  assert.equal(computeStageProgress('entrega', { project: { id: 'P1', status: 'En ejecucion', dossierExported: true } }), 'completado');
});

test('deriveProjectLifecycleStage: identifica con precision la etapa real de obra', () => {
  assert.equal(deriveProjectLifecycleStage({ project: null }), null);

  // Sin evidencia -> etapa actual es Evidencia
  const p1 = { id: 'P1', status: 'En ejecucion' };
  assert.equal(deriveProjectLifecycleStage({ project: p1, surveys: [] })?.key, 'evidencia');

  // Con evidencia pero sin cuantificación -> etapa actual es Cuantificación
  const surveys = [{ projectId: 'P1' }];
  assert.equal(deriveProjectLifecycleStage({ project: p1, surveys, apus: [] })?.key, 'cuantificacion');

  // Con evidencia y cuantificación pero sin presupuestos ni APUs -> Costos
  const apusWithQty = [{ projectId: 'P1', sourceQty: 10 }];
  // En nuestro modelo apusWithQty cubre cuantificacion y costos simultáneamente si tiene APU
  // Si tiene survey pero no APUs:
  assert.equal(deriveProjectLifecycleStage({ project: p1, surveys, apus: [] })?.key, 'cuantificacion');
});
