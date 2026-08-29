/* ZOEMEC MEMORIA TECNICA EMPRESARIAL (Fase 4): pruebas del modelo de
   dominio y su integracion (Confidence/Challenge/Scenario). Fixtures de APU
   reusan el mismo patron de plantilla real completa que apuConfidence.test.js/
   bidRisk.test.js/apuScenario.test.js. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMORY_SCOPE, MEMORY_STATUS, MEMORY_TYPE,
  createMemoryProposal, proposeMemoryFromCorrection, approveMemoryEntry, rejectMemoryEntry,
  supersedeMemoryEntry, findApplicableMemory, resolveTechnicalMemory, buildMemoryEvidence,
  buildScenarioChangeFromMemory
} from './technicalMemory.js';
import { runApuConfidence } from './apuConfidence.js';
import { runApuChallenge } from './apuChallenge.js';
import { createScenario, CHANGE_TYPE } from './apuScenario.js';
import { finalizeProfessionalAPU } from './apuProfessional.js';
import { SYSTEM_RESOURCES } from './constructionSystems.js';

function templateApuFixture(tipo, overrides = {}){
  const fuente = { proveedor: 'Proveedor Confiable S.A.', fecha: new Date().toISOString(), estado: 'VERIFICADO' };
  const materials = SYSTEM_RESOURCES[tipo].materials.map(([descripcion, consumo, unidad, precioUnitario, desperdicioPct]) => ({ descripcion, consumo, unidad, precioUnitario, desperdicioPct, fuente }));
  const labor = SYSTEM_RESOURCES[tipo].labor.map(([descripcion, coef, unidad, salarioBase, fsr]) => ({ descripcion, cuadrilla: 1, rendimiento: 1 / coef, salarioBase, fsr, fuente, rendimientoFuente: 'PLANTILLA' }));
  return {
    concept: `concepto de ${tipo}`, unit: SYSTEM_RESOURCES[tipo].unit, cantidadObra: 100,
    primaryActivity: tipo, classificationMatch: 'exact',
    procedimientoConstructivo: ['paso 1', 'paso 2'], controlCalidad: ['control 1'],
    criterioMedicion: { unidadMedicion: SYSTEM_RESOURCES[tipo].unit }, variables: {},
    materials, labor, equipment: [], consumables: [], seguridad: [], factores: {},
    ...overrides
  };
}

function approvedEntry(overrides = {}){
  const proposal = createMemoryProposal({
    scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD,
    subject: { primaryActivity: 'acero' }, value: 10, unit: 'jor', createdBy: 'ing.perez',
    context: {}, ...overrides
  });
  return approveMemoryEntry(proposal, { approvedBy: 'admin.gonzalez', at: overrides.approvedAt || '2026-01-01T00:00:00.000Z' });
}

// CASO A: PROJECT gana sobre GLOBAL cuando el contexto coincide.
test('CASO A: PROJECT tiene prioridad sobre GLOBAL cuando el context.projectId coincide', () => {
  const global = approvedEntry({ value: 10, approvedAt: '2026-01-01T00:00:00.000Z' });
  const project = approvedEntry({ scope: MEMORY_SCOPE.PROJECT, context: { projectId: 'P1' }, value: 6.5, approvedAt: '2026-02-01T00:00:00.000Z' });
  const resolution = resolveTechnicalMemory([global, project], { type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, context: { projectId: 'P1' } });
  assert.equal(resolution.selectedValue, 6.5);
  assert.equal(resolution.selectedSource.scope, MEMORY_SCOPE.PROJECT);
  assert.equal(resolution.alternatives.length, 1);
  assert.equal(resolution.alternatives[0].scope, MEMORY_SCOPE.GLOBAL);
});

// CASO B: ORGANIZATION aplica cuando no hay PROJECT.
test('CASO B: ORGANIZATION se selecciona cuando no existe una entrada PROJECT aplicable', () => {
  const global = approvedEntry({ value: 10 });
  const org = approvedEntry({ scope: MEMORY_SCOPE.ORGANIZATION, context: { organizationId: 'ORG1' }, value: 8 });
  const resolution = resolveTechnicalMemory([global, org], { type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, context: { organizationId: 'ORG1' } });
  assert.equal(resolution.selectedValue, 8);
  assert.equal(resolution.selectedSource.scope, MEMORY_SCOPE.ORGANIZATION);
});

// CASO C: PROPOSED no influye en Confidence.
test('CASO C: una entrada PROPOSED no se resuelve ni afecta historicalConsistency', () => {
  const proposal = createMemoryProposal({ scope: MEMORY_SCOPE.PROJECT, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero', resourceDescripcion: 'Fierrero (oficial)' }, value: 0.03, context: { projectId: 'P1' } });
  const resolution = resolveTechnicalMemory([proposal], { type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero', resourceDescripcion: 'Fierrero (oficial)' }, context: { projectId: 'P1' } });
  assert.equal(resolution.selectedValue, null);
  assert.equal(resolution.candidates.length, 1, 'debe aparecer como candidato debil, nunca como regla aplicada');

  const apu = finalizeProfessionalAPU(templateApuFixture('acero'));
  const query = { type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero', resourceDescripcion: apu.labor[0].descripcion }, context: { projectId: 'P1' } };
  const evidence = buildMemoryEvidence([proposal], [query]);
  const withoutMemory = runApuConfidence(apu);
  const withMemory = runApuConfidence(apu, { memoryBoost: evidence });
  assert.deepEqual(withMemory.dimensions.historicalConsistency, withoutMemory.dimensions.historicalConsistency);
});

// CASO D: APPROVED si puede mejorar historicalConsistency.
test('CASO D: una entrada APPROVED mejora historicalConsistency (rendimiento calibrado por memoria)', () => {
  const apu = finalizeProfessionalAPU(templateApuFixture('acero'));
  const entry = approvedEntry({ scope: MEMORY_SCOPE.PROJECT, context: { projectId: 'P1' }, subject: { primaryActivity: 'acero', resourceDescripcion: apu.labor[0].descripcion }, value: apu.labor[0].rendimiento });
  const query = { type: MEMORY_TYPE.APPROVED_YIELD, subject: entry.subject, context: { projectId: 'P1' } };
  const evidence = buildMemoryEvidence([entry], [query]);
  const withoutMemory = runApuConfidence(apu);
  const withMemory = runApuConfidence(apu, { memoryBoost: evidence });
  assert.ok(withMemory.dimensions.historicalConsistency.score > withoutMemory.dimensions.historicalConsistency.score);
});

// CASO E: REJECTED nunca se aplica.
test('CASO E: una entrada REJECTED nunca se resuelve ni aparece como candidata', () => {
  const proposal = createMemoryProposal({ scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, value: 10 });
  const rejected = rejectMemoryEntry(proposal, { rejectedBy: 'admin.gonzalez', reason: 'Rendimiento no verificado en campo.' });
  const resolution = resolveTechnicalMemory([rejected], { type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, context: {} });
  assert.equal(resolution.selectedValue, null);
  assert.equal(resolution.candidates.length, 0);
});

// CASO F: SUPERSEDED nunca es vigente.
test('CASO F: una entrada SUPERSEDED nunca se selecciona, aunque su version anterior fue APPROVED', () => {
  const v1 = approvedEntry({ value: 10 });
  const { supersededEntry, nextEntry } = supersedeMemoryEntry(v1, { scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, value: 8 });
  const v2 = approveMemoryEntry(nextEntry, { approvedBy: 'admin.gonzalez' });
  const resolution = resolveTechnicalMemory([supersededEntry, v2], { type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, context: {} });
  assert.equal(resolution.selectedValue, 8);
  assert.equal(resolution.selectedSource.entryId, v2.id);
  assert.equal(supersededEntry.status, MEMORY_STATUS.SUPERSEDED);
});

// CASO G: conflicto en el mismo scope se reporta explicitamente.
test('CASO G: dos entradas APPROVED en el mismo scope reportan conflicto, no se elige por orden de arreglo', () => {
  const a = approvedEntry({ value: 10, approvedAt: '2026-01-01T00:00:00.000Z' });
  const b = approvedEntry({ value: 12, approvedAt: '2026-03-01T00:00:00.000Z' });
  const resolutionOrderAB = resolveTechnicalMemory([a, b], { type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, context: {} });
  const resolutionOrderBA = resolveTechnicalMemory([b, a], { type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, context: {} });
  assert.equal(resolutionOrderAB.conflicts.length, 2);
  assert.equal(resolutionOrderAB.selectedValue, 12, 'debe ganar la aprobacion mas reciente, no la primera del arreglo');
  assert.deepEqual(resolutionOrderAB.selectedValue, resolutionOrderBA.selectedValue, 'el orden del arreglo no debe cambiar el resultado');
  assert.match(resolutionOrderAB.reason, /Conflicto/);
});

// CASO H: correccion genera proposal, no auto-approval.
test('CASO H: proposeMemoryFromCorrection siempre produce PROPOSED, nunca APPROVED', () => {
  const apu = finalizeProfessionalAPU(templateApuFixture('acero'));
  const proposal = proposeMemoryFromCorrection({
    apu, field: 'labor.0.rendimiento', previousValue: apu.labor[0].rendimiento, newValue: apu.labor[0].rendimiento * 0.85,
    scope: MEMORY_SCOPE.PROJECT, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero', resourceDescripcion: apu.labor[0].descripcion },
    context: { projectId: 'P1' }, createdBy: 'ing.perez'
  });
  assert.equal(proposal.status, MEMORY_STATUS.PROPOSED);
  assert.equal(proposal.provenance.wasCorrection, true);
  assert.equal(proposal.provenance.humanApproved, false);
});

// CASO I: approval conserva provenance.
test('CASO I: approveMemoryEntry conserva la provenance original y agrega humanApproved/approvedBy/approvedAt', () => {
  const proposal = createMemoryProposal({ scope: MEMORY_SCOPE.PROJECT, type: MEMORY_TYPE.APPROVED_PRICE, subject: { resourceDescripcion: 'Cemento gris CPC 30R' }, value: 230, context: { projectId: 'P1' }, provenance: { sourceType: 'HUMAN_CORRECTION', wasCorrection: true }, createdBy: 'ing.perez' });
  const approved = approveMemoryEntry(proposal, { approvedBy: 'admin.gonzalez', at: '2026-01-05T00:00:00.000Z' });
  assert.equal(approved.status, MEMORY_STATUS.APPROVED);
  assert.equal(approved.approvedBy, 'admin.gonzalez');
  assert.equal(approved.approvedAt, '2026-01-05T00:00:00.000Z');
  assert.equal(approved.provenance.wasCorrection, true);
  assert.equal(approved.provenance.sourceType, 'HUMAN_CORRECTION');
  assert.equal(approved.provenance.humanApproved, true);
  assert.equal(approved.createdBy, 'ing.perez', 'no debe perder quien la creo originalmente');
});

// CASO J: nueva version supersede la anterior.
test('CASO J: supersedeMemoryEntry crea una version nueva y marca la anterior SUPERSEDED sin borrarla', () => {
  const v1 = approvedEntry({ value: 10 });
  const { supersededEntry, nextEntry } = supersedeMemoryEntry(v1, { scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, value: 8 });
  assert.equal(supersededEntry.status, MEMORY_STATUS.SUPERSEDED);
  assert.equal(supersededEntry.supersededBy, nextEntry.id);
  assert.equal(supersededEntry.value, 10, 'el valor anterior se conserva integro, no se sobreescribe');
  assert.equal(nextEntry.supersedes, v1.id);
  assert.equal(nextEntry.status, MEMORY_STATUS.PROPOSED, 'la nueva version debe pasar su propia revision, no hereda APPROVED');
});

// CASO K + L: Scenario puede usar memoria explicitamente, sin mutar el APU base.
test('CASO K/L: buildScenarioChangeFromMemory + createScenario aplica el valor de memoria sin mutar el apu original', () => {
  const apu = finalizeProfessionalAPU(templateApuFixture('acero'));
  const snapshot = JSON.stringify(apu);
  const memoriaRendimiento = apu.labor[0].rendimiento * 0.7; // memoria de proyecto: rendimiento historico mas conservador
  const entry = approvedEntry({ scope: MEMORY_SCOPE.PROJECT, context: { projectId: 'P1' }, subject: { primaryActivity: 'acero', resourceDescripcion: apu.labor[0].descripcion }, value: memoriaRendimiento });
  const resolution = resolveTechnicalMemory([entry], { type: MEMORY_TYPE.APPROVED_YIELD, subject: entry.subject, context: { projectId: 'P1' } });
  // "rendimiento" no tiene un CHANGE_TYPE absoluto propio en Scenario (PRODUCTIVITY_PERCENT_CHANGE
  // es siempre porcentual) -- buildScenarioChangeFromMemory ya arma mode:'absolute' por defecto,
  // asi que basta con indicarle el changeType/selector correctos para el campo memorizado.
  const change = buildScenarioChangeFromMemory(resolution, { changeType: CHANGE_TYPE.PRODUCTIVITY_PERCENT_CHANGE, selector: { kind: 'labor', descripcion: apu.labor[0].descripcion } });
  const result = createScenario({ apu, changes: [change] });
  assert.equal(JSON.stringify(apu), snapshot, 'el apu original no debe mutar');
  assert.equal(result.appliedChanges.length, 1);
  assert.ok(Math.abs(result.scenario.labor[0].rendimiento - memoriaRendimiento) < 1e-9);
  assert.equal(result.warnings.length, 0);
});

// CASO M: memoria con contexto incorrecto no se aplica.
test('CASO M: una entrada PROJECT con projectId distinto al de la query no se aplica', () => {
  const entry = approvedEntry({ scope: MEMORY_SCOPE.PROJECT, context: { projectId: 'P1' }, value: 6.5 });
  const resolution = resolveTechnicalMemory([entry], { type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, context: { projectId: 'P2' } });
  assert.equal(resolution.selectedValue, null);
  assert.equal(resolution.reason, 'NO_APPROVED_MEMORY_FOUND');
});

// CASO N: mismo input -> misma resolucion (determinismo).
test('CASO N: resolveTechnicalMemory es determinista para el mismo input', () => {
  const entries = [approvedEntry({ value: 10 }), approvedEntry({ scope: MEMORY_SCOPE.PROJECT, context: { projectId: 'P1' }, value: 6.5 })];
  const query = { type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, context: { projectId: 'P1' } };
  assert.deepEqual(resolveTechnicalMemory(entries, query), resolveTechnicalMemory(entries, query));
});

// CASO O: al menos 3 tipos de memoria distintos, resueltos independientemente.
test('CASO O: rendimiento, precio y cuadrilla se resuelven de forma independiente sin cruzarse', () => {
  const yieldEntry = approvedEntry({ type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, value: 10 });
  const priceEntry = approvedEntry({ type: MEMORY_TYPE.APPROVED_PRICE, subject: { resourceDescripcion: 'Acero de refuerzo fy=4200' }, value: 28.5, unit: 'kg' });
  const crewEntry = approvedEntry({ type: MEMORY_TYPE.APPROVED_CREW, subject: { primaryActivity: 'acero', resourceDescripcion: 'Fierrero (oficial)' }, value: 2, unit: 'trabajadores' });
  const entries = [yieldEntry, priceEntry, crewEntry];
  const yieldRes = resolveTechnicalMemory(entries, { type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, context: {} });
  const priceRes = resolveTechnicalMemory(entries, { type: MEMORY_TYPE.APPROVED_PRICE, subject: { resourceDescripcion: 'Acero de refuerzo fy=4200' }, context: {} });
  const crewRes = resolveTechnicalMemory(entries, { type: MEMORY_TYPE.APPROVED_CREW, subject: { primaryActivity: 'acero', resourceDescripcion: 'Fierrero (oficial)' }, context: {} });
  assert.equal(yieldRes.selectedValue, 10);
  assert.equal(priceRes.selectedValue, 28.5);
  assert.equal(crewRes.selectedValue, 2);
});

// Integracion con Challenge (regla 9): un baseline de memoria reemplaza a la
// plantilla y Challenge sigue calculando el impacto el mismo (sin duplicar logica).
test('integracion Challenge: memoryBaselines reemplaza el baseline de plantilla y detecta la desviacion', () => {
  const apu = finalizeProfessionalAPU(templateApuFixture('acero'));
  const memoriaRendimiento = apu.labor[0].rendimiento * 0.5; // memoria del proyecto: 50% mas conservadora
  const memoryBaselines = { [apu.labor[0].descripcion.toLowerCase()]: { rendimiento: memoriaRendimiento, sourceLabel: 'Memoria tecnica aprobada (project)' } };
  const { challenges } = runApuChallenge(apu, { memoryBaselines });
  const finding = challenges.find(c => c.category === 'rendimiento');
  assert.ok(finding);
  assert.equal(finding.baselineValue, memoriaRendimiento);
  assert.equal(finding.baselineSource, 'Memoria tecnica aprobada (project)');
});
