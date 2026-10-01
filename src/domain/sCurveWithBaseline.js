/* Curva S CON baseline programada (Fase 3, regla 15). EXTIENDE
   sCurveData.buildSCurveData sin modificarla -- si hay actividades con
   fechaInicio/fechaFin/importe, se calcula la serie planificada; si no,
   se degrada a lo que ya hacia sCurveData (solo real).

   Formula:
   - Cada actividad distribuye su importe presupuestado LINEALMENTE entre
     su fechaInicio y fechaFin (segun dias laborables). Al final del mes,
     se acumula lo que le toco a ese mes.
   - Curva S PROGRAMADA acumulada = suma acumulada mes a mes del gasto
     planificado.
   - Curva S REAL: identica a buildSCurveData (progressEntries + payments).
   - Ambas convergen en el ultimo periodo cuando el proyecto termina segun
     plan; la divergencia por periodo es la "desviacion" cronologica. */
import { buildSCurveData } from './sCurveData.js';
import { workingDaysBetween } from './workingCalendar.js';

function toDateKey(iso){
  const d = new Date(iso);
  if(Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function toNumber(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

/* Distribuye el importe de UNA actividad entre los meses que abarca su
   fechaInicio -> fechaFin, proporcional a los dias laborables de cada mes
   contenidos en el rango. */
function distributeActivityByMonth(activity, calendar){
  const start = activity?.fechaInicio;
  const end = activity?.fechaFin;
  if(!start || !end) return new Map();
  const totalWorkingDays = workingDaysBetween(calendar, start, end);
  if(totalWorkingDays <= 0) return new Map();
  const importe = toNumber(activity.importe);
  if(importe <= 0) return new Map();

  const byMonth = new Map();
  // Iteramos mes a mes desde el mes del start hasta el mes del end
  const startDate = new Date(start.slice(0,4), Number(start.slice(5,7)) - 1, Number(start.slice(8,10)));
  const endDate = new Date(end.slice(0,4), Number(end.slice(5,7)) - 1, Number(end.slice(8,10)));
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  while(cursor <= endDate){
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0); // ultimo dia del mes
    const rangeStart = monthStart < startDate ? startDate : monthStart;
    const rangeEnd = monthEnd > endDate ? endDate : monthEnd;
    const rsIso = `${rangeStart.getFullYear()}-${String(rangeStart.getMonth()+1).padStart(2,'0')}-${String(rangeStart.getDate()).padStart(2,'0')}`;
    const reIso = `${rangeEnd.getFullYear()}-${String(rangeEnd.getMonth()+1).padStart(2,'0')}-${String(rangeEnd.getDate()).padStart(2,'0')}`;
    const days = workingDaysBetween(calendar, rsIso, reIso);
    if(days > 0){
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}`;
      byMonth.set(key, (byMonth.get(key) || 0) + importe * (days / totalWorkingDays));
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return byMonth;
}

/* Construye la curva S completa. Recibe:
     activities: actividades con fechaInicio/fechaFin/importe (o
                 cantidad y pu)
     progressEntries, payments, presupuestoVigente -- mismos que buildSCurveData
     calendar
   Devuelve el mismo shape que buildSCurveData pero con
   avanceProgramadoPct/costoProgramado poblados cuando hay datos. */
export function buildSCurveWithBaseline({ activities = [], progressEntries = [], payments = [], presupuestoVigente = 0, calendar }){
  const base = buildSCurveData({ progressEntries, payments, presupuestoVigente });
  if(!calendar || !activities?.length){
    return base;
  }
  // Enriquecer con importe si no viene en la actividad
  const enriched = activities.map(a => {
    const importe = toNumber(a.importe) || (toNumber(a.cantidad) * toNumber(a.pu));
    return { ...a, importe };
  });
  const programadoByMonth = new Map();
  enriched.forEach(a => {
    const dist = distributeActivityByMonth(a, calendar);
    dist.forEach((v, k) => programadoByMonth.set(k, (programadoByMonth.get(k) || 0) + v));
  });
  const totalProgramado = Array.from(programadoByMonth.values()).reduce((s, v) => s + v, 0);
  if(programadoByMonth.size === 0){
    return base;
  }
  // Reune todos los periodos: los de la curva real (base.periods) mas los del programa.
  const allPeriods = [...new Set([...(base.periods || []), ...programadoByMonth.keys()])].sort();
  let cumProgramado = 0;
  const costoProgramado = [];
  const avanceProgramadoPct = [];
  allPeriods.forEach(key => {
    cumProgramado += programadoByMonth.get(key) || 0;
    costoProgramado.push({ period: key, value: cumProgramado });
    avanceProgramadoPct.push({ period: key, value: totalProgramado > 0 ? (cumProgramado / totalProgramado) * 100 : null });
  });
  return {
    available: allPeriods.length >= 2 || base.available,
    periods: allPeriods,
    reason: allPeriods.length < 2 ? 'Se necesitan al menos 2 periodos distintos.' : null,
    series: {
      avanceProgramadoPct,
      avanceRealPct: base.series?.avanceRealPct || [],
      costoProgramado,
      costoReal: base.series?.costoReal || []
    },
    totalProgramado
  };
}
