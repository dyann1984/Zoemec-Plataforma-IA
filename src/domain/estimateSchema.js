/* Esquema de Estimacion de obra (Fase E, Control Presupuestal). Deliberadamente
   SIN logica fiscal especifica de Mexico (retencion de fondo de garantia,
   amortizacion de anticipo, deducciones): se auditó el resto del dominio
   (apuCalc.js#applyCascade, priceNormalization.js, etc.) y ninguna pieza ya
   implementada calcula retencion/amortizacion de una estimacion -- esta fase
   solo captura esos 3 valores como PORCENTAJES simples que el usuario
   declara por estimacion (nunca una tasa legal inventada por default), y
   documenta la formula resultante; no inventa una segunda logica fiscal. */
import { uid } from '../utils/id.js';

export const ESTIMATE_STATUS = Object.freeze({
  BORRADOR: 'BORRADOR',
  AUTORIZADA: 'AUTORIZADA'
});

const LEGAL_TRANSITIONS = Object.freeze({
  BORRADOR: ['AUTORIZADA'],
  AUTORIZADA: []
});

export function isLegalEstimateTransition(from, to){
  if(from === to) return true;
  return (LEGAL_TRANSITIONS[from] || []).includes(to);
}

/* Formula documentada (unica, ver seccion 6 del pedido -- retencion/
   amortizacion/deducciones son PORCENTAJES sobre el importe bruto de la
   estimacion, capturados por el usuario, nunca inferidos):
     importeBruto     = suma de (cantidadDelPeriodo x P.U.) de cada renglon
     retencion        = importeBruto x retencionPct / 100
     amortizacion     = importeBruto x amortizacionPct / 100
     deducciones      = monto fijo declarado (no un porcentaje -- las
                        deducciones reales, ej. una penalizacion, no suelen
                        ser proporcionales al importe)
     totalEstimado    = importeBruto - retencion - amortizacion - deducciones
   totalPagado/saldo NO se calculan aqui -- vienen de los pagos reales
   vinculados (ver paymentSchema.js/controlPresupuestalAggregation.js),
   nunca se estiman por adelantado. */
export function computeEstimateTotals({ conceptos = [], retencionPct = 0, amortizacionPct = 0, deducciones = 0 }){
  const importeBruto = (conceptos || []).reduce((sum, c) => sum + (Number(c?.cantidadPeriodo) || 0) * (Number(c?.pu) || 0), 0);
  const retencion = importeBruto * (Number(retencionPct) || 0) / 100;
  const amortizacion = importeBruto * (Number(amortizacionPct) || 0) / 100;
  const deduccionesMonto = Number(deducciones) || 0;
  const totalEstimado = importeBruto - retencion - amortizacion - deduccionesMonto;
  return { importeBruto, retencion, amortizacion, deducciones: deduccionesMonto, totalEstimado };
}

export function makeEmptyEstimate({
  id = null, numero = null, projectId = null, periodoDesde = null, periodoHasta = null,
  conceptos = [], retencionPct = 0, amortizacionPct = 0, deducciones = 0
} = {}){
  const now = new Date().toISOString();
  const totals = computeEstimateTotals({ conceptos, retencionPct, amortizacionPct, deducciones });
  return {
    id: id || ('EST-OBRA-' + uid()),
    numero, projectId, periodoDesde, periodoHasta,
    conceptos: conceptos || [],
    retencionPct: Number(retencionPct) || 0, amortizacionPct: Number(amortizacionPct) || 0,
    ...totals,
    status: ESTIMATE_STATUS.BORRADOR,
    createdAt: now, updatedAt: now, authorizedBy: null, authorizedAt: null
  };
}

export function validateEstimate(estimate){
  const errors = [];
  if(!estimate || typeof estimate !== 'object') errors.push('La estimacion no tiene una forma valida.');
  if(!estimate?.projectId) errors.push('La estimacion debe pertenecer a un proyecto.');
  if(!Array.isArray(estimate?.conceptos) || !estimate.conceptos.length) errors.push('La estimacion necesita al menos un concepto.');
  if(!Object.values(ESTIMATE_STATUS).includes(estimate?.status)) errors.push('status invalido.');
  return { valid: errors.length === 0, errors };
}
