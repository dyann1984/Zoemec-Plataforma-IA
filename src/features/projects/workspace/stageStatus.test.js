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
  assert.equal(computeStageProgress('evidencia', { project: { id: 'P1' }, surveys: [], evidenceItems: [], planos: [] }), 'pendiente');
  assert.equal(computeStageProgress('cuantificacion', { project: { id: 'P1' } }), 'pendiente');
  assert.equal(computeStageProgress('costos', { project: { id: 'P1' } }), 'pendiente');
  assert.equal(computeStageProgress('revision', { project: { id: 'P1' } }), 'pendiente');
  assert.equal(computeStageProgress('entrega', { project: { id: 'P1' } }), 'pendiente');
});

test('computeStageProgress: evidencia prioriza colecciones reales (surveys, evidenceItems, planos)', () => {
  const project = { id: 'P1' };

  // 1. Con un survey real del proyecto -> completado
  assert.equal(computeStageProgress('evidencia', { project, surveys: [{ projectId: 'P1' }] }), 'completado');

  // 2. Con un evidenceItem real (foto/video en Storage) -> completado
  assert.equal(computeStageProgress('evidencia', { project, surveys: [], evidenceItems: [{ projectId: 'P1', id: 'ev1' }] }), 'completado');

  // 3. Con un plano real vinculado al proyecto -> completado
  assert.equal(computeStageProgress('evidencia', { project, surveys: [], evidenceItems: [], planos: [{ projectId: 'P1', id: 'pl1' }] }), 'completado');

  // 4. Ítems de otro proyecto NO completan la etapa
  assert.equal(computeStageProgress('evidencia', {
    project,
    surveys: [{ projectId: 'OTRO_PROYECTO' }],
    evidenceItems: [{ projectId: 'OTRO_PROYECTO' }],
    planos: [{ projectId: 'OTRO_PROYECTO' }]
  }), 'pendiente');

  // 5. Fallback secundario de evidenceCount solo cuando colecciones no se proveen
  assert.equal(computeStageProgress('evidencia', { project: { id: 'P1', evidenceCount: 3 } }), 'completado');
  // Pero si las colecciones se proveen vacías, los datos reales mandan -> pendiente
  assert.equal(computeStageProgress('evidencia', { project: { id: 'P1', evidenceCount: 3 }, surveys: [], evidenceItems: [], planos: [] }), 'pendiente');
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

test('computeStageProgress: cuantificacion regla determinista estricta', () => {
  const project = { id: 'PRJ-1' };

  // 1. solo APU con cantidad > 0 -> PENDIENTE (APU no pertenece a Cuantificacion)
  const apusWithQty = [{ projectId: 'PRJ-1', sourceQty: 50, calculated: { qty: 50 } }];
  assert.equal(computeStageProgress('cuantificacion', { project, apus: apusWithQty }), 'pendiente', 'APU NO es fuente de verdad para Cuantificacion');

  // 2. Takeoff confirmado con cantidad > 0 -> COMPLETADO
  const confirmedTakeoff = [{
    id: 'TK-1',
    projectId: 'PRJ-1',
    snapshot: {
      elementos: [{ id: 'el-1', estado: 'VALIDADO_POR_USUARIO', cantidadPropuesta: 15.5 }]
    }
  }];
  assert.equal(computeStageProgress('cuantificacion', { project, planoTakeoffs: confirmedTakeoff }), 'completado');

  // 3. Survey cuantificado con cantidades reales > 0 -> COMPLETADO
  const quantifiedSurvey = [{
    id: 'SURV-1',
    projectId: 'PRJ-1',
    spaces: [{ name: 'Sala', floorArea: 48, wallNetArea: 91.71 }]
  }];
  assert.equal(computeStageProgress('cuantificacion', { project, surveys: quantifiedSurvey }), 'completado');

  // 4. Takeoff vacio -> PENDIENTE
  const emptyTakeoff = [{
    id: 'TK-EMPTY',
    projectId: 'PRJ-1',
    snapshot: { elementos: [] }
  }];
  assert.equal(computeStageProgress('cuantificacion', { project, planoTakeoffs: emptyTakeoff }), 'pendiente');

  const unconfirmedTakeoff = [{
    id: 'TK-UNCONF',
    projectId: 'PRJ-1',
    snapshot: {
      elementos: [{ id: 'el-2', estado: 'PROPUESTO_POR_IA', cantidadPropuesta: 20 }]
    }
  }];
  assert.equal(computeStageProgress('cuantificacion', { project, planoTakeoffs: unconfirmedTakeoff }), 'pendiente');

  // 5. Takeoff/survey de otro projectId -> PENDIENTE
  assert.equal(computeStageProgress('cuantificacion', {
    project,
    planoTakeoffs: [{ projectId: 'OTRO_PROYECTO', snapshot: { elementos: [{ estado: 'VALIDADO_POR_USUARIO', cantidadPropuesta: 100 }] } }],
    surveys: [{ projectId: 'OTRO_PROYECTO', spaces: [{ floorArea: 100 }] }]
  }), 'pendiente');
});

test('computeStageProgress: un modelo 3D por si solo no completa cuantificacion', () => {
  assert.equal(computeStageProgress('cuantificacion', {
    project: { id: 'PRJ-1' },
    evidenceItems: [{
      projectId: 'PRJ-1',
      kind: '3d',
      metadata: { boundingBox: { size: { x: 10, y: 3, z: 8 } }, meshCount: 12 }
    }]
  }), 'pendiente');
});
