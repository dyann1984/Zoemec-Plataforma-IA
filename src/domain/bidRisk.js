/* ZOEMEC BID RISK (Fase 2): analiza riesgo economico/tecnico de licitacion.
   NO reimplementa auditoria, challenge ni confianza -- los CONSUME (ver
   arquitectura del spec: APU -> motor determinista -> Auditor -> Challenge
   -> Confidence -> Bid Risk). Cada finding de este modulo apunta a un
   hallazgo real ya producido por una capa anterior; este modulo solo
   traduce esos hallazgos a severidad de riesgo y, cuando el dato existe,
   impacto monetario -- nunca inventa una cifra que el motor determinista no
   pueda respaldar (ver regla del spec: sin datos suficientes,
   unitImpact/projectImpact quedan null con reason:'NOT_ESTIMABLE_WITH_CURRENT_DATA'). */
import { calcAPUv2, calcMaterialRow, calcLaborRow, calcEquipmentRow, calcConsumableRow, calcSeguridadRow } from '../lib/apuCalc.js';
import { runApuAudit } from './apuAuditor.js';
import { runApuChallenge } from './apuChallenge.js';
import { runApuConfidence } from './apuConfidence.js';

export const BID_RISK_SEVERITY = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' });
export const BID_RISK_CATEGORY = Object.freeze({
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  PRICE_WITHOUT_EVIDENCE: 'PRICE_WITHOUT_EVIDENCE',
  AGGRESSIVE_PRODUCTIVITY: 'AGGRESSIVE_PRODUCTIVITY',
  CRITICAL_RESOURCE_MISSING: 'CRITICAL_RESOURCE_MISSING',
  HIGH_AUDIT_FINDING: 'HIGH_AUDIT_FINDING',
  HIGH_CHALLENGE_IMPACT: 'HIGH_CHALLENGE_IMPACT',
  INCOMPLETE_APU: 'INCOMPLETE_APU',
  POSSIBLE_UNDERESTIMATION: 'POSSIBLE_UNDERESTIMATION',
  UNCONFIRMED_ASSUMPTIONS: 'UNCONFIRMED_ASSUMPTIONS',
  COST_CONCENTRATION: 'COST_CONCENTRATION',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE'
});

const NOT_ESTIMABLE = 'NOT_ESTIMABLE_WITH_CURRENT_DATA';
const round2 = v => (Number.isFinite(v) ? Number(v.toFixed(2)) : null);

/* Severidad por magnitud relativa: un impacto de $50 no es lo mismo en un
   concepto de $200,000 que en uno de $600 -- se mide como fraccion del
   importe total del concepto (importeBase), nunca como cifra absoluta
   aislada. Sin importeBase confiable (cantidadObra no capturada) se usa el
   piso MEDIUM: el impacto es real pero no se puede graduar su gravedad
   relativa, y subestimarla seria peor que sobreestimarla. */
function severityByImpactRatio(absImpact, importeBase){
  if(!(importeBase > 0)) return BID_RISK_SEVERITY.MEDIUM;
  const ratio = absImpact / importeBase;
  if(ratio >= 0.15) return BID_RISK_SEVERITY.CRITICAL;
  if(ratio >= 0.05) return BID_RISK_SEVERITY.HIGH;
  return BID_RISK_SEVERITY.MEDIUM;
}

function auditSeverityToBidRisk(severity){
  return severity === 'CRITICAL' ? BID_RISK_SEVERITY.CRITICAL : BID_RISK_SEVERITY.HIGH;
}

function finding({ id, severity, category, description, evidence, unitImpact = null, projectImpact = null, reason = null, recommendation, source, aggregate = false }){
  // projectImpact null siempre lleva una razon explicita -- nunca se deja
  // sin explicar por que no se pudo monetizar. Cuando ni siquiera el
  // impacto unitario existe, la razon es la generica NOT_ESTIMABLE; cuando
  // si existe pero falta la cantidad de obra para escalarlo a proyecto, la
  // razon es mas especifica (nunca se inventa una cantidad).
  const finalReason = projectImpact == null
    ? (reason || (unitImpact == null ? NOT_ESTIMABLE : 'PROJECT_QUANTITY_NOT_CAPTURED'))
    : null;
  return { id, severity, category, description, evidence, unitImpact, projectImpact: projectImpact == null ? null : round2(projectImpact), reason: finalReason, recommendation, source, aggregate };
}

/* INCOMPLETE_APU / CRITICAL_RESOURCE_MISSING / HIGH_AUDIT_FINDING: traducen
   findings CRITICAL/HIGH del Auditor (Fase 1) a riesgo de licitacion, sin
   recrear su logica de deteccion. Un mismo finding del Auditor cae en
   exactamente UNA categoria de Bid Risk (nunca se cuenta dos veces). */
const INCOMPLETE_CODES = new Set(['missing_labor', 'missing_materials', 'missing_unit', 'missing_concept', 'zero_cantidad_obra']);
function findingsFromAudit(audit){
  return audit.findings
    .filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH')
    .map(f => {
      let category = BID_RISK_CATEGORY.HIGH_AUDIT_FINDING;
      if(f.code === 'discipline_missing_expected_resource') category = BID_RISK_CATEGORY.CRITICAL_RESOURCE_MISSING;
      else if(INCOMPLETE_CODES.has(f.code)) category = BID_RISK_CATEGORY.INCOMPLETE_APU;
      return finding({
        id: `audit:${f.id}`, severity: auditSeverityToBidRisk(f.severity), category,
        description: f.message, evidence: f.evidence, recommendation: 'Revisar y completar antes de aprobar el APU.', source: 'auditor'
      });
    });
}

/* PRICE_WITHOUT_EVIDENCE / AGGRESSIVE_PRODUCTIVITY / POSSIBLE_UNDERESTIMATION:
   traducen los challenges ya calculados (Fase 1, con impacto $ verificado
   contra calcAPUv2) a riesgo. Para rendimiento: si el baseline honesto
   costaria MAS que lo actualmente presupuestado (projectImpact > 0 al
   sustituir por el baseline), el riesgo real es que el proyecto esta
   SUBESTIMADO -- se distingue de un rendimiento simplemente inusual pero
   mas caro que el baseline (no es una subestimacion, es responsabilidad
   propia ya castigada en el precio). */
function findingsFromChallenge(challenge, importeBase){
  return challenge.challenges.map(c => {
    // Bid Risk reporta EXPOSICION (magnitud de dinero en riesgo), nunca una
    // delta con signo como Challenge (donde el signo importa para saber
    // direccion) -- abs() aqui, el signo original solo decide la categoria
    // (subestimacion vs simplemente inusual) mas abajo.
    const absUnit = c.unitImpact == null ? null : Math.abs(c.unitImpact);
    const absProject = c.projectImpact == null ? null : Math.abs(c.projectImpact);
    const severity = severityByImpactRatio(absProject ?? absUnit ?? 0, importeBase);
    if(c.category === 'precio'){
      return finding({
        id: `challenge:${c.id}`, severity, category: BID_RISK_CATEGORY.PRICE_WITHOUT_EVIDENCE,
        description: c.title, evidence: c.baselineSource, unitImpact: absUnit, projectImpact: absProject,
        recommendation: 'Cotizar con al menos una fuente de mercado verificable.', source: 'challenge'
      });
    }
    // Signo real (no absoluto) solo para decidir la categoria: positivo =
    // el baseline honesto costaria MAS que lo presupuestado actualmente =
    // posible subestimacion. Se toma de projectImpact si existe, si no del
    // unitImpact (siempre disponible, no depende de cantidadObra).
    const signalValue = c.projectImpact ?? c.unitImpact ?? 0;
    const isUnderestimation = Number(signalValue) > 0;
    return finding({
      id: `challenge:${c.id}`, severity,
      category: isUnderestimation ? BID_RISK_CATEGORY.POSSIBLE_UNDERESTIMATION : BID_RISK_CATEGORY.AGGRESSIVE_PRODUCTIVITY,
      description: c.title, evidence: c.baselineSource, unitImpact: absUnit, projectImpact: absProject,
      recommendation: isUnderestimation ? 'Verificar si el rendimiento usado es realista: el proyecto podria costar mas de lo presupuestado.' : 'Confirmar que el rendimiento usado es alcanzable en campo.',
      source: 'challenge'
    });
  });
}

/* HIGH_CHALLENGE_IMPACT: finding AGREGADO (no reemplaza los individuales de
   arriba, los resume) cuando la EXPOSICION TOTAL combinada de todos los
   challenges es grande relativa al concepto -- marcado aggregate:true para
   que la agregacion a nivel proyecto nunca sume este numero junto con los
   individuales que ya lo componen (evitar doble conteo de dinero). */
function aggregateChallengeImpactFinding(challenge, importeBase){
  const total = challenge.challenges.reduce((s, c) => s + (Number.isFinite(c.projectImpact) ? c.projectImpact : 0), 0);
  if(!(importeBase > 0) || Math.abs(total) / importeBase < 0.20) return null;
  return finding({
    id: 'challenge:aggregate', severity: BID_RISK_SEVERITY.CRITICAL, category: BID_RISK_CATEGORY.HIGH_CHALLENGE_IMPACT,
    description: `La suma de ${challenge.challenges.length} hallazgos de Challenge representa ${(Math.abs(total) / importeBase * 100).toFixed(1)}% del importe del concepto.`,
    evidence: 'Resumen agregado -- no duplica los renglones individuales ya listados.', projectImpact: total,
    recommendation: 'Revision integral del APU antes de licitar: la exposicion combinada es alta.', source: 'challenge', aggregate: true
  });
}

/* LOW_CONFIDENCE / INSUFFICIENT_EVIDENCE: traducen el resultado ya calculado
   del Confidence Engine (Fase 2). No son monetizables por si mismos -- la
   confianza no es un costo, es una senal de cuanto se puede confiar en los
   demas numeros. */
function findingsFromConfidence(confidence){
  const findings = [];
  if(confidence.status === 'LOW'){
    findings.push(finding({
      id: 'confidence:low', severity: BID_RISK_SEVERITY.HIGH, category: BID_RISK_CATEGORY.LOW_CONFIDENCE,
      description: `Confianza tecnica global BAJA (score=${confidence.score}).`, evidence: confidence.criticalFactors.map(c => c.dimension).join(', ') || 'multiples dimensiones debiles',
      recommendation: 'No licitar este concepto sin revision humana completa.', source: 'confidence'
    }));
  } else if(confidence.status === 'INSUFFICIENT_EVIDENCE'){
    findings.push(finding({
      id: 'confidence:insufficient', severity: BID_RISK_SEVERITY.MEDIUM, category: BID_RISK_CATEGORY.INSUFFICIENT_EVIDENCE,
      description: 'No hay evidencia suficiente para evaluar la confianza tecnica de este concepto.', evidence: 'multiples dimensiones sin datos',
      recommendation: 'Completar informacion basica (precios, rendimiento, clasificacion) antes de poder evaluar riesgo.', source: 'confidence'
    }));
  }
  const hc = confidence.dimensions.historicalConsistency;
  if(hc.score != null && hc.score < 50){
    findings.push(finding({
      id: 'confidence:unconfirmed-yield', severity: BID_RISK_SEVERITY.MEDIUM, category: BID_RISK_CATEGORY.UNCONFIRMED_ASSUMPTIONS,
      description: 'La mayoria de los rendimientos de mano de obra no estan calibrados contra historico real ni validados por un humano.', evidence: hc.evidence.join('; '),
      recommendation: 'Validar con un supervisor de campo antes de usar este APU como base firme de oferta.', source: 'confidence'
    }));
  }
  return findings;
}

/* COST_CONCENTRATION: mide el RENGLON individual mas caro contra el costo
   directo -- deliberadamente NO por categoria completa (materials/labor/...).
   Una categoria completa dominando el costo es NORMAL y esperado en muchas
   disciplinas (concreto/block son inherentemente "materiales-intensivos",
   nunca deberia leerse como riesgo solo por eso). Un solo renglon
   individual concentrando la mayoria del costo SI es una senal real,
   independiente de la disciplina: si ese precio especifico esta mal, dana
   todo el concepto. Reusa las mismas funciones de calculo que calcAPUv2,
   nunca una formula nueva. */
const ROW_COST_FN = { materials: calcMaterialRow, labor: calcLaborRow, equipment: calcEquipmentRow, consumables: calcConsumableRow, seguridad: calcSeguridadRow };
function costConcentrationFinding(apu, totals, cantidadObra){
  const direct = totals.direct;
  if(!(direct > 0)) return null;
  const ctx = { cantidadContractual: Number(cantidadObra) || 0 };
  const rows = ['materials', 'labor', 'equipment', 'consumables', 'seguridad'].flatMap(kind =>
    (Array.isArray(apu[kind]) ? apu[kind] : []).map(row => ({ kind, row, cost: Math.max(0, Number(ROW_COST_FN[kind](row, ctx)) || 0) })));
  if(!rows.length) return null;
  const top = rows.reduce((max, r) => r.cost > max.cost ? r : max, rows[0]);
  const share = top.cost / direct;
  // Umbrales conservadores: un solo renglon con 50-60% del costo directo es
  // habitual (ej. el cemento en una mezcla de concreto) y NO amerita alerta
  // -- solo se marca cuando un unico renglon realmente domina el concepto.
  if(share < 0.60) return null;
  const severity = share >= 0.90 ? BID_RISK_SEVERITY.CRITICAL : share >= 0.75 ? BID_RISK_SEVERITY.HIGH : BID_RISK_SEVERITY.MEDIUM;
  const projectImpact = Number(cantidadObra) > 0 ? top.cost * Number(cantidadObra) : null;
  return finding({
    id: 'cost-concentration', severity, category: BID_RISK_CATEGORY.COST_CONCENTRATION,
    description: `"${top.row.descripcion || top.kind}" concentra ${(share * 100).toFixed(1)}% del costo directo del concepto.`, evidence: `direct=${direct.toFixed(2)}, renglon=${top.cost.toFixed(2)}`,
    unitImpact: round2(top.cost), projectImpact, recommendation: 'Verificar ese renglon con especial cuidado: cualquier error de precio o cantidad ahi domina el costo total.', source: 'motor_determinista'
  });
}

export function runBidRisk(apu = {}, options = {}){
  const now = options.now ? new Date(options.now) : new Date();
  const totals = apu.calculated || calcAPUv2(apu);
  const audit = options.audit || runApuAudit(apu, { now });
  const challenge = options.challenge || runApuChallenge(apu, { now });
  const confidence = options.confidence || runApuConfidence(apu, { now, audit, challenge });
  const importeBase = totals.importeTotal > 0 ? totals.importeTotal : totals.direct;

  const findings = [
    ...findingsFromAudit(audit),
    ...findingsFromChallenge(challenge, importeBase),
    ...findingsFromConfidence(confidence)
  ];
  const aggregateFinding = aggregateChallengeImpactFinding(challenge, importeBase);
  if(aggregateFinding) findings.push(aggregateFinding);
  const costConcentration = costConcentrationFinding(apu, totals, apu.cantidadObra);
  if(costConcentration) findings.push(costConcentration);

  const summary = { critical: 0, high: 0, medium: 0, low: 0 };
  findings.forEach(f => { summary[f.severity.toLowerCase()]++; });

  // Exposicion monetaria: solo suma findings NO agregados (evitar doble
  // conteo -- HIGH_CHALLENGE_IMPACT ya es la suma de los de Challenge) y con
  // projectImpact real (Number.isFinite descarta null/NaN/Infinity).
  const estimatedExposure = round2(findings.filter(f => !f.aggregate && Number.isFinite(f.projectImpact)).reduce((s, f) => s + f.projectImpact, 0));
  // Severidad global del APU (para ranking y para el caso "APU sano, sin
  // ningun finding"): el peor severity entre sus findings, o LOW cuando no
  // hay ninguno -- nunca "sin riesgo" (eso implicaria certeza absoluta que
  // ningun motor determinista puede dar), siempre al menos LOW.
  const severity = worstSeverity(findings);

  return { severity, findings, summary, estimatedExposure, confidence, totals };
}

const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
function worstSeverity(findings){
  return findings.reduce((worst, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst] ? f.severity : worst), BID_RISK_SEVERITY.LOW);
}

/* Agregacion a nivel proyecto: consume runBidRisk por cada APU (nunca
   recalcula auditoria/challenge/confianza a mano). apus puede ser cualquier
   arreglo de APUs v2 (finalizados o no) -- este modulo no depende de ningun
   modelo de "Project" especifico de almacenamiento (Firestore/workspace),
   para no acoplar la capa de dominio a la capa de persistencia. */
export function runProjectBidRisk(apus = [], options = {}){
  const perApu = apus.map((apu, index) => {
    const result = runBidRisk(apu, options);
    return { apuId: apu.id || apu.clave || `APU-${index + 1}`, concept: apu.concept || '', severity: result.severity, result };
  });
  const counts = { low: 0, medium: 0, high: 0, critical: 0 };
  perApu.forEach(p => counts[p.severity.toLowerCase()]++);
  const estimatedExposure = round2(perApu.reduce((s, p) => s + (Number.isFinite(p.result.estimatedExposure) ? p.result.estimatedExposure : 0), 0));
  const topRisks = [...perApu]
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || (b.result.estimatedExposure ?? 0) - (a.result.estimatedExposure ?? 0))
    .slice(0, options.topN || 10)
    .map(p => ({ apuId: p.apuId, concept: p.concept, severity: p.severity, estimatedExposure: p.result.estimatedExposure, topFindings: p.result.findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').slice(0, 3) }));
  return { totalAPUs: apus.length, low: counts.low, medium: counts.medium, high: counts.high, critical: counts.critical, estimatedExposure, topRisks };
}
