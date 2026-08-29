/* ZOEMEC CONFIDENCE ENGINE (Fase 2): confianza tecnica MULTIDIMENSIONAL,
   determinista y reproducible -- nunca sale de un LLM. No reemplaza
   calculateAPUConfidence (apuProfessional.js, que sigue alimentando la UI
   existente sin cambios): REUSA sus 4 dimensiones numericas ya calculadas
   (precios/rendimientos/cantidades/composicion) y las combina con 3 fuentes
   adicionales que YA EXISTEN en la plataforma pero nunca se habian usado
   juntas para esto:
   - reconcileAPU (src/lib/apuReconciliation.js): control matematico
     INDEPENDIENTE (cascada + totales exportados vs recalculo fresco) ->
     dimension "calculation".
   - runApuAudit (apuAuditor.js, Fase 1): findings CRITICAL/HIGH ya
     clasificados -> capping de "structure"/"calculation".
   - runApuChallenge (apuChallenge.js, Fase 1): desviaciones de rendimiento
     ya detectadas -> capping de "productivity".
   - RENDIMIENTO_FUENTE (apuReview.js) + LIBRARY_CALIBRATED_TIPOS (crewModel.js):
     dimension nueva "historicalConsistency" (que fraccion de la mano de obra
     tiene un rendimiento realmente calibrado contra una matriz real, no solo
     plantilla o IA).

   Principio (spec del usuario): el score NUNCA es un promedio simple. Una
   falla critica en una dimension limita el techo del score GLOBAL, sin
   importar que tan bien esten las demas -- generaliza el mismo precedente
   que ya existia en calculateAPUConfidence (cap a 40 si hay falla critica de
   QA tecnico). Cuando una dimension no tiene datos suficientes para
   evaluarse (no "esta mal", simplemente no hay con que juzgarla), su score
   es null y su status INSUFFICIENT_EVIDENCE -- nunca se inventa un numero. */
import { calcAPUv2 } from '../lib/apuCalc.js';
import { reconcileAPU } from '../lib/apuReconciliation.js';
import { calculateAPUConfidence } from './apuProfessional.js';
import { runApuAudit } from './apuAuditor.js';
import { runApuChallenge } from './apuChallenge.js';
import { RENDIMIENTO_FUENTE } from './apuReview.js';
import { LIBRARY_CALIBRATED_TIPOS } from './crewModel.js';

export const CONFIDENCE_STATUS = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE' });

const clamp = v => Math.max(0, Math.min(100, v));
const num = (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb);

function statusFromScore(score){
  if(score == null) return CONFIDENCE_STATUS.INSUFFICIENT_EVIDENCE;
  return score >= 85 ? CONFIDENCE_STATUS.HIGH : score >= 65 ? CONFIDENCE_STATUS.MEDIUM : CONFIDENCE_STATUS.LOW;
}

/* Constructor de dimension: score null (INSUFFICIENT_EVIDENCE) nunca se
   redondea ni se fuerza a 0 -- 0 significa "evaluado y es malo", null
   significa "no hay con que evaluarlo todavia", son cosas distintas. */
function dimension({ score, reasons = [], penalties = [], evidence = [], missingData = [] }){
  const safeScore = score == null ? null : Math.round(clamp(score));
  return { score: safeScore, status: statusFromScore(safeScore), reasons, penalties, evidence, missingData };
}

/* "calculation": control matematico independiente, no una re-derivacion del
   mismo calculo (ver reconcileAPU). Un diff de reconciliacion es SIEMPRE
   critico (el motor determinista dejo de cuadrar consigo mismo, o el
   documento exportado quedo desactualizado respecto a los renglones
   actuales) -- score 0, nunca un numero intermedio que sugiera "algo de
   confianza". Los findings numericos de findApuNumericIssuesV2 (via el
   Auditor, origin:'numeric') son la segunda fuente: valores no finitos o
   negativos tambien son errores de calculo, aunque la cascada en si cuadre. */
function calculationDimension(apu, totals, auditFindings){
  const reconciliation = reconcileAPU(apu, { claimedTotals: apu.calculated });
  const numericCritical = auditFindings.filter(f => f.severity === 'CRITICAL' && ['non_finite_value', 'negative_value', 'zero_rendimiento'].includes(f.code));
  const reasons = [];
  const penalties = [];
  let score = 100;
  if(!reconciliation.ok){
    score = 0;
    reconciliation.diffs.forEach(d => { reasons.push(`Reconciliacion matematica fallida (${d.code}): esperado ${d.esperado.toFixed(2)}, obtenido ${d.obtenido.toFixed(2)}.`); penalties.push({ code: d.code, amount: 100 }); });
  }
  numericCritical.forEach(f => { score = Math.min(score, 30); reasons.push(f.message); penalties.push({ code: f.code, amount: 70 }); });
  return dimension({ score, reasons, penalties, evidence: [`reconciliation.ok=${reconciliation.ok}`, `numericCriticalCount=${numericCritical.length}`] });
}

/* "structure": reusa la sub-dimension "composicion" ya calculada por
   calculateAPUConfidence (presencia de materiales/mano de obra/procedimiento/
   control de calidad/criterio de medicion), capeada si el Auditor encontro
   una falla estructural CRITICAL (falta unidad, concepto o mano de obra por
   completo -- un APU asi no puede considerarse "bien estructurado" aunque
   los demas campos esten llenos). */
function structureDimension(baseComposicion, auditFindings){
  const structuralCritical = auditFindings.filter(f => f.severity === 'CRITICAL' && ['missing_labor', 'missing_unit', 'missing_concept'].includes(f.code));
  let score = baseComposicion;
  const reasons = [];
  if(structuralCritical.length){
    score = Math.min(score, 20);
    structuralCritical.forEach(f => reasons.push(f.message));
  }
  return dimension({ score, reasons, penalties: structuralCritical.map(f => ({ code: f.code, amount: 80 })), evidence: [`composicionBase=${baseComposicion}`] });
}

/* "prices"/"evidence": reusan precios/evidenciaMercado ya calculados por
   calculateAPUConfidence (evidencia de mercado ponderada por costo, ver
   pricesDimension en apuProfessional.js -- no se duplica esa logica). Cuando
   el costo directo es $0 (renglones "Pendiente de cotizacion", el marcador
   real que usa el motor universal para un concepto sin precio -- ver
   apuGeneration.js) no hay NINGUN costo real contra el cual ponderar
   evidencia: forzar un 0 aqui seria inventar un juicio de calidad sobre una
   base inexistente, asi que se marca INSUFFICIENT_EVIDENCE en vez de castigar. */
function pricesAndEvidenceDimensions(basePrecios, baseEvidenciaMercado, directCost){
  const noCost = !(directCost > 0);
  const prices = dimension(noCost
    ? { score: null, missingData: ['direct_cost_is_zero'], evidence: ['directCost=0'] }
    : { score: basePrecios, evidence: [`directCost=${directCost.toFixed(2)}`] });
  const evidence = dimension(noCost
    ? { score: null, missingData: ['direct_cost_is_zero'], evidence: ['directCost=0'] }
    : { score: baseEvidenciaMercado, evidence: [`directCost=${directCost.toFixed(2)}`] });
  return { prices, evidence };
}

/* "productivity": reusa rendimientos (calculateAPUConfidence), capeado por
   los challenges de rendimiento ya detectados (apuChallenge.js) -- una
   desviacion real y grande respecto al baseline (plantilla o historico
   calibrado) es evidencia mas fuerte de riesgo que la mera cobertura
   binaria "existe un rendimiento". Sin renglones de mano de obra no hay
   nada que evaluar (no es "0% de confianza", es "no aplica todavia"). */
function productivityDimension(apu, baseRendimientos, challengeFindings){
  const laborCount = Array.isArray(apu.labor) ? apu.labor.length : 0;
  if(!laborCount) return dimension({ score: null, missingData: ['no_labor_rows'] });
  // Sin disciplina clasificada (igual que apuChallenge.js): no existe ningun
  // baseline independiente contra el cual juzgar si el rendimiento es
  // razonable -- evaluar de todas formas seria inventar un criterio.
  if(!apu.primaryActivity || apu.primaryActivity === 'generico') return dimension({ score: null, missingData: ['no_known_discipline'] });
  const yieldChallenges = challengeFindings.filter(c => c.category === 'rendimiento');
  let score = baseRendimientos;
  const reasons = [];
  const penalties = [];
  yieldChallenges.forEach(c => {
    const severity = Math.abs(c.deltaPct) >= 50 ? 25 : Math.abs(c.deltaPct) >= 30 ? 50 : 65;
    score = Math.min(score, severity);
    reasons.push(`${c.title} (baseline: ${c.baselineSource}).`);
    penalties.push({ code: 'yield_deviation', amount: 100 - severity });
  });
  return dimension({ score, reasons, penalties, evidence: [`yieldChallengeCount=${yieldChallenges.length}`] });
}

/* "quantities"/"specification": reusan directamente cantidades/especificaciones
   de calculateAPUConfidence -- son juicios validos incluso en 0 (cantidad
   cero o sin ninguna especificacion capturada es informacion real, no
   ausencia de base para juzgar). */
function passthroughDimension(score, label){
  return dimension({ score, evidence: [`${label}Base=${score}`] });
}

/* "historicalConsistency" (dimension NUEVA, no existia en ningun lado):
   que fraccion de la mano de obra tiene un rendimiento con procedencia
   verificable (HISTORICO/BIBLIOTECA: matriz real; VALIDADO: confirmado por
   un humano en este APU) en vez de solo plantilla tecnica o estimacion de
   IA. Un renglon capturado a mano sin rendimientoFuente (historial previo a
   esta fase) cuenta como no calibrado -- no es un castigo retroactivo, es
   una dimension nueva que nunca existio antes y evalua con la misma regla
   para todos. */
const CALIBRATED_SOURCES = new Set([RENDIMIENTO_FUENTE.HISTORICO, RENDIMIENTO_FUENTE.BIBLIOTECA, RENDIMIENTO_FUENTE.VALIDADO]);
const foldDescripcion = value => String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/* Integracion con Memoria Tecnica (Fase 4, ver technicalMemory.js#buildMemoryEvidence):
   este modulo NUNCA importa technicalMemory.js (evita dependencia circular
   -- Confidence es una capa mas baja que Memoria, que a su vez puede
   consumir Confidence en el futuro). El llamador resuelve la memoria y pasa
   el resultado ya normalizado via options.memoryBoost.yieldApprovedFold
   (Set de descripciones normalizadas con un rendimiento APPROVED
   aplicable) -- un renglon cuenta como calibrado si su propia fuente ya lo
   era O si hay una memoria aprobada para ese recurso especifico. Una
   memoria PROPOSED/REJECTED/SUPERSEDED nunca llega aqui: buildMemoryEvidence
   solo resuelve entradas APPROVED (ver resolveTechnicalMemory). */
function historicalConsistencyDimension(apu, options = {}){
  const labor = Array.isArray(apu.labor) ? apu.labor : [];
  if(!labor.length) return dimension({ score: null, missingData: ['no_labor_rows'] });
  if(!apu.primaryActivity || apu.primaryActivity === 'generico') return dimension({ score: null, missingData: ['no_known_discipline'] });
  const memoryFold = options.memoryBoost?.yieldApprovedFold;
  const calibrated = labor.filter(r => CALIBRATED_SOURCES.has(r.rendimientoFuente) || memoryFold?.has(foldDescripcion(r.descripcion))).length;
  const memoryCalibratedCount = memoryFold ? labor.filter(r => !CALIBRATED_SOURCES.has(r.rendimientoFuente) && memoryFold.has(foldDescripcion(r.descripcion))).length : 0;
  const score = (calibrated / labor.length) * 100;
  const disciplineCalibrated = LIBRARY_CALIBRATED_TIPOS.has(apu.primaryActivity);
  return dimension({
    score,
    reasons: calibrated < labor.length ? [`${labor.length - calibrated} de ${labor.length} renglones de mano de obra no tienen un rendimiento calibrado contra historico real.`] : [],
    evidence: [`calibratedLaborRows=${calibrated}/${labor.length}`, `disciplineInLibraryCalibratedTipos=${disciplineCalibrated}`, `memoryApprovedRows=${memoryCalibratedCount}`]
  });
}

// Pesos documentados (suman 1.00 sobre las 8 dimensiones). "calculation" pesa
// mas porque un numero mal calculado invalida todo lo demas; "prices" en
// segundo lugar porque es el insumo mas directo del riesgo economico.
const WEIGHTS = Object.freeze({
  calculation: 0.25, prices: 0.20, productivity: 0.15, quantities: 0.10,
  structure: 0.10, evidence: 0.10, specification: 0.05, historicalConsistency: 0.05
});

const STATUS_RECOMMENDATION = Object.freeze({
  HIGH: 'LOW_REVIEW_PRIORITY', MEDIUM: 'REVIEW_RECOMMENDED', LOW: 'REVIEW_REQUIRED',
  INSUFFICIENT_EVIDENCE: 'CANNOT_ASSESS_INSUFFICIENT_DATA'
});

export function runApuConfidence(apu = {}, options = {}){
  const now = options.now ? new Date(options.now) : new Date();
  const totals = apu.calculated || calcAPUv2(apu);
  const audit = options.audit || runApuAudit(apu, { now });
  const challenge = options.challenge || runApuChallenge(apu, { now });
  const base = calculateAPUConfidence(apu, { now });

  const dimensions = {
    structure: structureDimension(base.dimensions.composicion, audit.findings),
    calculation: calculationDimension(apu, totals, audit.findings),
    ...pricesAndEvidenceDimensions(base.dimensions.precios, base.dimensions.evidenciaMercado, totals.direct),
    productivity: productivityDimension(apu, base.dimensions.rendimientos, challenge.challenges),
    quantities: passthroughDimension(base.dimensions.cantidades, 'cantidades'),
    specification: passthroughDimension(base.dimensions.especificaciones, 'especificaciones'),
    historicalConsistency: historicalConsistencyDimension(apu, options)
  };

  const scored = Object.entries(dimensions).filter(([, d]) => d.score != null);
  let score = null;
  if(scored.length){
    const weightSum = scored.reduce((s, [k]) => s + WEIGHTS[k], 0);
    score = Math.round(scored.reduce((s, [k, d]) => s + WEIGHTS[k] * d.score, 0) / weightSum);
  }

  // Gating/capping: una falla critica de calculo o de estructura (score muy
  // bajo, no solo "regular") limita el techo del score GLOBAL, nunca se
  // promedia como si no existiera -- generaliza el precedente ya existente
  // en calculateAPUConfidence (cap a 40 por falla critica de QA tecnico).
  const criticalFactors = [];
  if(dimensions.calculation.score != null && dimensions.calculation.score <= 30){
    if(score != null) score = Math.min(score, 40);
    criticalFactors.push({ dimension: 'calculation', reasons: dimensions.calculation.reasons });
  }
  if(dimensions.structure.score != null && dimensions.structure.score <= 20){
    if(score != null) score = Math.min(score, 40);
    criticalFactors.push({ dimension: 'structure', reasons: dimensions.structure.reasons });
  }
  // Sin ninguna disciplina de construccion reconocida (fallback "generico"),
  // ningun promedio ponderado de las demas dimensiones puede compensarlo --
  // no hay con que validar si los recursos, cuadrilla o rendimiento
  // elegidos son siquiera los correctos para este tipo de trabajo. El score
  // global se anula por completo (nunca se presenta un numero como si
  // hubiera suficiente base para calcularlo). Mismo criterio que ya usa
  // apuChallenge.js para negarse a comparar rendimiento sin clasificacion.
  const unclassified = !apu?.primaryActivity || apu.primaryActivity === 'generico';
  if(unclassified){
    score = null;
    criticalFactors.push({ dimension: 'classification', reasons: ['Concepto sin clasificacion de disciplina conocida: no hay base independiente confiable para evaluar productividad, consistencia historica ni evidencia esperada de este tipo de trabajo.'] });
  }

  const status = statusFromScore(score);
  const explanation = [
    ...Object.entries(dimensions).flatMap(([key, d]) => d.reasons.map(r => `[${key}] ${r}`)),
    ...(criticalFactors.length ? [`Score global limitado por falla critica en: ${criticalFactors.map(c => c.dimension).join(', ')}.`] : [])
  ];

  return { score, status, recommendation: STATUS_RECOMMENDATION[status], dimensions, criticalFactors, explanation, pendingValidation: base.pendingValidation };
}

/* Agregacion a nivel proyecto (Fase 8 Parte 2, seccion 2 del spec:
   "Confidence distribution"). Mismo criterio que runProjectBidRisk
   (bidRisk.js): consume runApuConfidence por cada APU, nunca reimplementa
   ni recalcula las dimensiones a mano -- este modulo no depende de ningun
   modelo de almacenamiento (Firestore/proyecto), igual que runProjectBidRisk. */
export function runProjectConfidence(apus = [], options = {}){
  const perApu = apus.map((apu, index) => {
    const result = runApuConfidence(apu, options);
    return { apuId: apu.id || apu.clave || `APU-${index + 1}`, concept: apu.concept || '', status: result.status, score: result.score, result };
  });
  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0, INSUFFICIENT_EVIDENCE: 0 };
  perApu.forEach(p => counts[p.status]++);
  const scored = perApu.filter(p => p.score != null);
  const averageScore = scored.length ? Math.round(scored.reduce((s, p) => s + p.score, 0) / scored.length) : null;
  return { totalAPUs: apus.length, high: counts.HIGH, medium: counts.MEDIUM, low: counts.LOW, insufficientEvidence: counts.INSUFFICIENT_EVIDENCE, averageScore, perApu };
}
