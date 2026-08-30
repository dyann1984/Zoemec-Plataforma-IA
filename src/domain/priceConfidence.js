/* Material & Price Intelligence 2.1 -- regla 8: confianza de UN precio
   (distinta de PRICE_STATUS y de la confianza global del APU en
   apuConfidence.js) calculada con senales observables -- nunca con la
   opinion del LLM sobre si mismo. Cada resultado trae confidenceReasons[]
   explicando exactamente que senales se usaron, para que sea auditable. */

export const PRICE_CONFIDENCE = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', UNVERIFIED: 'UNVERIFIED' });

const HIGH_MATCH_MIN_SOURCES = 2;
const RECENT_DAYS_THRESHOLD = 30;
const STALE_DAYS_THRESHOLD = 180;
const LOW_DISPERSION_PCT = 0.15;
const HIGH_DISPERSION_PCT = 0.40;

/* computePriceConfidence: senales consideradas (todas opcionales salvo
   references, que puede venir vacio):
   - references: array con {match:{verdict}, presentacionComparable}.
   - recencyDays: antiguedad en dias de la fuente mas reciente entre las
     ALTO (null si no se sabe -- nunca se asume "reciente" sin evidencia).
   - dispersionPct: dispersion relativa entre los precios de las referencias
     ALTO (ej. (max-min)/mediana). null si no aplica (0 o 1 referencia). */
export function computePriceConfidence({ references = [], recencyDays = null, dispersionPct = null } = {}){
  const refs = Array.isArray(references) ? references : [];
  const alto = refs.filter(r => r?.match?.verdict === 'ALTO');
  const medio = refs.filter(r => r?.match?.verdict === 'MEDIO');
  const reasons = [];

  if(!refs.length){
    reasons.push('Sin ninguna referencia de mercado consultada o encontrada.');
    return { level: PRICE_CONFIDENCE.UNVERIFIED, reasons };
  }

  if(!alto.length){
    reasons.push(medio.length
      ? `${medio.length} referencia(s) con equivalencia tecnica parcial (MEDIO), ninguna ALTO: no participan en un precio recomendado.`
      : 'Ninguna referencia alcanzo equivalencia tecnica suficiente (todas BAJO o rechazadas).');
    return { level: PRICE_CONFIDENCE.LOW, reasons };
  }

  const nonComparable = alto.filter(r => r.presentacionComparable === false);
  if(nonComparable.length === alto.length){
    reasons.push('Las referencias ALTO no tienen presentacion comparable con certeza contra la unidad requerida.');
    return { level: PRICE_CONFIDENCE.LOW, reasons };
  }

  reasons.push(`${alto.length} referencia(s) con equivalencia tecnica ALTO.`);

  const isStale = Number.isFinite(recencyDays) && recencyDays > STALE_DAYS_THRESHOLD;
  const isRecent = Number.isFinite(recencyDays) && recencyDays <= RECENT_DAYS_THRESHOLD;
  if(isStale) reasons.push(`La fuente mas reciente tiene ${recencyDays} dias de antiguedad (> ${STALE_DAYS_THRESHOLD}): evidencia posiblemente obsoleta.`);
  else if(isRecent) reasons.push(`Fuente reciente (${recencyDays} dias).`);
  else reasons.push('Antiguedad de la fuente no determinada.');

  const isLowDispersion = Number.isFinite(dispersionPct) && dispersionPct <= LOW_DISPERSION_PCT;
  const isHighDispersion = Number.isFinite(dispersionPct) && dispersionPct >= HIGH_DISPERSION_PCT;
  if(isHighDispersion) reasons.push(`Dispersion de precios alta entre fuentes (${Math.round(dispersionPct * 100)}%).`);
  else if(isLowDispersion) reasons.push(`Dispersion de precios baja entre fuentes (${Math.round(dispersionPct * 100)}%).`);

  if(isStale || isHighDispersion){
    return { level: PRICE_CONFIDENCE.MEDIUM, reasons };
  }
  if(alto.length >= HIGH_MATCH_MIN_SOURCES && !isHighDispersion && (isRecent || isLowDispersion)){
    return { level: PRICE_CONFIDENCE.HIGH, reasons };
  }
  if(alto.length >= HIGH_MATCH_MIN_SOURCES){
    reasons.push(`Multiples fuentes ALTO (${alto.length}) pero sin confirmar recencia ni dispersion: no se sube a HIGH sin esa evidencia.`);
    return { level: PRICE_CONFIDENCE.MEDIUM, reasons };
  }
  reasons.push('Solo 1 referencia ALTO: se requieren al menos 2 fuentes concordantes para HIGH.');
  return { level: PRICE_CONFIDENCE.MEDIUM, reasons };
}
