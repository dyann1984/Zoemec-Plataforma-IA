/* Dossier de Proyecto/Multi-APU (Fase 8 Parte 2): capa de datos pura de
   orquestacion, sin dibujar nada (ver apuProjectDossierPdf.js/
   apuProjectDossierXlsx.js). NUNCA reimplementa un motor ni una agregacion
   ya existente -- reusa tal cual runProjectBidRisk/runProjectConfidence
   (agregacion por proyecto), createScenario/applyChangeAcrossProject
   (escenarios) y computeApuEngineResults/loadChallengeDecisions/
   loadProjectMemory (computo por-APU, ya extraidos en apuDossierData.js
   para este proposito exacto -- ver el comentario de esa funcion).

   Fuente de verdad (misma regla 1 de apuDossierData.js, a nivel proyecto):
   los APUs vienen SIEMPRE de `GET /api/apus?projectId=`, que ya devuelve el
   `snapshot` de la version ACTUAL de cada uno (server-side, Fase 7) -- nunca
   se acepta un arreglo de APUs enviado por el llamador como si fuera la
   fuente autoritativa. */
import { runProjectBidRisk } from '../domain/bidRisk.js';
import { runProjectConfidence } from '../domain/apuConfidence.js';
import { createScenario, applyChangeAcrossProject } from '../domain/apuScenario.js';
import { computeApuEngineResults, loadChallengeDecisions, loadProjectMemory } from './apuDossierData.js';
import { computeSnapshotHash } from '../domain/snapshotHash.js';
import { apiGetSafe } from '../services/apiClient.js';

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

export async function loadProjectApus(projectId){
  const data = await apiGetSafe(`/api/apus?projectId=${encodeURIComponent(projectId)}`);
  return Array.isArray(data?.apus) ? data.apus : [];
}

export async function loadProjectMeta(projectId){
  const data = await apiGetSafe(`/api/projects?id=${encodeURIComponent(projectId)}`);
  return data?.project || null;
}

/* Un APU "requiere revision prioritaria" (regla 2 del spec) si su Bid Risk
   es HIGH/CRITICAL o si su Confidence no se pudo calcular por evidencia
   insuficiente -- nunca por un umbral inventado sobre P.U. o importe. */
function needsPriorityReview(entry){
  return entry.bidRisk.severity === 'CRITICAL' || entry.bidRisk.severity === 'HIGH'
    || entry.confidence.status === 'INSUFFICIENT_EVIDENCE';
}

/* Escenarios seleccionados EXPLICITAMENTE (regla 7): `selectedScenarios` es
   `[{scenarioId, name, apuId, changes, options}]` -- nunca se generan/
   incluyen escenarios que el llamador no pidio. Cada uno se recalcula desde
   el snapshot REAL de ese APU dentro de este proyecto (nunca desde un
   snapshot distinto), rotulado por el llamador (UI) como
   "SIMULACION -- NO MODIFICA EL APU BASE". */
function buildSelectedScenarios(apuEntries, selectedScenarios){
  return selectedScenarios.map(def => {
    const entry = apuEntries.find(e => e.apuId === def.apuId);
    if(!entry) return null;
    const result = createScenario({ apu: entry.snapshot, changes: def.changes || [], options: def.options || {} });
    return {
      scenarioId: def.scenarioId || `${def.apuId}-SC-${Math.random().toString(36).slice(2, 8)}`,
      name: def.name || 'Escenario', apuId: def.apuId, concept: entry.concept,
      baseVersionId: entry.versionId, changes: def.changes || [],
      baseCost: result.base.calculated?.pu ?? null, scenarioCost: result.scenario.calculated?.pu ?? null,
      delta: result.delta,
      confidenceBefore: result.confidence.base.status, confidenceAfter: result.confidence.scenario.status,
      bidRiskBefore: result.bidRisk.base.severity, bidRiskAfter: result.bidRisk.scenario.severity,
      projectImpact: result.delta.projectDelta, warnings: result.warnings,
      label: 'SIMULACION -- NO MODIFICA EL APU BASE'
    };
  }).filter(Boolean);
}

/* Orquestador principal. `mode` decide solo que se presenta despues (misma
   regla que buildDossierData). `selectedScenarios` (regla 7) y
   `projectScenario` (regla 8, un cambio aplicado a VARIOS APUs via
   applyChangeAcrossProject) son ambos opcionales y nunca se activan salvo
   que el llamador los pida explicitamente. */
export async function buildProjectDossierData({ projectId, mode = 'TECNICO', selectedScenarios = [], projectScenario = null } = {}){
  if(!projectId) throw new Error('Falta projectId para generar el dossier de proyecto.');

  const [project, apuDocs, memoryEntries] = await Promise.all([
    loadProjectMeta(projectId), loadProjectApus(projectId), loadProjectMemory(projectId)
  ]);
  if(!apuDocs.length) throw new Error('El proyecto no tiene ningun APU guardado (server-side) para generar el dossier.');

  const apuEntries = await Promise.all(apuDocs.map(async doc => {
    const snapshot = doc.snapshot || {};
    const decisionsByChallengeId = await loadChallengeDecisions(doc.id);
    const engine = computeApuEngineResults(snapshot, { decisionsByChallengeId, memoryEntries, mode });
    const snapshotHash = await computeSnapshotHash(snapshot);
    return {
      apuId: doc.id, versionId: doc.currentVersion || null,
      createdAt: doc.createdAt || null, updatedAt: doc.updatedAt || null,
      snapshot, snapshotHash,
      concept: snapshot.concept || '(sin concepto)', unit: snapshot.unit || '',
      pu: snapshot.calculated?.pu ?? null, importeTotal: snapshot.calculated?.importeTotal ?? null,
      ...engine
    };
  }));

  const snapshots = apuEntries.map(e => e.snapshot);
  const projectBidRisk = runProjectBidRisk(snapshots);
  const projectConfidence = runProjectConfidence(snapshots);

  const ranking = apuEntries.map(e => ({
    apuId: e.apuId, concept: e.concept, unit: e.unit, pu: e.pu, importeTotal: e.importeTotal,
    confidenceScore: e.confidence.score, confidenceStatus: e.confidence.status,
    bidRiskSeverity: e.bidRisk.severity, estimatedExposure: e.bidRisk.estimatedExposure,
    criticalFindings: e.audit.summary.critical + e.bidRisk.findings.filter(f => f.severity === 'CRITICAL').length,
    reviewRequired: needsPriorityReview(e)
  })).sort((a, b) => (SEVERITY_RANK[b.bidRiskSeverity] || 0) - (SEVERITY_RANK[a.bidRiskSeverity] || 0)
    || (b.estimatedExposure || 0) - (a.estimatedExposure || 0));

  const importeProyectoTotal = round2(apuEntries.reduce((s, e) => s + (Number.isFinite(e.importeTotal) ? e.importeTotal : 0), 0));

  const topFindings = apuEntries
    .flatMap(e => e.bidRisk.findings.map(f => ({ ...f, apuId: e.apuId, concept: e.concept })))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
      || (b.projectImpact ?? 0) - (a.projectImpact ?? 0))
    .slice(0, 10);

  const scenarios = buildSelectedScenarios(apuEntries, selectedScenarios);

  // Escenario de proyecto (regla 8): reusa applyChangeAcrossProject TAL
  // CUAL -- nunca reimplementa "afectados/no afectados/delta total/top
  // impactos", eso ya lo calcula ese motor.
  const projectScenarioResult = projectScenario
    ? { ...applyChangeAcrossProject(snapshots, projectScenario.change, projectScenario.options || {}), label: 'SIMULACION -- NO MODIFICA NINGUN APU BASE' }
    : null;

  const manifestPre = {
    projectId, apuVersionIds: apuEntries.map(e => `${e.apuId}@${e.versionId ?? 'SIN_VERSION'}`),
    snapshotHashes: apuEntries.map(e => e.snapshotHash),
    options: { mode }, selectedScenarioIds: scenarios.map(s => s.scenarioId)
  };
  const manifestHash = await computeSnapshotHash(manifestPre);
  const dossierManifest = { ...manifestPre, manifestHash };

  return {
    project, projectId, mode, apuEntries, ranking,
    projectBidRisk, projectConfidence, importeProyectoTotal, topFindings,
    scenarios, projectScenario: projectScenarioResult, dossierManifest
  };
}
