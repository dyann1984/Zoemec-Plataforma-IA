/* Calculo de duracion de una actividad (Fase 3). Puro.

   REGLA BASE (regla 3 del encargo): duracion = cantidad / rendimiento.
   Nunca produce NaN ni Infinity: cuando el rendimiento es 0/null/invalido,
   retorna un resultado explicito `{ days: null, reason: 'RENDIMIENTO_REQUERIDO' }`
   -- se muestra al usuario "Rendimiento requerido" en vez de inventar. */
import { ACTIVITY_ORIGIN } from './activitySchema.js';

export const DURATION_ISSUE = Object.freeze({
  RENDIMIENTO_REQUERIDO: 'RENDIMIENTO_REQUERIDO',
  CANTIDAD_REQUERIDA: 'CANTIDAD_REQUERIDA',
  CANTIDAD_CERO: 'CANTIDAD_CERO'
});

function toNumberOrNull(v){
  if(v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* Duracion en dias laborables. `cuadrilla` NO multiplica el rendimiento
   (el rendimiento del APU YA es de la cuadrilla completa -- ver
   crewModel.js: "rendimiento = 1/cantidadPorUnidad para cuadrilla de 1"
   pero para plantillas reales calibradas, el rendimiento REPRESENTA a la
   cuadrilla ya definida). Se acepta un `crewMultiplier` opcional para el
   caso en que el usuario asigne el DOBLE de cuadrilla (2 turnos, ej.):
   duracion se divide por el multiplicador. Nunca menor a 1. */
export function computeDurationDays({ cantidad, rendimiento, crewMultiplier = 1 }){
  const c = toNumberOrNull(cantidad);
  const r = toNumberOrNull(rendimiento);
  const m = Math.max(1, Number(crewMultiplier) || 1);
  if(r == null || r <= 0){
    return { days: null, reason: DURATION_ISSUE.RENDIMIENTO_REQUERIDO };
  }
  if(c == null){
    return { days: null, reason: DURATION_ISSUE.CANTIDAD_REQUERIDA };
  }
  if(c === 0){
    // Cero cantidad -> duracion 0 (actividad marcada, sin trabajo real
    // por hacer). Se distingue de "cantidad requerida" con una razon
    // informativa para que la UI decida como presentarlo (ej. gris).
    return { days: 0, reason: DURATION_ISSUE.CANTIDAD_CERO };
  }
  const days = c / (r * m);
  return { days, reason: null };
}

/* Extrae el rendimiento propuesto desde un APU. Prioridad:
     1. laborDetails (v1/v2) primer renglon con rendimiento > 0 -- ese es
        el rendimiento de la cuadrilla principal, la que decide el ritmo
        (ver deriveCrewFromLaborRows en crewModel.js).
     2. labor v2: primer renglon-objeto con rendimiento explicito.
     3. Fallback null si ninguno tiene el dato. NUNCA se inventa un valor
        (regla 4 del encargo).
   Regresa { rendimiento, cuadrilla, fuente } -- fuente es una etiqueta
   ('APU' cuando viene del APU; el llamador puede sobreescribirla si el
   dato de origen es distinto, por ejemplo historico). */
export function extractApuRendimiento(apu){
  if(!apu || typeof apu !== 'object') return { rendimiento: null, cuadrilla: 1, fuente: null };
  const details = Array.isArray(apu.laborDetails) ? apu.laborDetails : [];
  const firstDetail = details.find(d => Number(d?.rendimiento) > 0);
  if(firstDetail){
    return {
      rendimiento: Number(firstDetail.rendimiento),
      cuadrilla: Number(firstDetail.cuadrilla) || 1,
      fuente: 'APU'
    };
  }
  const v2Labor = Array.isArray(apu.labor) ? apu.labor : [];
  const firstV2 = v2Labor.find(row => row && typeof row === 'object' && Number(row.rendimiento) > 0);
  if(firstV2){
    return {
      rendimiento: Number(firstV2.rendimiento),
      cuadrilla: Number(firstV2.cuadrilla) || 1,
      fuente: 'APU'
    };
  }
  return { rendimiento: null, cuadrilla: 1, fuente: null };
}

/* Decide si aplicar automaticamente el rendimiento propuesto del APU sobre
   una actividad. Reglas:
   - Actividad recien creada desde CATALOG y sin rendimiento propio -> SI
     se aplica automaticamente.
   - Actividad con rendimiento ya establecido (por usuario o por otro APU
     anterior) -> NO se sobreescribe (regla 4 del encargo). Solo se sugiere.
   Retorna { shouldApply, reason }. */
export function shouldAdoptApuRendimiento(activity, proposal){
  if(!activity || !proposal || proposal.rendimiento == null) return { shouldApply: false, reason: 'NO_PROPOSAL' };
  if(activity.rendimiento == null || activity.rendimiento <= 0){
    return { shouldApply: true, reason: 'EMPTY_TARGET' };
  }
  if(activity.rendimientoFuente === 'MANUAL'){
    return { shouldApply: false, reason: 'USER_OVERRIDE' };
  }
  if(activity.origen === ACTIVITY_ORIGIN.MANUAL){
    return { shouldApply: false, reason: 'MANUAL_ORIGIN' };
  }
  return { shouldApply: false, reason: 'ALREADY_SET' };
}
