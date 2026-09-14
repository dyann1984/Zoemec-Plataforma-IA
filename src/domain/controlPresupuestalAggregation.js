/* Agregacion PURA de Control Presupuestal (Fase E). Combina, SIN
   recalcular ninguna pieza que ya calculo otro motor, los siguientes
   insumos reales:
     - presupuestoRows: renglones YA agregados por
       src/domain/presupuestoAggregation.js#aggregatePresupuesto (Fase D) --
       trae qty/pu/direct/importe de cada concepto, que a su vez vienen de
       calcAPU/calcAPUv2 (indirectos/financiamiento/utilidad/cargos/IVA ya
       incluidos en `pu`, ver apuCalc.js). Este modulo NUNCA vuelve a
       calcular un precio.
     - changeOrders APROBADA (changeOrderSchema.js) -- unicas que mueven el
       presupuesto VIGENTE, nunca el baseline (regla 2 del pedido).
     - commitments ACTIVO (commitmentSchema.js) -- comprometido, separado de
       pagado (regla 3).
     - progressEntries (progressEntrySchema.js) -- avance fisico real,
       sumado desde el ledger, nunca desde un campo "actual" editable.
     - estimates AUTORIZADA (estimateSchema.js) -- avance FINANCIERO
       (certificado/facturado), deliberadamente distinto de "ejecutado"
       (avance fisico valuado a precio de presupuesto) para que la
       comparacion fisico-vs-financiero de la seccion 5 del pedido tenga
       sentido real: un proyecto puede ir fisicamente adelantado pero con
       facturacion atrasada, o viceversa -- si ambos fueran la misma
       formula, la comparacion seria tautologica.
     - payments (paymentSchema.js) -- pagado, prorrateado entre los
       conceptos de la estimacion que referencian (ver allocatePayments
       abajo); un pago sin estimacionId no se prorratea a ningun concepto
       (queda visible solo a nivel proyecto) y genera su propia alerta
       (controlPresupuestalAlerts.js), nunca se inventa a que concepto
       pertenece.

   FORMULAS UNICAS Y DOCUMENTADAS DE ESTA FASE (regla 16 del pedido: "debe
   ser unica y documentada"):
     presupuestoVigente = presupuestoBase + cambiosAprobados         (regla 1)
     ejecutado           = cantidadEjecutada x P.U. del APU           (regla 16, "<=" es guard de sanidad, no una desigualdad de diseno)
     avanceFisico%       = cantidadEjecutada / cantidadVigente        (regla 4, formula dada)
     avanceFinanciero%   = estimado (certificado) / presupuestoVigente -- deliberadamente NO ejecutado/vigente (ver arriba)
     saldo                = presupuestoVigente - pagado               (regla 16, definicion default sugerida, adoptada)
     ETC (forecast restante) = cantidadPendiente x P.U.               (estandar EVM: resto del trabajo a precio de presupuesto, nunca se inventa un precio distinto sin datos)
     EAC (costo estimado al cierre) = ejecutado + ETC                 (estandar EVM AC + (BAC-EV) cuando no hay suficiente historial para un indice de desempeño confiable -- "no inventar proyecciones sin datos", regla 8)
     variacion$          = EAC - presupuestoVigente
     comprometidoPendiente (a nivel proyecto) = max(0, comprometidoTotal - pagadoTotal) */
import { normalizeCapitulo, capituloLabel } from './presupuestoCapitulos.js';
import { sumProgressDeltas } from './progressEntrySchema.js';
import { CHANGE_ORDER_STATUS } from './changeOrderSchema.js';
import { COMMITMENT_STATUS } from './commitmentSchema.js';
import { ESTIMATE_STATUS } from './estimateSchema.js';

function toNumber(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

/* Reparte cada pago entre los conceptos de SU estimacion (si la tiene),
   proporcional al importe de cada renglon dentro del importeBruto total de
   esa estimacion -- nunca inventa a que concepto pertenece un pago sin
   estimacionId (esos quedan fuera del mapa, solo cuentan a nivel proyecto). */
function allocatePayments(payments, estimatesById){
  const byConcepto = new Map(); // conceptoId -> monto asignado
  let unassigned = 0;
  (payments || []).forEach(p => {
    const monto = toNumber(p?.monto);
    const estimate = p?.estimacionId ? estimatesById.get(p.estimacionId) : null;
    if(!estimate || !Array.isArray(estimate.conceptos) || !estimate.importeBruto){
      unassigned += monto;
      return;
    }
    estimate.conceptos.forEach(line => {
      const lineImporte = toNumber(line?.cantidadPeriodo) * toNumber(line?.pu);
      const share = estimate.importeBruto > 0 ? lineImporte / estimate.importeBruto : 0;
      const allocated = monto * share;
      if(!line?.conceptoId) { unassigned += allocated; return; }
      byConcepto.set(line.conceptoId, (byConcepto.get(line.conceptoId) || 0) + allocated);
    });
  });
  return { byConcepto, unassigned };
}

/* Suma, por concepto, el importe CERTIFICADO (avance financiero) de todas
   las estimaciones AUTORIZADA que lo referencian -- una estimacion en
   BORRADOR nunca cuenta (no es oficial todavia, "no fabricar" datos). */
function sumAuthorizedEstimateByConcepto(estimates){
  const byConcepto = new Map();
  (estimates || [])
    .filter(e => e?.status === ESTIMATE_STATUS.AUTORIZADA)
    .forEach(e => (e.conceptos || []).forEach(line => {
      if(!line?.conceptoId) return;
      const importe = toNumber(line?.cantidadPeriodo) * toNumber(line?.pu);
      byConcepto.set(line.conceptoId, (byConcepto.get(line.conceptoId) || 0) + importe);
    }));
  return byConcepto;
}

export function aggregateControlPresupuestal({
  presupuestoRows = [], changeOrders = [], commitments = [], progressEntries = [], estimates = [], payments = []
} = {}){
  const approvedChangeOrders = changeOrders.filter(c => c?.status === CHANGE_ORDER_STATUS.APROBADA);
  const activeCommitments = commitments.filter(c => c?.status === COMMITMENT_STATUS.ACTIVO);
  const estimatesById = new Map((estimates || []).map(e => [e.id, e]));
  const estimadoByConcepto = sumAuthorizedEstimateByConcepto(estimates);
  const { byConcepto: pagadoByConcepto, unassigned: pagadoSinEstimacion } = allocatePayments(payments, estimatesById);

  const rows = presupuestoRows.map(row => {
    const conceptoId = row.conceptoId;
    const pu = toNumber(row.pu);
    const direct = toNumber(row.direct);
    const qtyBase = toNumber(row.qty);
    const presupuestoBase = qtyBase * pu;

    const conceptoChangeOrders = approvedChangeOrders.filter(c => c.conceptoId === conceptoId);
    const cambiosAprobados = conceptoChangeOrders.reduce((s, c) => s + toNumber(c.impactoEconomico), 0);
    const cantidadVigente = qtyBase + conceptoChangeOrders.reduce((s, c) => s + (toNumber(c.cantidadNueva) - toNumber(c.cantidadAnterior)), 0);
    const presupuestoVigente = presupuestoBase + cambiosAprobados;

    const comprometido = activeCommitments.filter(c => c.conceptoId === conceptoId).reduce((s, c) => s + toNumber(c.monto), 0);

    const cantidadEjecutada = sumProgressDeltas(progressEntries, conceptoId);
    const ejecutado = cantidadEjecutada * pu;
    const cantidadPendiente = Math.max(0, cantidadVigente - cantidadEjecutada);
    const etc = cantidadPendiente * pu;
    const eac = ejecutado + etc;

    const estimado = estimadoByConcepto.get(conceptoId) || 0;
    const pagado = pagadoByConcepto.get(conceptoId) || 0;
    const saldo = presupuestoVigente - pagado;

    const avanceFisicoPct = cantidadVigente > 0 ? (cantidadEjecutada / cantidadVigente) * 100 : null;
    const avanceFinancieroPct = presupuestoVigente > 0 ? (estimado / presupuestoVigente) * 100 : null;
    const desviacionFisicoFinanciero = (avanceFisicoPct != null && avanceFinancieroPct != null) ? avanceFisicoPct - avanceFinancieroPct : null;

    const variacion = eac - presupuestoVigente;
    const variacionPct = presupuestoVigente > 0 ? (variacion / presupuestoVigente) * 100 : null;

    return {
      conceptoId, clave: row.clave, capitulo: normalizeCapitulo(row.capitulo), capituloLabel: capituloLabel(row.capitulo),
      concept: row.concept, unit: row.unit,
      qtyBase, cantidadVigente, cantidadEjecutada, cantidadPendiente, pu, direct,
      presupuestoBase, cambiosAprobados, presupuestoVigente,
      comprometido, ejecutado, estimado, pagado, saldo,
      etc, eac, variacion, variacionPct,
      avanceFisicoPct, avanceFinancieroPct, desviacionFisicoFinanciero,
      changeOrdersCount: conceptoChangeOrders.length
    };
  });

  const sum = (key) => rows.reduce((s, r) => s + (r[key] || 0), 0);
  const baseline = sum('presupuestoBase');
  const cambiosAprobadosTotal = sum('cambiosAprobados');
  const vigente = sum('presupuestoVigente');
  const comprometidoTotal = sum('comprometido');
  const ejecutadoTotal = sum('ejecutado');
  const estimadoTotal = sum('estimado');
  const pagadoTotal = sum('pagado') + pagadoSinEstimacion;
  const saldoTotal = vigente - pagadoTotal;
  const etcTotal = sum('etc');
  const eacTotal = ejecutadoTotal + etcTotal;
  const variacionTotal = eacTotal - vigente;
  const variacionPctTotal = vigente > 0 ? (variacionTotal / vigente) * 100 : null;
  const comprometidoPendiente = Math.max(0, comprometidoTotal - pagadoTotal);
  const avanceFisicoProyecto = vigente > 0 ? (rows.reduce((s, r) => s + r.cantidadEjecutada * r.pu, 0) / vigente) * 100 : null;
  const avanceFinancieroProyecto = vigente > 0 ? (estimadoTotal / vigente) * 100 : null;

  return {
    rows,
    totals: {
      baseline, cambiosAprobados: cambiosAprobadosTotal, vigente,
      comprometido: comprometidoTotal, comprometidoPendiente,
      ejecutado: ejecutadoTotal, estimado: estimadoTotal, pagado: pagadoTotal, saldo: saldoTotal,
      etc: etcTotal, eac: eacTotal, variacion: variacionTotal, variacionPct: variacionPctTotal,
      avanceFisicoPct: avanceFisicoProyecto, avanceFinancieroPct: avanceFinancieroProyecto,
      pagadoSinEstimacion
    }
  };
}
