import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeReviewStageModel } from './reviewStageModel.js';
import { SYSTEM_RESOURCES } from '../../../domain/constructionSystems.js';
import { calcAPUv2 } from '../../../lib/apuCalc.js';

const baseApu = (overrides = {}) => {
  const source = {
    proveedor: 'Proveedor de prueba',
    fecha: new Date().toISOString(),
    estado: 'VERIFICADO'
  };

  const type = 'acero';

  const apu = {
    id: 'apu-1',
    projectId: 'project-a',
    concept: 'Suministro y habilitado de acero',
    unit: SYSTEM_RESOURCES[type].unit,
    cantidadObra: 10,
    primaryActivity: type,
    classificationMatch: 'exact',

    procedimientoConstructivo: [
      'Preparación del material',
      'Habilitado y colocación'
    ],

    controlCalidad: [
      'Verificación de especificación y colocación'
    ],

    criterioMedicion: {
      unidadMedicion: SYSTEM_RESOURCES[type].unit
    },

    variables: {
      weight: 10
    },

    materials: SYSTEM_RESOURCES[type].materials.map(
      ([descripcion, consumo, unidad, precioUnitario, desperdicioPct]) => ({
        descripcion,
        consumo,
        unidad,
        precioUnitario,
        desperdicioPct,
        fuente: source
      })
    ),

    labor: SYSTEM_RESOURCES[type].labor.map(
      ([descripcion, coef, unidad, salarioBase, fsr]) => ({
        descripcion,
        unidad,
        cuadrilla: 1,
        rendimiento: 1 / coef,
        salarioBase,
        fsr,
        fuente: source,
        rendimientoFuente: 'HISTORICO'
      })
    ),

    equipment: [],
    consumables: [],
    seguridad: [],
    factores: {},
    ...overrides
  };

  if (!Object.prototype.hasOwnProperty.call(overrides, 'calculated')) {
    apu.calculated = calcAPUv2(apu);
  }

  return apu;
};

const concept = (apuId = 'apu-1', projectId = 'project-a') => ({ id: `concept-${apuId}`, projectId, apuId, qty: 10 });

describe('computeReviewStageModel', () => {
  it('sin APUs costados devuelve PENDIENTE', () => {
    assert.equal(computeReviewStageModel({ projectId: 'project-a', apus: [], catalogConceptos: [] }).status, 'pendiente');
  });

  it('filtra por proyecto y no consume el APU de otro proyecto', () => {
    const model = computeReviewStageModel({
      projectId: 'project-a',
      apus: [baseApu(), baseApu({ id: 'apu-b', projectId: 'project-b' })],
      catalogConceptos: [concept()]
    });
    assert.equal(model.reviewableCount, 1);
    assert.equal(model.results[0].apuId, 'apu-1');
  });

  it('Audit CRITICAL produce ATENCIÓN', () => {
    const model = computeReviewStageModel({
      projectId: 'project-a',
      apus: [baseApu({ unit: '' })],
      catalogConceptos: [concept()]
    });
    assert.equal(model.status, 'atencion');
    assert.ok(model.criticalFindings > 0);
  });

  it('Challenge sin decisión produce ATENCIÓN y con decisión deja de estar pendiente', () => {
    const apu = baseApu({ labor: [{ descripcion: 'Oficial', rendimiento: 1.3, cuadrilla: 1, salarioBase: 100, fsr: 1 }] });
    const pending = computeReviewStageModel({ projectId: 'project-a', apus: [apu], catalogConceptos: [concept()] });
    assert.ok(pending.pendingChallenges > 0);
    const decisions = pending.results[0].challenges.map(challenge => ({ challengeId: challenge.id, decision: 'JUSTIFY' }));
    const decided = computeReviewStageModel({ projectId: 'project-a', apus: [apu], catalogConceptos: [concept()], decisions });
    assert.equal(decided.pendingChallenges, 0);
  });

  it('Confidence insuficiente no se convierte en cero', () => {
    const model = computeReviewStageModel({
      projectId: 'project-a',
      apus: [baseApu({ primaryActivity: 'generico' })],
      catalogConceptos: [concept()]
    });
    assert.equal(model.confidenceAverage, null);
    assert.equal(model.confidenceInsufficient, 1);
  });

  it('APU revisado y sin hallazgos críticos puede completar la etapa', () => {
    const apu = baseApu({ revisionStatus: 'REVISADO' });
    const pending = computeReviewStageModel({ projectId: 'project-a', apus: [apu], catalogConceptos: [concept()] });
    const decisions = pending.results[0].challenges.map(challenge => ({ challengeId: challenge.id, decision: 'MAINTAIN' }));
    const model = computeReviewStageModel({
      projectId: 'project-a',
      apus: [apu],
      catalogConceptos: [concept()],
      decisions
    });
    assert.equal(model.status, 'completado');
    assert.equal(model.reviewedCount, 1);
  });

  it('agrega dos APUs con estados distintos como ATENCIÓN', () => {
    const model = computeReviewStageModel({
      projectId: 'project-a',
      apus: [baseApu({ revisionStatus: 'REVISADO' }), baseApu({ id: 'apu-2', revisionStatus: 'GENERADO' })],
      catalogConceptos: [concept(), concept('apu-2')]
    });
    assert.equal(model.reviewableCount, 2);
    assert.equal(model.status, 'atencion');
  });

  it('un error aislado de motor no elimina la fila ni rompe el resumen', () => {
    const model = computeReviewStageModel({
      projectId: 'project-a',
      apus: [baseApu({ calculated: null, labor: null, materials: null })],
      catalogConceptos: [concept()]
    });
    assert.equal(model.reviewableCount, 1);
    assert.ok(Array.isArray(model.engineErrors));
  });
});
