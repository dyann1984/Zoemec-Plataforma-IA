/* Alertas de Control Presupuestal (Fase E, seccion 10 del pedido). Pura:
   recibe el resultado YA calculado de controlPresupuestalAggregation.js mas
   los registros crudos que necesitan las 2 alertas que no son numericas
   (orden de cambio pendiente, pago sin estimacion), y produce una lista
   plana de alertas. Nunca recalcula nada -- solo interpreta umbrales sobre
   numeros que ya existen. Reusa el MISMO vocabulario de severidad que
   bidRisk.js (LOW/MEDIUM/HIGH/CRITICAL) para que la UI reutilice las
   mismas clases visuales (.zi-badge-*) ya establecidas, nunca un
   semaforo nuevo.

   "No crear todavia Project Sentinel separado; estas alertas seran la base
   para esa fase futura" (regla 10) -- por eso esta funcion es pura y no
   depende de ningun mecanismo de notificacion: cualquier fase futura puede
   llamarla igual desde un cron/servidor sin este modulo saber nada de eso. */
import { CHANGE_ORDER_STATUS } from './changeOrderSchema.js';

export const ALERT_TYPE = Object.freeze({
  SOBREPRESUPUESTO: 'SOBREPRESUPUESTO',
  CONCEPTO_AGOTADO: 'CONCEPTO_AGOTADO',
  EJECUCION_MAYOR_PRESUPUESTO: 'EJECUCION_MAYOR_PRESUPUESTO',
  COMPROMETIDO_EXCESIVO: 'COMPROMETIDO_EXCESIVO',
  ORDEN_CAMBIO_PENDIENTE: 'ORDEN_CAMBIO_PENDIENTE',
  PAGO_SIN_ESTIMACION: 'PAGO_SIN_ESTIMACION',
  DESVIACION_FISICO_FINANCIERO: 'DESVIACION_FISICO_FINANCIERO',
  FORECAST_SOBRE_PRESUPUESTO: 'FORECAST_SOBRE_PRESUPUESTO'
});

const DEFAULT_DEVIATION_THRESHOLD_PCT = 15;

export function computeControlPresupuestalAlerts({ aggregation, changeOrders = [], payments = [], deviationThresholdPct = DEFAULT_DEVIATION_THRESHOLD_PCT } = {}){
  const alerts = [];
  if(!aggregation) return alerts;
  const { rows, totals } = aggregation;

  // -- Alertas a nivel PROYECTO --
  if(totals.ejecutado + totals.comprometido > totals.vigente){
    alerts.push({ type: ALERT_TYPE.SOBREPRESUPUESTO, severity: 'CRITICAL', scope: 'project', message: `Ejecutado + comprometido ($${(totals.ejecutado + totals.comprometido).toFixed(2)}) supera el presupuesto vigente ($${totals.vigente.toFixed(2)}).` });
  }
  if(totals.eac > totals.vigente){
    alerts.push({ type: ALERT_TYPE.FORECAST_SOBRE_PRESUPUESTO, severity: 'HIGH', scope: 'project', message: `El costo estimado al cierre ($${totals.eac.toFixed(2)}) supera el presupuesto vigente ($${totals.vigente.toFixed(2)}).`, value: totals.variacion });
  }

  // -- Alertas por CONCEPTO --
  rows.forEach(r => {
    const disponible = r.presupuestoVigente - r.comprometido - r.ejecutado;
    if(r.presupuestoVigente > 0 && disponible <= 0){
      alerts.push({ type: ALERT_TYPE.CONCEPTO_AGOTADO, severity: 'HIGH', scope: 'concept', conceptoId: r.conceptoId, message: `"${r.concept}" no tiene presupuesto disponible (vigente - comprometido - ejecutado = $${disponible.toFixed(2)}).` });
    }
    if(r.ejecutado > r.presupuestoVigente && r.presupuestoVigente > 0){
      alerts.push({ type: ALERT_TYPE.EJECUCION_MAYOR_PRESUPUESTO, severity: 'CRITICAL', scope: 'concept', conceptoId: r.conceptoId, message: `"${r.concept}" ya ejecuto ($${r.ejecutado.toFixed(2)}) mas de su presupuesto vigente ($${r.presupuestoVigente.toFixed(2)}).` });
    }
    const restanteParaEjecutar = r.presupuestoVigente - r.ejecutado;
    if(r.comprometido > restanteParaEjecutar && restanteParaEjecutar >= 0){
      alerts.push({ type: ALERT_TYPE.COMPROMETIDO_EXCESIVO, severity: 'MEDIUM', scope: 'concept', conceptoId: r.conceptoId, message: `"${r.concept}" tiene comprometido ($${r.comprometido.toFixed(2)}) mas de lo que le queda por ejecutar ($${restanteParaEjecutar.toFixed(2)}).` });
    }
    if(r.desviacionFisicoFinanciero != null && Math.abs(r.desviacionFisicoFinanciero) > deviationThresholdPct){
      alerts.push({ type: ALERT_TYPE.DESVIACION_FISICO_FINANCIERO, severity: 'MEDIUM', scope: 'concept', conceptoId: r.conceptoId, message: `"${r.concept}" tiene una desviacion fisico-financiera de ${r.desviacionFisicoFinanciero.toFixed(1)} puntos porcentuales.`, value: r.desviacionFisicoFinanciero });
    }
  });

  // -- Ordenes de cambio pendientes de decision --
  changeOrders.filter(c => c?.status === CHANGE_ORDER_STATUS.EN_REVISION).forEach(c => {
    alerts.push({ type: ALERT_TYPE.ORDEN_CAMBIO_PENDIENTE, severity: 'LOW', scope: 'concept', conceptoId: c.conceptoId, message: `Orden de cambio ${c.folio || c.id} ("${c.concept}") esta EN_REVISION, pendiente de aprobar o rechazar.` });
  });

  // -- Pagos sin estimacion asociada --
  payments.filter(p => !p?.estimacionId).forEach(p => {
    alerts.push({ type: ALERT_TYPE.PAGO_SIN_ESTIMACION, severity: 'LOW', scope: 'project', message: `Pago de $${toFixedSafe(p?.monto)} a "${p?.proveedor || 'proveedor sin nombre'}" no esta vinculado a ninguna estimacion.` });
  });

  const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  return alerts.sort((a, b) => rank[b.severity] - rank[a.severity]);
}

function toFixedSafe(v){ const n = Number(v); return Number.isFinite(n) ? n.toFixed(2) : '0.00'; }
