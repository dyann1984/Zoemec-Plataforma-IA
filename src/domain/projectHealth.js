/* Project Health Score (Fase F, secciones 5-7 del pedido). Score 0-100
   EXPLICABLE, nunca un numero magico. NO reemplaza ni duplica Confidence
   Engine / Bid Risk / Bid Readiness -- este modulo solo CONSUME sus
   resultados YA calculados (runProjectConfidence, runProjectBidRisk) mas
   los datos de ejecucion de Fase E (controlPresupuestalAggregation) y la
   calidad de datos de esta fase (projectDataQuality.js). Ninguna de las 8
   dimensiones recalcula lo que esos motores ya resolvieron.

   Formula (auditada contra los datos realmente disponibles, ver el reporte
   de auditoria previo a esta fase -- ningun peso es arbitrario):
     Costos           15  -- señal financiera directa y mas accionable hoy
     Riesgo           15  -- exposicion tecnica/financiera YA cuantificada por Bid Risk
     Datos            15  -- un proyecto con datos incompletos vuelve poco confiables
                              TODOS los demas ejes, se pesa igual de fuerte que Costos/Riesgo
     Forecast         15  -- EAC vs vigente es el numero mas relevante para decidir
     Avance           10  -- señal de progreso, secundaria a si el dinero esta controlado
     Confianza precios 10 -- ya alimenta Riesgo a nivel APU; se pesa mas bajo aqui para
                              no contar la misma evidencia dos veces
     Cambios          10  -- señal de scope creep, importante pero secundaria
     Documentacion    10  -- que tanto se esta generando/vinculando evidencia formal
   Suma = 100.

   Cuando una dimension no tiene datos suficientes para evaluarse, NUNCA se
   fuerza a 0 (castigaria un proyecto apenas iniciado) ni a 100 (fingiria
   salud que no se puede demostrar) -- se usa un valor neutral (50) y se
   marca `insufficientData:true`, visible en la UI, para que el score
   nunca mienta sobre lo que en realidad no pudo evaluar. */
import { runProjectConfidence } from './apuConfidence.js';
import { runProjectBidRisk } from './bidRisk.js';

export const HEALTH_DIMENSION_WEIGHTS = Object.freeze({
  costos: 15, riesgo: 15, datos: 15, forecast: 15, avance: 10, confianzaPrecios: 10, cambios: 10, documentacion: 10
});

export const HEALTH_LEVEL = Object.freeze({ SALUDABLE: 'SALUDABLE', ATENCION: 'ATENCION', RIESGO: 'RIESGO', CRITICO: 'CRITICO' });

const LEVEL_THRESHOLDS = [
  { min: 85, level: HEALTH_LEVEL.SALUDABLE, label: 'Saludable', description: 'El proyecto esta dentro de los parametros esperados en todos los ejes principales.' },
  { min: 70, level: HEALTH_LEVEL.ATENCION, label: 'Atención', description: 'Uno o mas ejes requieren seguimiento cercano antes de que se conviertan en un problema.' },
  { min: 50, level: HEALTH_LEVEL.RIESGO, label: 'Riesgo', description: 'Existen desviaciones reales que ya afectan costo, plazo o confianza del proyecto.' },
  { min: 0, level: HEALTH_LEVEL.CRITICO, label: 'Crítico', description: 'El proyecto necesita intervencion inmediata en al menos un eje critico.' }
];

export function classifyProjectHealthScore(score){
  const found = LEVEL_THRESHOLDS.find(t => score >= t.min);
  return { level: found.level, label: found.label, description: found.description };
}

function toNumber(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function clampScore(n){ return Math.max(0, Math.min(100, Math.round(n))); }
function neutral(reasons = []){ return { score: 50, insufficientData: true, reasons }; }

/* Costos: penaliza por cada alerta CRITICAL/HIGH de Control Presupuestal
   relacionada con sobreejercicio (SOBREPRESUPUESTO/CONCEPTO_AGOTADO/
   EJECUCION_MAYOR_PRESUPUESTO/COMPROMETIDO_EXCESIVO) -- nunca vuelve a
   calcular el propio sobreejercicio, solo cuenta lo que
   controlPresupuestalAlerts.js YA detecto. */
function scoreCostos(controlPresupuestalAlerts, hasControlPresupuestal){
  if(!hasControlPresupuestal) return neutral(['Sin Control Presupuestal activo todavia (requiere Baseline aprobado).']);
  const relevant = (controlPresupuestalAlerts || []).filter(a => ['SOBREPRESUPUESTO', 'CONCEPTO_AGOTADO', 'EJECUCION_MAYOR_PRESUPUESTO', 'COMPROMETIDO_EXCESIVO'].includes(a.type));
  const penalty = relevant.reduce((s, a) => s + (a.severity === 'CRITICAL' ? 25 : a.severity === 'HIGH' ? 15 : 8), 0);
  return { score: clampScore(100 - penalty), insufficientData: false, reasons: relevant.map(a => a.message) };
}

/* Avance: penaliza por desviacion fisico-financiera real (misma alerta de
   Fase E), premia que exista avance registrado en absoluto. */
function scoreAvance(controlPresupuestalAlerts, hasProgress){
  if(!hasProgress) return neutral(['Sin avance fisico registrado todavia.']);
  const desviaciones = (controlPresupuestalAlerts || []).filter(a => a.type === 'DESVIACION_FISICO_FINANCIERO');
  const penalty = desviaciones.reduce((s, a) => s + Math.min(30, Math.abs(toNumber(a.value)) / 2), 0);
  return { score: clampScore(100 - penalty), insufficientData: false, reasons: desviaciones.map(a => a.message) };
}

/* Riesgo: proporcion de APUs con severidad HIGH/CRITICAL segun Bid Risk
   real (runProjectBidRisk) -- nunca una regla de riesgo nueva. */
function scoreRiesgo(bidRiskProject){
  if(!bidRiskProject || !bidRiskProject.totalAPUs) return neutral(['Sin APUs generados todavia para evaluar riesgo de oferta.']);
  const graveProportion = (bidRiskProject.high + bidRiskProject.critical) / bidRiskProject.totalAPUs;
  const score = clampScore(100 - graveProportion * 100);
  const reasons = [];
  if(bidRiskProject.critical > 0) reasons.push(`${bidRiskProject.critical} APU(s) con riesgo CRITICAL.`);
  if(bidRiskProject.high > 0) reasons.push(`${bidRiskProject.high} APU(s) con riesgo HIGH.`);
  return { score, insufficientData: false, reasons };
}

/* Datos: reusa DIRECTAMENTE projectDataQuality.js, nunca recalcula. */
function scoreDatos(dataQuality){
  if(!dataQuality) return neutral(['Calidad de datos no evaluada.']);
  return { score: clampScore(dataQuality.overallPct), insufficientData: false, reasons: dataQuality.missing.map(m => `Falta: ${m}.`) };
}

/* Confianza de precios: promedio directo de runProjectConfidence, nunca
   un segundo calculo de evidencia de precio. */
function scoreConfianzaPrecios(confidenceProject){
  if(!confidenceProject || confidenceProject.averageScore == null) return neutral(['Sin score de Confidence disponible (APUs insuficientes o sin evidencia).']);
  const reasons = [];
  if(confidenceProject.insufficientEvidence > 0) reasons.push(`${confidenceProject.insufficientEvidence} APU(s) con evidencia insuficiente.`);
  if(confidenceProject.low > 0) reasons.push(`${confidenceProject.low} APU(s) con confianza BAJA.`);
  return { score: clampScore(confidenceProject.averageScore), insufficientData: false, reasons };
}

/* Cambios: penaliza ordenes EN_REVISION pendientes de decidir, y el
   volumen de cambios aprobados relativo al baseline (mucho scope creep
   real, no solo "hubo cambios"). */
function scoreCambios(changeOrders, baseline, cambiosAprobados){
  const list = changeOrders || [];
  if(!list.length) return { score: 100, insufficientData: false, reasons: [] };
  const pendientes = list.filter(c => c.status === 'EN_REVISION').length;
  const ratio = baseline > 0 ? Math.abs(toNumber(cambiosAprobados)) / baseline : 0;
  const penalty = pendientes * 10 + Math.min(40, ratio * 100);
  const reasons = [];
  if(pendientes > 0) reasons.push(`${pendientes} orden(es) de cambio pendientes de aprobar/rechazar.`);
  if(ratio > 0.15) reasons.push(`Los cambios aprobados representan ${(ratio * 100).toFixed(1)}% del baseline.`);
  return { score: clampScore(100 - penalty), insufficientData: false, reasons };
}

/* Documentacion: cuantos documentos reales estan vinculados al proyecto
   (evidencia + entregables exportados) -- formula simple y documentada:
   40 puntos base por tener AL MENOS uno, +10 por cada documento adicional
   hasta 100; nunca se inventa una meta de "cuantos deberia tener". */
function scoreDocumentacion(documentosCount){
  if(!documentosCount) return neutral(['Sin documentos vinculados al proyecto todavia.']);
  return { score: clampScore(40 + documentosCount * 10), insufficientData: false, reasons: [] };
}

/* Forecast: variacion% de Control Presupuestal (EAC vs vigente, Fase E,
   formula unica ya documentada alli) -- nunca un forecast nuevo. */
function scoreForecast(variacionPct, hasControlPresupuestal){
  if(!hasControlPresupuestal || variacionPct == null) return neutral(['Sin forecast disponible todavia (requiere avance fisico registrado).']);
  const penalty = variacionPct > 0 ? Math.min(60, variacionPct * 1.5) : 0;
  const reasons = variacionPct > 5 ? [`El costo estimado al cierre (EAC) supera el presupuesto vigente en ${variacionPct.toFixed(1)}%.`] : [];
  return { score: clampScore(100 - penalty), insufficientData: false, reasons };
}

/* computeProjectHealth: unico punto de entrada. Recibe resultados YA
   calculados por el llamador (server/api-lib/_route-project-vault.mjs) --
   nunca hace fetch ni llama a runProjectConfidence/runProjectBidRisk por
   si mismo salvo que el llamador no los haya provisto (conveniencia para
   los tests unitarios; en produccion el route SIEMPRE los calcula una sola
   vez y los reusa para Vault + DNA + Health, nunca tres veces). */
export function computeProjectHealth({
  apusFlat = [], confidenceProject = null, bidRiskProject = null,
  controlPresupuestalTotals = null, controlPresupuestalAlerts = [],
  changeOrders = [], progressEntries = [], dataQuality = null, documentosCount = 0
} = {}){
  const resolvedConfidence = confidenceProject || (apusFlat.length ? runProjectConfidence(apusFlat) : null);
  const resolvedBidRisk = bidRiskProject || (apusFlat.length ? runProjectBidRisk(apusFlat) : null);
  const hasControlPresupuestal = Boolean(controlPresupuestalTotals && controlPresupuestalTotals.vigente > 0);

  const dimensions = {
    costos: scoreCostos(controlPresupuestalAlerts, hasControlPresupuestal),
    avance: scoreAvance(controlPresupuestalAlerts, progressEntries.length > 0),
    riesgo: scoreRiesgo(resolvedBidRisk),
    datos: scoreDatos(dataQuality),
    confianzaPrecios: scoreConfianzaPrecios(resolvedConfidence),
    cambios: scoreCambios(changeOrders, controlPresupuestalTotals?.baseline, controlPresupuestalTotals?.cambiosAprobados),
    documentacion: scoreDocumentacion(documentosCount),
    forecast: scoreForecast(controlPresupuestalTotals?.variacionPct, hasControlPresupuestal)
  };

  const overall = Object.keys(HEALTH_DIMENSION_WEIGHTS).reduce((s, key) => s + dimensions[key].score * (HEALTH_DIMENSION_WEIGHTS[key] / 100), 0);
  const score = clampScore(overall);
  const classification = classifyProjectHealthScore(score);

  // "Que esta bajando el score": las dimensiones con mayor DEFICIT ponderado
  // (peso x (100-score)) son las que mas estan restando -- nunca solo la de
  // menor score absoluto, que podria pesar poco en la formula.
  const drivers = Object.entries(dimensions)
    .map(([key, d]) => ({ key, weightedDeficit: (HEALTH_DIMENSION_WEIGHTS[key] / 100) * (100 - d.score), ...d }))
    .filter(d => d.weightedDeficit > 0.5)
    .sort((a, b) => b.weightedDeficit - a.weightedDeficit);

  return {
    score, level: classification.level, label: classification.label, description: classification.description,
    dimensions: Object.fromEntries(Object.entries(dimensions).map(([key, d]) => [key, { ...d, weight: HEALTH_DIMENSION_WEIGHTS[key] }])),
    drivers: drivers.slice(0, 5).map(d => ({ key: d.key, score: d.score, reasons: d.reasons }))
  };
}
