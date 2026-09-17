import { runApuAudit } from '../../../domain/apuAuditor.js';
import { runApuChallenge } from '../../../domain/apuChallenge.js';
import { runApuConfidence } from '../../../domain/apuConfidence.js';
import { runBidRisk } from '../../../domain/bidRisk.js';
import { analyzeApuRisks } from '../../../domain/apuRiskDetector.js';

export const REVIEW_HUMAN_STATUSES = Object.freeze([
  'GENERADO',
  'REQUIERE_REVISION',
  'REVISADO',
  'VALIDADO_POR_USUARIO'
]);

const REVIEWED_STATUSES = new Set(['REVISADO', 'VALIDADO_POR_USUARIO']);

function projectApus(apus, projectId) {
  return (apus || []).filter(apu => String(apu?.projectId ?? '') === String(projectId ?? ''));
}

function challengeDecisionMap(decisions = []) {
  return new Map((decisions || []).map(decision => [String(decision.challengeId), decision]));
}

function runEngine(name, fn) {
  try {
    return { value: fn(), error: null };
  } catch (error) {
    return { value: null, error: { engine: name, message: error?.message || 'No se pudo ejecutar el motor.' } };
  }
}

export function buildReviewApuResult(apu, decisions = []) {
  const decisionById = challengeDecisionMap(decisions);
  const auditRun = runEngine('Auditoría', () => runApuAudit(apu));
  const challengeRun = runEngine('Challenges', () => runApuChallenge(apu));
  const confidenceRun = runEngine('Confidence', () => runApuConfidence(apu, {
    audit: auditRun.value,
    challenge: challengeRun.value
  }));
  const bidRiskRun = runEngine('Bid Risk', () => runBidRisk(apu, {
    audit: auditRun.value,
    challenge: challengeRun.value,
    confidence: confidenceRun.value
  }));

  const challenges = (challengeRun.value?.challenges || []).map(challenge => ({
    ...challenge,
    decision: decisionById.get(String(challenge.id)) || null
  }));
  const humanStatus = REVIEW_HUMAN_STATUSES.includes(apu?.revisionStatus)
    ? apu.revisionStatus
    : 'GENERADO';
  const errors = [auditRun, challengeRun, confidenceRun, bidRiskRun]
    .map(result => result.error)
    .filter(Boolean);
  const auditFindings = auditRun.value?.findings || [];
  const criticalAuditFindings = auditFindings.filter(finding => finding.severity === 'CRITICAL');
  const pendingChallenges = challenges.filter(challenge => !challenge.decision);
  const riskSeverity = bidRiskRun.value?.severity || null;

  return {
    apu,
    apuId: apu?.id || apu?.clave || null,
    concept: apu?.concept || apu?.clave || 'APU sin concepto',
    humanStatus,
    audit: auditRun.value,
    challenge: challengeRun.value ? { ...challengeRun.value, challenges } : null,
    confidence: confidenceRun.value,
    bidRisk: bidRiskRun.value,
    errors,
    auditFindings,
    criticalAuditFindings,
    challenges,
    pendingChallenges,
    riskSeverity,
    hasCriticalRisk: riskSeverity === 'CRITICAL',
    hasHighOrCriticalRisk: riskSeverity === 'CRITICAL' || riskSeverity === 'HIGH'
  };
}

export function computeReviewStageModel({
  projectId,
  apus = [],
  catalogConceptos = [],
  decisions = []
} = {}) {
  const projectConcepts = (catalogConceptos || []).filter(concept =>
    String(concept?.projectId ?? '') === String(projectId ?? '') &&
    Number(concept?.qty) > 0 &&
    concept?.apuId
  );
  const linkedApuIds = new Set(projectConcepts.map(concept => String(concept.apuId)));
  const candidates = projectApus(apus, projectId)
    .filter(apu => linkedApuIds.size === 0 || linkedApuIds.has(String(apu.id)));
  const results = candidates.map(apu => buildReviewApuResult(apu, decisions));
  const criticalFindings = results.reduce((total, result) => total + result.criticalAuditFindings.length, 0);
  const highFindings = results.reduce((total, result) => total + (result.audit?.summary?.high || 0), 0);
  const pendingChallenges = results.reduce((total, result) => total + result.pendingChallenges.length, 0);
  const reviewedCount = results.filter(result => REVIEWED_STATUSES.has(result.humanStatus)).length;
  const engineErrors = results.flatMap(result => result.errors);
  const confidenceResults = results.map(result => result.confidence).filter(Boolean);
  const scoredConfidence = confidenceResults.filter(result => result.score != null);
  const confidenceAverage = scoredConfidence.length
    ? Math.round(scoredConfidence.reduce((sum, result) => sum + result.score, 0) / scoredConfidence.length)
    : null;
  const riskCounts = results.reduce((counts, result) => {
    if (result.riskSeverity) counts[result.riskSeverity] = (counts[result.riskSeverity] || 0) + 1;
    return counts;
  }, {});
  const exposureValues = results
    .map(result => result.bidRisk?.estimatedExposure)
    .filter(value => Number.isFinite(value));

  const estimatedExposure = exposureValues.length
    ? exposureValues.reduce((sum, value) => sum + value, 0)
    : null;
  const hasUnreviewedRisk = results.some(result => result.hasHighOrCriticalRisk && !REVIEWED_STATUSES.has(result.humanStatus));
  const hasUnreviewedHumanReview = results.some(result => !REVIEWED_STATUSES.has(result.humanStatus));
  const allChallengesDecided = results.every(result => result.pendingChallenges.length === 0);
  const status = !results.length
    ? 'pendiente'
    : engineErrors.length || criticalFindings > 0 || pendingChallenges > 0 ||
      hasUnreviewedRisk || hasUnreviewedHumanReview ||
      results.some(result => ['LOW', 'INSUFFICIENT_EVIDENCE'].includes(result.confidence?.status))
      ? 'atencion'
      : allChallengesDecided && reviewedCount === results.length
        ? 'completado'
        : 'atencion';

  return {
    projectId,
    results,
    status,
    reviewedCount,
    reviewableCount: results.length,
    criticalFindings,
    highFindings,
    pendingChallenges,
    engineErrors,
    confidenceAverage,
    confidenceInsufficient: confidenceResults.filter(result => result.status === 'INSUFFICIENT_EVIDENCE').length,
    riskCounts,
    estimatedExposure,
    allChallengesDecided
  };
}

export function analyzeOmittedCosts(result) {
  if (!result?.apu) return null;
  return analyzeApuRisks(result.apu);
}
