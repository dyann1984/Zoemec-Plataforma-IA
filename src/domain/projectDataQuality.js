/* Indicador de calidad de datos del proyecto (Fase F, seccion 10 del
   pedido). Mide que tan completo esta el EXPEDIENTE, no que tan bueno es
   el proyecto -- alimenta la dimension "Datos" de Project Health
   (projectHealth.js) pero es independiente y consultable por si solo
   ("Datos del proyecto: 82% completos"). Pesos explicitos, documentados,
   suman 100 -- presupuesto/APU/precios pesan mas porque sin ellos ningun
   otro numero del Vault (Control Presupuestal, Forecast, Confidence) tiene
   con que calcularse; el resto son senales de completitud secundarias. */

export const DATA_QUALITY_DIMENSIONS = Object.freeze([
  { key: 'ubicacion', label: 'Ubicación', weight: 10 },
  { key: 'planos', label: 'Planos', weight: 10 },
  { key: 'presupuesto', label: 'Presupuesto', weight: 15 },
  { key: 'apu', label: 'APU', weight: 15 },
  { key: 'precios', label: 'Precios con evidencia', weight: 15 },
  { key: 'avance', label: 'Avance', weight: 10 },
  { key: 'documentos', label: 'Documentos', weight: 10 },
  { key: 'responsables', label: 'Responsables', weight: 15 }
]);

function toNumber(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

/* Precios "con evidencia" = al menos un APU del proyecto NO cayo en
   INSUFFICIENT_EVIDENCE segun el Confidence Engine real (nunca se vuelve a
   evaluar evidencia de precio aqui, se reusa runProjectConfidence). */
function hasPriceEvidence(confidenceProject){
  if(!confidenceProject || !confidenceProject.totalAPUs) return false;
  return (toNumber(confidenceProject.high) + toNumber(confidenceProject.medium)) > 0;
}

export function computeProjectDataQuality({
  hasUbicacion = false, planosCount = 0, presupuestoHasBaseline = false, apusCount = 0,
  confidenceProject = null, avanceCount = 0, documentosCount = 0, responsablesCount = 0
} = {}){
  const presence = {
    ubicacion: Boolean(hasUbicacion),
    planos: planosCount > 0,
    presupuesto: Boolean(presupuestoHasBaseline),
    apu: apusCount > 0,
    precios: hasPriceEvidence(confidenceProject),
    avance: avanceCount > 0,
    documentos: documentosCount > 0,
    responsables: responsablesCount > 0
  };
  const dimensions = DATA_QUALITY_DIMENSIONS.map(d => ({ ...d, present: presence[d.key], contribution: presence[d.key] ? d.weight : 0 }));
  const overallPct = dimensions.reduce((s, d) => s + d.contribution, 0);
  const missing = dimensions.filter(d => !d.present).map(d => d.label);
  return { overallPct, dimensions, missing };
}
