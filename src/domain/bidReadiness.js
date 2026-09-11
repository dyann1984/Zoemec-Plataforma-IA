/* BID READINESS SCORE (Fase Astra, Centro de Inteligencia de Preconstruccion).
   Indicador de alto nivel que responde "¿esta esta oferta lista para
   presentarse?" -- construido EXCLUSIVAMENTE combinando las salidas de los
   motores deterministas que ya existen y ya se prueban por separado:
   runApuAudit (apuAuditor.js), runBidRisk/runProjectBidRisk (bidRisk.js) y
   runApuConfidence/runProjectConfidence (apuConfidence.js). Este modulo NO
   reimplementa ninguna regla de negocio propia ni inventa un numero: solo
   traduce hallazgos YA CLASIFICADOS por esos motores en una resta de puntos
   documentada, para que "82/100" siempre pueda explicarse renglon por
   renglon (ver DEDUCTIONS abajo) en vez de ser una caja negra.

   Principio explicito del usuario: "Este score NO debe ser un numero
   inventado" -- cada deduccion cita la fuente real (codigo de auditoria,
   severidad de Bid Risk, o dimension de Confidence) y el conteo exacto de
   ocurrencias que la origino. Sin APUs (o si CADA APU del proyecto no pudo
   evaluarse) el resultado es null, nunca un numero de relleno. */
import { runApuAudit } from './apuAuditor.js';
import { runProjectBidRisk } from './bidRisk.js';
import { runProjectConfidence } from './apuConfidence.js';

export const BID_READINESS_STATUS = Object.freeze({
  NO_DATA: 'NO_DATA',
  READY: 'READY',
  READY_WITH_OBSERVATIONS: 'READY_WITH_OBSERVATIONS',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  NOT_READY: 'NOT_READY'
});

const STATUS_LABEL_ES = Object.freeze({
  READY: 'Lista para presentar',
  READY_WITH_OBSERVATIONS: 'Lista con observaciones',
  NEEDS_REVIEW: 'Requiere revisión antes de presentar',
  NOT_READY: 'No lista para presentar'
});

function statusFromScore(score){
  if(score == null) return BID_READINESS_STATUS.NO_DATA;
  if(score >= 90) return BID_READINESS_STATUS.READY;
  if(score >= 70) return BID_READINESS_STATUS.READY_WITH_OBSERVATIONS;
  if(score >= 50) return BID_READINESS_STATUS.NEEDS_REVIEW;
  return BID_READINESS_STATUS.NOT_READY;
}

/* Cada entrada documenta: de que codigo/severidad real viene, cuantos puntos
   resta CADA ocurrencia y el tope maximo que puede restar esa categoria (para
   que un proyecto con 40 hallazgos menores no llegue a score negativo por
   una sola categoria). Editar esta tabla es la UNICA forma de cambiar la
   formula -- nunca se debe restar un numero que no venga de aqui. */
const DEDUCTION_RULES = Object.freeze([
  {
    code: 'CRITICAL_AUDIT_FINDINGS',
    labelEs: (n) => `${n} hallazgo${n===1?'':'s'} crítico${n===1?'':'s'} de auditoría`,
    labelEn: (n) => `${n} critical audit finding${n===1?'':'s'}`,
    perOccurrence: 4, cap: 40
  },
  {
    code: 'HIGH_RISK_CONCEPTS',
    labelEs: (n) => `${n} concepto${n===1?'':'s'} con riesgo alto o crítico`,
    labelEn: (n) => `${n} concept${n===1?'':'s'} with high or critical bid risk`,
    perOccurrence: 5, cap: 25
  },
  {
    code: 'PRICES_WITHOUT_EVIDENCE',
    labelEs: (n) => `${n} precio${n===1?'':'s'} sin evidencia de mercado`,
    labelEn: (n) => `${n} price${n===1?'':'s'} without market evidence`,
    perOccurrence: 2, cap: 16
  },
  {
    code: 'INCOMPLETE_DOCUMENTATION',
    labelEs: (n) => `${n} concepto${n===1?'':'s'} con documentación técnica incompleta`,
    labelEn: (n) => `${n} concept${n===1?'':'s'} with incomplete technical documentation`,
    perOccurrence: 3, cap: 15
  },
  {
    code: 'INSUFFICIENT_EVIDENCE_APUS',
    labelEs: (n) => `${n} concepto${n===1?'':'s'} sin evidencia suficiente para evaluarse`,
    labelEn: (n) => `${n} concept${n===1?'':'s'} without enough evidence to be assessed`,
    perOccurrence: 2, cap: 10
  }
]);

function deduct(code, count){
  if(!count) return null;
  const rule = DEDUCTION_RULES.find(r => r.code === code);
  const points = Math.min(rule.cap, count * rule.perOccurrence);
  return { code, count, points, labelEs: rule.labelEs(count), labelEn: rule.labelEn(count) };
}

/* Evalua un solo APU con los 3 motores, tolerando que uno de ellos no pueda
   procesarlo (ej. un APU heredado con forma incompleta que calcAPUv2 no
   reconoce) -- en ese caso ESE apu cuenta como "sin evidencia suficiente"
   (una deduccion real, documentada), nunca hace fallar el score de todo el
   proyecto ni se omite en silencio. */
function safeEvaluate(apu, now){
  try{
    const audit = runApuAudit(apu, { now });
    return { ok: true, audit };
  }catch{
    return { ok: false };
  }
}

/* apus: arreglo de APUs v2 del proyecto activo (mismo shape que ya consume
   runApuConfidence/runBidRisk en toda la plataforma). options.now: fecha
   fija para tests deterministas. */
export function computeBidReadiness(apus = [], options = {}){
  const now = options.now ? new Date(options.now) : new Date();
  const list = Array.isArray(apus) ? apus : [];

  if(!list.length){
    return { score: null, status: BID_READINESS_STATUS.NO_DATA, deductions: [], totalAPUs: 0, evaluatedAPUs: 0 };
  }

  const evaluations = list.map(apu => safeEvaluate(apu, now));
  const evaluable = list.filter((_, i) => evaluations[i].ok);
  const unevaluable = list.length - evaluable.length;

  if(!evaluable.length){
    return { score: null, status: BID_READINESS_STATUS.NO_DATA, deductions: [], totalAPUs: list.length, evaluatedAPUs: 0 };
  }

  const riskProject = options.riskProject || runProjectBidRisk(evaluable, { now });
  const confidenceProject = options.confidenceProject || runProjectConfidence(evaluable, { now });

  const criticalAuditCount = evaluations.filter(e => e.ok).reduce((s, e) => s + e.audit.summary.critical, 0);
  const highRiskCount = riskProject.high + riskProject.critical;
  const priceWithoutEvidenceCount = evaluations.filter(e => e.ok).reduce((s, e) => s + e.audit.findings.filter(f => f.code === 'price_without_source').length, 0);
  const incompleteDocCount = confidenceProject.perApu.filter(p => {
    const spec = p.result.dimensions.specification;
    return spec.score != null && spec.score < 50;
  }).length;
  const insufficientEvidenceCount = confidenceProject.insufficientEvidence + unevaluable;

  const deductions = [
    deduct('CRITICAL_AUDIT_FINDINGS', criticalAuditCount),
    deduct('HIGH_RISK_CONCEPTS', highRiskCount),
    deduct('PRICES_WITHOUT_EVIDENCE', priceWithoutEvidenceCount),
    deduct('INCOMPLETE_DOCUMENTATION', incompleteDocCount),
    deduct('INSUFFICIENT_EVIDENCE_APUS', insufficientEvidenceCount)
  ].filter(Boolean);

  const totalPoints = deductions.reduce((s, d) => s + d.points, 0);
  const score = Math.max(0, Math.round(100 - totalPoints));
  const status = statusFromScore(score);

  return {
    score, status, statusLabelEs: STATUS_LABEL_ES[status],
    deductions, totalAPUs: list.length, evaluatedAPUs: evaluable.length,
    riskProject, confidenceProject
  };
}
