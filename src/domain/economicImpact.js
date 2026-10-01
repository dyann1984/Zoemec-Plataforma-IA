/* Impacto economico de un cambio de cantidad sobre un concepto ya asignado.
   Modulo puro, sin React ni Firebase.

   PROPOSITO (regla 5 del encargo): antes de sincronizar la nueva cantidad
   con el catalogo -- accion contractualmente sensible -- el usuario debe
   ver EXPLICITAMENTE:
     Cantidad anterior (la que se sincronizo por ultima vez)
     Cantidad actual (la que resulta de la geometria vigente)
     Variacion (delta de cantidad)
     P.U. (del APU asociado)
     Impacto = variacion x P.U.
   Nunca se estampa "Sincronizar" con un cambio contractual en silencio.

   Regla del brief §35 (Confidence Engine): un cambio de cantidad manual y
   validado tiene HIGH confidence; el cambio economico calculado desde una
   cantidad y un P.U. reales tambien -- ninguna cifra aqui es "estimada".
   Si falta el P.U. (APU no asignado o P.U. no calculable), el impacto
   economico se reporta null, NUNCA cero (cero seria mentir: "no cuesta
   nada"). La UI debe entonces mostrar solo el delta de cantidad y avisar
   que falta P.U. */

const round = (n, d = 4) => Math.round(n * Math.pow(10, d)) / Math.pow(10, d);

function toFiniteOrNull(v){
  // Number(null) === 0 y Number('') === 0 en JS -- si aceptaramos eso,
  // "sin P.U." pasaria como "P.U. = 0" y mostrariamos $0.00 como si fuera
  // el impacto real. Se requiere un dato numerico explicito.
  if(v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* Calcula el impacto economico de un cambio de cantidad.

   `previousQty`: cantidad ULTIMA sincronizada (assignment.syncedQty). Si no
     existe (nunca se sincronizo antes), se trata como 0 -- entonces el
     "delta" iguala la cantidad actual: es la propuesta de alta de la cifra.
   `currentQty`: cantidad vigente segun geometria (buildElementTakeoff).
   `pu`: precio unitario del APU asociado. null/NaN => el impacto economico
     queda null, el delta de cantidad se conserva.

   Retorna un objeto plano y JSON-safe (compatible con el resto del dominio
   ZOEMEC): { previousQty, currentQty, deltaQty, pu, deltaAmount, direction }.
   `direction` es 'increase' | 'decrease' | 'unchanged', util para UI. */
export function computeGeometryImpact({ previousQty, currentQty, pu = null } = {}){
  const prev = toFiniteOrNull(previousQty);
  const curr = toFiniteOrNull(currentQty);
  const previousQtyN = prev != null ? prev : 0;
  const currentQtyN = curr != null ? curr : 0;
  const deltaQty = currentQtyN - previousQtyN;
  const puN = toFiniteOrNull(pu);
  const deltaAmount = puN != null ? deltaQty * puN : null;
  let direction = 'unchanged';
  if(deltaQty > 1e-6) direction = 'increase';
  else if(deltaQty < -1e-6) direction = 'decrease';
  return {
    previousQty: round(previousQtyN),
    currentQty: round(currentQtyN),
    deltaQty: round(deltaQty),
    pu: puN,
    deltaAmount: deltaAmount != null ? round(deltaAmount, 2) : null,
    direction
  };
}

/* Formatea el impacto para presentacion textual (regla 12: "no llenar la
   pantalla de informacion innecesaria"). No hace calculo -- solo prosa
   corta lista para <b>/<span> en el panel. Redondeos: cantidades a 3
   decimales, montos a 2. Locale es-MX porque el resto del producto tambien
   lo usa (ver aggregateSurveyTotals, calcAPU export). */
export function formatImpactSummary(impact, { unit = '', currency = 'MXN' } = {}){
  if(!impact) return null;
  const qty = (n) => Number(n).toLocaleString('es-MX', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const money = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency });
  const sign = impact.deltaQty > 0 ? '+' : impact.deltaQty < 0 ? '-' : '';
  const deltaMoneyText = impact.deltaAmount == null
    ? 'Sin P.U.: solo cambia la cantidad, no se puede estimar el impacto economico.'
    : `${impact.deltaAmount >= 0 ? '+' : '-'}${money(Math.abs(impact.deltaAmount))}`;
  return {
    previousQtyText: `${qty(impact.previousQty)} ${unit}`.trim(),
    currentQtyText: `${qty(impact.currentQty)} ${unit}`.trim(),
    deltaQtyText: `${sign}${qty(Math.abs(impact.deltaQty))} ${unit}`.trim(),
    puText: impact.pu == null ? 'Sin P.U.' : money(impact.pu),
    deltaAmountText: deltaMoneyText,
    direction: impact.direction,
    hasCostImpact: impact.deltaAmount != null && Math.abs(impact.deltaAmount) > 0
  };
}
