/* ZOEMEC INTELLIGENCE (Fase 5, capa de orquestacion UI): pruebas de la capa
   pura entre el editor y los 4 motores. Sin React/DOM -- node:test puro,
   mismo criterio que el resto del dominio. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeZoemecIntelligence, summarizeIntelligence, describeImpact, safeRun, buildScenarioLabChange, runScenarioLab, SCENARIO_LAB_KIND, buildScenarioLabPrefillFromChallenge } from './zoemecIntelligence.js';
import { CHANGE_TYPE } from '../../domain/apuScenario.js';
import { finalizeProfessionalAPU } from '../../domain/apuProfessional.js';
import { SYSTEM_RESOURCES } from '../../domain/constructionSystems.js';

function healthyApuFixture(overrides = {}){
  const fuente = { proveedor: 'Proveedor Confiable S.A.', fecha: new Date().toISOString(), estado: 'VERIFICADO' };
  const materials = SYSTEM_RESOURCES.acero.materials.map(([descripcion, consumo, unidad, precioUnitario, desperdicioPct]) => ({ descripcion, consumo, unidad, precioUnitario, desperdicioPct, fuente }));
  const labor = SYSTEM_RESOURCES.acero.labor.map(([descripcion, coef, unidad, salarioBase, fsr]) => ({ descripcion, cuadrilla: 1, rendimiento: 1 / coef, salarioBase, fsr, fuente, rendimientoFuente: 'HISTORICO' }));
  return {
    concept: 'Suministro y habilitado de acero fy=4200', unit: 'kg', cantidadObra: 800,
    primaryActivity: 'acero', classificationMatch: 'exact',
    procedimientoConstructivo: ['p1', 'p2'], controlCalidad: ['c1'], criterioMedicion: { unidadMedicion: 'kg' }, variables: { weight: 800 },
    materials, labor, equipment: [], consumables: [], seguridad: [], factores: {},
    ...overrides
  };
}

test('safeRun: aisla un error sin propagarlo, y no lo inventa', () => {
  const ok = safeRun(() => 42);
  const fail = safeRun(() => { throw new Error('boom'); });
  assert.deepEqual(ok, { ok: true, data: 42 });
  assert.equal(fail.ok, false);
  assert.equal(fail.error, 'boom');
});

test('computeZoemecIntelligence: los 4 motores corren sobre el APU real y devuelven datos reales', () => {
  const apu = finalizeProfessionalAPU(healthyApuFixture());
  const intelligence = computeZoemecIntelligence(apu);
  assert.equal(intelligence.audit.ok, true);
  assert.equal(intelligence.challenge.ok, true);
  assert.equal(intelligence.confidence.ok, true);
  assert.equal(intelligence.bidRisk.ok, true);
  assert.ok(Array.isArray(intelligence.audit.data.findings));
  assert.ok(intelligence.confidence.data.score >= 0);
  assert.equal(intelligence.bidRisk.data.confidence.score, intelligence.confidence.data.score, 'bidRisk debe reusar la MISMA confidence ya calculada, no recalcularla aparte');
});

test('computeZoemecIntelligence: un APU vacio no revienta el calculo, cada motor responde con datos reales de ese caso', () => {
  const intelligence = computeZoemecIntelligence({});
  assert.equal(intelligence.audit.ok, true);
  assert.equal(intelligence.confidence.ok, true);
  assert.equal(intelligence.confidence.data.status, 'INSUFFICIENT_EVIDENCE');
});

test('summarizeIntelligence: Confidence INSUFFICIENT_EVIDENCE se muestra como "SIN EVIDENCIA", nunca un score inventado', () => {
  const intelligence = computeZoemecIntelligence({});
  const summary = summarizeIntelligence(intelligence);
  assert.equal(summary.confidence.display, 'SIN EVIDENCIA');
  assert.equal(summary.confidence.score, null);
});

test('summarizeIntelligence: Confidence normal muestra score% y status reales', () => {
  const apu = finalizeProfessionalAPU(healthyApuFixture());
  const intelligence = computeZoemecIntelligence(apu);
  const summary = summarizeIntelligence(intelligence);
  assert.equal(summary.confidence.display, `${intelligence.confidence.data.score}%`);
  assert.equal(summary.confidence.status, intelligence.confidence.data.status);
});

test('summarizeIntelligence: un motor con error se refleja como ERROR con el mensaje real, no se oculta', () => {
  const intelligence = { audit: { ok: false, error: 'fallo real de auditor' }, challenge: { ok: true, data: { challenges: [] } }, confidence: { ok: true, data: { status: 'HIGH', score: 90 } }, bidRisk: { ok: true, data: { severity: 'LOW', estimatedExposure: 0, findings: [] } } };
  const summary = summarizeIntelligence(intelligence);
  assert.equal(summary.audit.display, 'ERROR');
  assert.equal(summary.audit.error, 'fallo real de auditor');
});

test('summarizeIntelligence: audit.topSeverity refleja la peor severidad real entre los findings', () => {
  const intelligence = {
    audit: { ok: true, data: { findings: [{ severity: 'LOW' }, { severity: 'CRITICAL' }, { severity: 'MEDIUM' }], summary: {} } },
    challenge: { ok: true, data: { challenges: [{ projectImpact: 100 }, { projectImpact: null }] } },
    confidence: { ok: true, data: { status: 'HIGH', score: 90 } },
    bidRisk: { ok: true, data: { severity: 'LOW', estimatedExposure: 0, findings: [] } }
  };
  const summary = summarizeIntelligence(intelligence);
  assert.equal(summary.audit.topSeverity, 'CRITICAL');
  assert.equal(summary.audit.count, 3);
  assert.equal(summary.challenge.count, 2);
  assert.equal(summary.challenge.monetizableCount, 1);
});

test('describeImpact: valor real presente se devuelve tal cual, sin texto sustituto', () => {
  assert.deepEqual(describeImpact(1234.5, null), { display: null, value: 1234.5 });
});

test('describeImpact: null por falta de cantidadObra muestra "SIN CANTIDAD DE OBRA"', () => {
  assert.deepEqual(describeImpact(null, 'PROJECT_QUANTITY_NOT_CAPTURED'), { display: 'SIN CANTIDAD DE OBRA', value: null });
});

test('describeImpact: null por cualquier otra razon muestra "NO CALCULABLE", nunca $0', () => {
  assert.deepEqual(describeImpact(null, 'NOT_ESTIMABLE_WITH_CURRENT_DATA'), { display: 'NO CALCULABLE', value: null });
});

test('buildScenarioLabChange: mapea cada SCENARIO_LAB_KIND a su CHANGE_TYPE real de apuScenario.js', () => {
  assert.equal(buildScenarioLabChange({ kind: SCENARIO_LAB_KIND.MATERIAL_PERCENT, value: 10 }).type, CHANGE_TYPE.PRICE_PERCENT_CHANGE);
  assert.equal(buildScenarioLabChange({ kind: SCENARIO_LAB_KIND.LABOR_PERCENT, value: 10 }).type, CHANGE_TYPE.LABOR_COST_PERCENT_CHANGE);
  assert.equal(buildScenarioLabChange({ kind: SCENARIO_LAB_KIND.PRODUCTIVITY_PERCENT, value: -20 }).type, CHANGE_TYPE.PRODUCTIVITY_PERCENT_CHANGE);
  assert.equal(buildScenarioLabChange({ kind: SCENARIO_LAB_KIND.WASTE_PERCENT, value: 5 }).type, CHANGE_TYPE.WASTE_PERCENT_CHANGE);
  const priceOverride = buildScenarioLabChange({ kind: SCENARIO_LAB_KIND.RESOURCE_PRICE, resourceDescripcion: 'Acero de refuerzo fy=4200', value: 30 });
  assert.equal(priceOverride.type, CHANGE_TYPE.RESOURCE_PRICE_OVERRIDE);
  assert.equal(priceOverride.mode, 'absolute');
});

test('buildScenarioLabChange: RESOURCE_PRICE sin recurso especifico devuelve null (nunca "todos" para un override absoluto)', () => {
  assert.equal(buildScenarioLabChange({ kind: SCENARIO_LAB_KIND.RESOURCE_PRICE, value: 30 }), null);
});

// Regresion de un bug real encontrado en QA visual (Fase 5): "Simular
// correccion" pasaba baselineValue (rendimiento ABSOLUTO) directo al campo
// de valor del Scenario Lab, que SIEMPRE lo interpreta como % -- un
// rendimiento absoluto de 6.36 se colaba como "+6.36%" en vez de fijar el
// rendimiento correctamente al valor del baseline.
test('buildScenarioLabPrefillFromChallenge: el % calculado, aplicado como PRODUCTIVITY_PERCENT_CHANGE, reproduce exactamente el baselineValue absoluto', () => {
  const challengeFinding = { id: 'yield:0', category: 'rendimiento', resourceDescripcion: 'Oficial albañil', currentValue: 6.363636363636364, baselineValue: 4.545454545454546, unitImpact: 59.02, projectImpact: 4721.65, title: 'Rendimiento de "Oficial albañil" se desvia 40.0% de la referencia' };
  const prefill = buildScenarioLabPrefillFromChallenge(challengeFinding);
  assert.equal(prefill.kind, SCENARIO_LAB_KIND.PRODUCTIVITY_PERCENT);
  assert.equal(prefill.challengeId, 'yield:0');
  assert.equal(prefill.resourceDescripcion, 'Oficial albañil');
  // Fase 6.1: el finding completo viaja como challengeSnapshot para que el
  // servidor pueda comparar contra su propio recalculo al registrar CORRECT.
  assert.equal(prefill.challengeSnapshot.category, 'rendimiento');
  assert.equal(prefill.challengeSnapshot.unitImpact, 59.02);
  assert.equal(prefill.challengeSnapshot.projectImpact, 4721.65);
  // Verificacion real: aplicar el % calculado sobre currentValue debe
  // reproducir baselineValue (dentro de la precision de redondeo a 2 decimales).
  const reconstructed = challengeFinding.currentValue * (1 + prefill.value / 100);
  assert.ok(Math.abs(reconstructed - challengeFinding.baselineValue) < 0.01);
});

test('runScenarioLab: usa createScenario real (BASE vs ESCENARIO), sin mutar el apu original', () => {
  const apu = finalizeProfessionalAPU(healthyApuFixture());
  const snapshot = JSON.stringify(apu);
  const change = buildScenarioLabChange({ kind: SCENARIO_LAB_KIND.MATERIAL_PERCENT, value: 15, reason: 'Prueba' });
  const result = runScenarioLab(apu, [change]);
  assert.equal(result.ok, true);
  assert.ok(result.data.delta.scenarioUnitCost > result.data.delta.baseUnitCost);
  assert.equal(JSON.stringify(apu), snapshot);
});
