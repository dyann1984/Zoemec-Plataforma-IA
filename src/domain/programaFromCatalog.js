/* Generacion de actividades desde catalogo/presupuesto (Fase 3, regla 6).
   Puro. Reutiliza extractApuRendimiento -- no reimplementa lectura del APU.

   Reglas:
   - Por cada renglon del presupuesto/catalogo se crea UNA actividad.
   - Dedupe: no crear otra actividad si ya existe una con el mismo
     conceptoId (regla 6 del encargo: "no crear actividades duplicadas
     para el mismo concepto sin control").
   - Si ya existe actividad para ese conceptoId, se puede pedir "actualizar
     rendimiento desde APU" -- eso lo decide el llamador con
     shouldAdoptApuRendimiento (activityDuration.js), este modulo no
     sobreescribe silenciosamente.
   - Actividad hereda origenElementoId del renglon si viene del CAD
     (regla 12 del encargo -- puente con Fase 1). */
import { makeEmptyActivity, ACTIVITY_ORIGIN, ACTIVITY_STATUS } from './activitySchema.js';
import { extractApuRendimiento } from './activityDuration.js';

function normalizeName(row){
  const clave = row?.clave || '';
  const concept = row?.concept || row?.description || '';
  return [clave, concept].filter(Boolean).join(' - ');
}

/* Recibe:
     rows: renglones del presupuesto (con conceptoId, apuId, unit, qty, pu, clave, concept, capitulo, origenElementoId)
     existingActivities: actividades ya guardadas del proyecto (para dedupe)
     apusById: Map(apuId -> apu completo) para extraer rendimiento
     projectId
   Devuelve { created: [...actividadesNuevas], skipped: [...conceptoIds] }. */
export function generateActivitiesFromCatalog({ rows = [], existingActivities = [], apusById = new Map(), projectId, presupuestoId = null }){
  const existingConceptIds = new Set((existingActivities || []).map(a => String(a?.conceptoId || '')));
  const created = [];
  const skipped = [];

  (rows || []).forEach(row => {
    if(!row?.conceptoId){ return; }
    if(existingConceptIds.has(String(row.conceptoId))){
      skipped.push(row.conceptoId);
      return;
    }
    const apu = apusById.get?.(row.apuId) || null;
    const rendProposal = extractApuRendimiento(apu);
    const activity = makeEmptyActivity({
      projectId, conceptoId: row.conceptoId, apuId: row.apuId || null, presupuestoId,
      chapterId: row.capitulo || null,
      name: normalizeName(row),
      unit: row.unit || '',
      cantidad: Number(row.qty) || 0,
      rendimiento: rendProposal.rendimiento,
      cuadrilla: rendProposal.cuadrilla || 1,
      origen: ACTIVITY_ORIGIN.CATALOG,
      origenElementoId: row.origenElementoId || null,
      rendimientoFuente: rendProposal.rendimiento != null ? rendProposal.fuente : null,
      status: ACTIVITY_STATUS.PLANIFICADA
    });
    activity.cantidadVigenteSnapshot = activity.cantidad;
    created.push(activity);
    existingConceptIds.add(String(row.conceptoId));
  });

  return { created, skipped };
}

/* Detecta divergencia entre la cantidad vigente de un concepto (incluyendo
   OCs aprobadas) y la cantidad snapshot que la actividad tenia registrada.
   Regla 20 del encargo: nunca sobreescribir silenciosamente si el usuario
   edito la duracion manualmente -- solo se propone el ajuste. */
import { computeDurationDays } from './activityDuration.js';
import { CHANGE_ORDER_STATUS } from './changeOrderSchema.js';

export function detectVigentDivergence({ activity, changeOrders = [] }){
  if(!activity) return null;
  const base = Number(activity.cantidad) || 0;
  const approvedDelta = (changeOrders || [])
    .filter(c => c?.status === CHANGE_ORDER_STATUS.APROBADA && String(c?.conceptoId || '') === String(activity.conceptoId || ''))
    .reduce((sum, c) => sum + ((Number(c.cantidadNueva) || 0) - (Number(c.cantidadAnterior) || 0)), 0);
  const cantidadVigente = base + approvedDelta;
  if(cantidadVigente === (activity.cantidadVigenteSnapshot ?? base)) return null;
  const nuevaDuracion = computeDurationDays({ cantidad: cantidadVigente, rendimiento: activity.rendimiento });
  return {
    cantidadAnterior: activity.cantidadVigenteSnapshot ?? base,
    cantidadVigente,
    delta: cantidadVigente - (activity.cantidadVigenteSnapshot ?? base),
    duracionActual: activity.duracion,
    duracionSugerida: nuevaDuracion.days,
    duracionSugeridaReason: nuevaDuracion.reason,
    puedeAutoActualizar: !activity.duracionEditadaManual
  };
}

/* Aplica el ajuste sugerido de detectVigentDivergence. NUNCA se llama solo
   sin confirmacion del usuario -- la decision se toma en UI, este helper
   ejecuta el cambio determinista. */
export function applyVigentDivergence(activity, divergence){
  if(!activity || !divergence) return activity;
  return {
    ...activity,
    cantidad: divergence.cantidadVigente,
    cantidadVigenteSnapshot: divergence.cantidadVigente,
    duracion: divergence.duracionSugerida ?? activity.duracion,
    updatedAt: new Date().toISOString()
  };
}
