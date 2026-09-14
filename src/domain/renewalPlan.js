/* Plan de renovacion (Fase G, seccion 16). Agrupa el CapEx YA proyectado
   (capexProjection.js) en horizontes de 12 meses / 3 / 5 / 10 años. Un
   total de gasto SOLO se muestra cuando hay al menos un componente
   `confiable:true` en ese horizonte -- nunca se suma un costo inventado,
   y los componentes sin proyeccion confiable se listan aparte para que se
   vea que existen sin fingir que tienen numero. */
const HORIZONS = Object.freeze([
  { key: 'next12Months', label: 'Próximos 12 meses', maxYears: 1 },
  { key: 'next3Years', label: 'Próximos 3 años', maxYears: 3 },
  { key: 'next5Years', label: 'Próximos 5 años', maxYears: 5 },
  { key: 'next10Years', label: 'Próximos 10 años', maxYears: 10 }
]);

export function buildRenewalPlan(capexRows = []){
  const reliable = capexRows.filter(r => r.confiable);
  const unreliable = capexRows.filter(r => !r.confiable);
  const horizons = HORIZONS.map(h => {
    const items = reliable.filter(r => r.aniosRestantes != null && r.aniosRestantes <= h.maxYears);
    return {
      key: h.key, label: h.label, items,
      totalCost: items.reduce((s, r) => s + (r.costoProyectado || 0), 0),
      hasItems: items.length > 0
    };
  });
  return { horizons, unreliableComponents: unreliable };
}
