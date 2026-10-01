/* Programacion de actividades con dependencias Finish-to-Start (Fase 3,
   regla 8). Puro.

   NO es un motor CPM: no calcula holguras, ruta critica, adelanto/retraso
   ni float total -- solo propaga fechas de fin y arranque cuando una
   actividad tiene predecesoras FS y le falta fecha inicio explicita, o
   cuando su fecha manual es INCONSISTENTE con la predecesora
   (predecessorEnd + lag > fechaInicio).

   Reglas de negocio:
   1. Cada actividad con predecesoras FS arranca al SIGUIENTE dia laborable
      despues del MAXIMO fechaFin(predecesor) + lag.
   2. Si el usuario fijo `fechaInicio` manualmente Y NO tiene predecesoras
      o la predecesora ya termino antes, se respeta.
   3. `duracion` de la actividad se combina con el calendario laboral para
      obtener `fechaFin` (addWorkingDays -- fecha fin inclusive).
   4. Ciclos en dependencias se DETECTAN y se reportan (no se ordenan): la
      programacion no propaga por debajo de una arista ciclica, esa
      actividad queda con la fecha manual (o sin fecha) y se registra
      `issues[]` -- nunca stack overflow, nunca ciclo infinito. */
import { addWorkingDays, nextWorkingDay, workingDaysBetween } from './workingCalendar.js';
import { computeDurationDays } from './activityDuration.js';

export const SCHEDULE_ISSUE = Object.freeze({
  CYCLE: 'CYCLE',
  MISSING_PREDECESSOR: 'MISSING_PREDECESSOR',
  MISSING_START: 'MISSING_START',
  INCONSISTENT_START: 'INCONSISTENT_START',
  DURATION_UNKNOWN: 'DURATION_UNKNOWN'
});

/* Orden topologico (Kahn) sobre las dependencias FS. Detecta ciclos:
   devuelve { order: [...activityIds], cycles: [...activityIds involved] }. */
export function topologicalOrder(activities){
  const list = Array.isArray(activities) ? activities : [];
  const ids = new Set(list.map(a => a.id));
  // dependencyMap: activityId -> Set(predecessorIds validos)
  const preds = new Map();
  list.forEach(a => {
    const set = new Set();
    (a.predecessoras || []).forEach(p => { if(p?.activityId && ids.has(p.activityId)) set.add(p.activityId); });
    preds.set(a.id, set);
  });
  // succ: predecessorId -> [activityId, activityId, ...]
  const succ = new Map();
  preds.forEach((set, id) => set.forEach(pid => {
    if(!succ.has(pid)) succ.set(pid, []);
    succ.get(pid).push(id);
  }));
  const inDegree = new Map();
  list.forEach(a => inDegree.set(a.id, preds.get(a.id).size));
  const queue = list.filter(a => inDegree.get(a.id) === 0).map(a => a.id);
  const order = [];
  while(queue.length){
    const id = queue.shift();
    order.push(id);
    (succ.get(id) || []).forEach(sid => {
      inDegree.set(sid, inDegree.get(sid) - 1);
      if(inDegree.get(sid) === 0) queue.push(sid);
    });
  }
  const cycles = list.filter(a => !order.includes(a.id)).map(a => a.id);
  return { order, cycles };
}

/* Programa TODAS las actividades. Recibe calendario + fecha inicio proyecto
   + actividades. Devuelve arreglo NUEVO (nunca muta) con fechaInicio/
   fechaFin/duracion recalculadas cuando aplique, mas `issues` por actividad.

   Regla: nunca sobreescribe una fecha manual valida sin motivo. Solo
   sobreescribe fechaInicio si:
     - la actividad tiene predecesoras FS y la actual es inconsistente
       (start < predEnd+lag)
     - o si la fecha esta ausente y hay predecesoras. */
export function scheduleActivities({ calendar, projectStartDate = null, activities = [] }){
  const { order, cycles } = topologicalOrder(activities);
  const cycleSet = new Set(cycles);
  const byId = new Map(activities.map(a => [a.id, { ...a }]));
  const issues = new Map();
  const addIssue = (id, code, message) => {
    if(!issues.has(id)) issues.set(id, []);
    issues.get(id).push({ code, message });
  };
  cycleSet.forEach(id => addIssue(id, SCHEDULE_ISSUE.CYCLE, 'Dependencia ciclica -- no se recalculan fechas por dependencia.'));

  const resolveStart = (activity) => {
    const preds = (activity.predecessoras || []).filter(p => p?.activityId && byId.has(p.activityId) && !cycleSet.has(p.activityId));
    if(!preds.length){
      const start = activity.fechaInicio || projectStartDate;
      if(!start) addIssue(activity.id, SCHEDULE_ISSUE.MISSING_START, 'Sin fecha de inicio -- define fecha inicio de proyecto o de la actividad.');
      return start ? addWorkingDays(calendar, start, 0) : null;
    }
    // Todas terminadas: se arranca al SIGUIENTE laborable de la mas tarde.
    let latestEnd = null;
    for(const p of preds){
      const pred = byId.get(p.activityId);
      const pEnd = pred?.fechaFin;
      if(!pEnd){ addIssue(activity.id, SCHEDULE_ISSUE.MISSING_PREDECESSOR, `Predecesora ${p.activityId} no tiene fechaFin.`); continue; }
      const withLag = addWorkingDays(calendar, pEnd, Math.max(0, (Number(p.lag) || 0)));
      const startCandidate = nextWorkingDay(calendar, withLag);
      if(!latestEnd || startCandidate > latestEnd) latestEnd = startCandidate;
    }
    if(!latestEnd){
      const start = activity.fechaInicio || projectStartDate;
      return start ? addWorkingDays(calendar, start, 0) : null;
    }
    // Comparacion contra fecha manual si existe
    if(activity.fechaInicio && activity.fechaInicio < latestEnd){
      addIssue(activity.id, SCHEDULE_ISSUE.INCONSISTENT_START,
        `fechaInicio manual (${activity.fechaInicio}) es anterior al fin de sus predecesoras (${latestEnd}). Se ajusta.`);
    }
    return latestEnd;
  };

  for(const id of order){
    const activity = byId.get(id);
    const start = resolveStart(activity);
    let duracion = activity.duracion;
    if(duracion == null){
      const derived = computeDurationDays({ cantidad: activity.cantidad, rendimiento: activity.rendimiento });
      if(derived.days == null){
        addIssue(id, SCHEDULE_ISSUE.DURATION_UNKNOWN, 'Sin rendimiento -- no se puede calcular duracion.');
        activity.fechaInicio = start;
        activity.fechaFin = null;
        continue;
      }
      duracion = derived.days;
    }
    if(!start){ activity.fechaInicio = null; activity.fechaFin = null; continue; }
    activity.fechaInicio = start;
    activity.duracion = duracion;
    activity.fechaFin = duracion > 0 ? addWorkingDays(calendar, start, duracion) : start;
  }

  // Las que quedaron fuera del orden (ciclos): mantienen fecha manual o null.
  cycles.forEach(id => {
    const a = byId.get(id);
    if(a.fechaInicio && a.duracion != null && a.duracion > 0){
      a.fechaFin = addWorkingDays(calendar, a.fechaInicio, a.duracion);
    }
  });

  const scheduled = activities.map(a => byId.get(a.id));
  return {
    activities: scheduled,
    issues: Array.from(issues.entries()).map(([activityId, list]) => list.map(i => ({ activityId, ...i }))).flat(),
    order, cycles
  };
}

/* Recalcula fecha fin de UNA actividad manteniendo fechaInicio y usando la
   nueva duracion. Util para "actualizar duracion tras OC" sin repropagar
   todo el programa. */
export function recomputeActivityEnd(calendar, activity, duracion){
  if(!calendar || !activity?.fechaInicio || !(Number(duracion) >= 0)) return activity;
  const fechaFin = duracion === 0 ? activity.fechaInicio : addWorkingDays(calendar, activity.fechaInicio, duracion);
  return { ...activity, duracion, fechaFin };
}

/* Cuenta dias laborables reales entre fechaInicio y HOY (o una fecha
   `asOf`). Usado por activityProgress.js para calcular rendimiento real. */
export function elapsedWorkingDays(calendar, fechaInicio, asOf){
  if(!fechaInicio) return 0;
  const from = fechaInicio;
  const to = asOf || new Date().toISOString().slice(0, 10);
  return workingDaysBetween(calendar, from, to);
}
