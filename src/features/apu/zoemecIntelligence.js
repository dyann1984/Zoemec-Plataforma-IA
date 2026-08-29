/* ZOEMEC INTELLIGENCE (Fase 5): capa de orquestacion PURA (sin React, sin
   DOM) entre el APU real abierto en el editor y los 4 motores de dominio
   (Auditor/Challenge/Confidence/Bid Risk, Fases 1-2). Separada del
   componente visual a proposito: es testable con node:test sin necesidad de
   jsdom/testing-library (que este proyecto no tiene instalados), y es el
   unico lugar que decide que motor corre y como se aisla un fallo (regla 15
   del spec: "si un motor falla, el editor no debe caerse completo"). */
import { runApuAudit } from '../../domain/apuAuditor.js';
import { runApuChallenge } from '../../domain/apuChallenge.js';
import { runApuConfidence } from '../../domain/apuConfidence.js';
import { runBidRisk } from '../../domain/bidRisk.js';
import { createScenario, CHANGE_TYPE } from '../../domain/apuScenario.js';

/* Cada motor corre AISLADO -- un fallo en uno nunca impide que los demas
   se calculen ni tira el render. `data` es el resultado real del motor
   cuando ok:true; `error` es el mensaje real de la excepcion cuando
   ok:false (nunca se inventa un mensaje generico que oculte la causa). */
export function safeRun(fn){
  try{ return { ok: true, data: fn() }; }
  catch(error){ return { ok: false, error: error?.message || String(error) }; }
}

export function computeZoemecIntelligence(apu){
  const audit = safeRun(() => runApuAudit(apu));
  const challenge = safeRun(() => runApuChallenge(apu));
  const confidence = safeRun(() => runApuConfidence(apu));
  const bidRisk = safeRun(() => runBidRisk(apu, confidence.ok ? { confidence: confidence.data, audit: audit.ok ? audit.data : undefined, challenge: challenge.ok ? challenge.data : undefined } : {}));
  return { audit, challenge, confidence, bidRisk };
}

const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };

/* Resumen compacto para el encabezado (regla 2 del spec): nunca convierte
   "no calculable" en un 0 enganoso -- cada campo trae `display` ya resuelto
   a partir del dato real (o del `reason` real que ya traen bidRisk/confidence),
   nunca un texto inventado sin corresponder a un estado real del motor. */
export function summarizeIntelligence(intelligence){
  const { audit, challenge, confidence, bidRisk } = intelligence;

  const confidenceSummary = !confidence.ok
    ? { display: 'ERROR', error: confidence.error }
    : confidence.data.status === 'INSUFFICIENT_EVIDENCE'
      ? { display: 'SIN EVIDENCIA', status: confidence.data.status, score: null }
      : { display: `${confidence.data.score}%`, status: confidence.data.status, score: confidence.data.score };

  const bidRiskSummary = !bidRisk.ok
    ? { display: 'ERROR', error: bidRisk.error }
    : { severity: bidRisk.data.severity, estimatedExposure: bidRisk.data.estimatedExposure, findingsCount: bidRisk.data.findings.length };

  const auditFindings = audit.ok ? audit.data.findings : [];
  const auditSummary = !audit.ok
    ? { display: 'ERROR', error: audit.error }
    : {
        count: auditFindings.length,
        topSeverity: auditFindings.length ? auditFindings.reduce((worst, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst] ? f.severity : worst), 'INFO') : null,
        summary: audit.data.summary
      };

  const challengeFindings = challenge.ok ? challenge.data.challenges : [];
  const challengeSummary = !challenge.ok
    ? { display: 'ERROR', error: challenge.error }
    : { count: challengeFindings.length, monetizableCount: challengeFindings.filter(c => c.projectImpact != null).length };

  return { confidence: confidenceSummary, bidRisk: bidRiskSummary, audit: auditSummary, challenge: challengeSummary };
}

/* Texto real para un impacto que puede ser null (regla 7 del spec: "nunca
   convertir null en $0"). Reusa el `reason` que YA calculan bidRisk.js/
   apuScenario.js -- nunca inventa una razon nueva. */
export function describeImpact(value, reason){
  if(value != null) return { display: null, value };
  if(reason === 'PROJECT_QUANTITY_NOT_CAPTURED') return { display: 'SIN CANTIDAD DE OBRA', value: null };
  return { display: 'NO CALCULABLE', value: null };
}

export const AUDIT_SEVERITY_FILTERS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/* SCENARIO LAB (regla 8 del spec): subconjunto curado de CHANGE_TYPE
   (apuScenario.js) para el formulario simple del panel -- material +/-%,
   mano de obra +/-%, rendimiento +/-%, precio de recurso, desperdicio.
   No agrega ningun tipo de cambio nuevo: cada caso mapea 1:1 a un
   CHANGE_TYPE ya existente y probado en Fase 3. */
export const SCENARIO_LAB_KIND = Object.freeze({
  MATERIAL_PERCENT: 'MATERIAL_PERCENT',
  LABOR_PERCENT: 'LABOR_PERCENT',
  PRODUCTIVITY_PERCENT: 'PRODUCTIVITY_PERCENT',
  RESOURCE_PRICE: 'RESOURCE_PRICE',
  WASTE_PERCENT: 'WASTE_PERCENT'
});

export const SCENARIO_LAB_LABEL = Object.freeze({
  [SCENARIO_LAB_KIND.MATERIAL_PERCENT]: 'Material +/-%',
  [SCENARIO_LAB_KIND.LABOR_PERCENT]: 'Mano de obra +/-%',
  [SCENARIO_LAB_KIND.PRODUCTIVITY_PERCENT]: 'Rendimiento +/-%',
  [SCENARIO_LAB_KIND.RESOURCE_PRICE]: 'Precio de recurso (override)',
  [SCENARIO_LAB_KIND.WASTE_PERCENT]: 'Desperdicio (+/- puntos)'
});

/* Traduce el formulario simple del Scenario Lab a un `change` real de
   apuScenario.js. `resourceDescripcion` vacio significa "todos los
   renglones de esa categoria" (selector amplio), excepto RESOURCE_PRICE
   (un override de precio SIEMPRE necesita un recurso especifico -- no tiene
   sentido fijar el mismo precio absoluto para "todos los materiales"). */
export function buildScenarioLabChange({ kind, resourceDescripcion, value, reason }){
  const descripcion = resourceDescripcion?.trim() || null;
  const numericValue = Number(value);
  switch(kind){
    case SCENARIO_LAB_KIND.MATERIAL_PERCENT:
      return { type: CHANGE_TYPE.PRICE_PERCENT_CHANGE, selector: descripcion ? { kind: 'materials', descripcion } : { kind: 'materials' }, value: numericValue, reason, source: 'scenario_lab' };
    case SCENARIO_LAB_KIND.LABOR_PERCENT:
      return { type: CHANGE_TYPE.LABOR_COST_PERCENT_CHANGE, selector: descripcion ? { kind: 'labor', descripcion } : { kind: 'labor' }, value: numericValue, reason, source: 'scenario_lab' };
    case SCENARIO_LAB_KIND.PRODUCTIVITY_PERCENT:
      return { type: CHANGE_TYPE.PRODUCTIVITY_PERCENT_CHANGE, selector: descripcion ? { kind: 'labor', descripcion } : { kind: 'labor' }, value: numericValue, reason, source: 'scenario_lab' };
    case SCENARIO_LAB_KIND.RESOURCE_PRICE:
      if(!descripcion) return null; // un override de precio siempre necesita un recurso especifico, nunca "todos"
      return { type: CHANGE_TYPE.RESOURCE_PRICE_OVERRIDE, selector: { descripcion }, mode: 'absolute', value: numericValue, reason, source: 'scenario_lab' };
    case SCENARIO_LAB_KIND.WASTE_PERCENT:
      return { type: CHANGE_TYPE.WASTE_PERCENT_CHANGE, selector: descripcion ? { kind: 'materials', descripcion } : { kind: 'materials' }, value: numericValue, reason, source: 'scenario_lab' };
    default:
      return null;
  }
}

/* "Simular correccion" desde un finding de Challenge (categoria 'rendimiento'
   unicamente -- 'precio' no tiene un valor corregido real que proponer, ver
   apuChallenge.js#priceChallenges). El Scenario Lab simple solo soporta
   PRODUCTIVITY_PERCENT en modo porcentual, pero `baselineValue` es un
   rendimiento ABSOLUTO -- convertirlo al % equivalente desde el valor
   actual es lo que hace que "Simular" realmente reproduzca "corregir al
   baseline", no un numero arbitrario si se pasara baselineValue tal cual
   (bug real encontrado en QA visual de esta fase, ver reporte). */
export function buildScenarioLabPrefillFromChallenge(challengeFinding){
  const { id, category, currentValue, baselineValue, baselineSource, deltaPct, unitImpact, projectImpact, resourceDescripcion, title } = challengeFinding;
  const equivalentPercent = ((baselineValue - currentValue) / currentValue) * 100;
  return {
    kind: SCENARIO_LAB_KIND.PRODUCTIVITY_PERCENT,
    resourceDescripcion,
    value: Number(equivalentPercent.toFixed(2)),
    reason: `Simulación de corrección desde Challenge: ${title}`,
    // Fase 6: si el escenario se aplica realmente al APU, cierra el ciclo de
    // revision registrando una decision CORRECT para este challenge exacto
    // (ver EscenariosTab#confirmApply en ZoemecIntelligencePanel.jsx).
    challengeId: id,
    // Fase 6.1: el finding completo (lo que Challenge YA calculo en este
    // momento, antes de aplicar la correccion) va como clientSnapshot al
    // registrar la decision CORRECT -- el servidor lo compara contra su
    // propio recalculo (ver api/challenge-decisions.mjs#verifyChallengeSnapshot).
    challengeSnapshot: { category, currentValue, baselineValue, baselineSource, deltaPct, unitImpact, projectImpact }
  };
}

/* Corre el Scenario Lab de forma aislada (regla 15): un escenario invalido
   (ej. selector que no matchea nada) nunca tira el panel -- createScenario
   ya devuelve warnings estructurados en vez de lanzar, pero se envuelve en
   safeRun igual por si el propio `change` es invalido a nivel de forma. */
export function runScenarioLab(apu, changes){
  return safeRun(() => createScenario({ apu, changes }));
}
