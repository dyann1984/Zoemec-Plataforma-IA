/* Curva S (Fase E, seccion 11 del pedido). Esta fase NO tiene ningun motor
   de programa/linea base de tiempo (no existe un Gantt ni un flujo de caja
   planeado en ninguna fase anterior -- se audito explicitamente antes de
   escribir esto) -- por eso esta funcion SOLO construye las series REALES
   (avance real acumulado, costo real acumulado) a partir de datos que de
   verdad existen (progressEntries/payments con fecha). Las series
   "programado" se dejan `null` explicitamente, NUNCA se inventan (regla
   11: "nunca rellenar datos faltantes artificialmente") -- graficar una
   curva programada falsa seria peor que no graficarla. Si en el futuro se
   agrega un plan de obra con fechas objetivo, ese modulo puede alimentar
   esas series sin tocar esta funcion. */
function toDateKey(iso){
  const d = new Date(iso);
  if(Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const MIN_DISTINCT_PERIODS = 2;

export function buildSCurveData({ progressEntries = [], payments = [], presupuestoVigente = 0 } = {}){
  const physicalByPeriod = new Map();
  progressEntries.forEach(e => {
    const key = toDateKey(e?.fecha || e?.createdAt);
    if(!key) return;
    physicalByPeriod.set(key, (physicalByPeriod.get(key) || 0) + (Number(e?.delta) || 0) * (Number(e?.pu) || 0));
  });
  const costByPeriod = new Map();
  payments.forEach(p => {
    const key = toDateKey(p?.fecha || p?.createdAt);
    if(!key) return;
    costByPeriod.set(key, (costByPeriod.get(key) || 0) + (Number(p?.monto) || 0));
  });

  const periods = [...new Set([...physicalByPeriod.keys(), ...costByPeriod.keys()])].sort();
  if(periods.length < MIN_DISTINCT_PERIODS){
    return { available: false, reason: 'Datos insuficientes (se necesitan al menos 2 periodos distintos con avance o pagos reales).', periods: [], series: null };
  }

  let cumFisico = 0, cumCosto = 0;
  const avanceRealPct = [];
  const costoReal = [];
  periods.forEach(key => {
    cumFisico += physicalByPeriod.get(key) || 0;
    cumCosto += costByPeriod.get(key) || 0;
    avanceRealPct.push({ period: key, value: presupuestoVigente > 0 ? (cumFisico / presupuestoVigente) * 100 : null });
    costoReal.push({ period: key, value: cumCosto });
  });

  return {
    available: true,
    periods,
    series: {
      avanceProgramadoPct: null, // no existe linea base de programa en esta fase -- nunca se inventa
      avanceRealPct,
      costoProgramado: null,
      costoReal
    }
  };
}
