/* Material & Price Intelligence 2.1 -- regla 3: capa normalizada de estado
   de precio, ADITIVA sobre los estados que ZOEMEC ya usa (APU_DATA_STATE en
   apuSchema.js, PRICE_EVIDENCE_LEVEL, y el propio priceRecord.references con
   verdict de src/lib/technicalMatch.js). Deriva SIEMPRE de las mismas
   senales que ya lee apuChallenge.js#priceChallenges (row.fuente.estado y
   row.priceRecord.references[].match.verdict) -- nunca reimplementa esa
   deteccion, solo la traduce a un vocabulario mas explicito. Por eso, si un
   renglon tiene PRICE_STATUS.AI_ESTIMATE_UNVERIFIED, el motor de Challenge
   YA existente lo marca "sin respaldo" automaticamente, sin tocar
   apuChallenge.js/apuAuditor.js/bidRisk.js/apuConfidence.js. */
import { APU_DATA_STATE } from './apuSchema.js';

export const PRICE_STATUS = Object.freeze({
  VERIFIED_MARKET: 'VERIFIED_MARKET',
  MARKET_REFERENCE: 'MARKET_REFERENCE',
  AI_ESTIMATE_UNVERIFIED: 'AI_ESTIMATE_UNVERIFIED',
  QUOTATION_REQUIRED: 'QUOTATION_REQUIRED',
  NO_PRICE: 'NO_PRICE'
});

function num(value){ const n = Number(value); return Number.isFinite(n) ? n : 0; }

/* derivePriceStatus: mismas senales que apuChallenge.js#priceChallenges.
   - estado VERIFICADO/IMPORTADO (fuente real de catalogo/humano) -> nunca es
     cuestionable por precio; se mapea a VERIFIED_MARKET.
   - price <= 0 (o no finito) -> NO_PRICE SIEMPRE, sin importar evidencia:
     "un precio $0 NO debe convertirse en precio valido" (regla explicita).
   - requiresQuotation:true (el llamador declaro que es un producto
     especializado sin precio publico defendible, ej. Price Intelligence no
     encontro NINGUNA referencia utilizable) -> QUOTATION_REQUIRED.
   - references con al menos una ALTO -> VERIFIED_MARKET.
   - references con al menos una (MEDIO o BAJO, sin ALTO) -> MARKET_REFERENCE
     (existe evidencia, requiere validacion humana).
   - sin ninguna referencia -> AI_ESTIMATE_UNVERIFIED. */
export function derivePriceStatus({ estado = null, price = 0, references = [], requiresQuotation = false } = {}){
  if(!(num(price) > 0)) return PRICE_STATUS.NO_PRICE;
  if(estado === APU_DATA_STATE.VERIFICADO || estado === APU_DATA_STATE.IMPORTADO) return PRICE_STATUS.VERIFIED_MARKET;
  if(requiresQuotation) return PRICE_STATUS.QUOTATION_REQUIRED;

  const refs = Array.isArray(references) ? references : [];
  const hasAlto = refs.some(r => r?.match?.verdict === 'ALTO');
  if(hasAlto) return PRICE_STATUS.VERIFIED_MARKET;
  if(refs.length > 0) return PRICE_STATUS.MARKET_REFERENCE;
  return PRICE_STATUS.AI_ESTIMATE_UNVERIFIED;
}

/* Mapeo de vuelta al vocabulario existente (APU_DATA_STATE), para que un
   renglon enriquecido con PRICE_STATUS 2.1 siga siendo compatible, sin
   ningun cambio, con runApuChallenge/runApuAudit/runBidRisk/runApuConfidence
   -- todos ellos leen fuente.estado, nunca PRICE_STATUS directamente. */
export function priceStatusToLegacyState(priceStatus){
  switch(priceStatus){
    case PRICE_STATUS.VERIFIED_MARKET: return APU_DATA_STATE.VERIFICADO;
    case PRICE_STATUS.MARKET_REFERENCE: return APU_DATA_STATE.REQUIERE_VALIDACION;
    case PRICE_STATUS.QUOTATION_REQUIRED: return APU_DATA_STATE.REQUIERE_VALIDACION;
    case PRICE_STATUS.NO_PRICE: return APU_DATA_STATE.REQUIERE_VALIDACION;
    case PRICE_STATUS.AI_ESTIMATE_UNVERIFIED:
    default: return APU_DATA_STATE.ESTIMADO_IA;
  }
}

export const PRICE_STATUS_LABEL = Object.freeze({
  [PRICE_STATUS.VERIFIED_MARKET]: 'Verificado con mercado',
  [PRICE_STATUS.MARKET_REFERENCE]: 'Referencia de mercado (requiere validacion)',
  [PRICE_STATUS.AI_ESTIMATE_UNVERIFIED]: 'Estimado por IA (sin evidencia)',
  [PRICE_STATUS.QUOTATION_REQUIRED]: 'Requiere cotizacion real',
  [PRICE_STATUS.NO_PRICE]: 'Sin precio utilizable'
});
export function priceStatusLabel(status){
  return PRICE_STATUS_LABEL[status] || PRICE_STATUS_LABEL[PRICE_STATUS.AI_ESTIMATE_UNVERIFIED];
}
