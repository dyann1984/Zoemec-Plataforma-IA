/* Comparativo Baseline vs Actual (Fase F, seccion 12 del pedido). Pura
   interpretacion de datos YA calculados por Fase D (presupuestoVersioning)
   y Fase E (controlPresupuestalAggregation) -- nunca vuelve a sumar nada.
   Plazo: el proyecto no tiene hoy fecha de inicio/objetivo capturada en
   ningun lado (auditado antes de esta fase) -- el UNICO dato real de plazo
   disponible es el impacto en dias acumulado de las ordenes de cambio
   APROBADA, asi que eso es lo unico que se reporta; nunca se inventa una
   fecha de inicio/fin. */
function toNumber(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

export function compareBaselineVsActual({ presupuesto = null, controlPresupuestalTotals = null, controlPresupuestalRows = [], changeOrders = [] } = {}){
  const presupuestoBase = controlPresupuestalTotals?.baseline ?? null;
  const presupuestoVigente = controlPresupuestalTotals?.vigente ?? null;
  const variacion = (presupuestoBase != null && presupuestoVigente != null) ? presupuestoVigente - presupuestoBase : null;
  const variacionPct = (variacion != null && presupuestoBase > 0) ? (variacion / presupuestoBase) * 100 : null;

  const approved = (changeOrders || []).filter(c => c?.status === 'APROBADA');
  const impactoTiempoDiasTotal = approved.length ? approved.reduce((s, c) => s + toNumber(c.impactoTiempoDias), 0) : null;

  const cantidadesModificadas = approved.map(c => {
    const row = (controlPresupuestalRows || []).find(r => r.conceptoId === c.conceptoId);
    return {
      conceptoId: c.conceptoId, clave: c.clave || row?.clave || null, concept: c.concept || row?.concept || null,
      cantidadAnterior: c.cantidadAnterior, cantidadNueva: c.cantidadNueva, folio: c.folio || null
    };
  });

  return {
    baselineVersion: presupuesto?.baselineVersion ?? null,
    currentVersion: presupuesto?.currentVersion ?? null,
    presupuestoBase, presupuestoVigente, variacion, variacionPct,
    plazo: { impactoTiempoDiasTotal, ordenesConImpacto: approved.filter(c => toNumber(c.impactoTiempoDias) !== 0).length },
    cantidadesModificadas
  };
}
