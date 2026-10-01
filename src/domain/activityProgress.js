/* Avance fisico/financiero por actividad y forecast (Fase 3, reglas 11-19).
   Puro. Reutiliza progressEntrySchema.sumProgressDeltas -- NUNCA
   reimplementa el ledger de avance ni el prorrateo (eso vive en
   controlPresupuestalAggregation.js).

   Convenciones:
   - Los avances se guardan por conceptoId (fuente ledger real). La
     actividad tambien lleva conceptoId, asi que enlazar es directo.
   - Una actividad SIN cantidad o SIN progressEntries reporta avance 0.
   - Rendimiento real: se calcula solo si hay >= 1 dia laborable
     transcurrido; menos que eso da null (no simular "aun sin datos").
   - Proyeccion de fin: solo si rendimientoReal > 0 y hay cantidad
     pendiente; nunca inventa fecha (regla 19: distinguir planificada vs
     proyectada). */
import { sumProgressDeltas } from './progressEntrySchema.js';
import { addWorkingDays, workingDaysBetween } from './workingCalendar.js';
import { elapsedWorkingDays } from './activityScheduling.js';

function toNumber(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

/* Avance de UNA actividad. Devuelve {
     cantidadEjecutada, cantidadPendiente, avanceFisicoPct,
     rendimientoReal, rendimientoPlan, rendimientoDesviacionPct,
     fechaFinProyectada, diasRestantesEstimados,
     atrasoDias, riesgoAtraso
   }. */
export function computeActivityProgress({ activity, progressEntries = [], calendar, asOf = null }){
  const cantidad = toNumber(activity?.cantidad);
  const cantidadEjecutada = Math.max(0, sumProgressDeltas(progressEntries, activity?.conceptoId));
  const cantidadPendiente = Math.max(0, cantidad - cantidadEjecutada);
  const avanceFisicoPct = cantidad > 0 ? (cantidadEjecutada / cantidad) * 100 : 0;

  const rendimientoPlan = toNumber(activity?.rendimiento);
  const diasHabTranscurridos = calendar && activity?.fechaInicio
    ? elapsedWorkingDays(calendar, activity.fechaInicio, asOf)
    : 0;

  let rendimientoReal = null;
  if(cantidadEjecutada > 0 && diasHabTranscurridos > 0){
    rendimientoReal = cantidadEjecutada / diasHabTranscurridos;
  }
  const rendimientoDesviacionPct = (rendimientoReal != null && rendimientoPlan > 0)
    ? ((rendimientoReal - rendimientoPlan) / rendimientoPlan) * 100
    : null;

  // Proyeccion (regla 19): fecha fin proyectada solo si hay rendimiento
  // real y cantidad pendiente. Nunca se inventa un valor.
  let fechaFinProyectada = null, diasRestantesEstimados = null;
  if(rendimientoReal != null && rendimientoReal > 0 && cantidadPendiente > 0 && calendar){
    diasRestantesEstimados = cantidadPendiente / rendimientoReal;
    const fromDate = asOf || new Date().toISOString().slice(0, 10);
    fechaFinProyectada = addWorkingDays(calendar, fromDate, diasRestantesEstimados);
  } else if(rendimientoReal != null && rendimientoReal > 0 && cantidadPendiente === 0){
    // Ya terminada -- fecha proyectada = ultimo avance -> hoy (asOf)
    diasRestantesEstimados = 0;
    fechaFinProyectada = asOf || new Date().toISOString().slice(0, 10);
  }

  const atrasoDias = (activity?.fechaFin && fechaFinProyectada && fechaFinProyectada > activity.fechaFin && calendar)
    ? workingDaysBetween(calendar, activity.fechaFin, fechaFinProyectada) - 1
    : 0;
  const riesgoAtraso = atrasoDias > 0;

  return {
    cantidad,
    cantidadEjecutada,
    cantidadPendiente,
    avanceFisicoPct,
    diasHabTranscurridos,
    rendimientoPlan: rendimientoPlan || null,
    rendimientoReal,
    rendimientoDesviacionPct,
    fechaFinProyectada,
    diasRestantesEstimados,
    atrasoDias,
    riesgoAtraso
  };
}

/* Avance fisico PONDERADO por importe presupuestado (regla 13, "no promedio
   simple sin ponderacion"). Mismo criterio que
   controlPresupuestalAggregation.avanceFisicoProyecto. */
export function computeWeightedPhysicalProgress(activities, progressEntries, presupuestoRowsByConcepto){
  let sumPeso = 0;
  let sumAvancePeso = 0;
  (activities || []).forEach(a => {
    const row = presupuestoRowsByConcepto?.get?.(a.conceptoId);
    const pu = row ? toNumber(row.pu) : 0;
    const cantidad = toNumber(a.cantidad);
    const importe = cantidad * pu;
    if(importe <= 0) return;
    const cantidadEjecutada = sumProgressDeltas(progressEntries, a.conceptoId);
    const avance = cantidad > 0 ? cantidadEjecutada / cantidad : 0;
    sumPeso += importe;
    sumAvancePeso += importe * avance;
  });
  return sumPeso > 0 ? (sumAvancePeso / sumPeso) * 100 : 0;
}

/* Costo real ejecutado de una actividad = suma (delta * pu) de sus
   progressEntries (pu ya congelado en cada entry, ver
   progressEntrySchema). No duplica prorrateo de pagos --
   controlPresupuestalAggregation ya lo hace, aqui es solo el bloque
   "ejecutado" por actividad. */
export function computeActivityExecutedCost(activity, progressEntries){
  return (progressEntries || [])
    .filter(e => e?.conceptoId === activity?.conceptoId)
    .reduce((sum, e) => sum + toNumber(e.delta) * toNumber(e.pu), 0);
}
