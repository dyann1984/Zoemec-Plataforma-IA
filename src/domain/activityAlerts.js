/* Alertas deterministas del programa de obra (Fase 3, regla 16). Puro,
   sin IA. Un motor de reglas simples que produce un arreglo de alertas
   con {code, severity, activityId, message, context}.

   REGLAS DE NEGOCIO -- todas verificables con datos ya calculados por
   activityProgress.computeActivityProgress:
     ACTIVIDAD_ATRASADA          -- fechaFinProyectada > fechaFin (atrasoDias > 0)
     RENDIMIENTO_BAJO            -- rendimientoDesviacionPct <= -15
     AVANCE_MENOR_A_PROGRAMADO   -- avance real < avance programado esperado a la fecha
     COSTO_MAYOR_A_ESPERADO      -- costoEjecutado > costoPresupuestado * (avanceFisico/100 + tolerancia)
     ACTIVIDAD_SIN_RENDIMIENTO   -- rendimiento null y actividad no CANCELADA
     ACTIVIDAD_SIN_RESPONSABLE   -- responsable null y status planificada+
     ACTIVIDAD_SIN_FECHA         -- fechaInicio o fechaFin null en actividad no BORRADOR
   El orden se preserva por severity y luego por activityId, para que la
   UI muestre CRITICAS arriba sin ordenar por su cuenta. */
import { ACTIVITY_STATUS } from './activitySchema.js';

export const ALERT_CODE = Object.freeze({
  ACTIVIDAD_ATRASADA: 'ACTIVIDAD_ATRASADA',
  RENDIMIENTO_BAJO: 'RENDIMIENTO_BAJO',
  AVANCE_MENOR_A_PROGRAMADO: 'AVANCE_MENOR_A_PROGRAMADO',
  COSTO_MAYOR_A_ESPERADO: 'COSTO_MAYOR_A_ESPERADO',
  ACTIVIDAD_SIN_RENDIMIENTO: 'ACTIVIDAD_SIN_RENDIMIENTO',
  ACTIVIDAD_SIN_RESPONSABLE: 'ACTIVIDAD_SIN_RESPONSABLE',
  ACTIVIDAD_SIN_FECHA: 'ACTIVIDAD_SIN_FECHA'
});

export const ALERT_SEVERITY = Object.freeze({
  CRITICA: 'CRITICA', ALTA: 'ALTA', MEDIA: 'MEDIA', BAJA: 'BAJA', INFO: 'INFO'
});

const SEVERITY_RANK = { CRITICA: 5, ALTA: 4, MEDIA: 3, BAJA: 2, INFO: 1 };

const RENDIMIENTO_UMBRAL_BAJO_PCT = -15;
const COSTO_TOLERANCIA_PCT = 0.05; // 5% de tolerancia respecto al avance

function toNumber(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

/* Avance PROGRAMADO esperado a la fecha: dias transcurridos / duracion total.
   Nunca > 100 %. Devuelve null si no hay duracion o fechas. */
function expectedProgressPct(activity, diasHabTranscurridos){
  if(!activity?.duracion || activity.duracion <= 0) return null;
  const days = Math.max(0, Number(diasHabTranscurridos) || 0);
  return Math.min(100, (days / activity.duracion) * 100);
}

export function computeActivityAlerts({ activity, progress, costBreakdown = null } = {}){
  const alerts = [];
  const push = (code, severity, message, context = {}) => alerts.push({ code, severity, activityId: activity?.id, message, context });

  if(!activity) return alerts;
  const status = activity.status;

  if(status === ACTIVITY_STATUS.CANCELADA) return alerts; // canceladas nunca alertan

  if(activity.rendimiento == null){
    push(ALERT_CODE.ACTIVIDAD_SIN_RENDIMIENTO, ALERT_SEVERITY.ALTA,
      `${activity.name || activity.id}: sin rendimiento -- no se puede calcular duracion.`);
  }
  if(!activity.responsable && (status === ACTIVITY_STATUS.PLANIFICADA || status === ACTIVITY_STATUS.EN_PROCESO)){
    push(ALERT_CODE.ACTIVIDAD_SIN_RESPONSABLE, ALERT_SEVERITY.MEDIA,
      `${activity.name || activity.id}: sin responsable asignado.`);
  }
  if((!activity.fechaInicio || !activity.fechaFin) && status !== ACTIVITY_STATUS.BORRADOR){
    push(ALERT_CODE.ACTIVIDAD_SIN_FECHA, ALERT_SEVERITY.ALTA,
      `${activity.name || activity.id}: falta fecha inicio o fin.`);
  }
  if(progress?.riesgoAtraso){
    const dias = progress.atrasoDias;
    push(ALERT_CODE.ACTIVIDAD_ATRASADA, dias >= 5 ? ALERT_SEVERITY.CRITICA : ALERT_SEVERITY.ALTA,
      `${activity.name || activity.id}: atraso proyectado de ${dias} dia${dias === 1 ? '' : 's'}.`,
      { atrasoDias: dias, fechaFinProyectada: progress.fechaFinProyectada });
  }
  if(progress?.rendimientoDesviacionPct != null && progress.rendimientoDesviacionPct <= RENDIMIENTO_UMBRAL_BAJO_PCT){
    push(ALERT_CODE.RENDIMIENTO_BAJO, ALERT_SEVERITY.ALTA,
      `${activity.name || activity.id}: rendimiento real ${progress.rendimientoDesviacionPct.toFixed(1)}% del plan.`,
      { plan: progress.rendimientoPlan, real: progress.rendimientoReal });
  }
  const expected = expectedProgressPct(activity, progress?.diasHabTranscurridos);
  if(expected != null && progress?.avanceFisicoPct != null && progress.avanceFisicoPct + 5 < expected){
    push(ALERT_CODE.AVANCE_MENOR_A_PROGRAMADO, ALERT_SEVERITY.MEDIA,
      `${activity.name || activity.id}: avance real ${progress.avanceFisicoPct.toFixed(1)}% vs programado ${expected.toFixed(1)}%.`,
      { real: progress.avanceFisicoPct, programado: expected });
  }
  if(costBreakdown && Number(costBreakdown.presupuestado) > 0){
    const avanceFactor = (Number(progress?.avanceFisicoPct) || 0) / 100;
    const esperado = Number(costBreakdown.presupuestado) * (avanceFactor + COSTO_TOLERANCIA_PCT);
    if(Number(costBreakdown.ejecutado) > esperado){
      push(ALERT_CODE.COSTO_MAYOR_A_ESPERADO, ALERT_SEVERITY.ALTA,
        `${activity.name || activity.id}: costo ejecutado mayor al esperado por avance actual.`,
        { ejecutado: costBreakdown.ejecutado, esperado });
    }
  }

  return alerts;
}

/* Alertas de TODAS las actividades, ordenadas por severity descendente y
   luego por activityId. */
export function computeAllAlerts({ activities = [], progressByActivityId = new Map(), costByActivityId = new Map() } = {}){
  const alerts = [];
  activities.forEach(a => {
    alerts.push(...computeActivityAlerts({
      activity: a,
      progress: progressByActivityId.get?.(a.id) || null,
      costBreakdown: costByActivityId.get?.(a.id) || null
    }));
  });
  alerts.sort((x, y) => (SEVERITY_RANK[y.severity] || 0) - (SEVERITY_RANK[x.severity] || 0) || String(x.activityId).localeCompare(String(y.activityId)));
  return alerts;
}
