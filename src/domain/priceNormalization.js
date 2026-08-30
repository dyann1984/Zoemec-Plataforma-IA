/* Material & Price Intelligence 2.1 -- regla 7: normalizacion determinista.
   La IA puede identificar presentacion/contenido/unidad comercial/equivalencia
   propuesta, pero el CALCULO final (precio de presentacion -> precio por
   unidad del APU) siempre lo hace este modulo, codigo puro, nunca el LLM en
   silencio. Si la conversion no puede demostrarse con las unidades
   conocidas, NUNCA se inventa: se devuelve NORMALIZATION_REQUIRED. */

export const NORMALIZATION_REQUIRED = 'NORMALIZATION_REQUIRED';

/* Factor para llevar cada unidad a su unidad canonica de dimension (metro,
   kilogramo, metro2, litro). Solo unidades realmente usadas en construccion
   -- ampliar esta tabla es seguro y no rompe nada (aditivo). */
const UNIT_TO_CANONICAL = Object.freeze({
  // longitud -> metro
  m: { dimension: 'length', factor: 1 },
  metro: { dimension: 'length', factor: 1 },
  cm: { dimension: 'length', factor: 0.01 },
  mm: { dimension: 'length', factor: 0.001 },
  km: { dimension: 'length', factor: 1000 },
  // masa -> kilogramo
  kg: { dimension: 'mass', factor: 1 },
  g: { dimension: 'mass', factor: 0.001 },
  ton: { dimension: 'mass', factor: 1000 },
  tonelada: { dimension: 'mass', factor: 1000 },
  // area -> metro2
  'm2': { dimension: 'area', factor: 1 },
  'm²': { dimension: 'area', factor: 1 },
  'cm2': { dimension: 'area', factor: 0.0001 },
  'cm²': { dimension: 'area', factor: 0.0001 },
  // volumen -> litro (1 m3 = 1000 L)
  l: { dimension: 'volume', factor: 1 },
  litro: { dimension: 'volume', factor: 1 },
  'm3': { dimension: 'volume', factor: 1000 },
  'm³': { dimension: 'volume', factor: 1000 },
  ml: { dimension: 'volume', factor: 0.001 },
  // conteo -> pieza (dimension propia: solo pza<->pza es valido)
  pza: { dimension: 'count', factor: 1 },
  pieza: { dimension: 'count', factor: 1 },
  jgo: { dimension: 'set', factor: 1 },
  lote: { dimension: 'lot', factor: 1 }
});

function normalizeUnitKey(unit){
  return String(unit ?? '').trim().toLowerCase();
}
function unitInfo(unit){
  return UNIT_TO_CANONICAL[normalizeUnitKey(unit)] || null;
}

function isPositiveFinite(value){
  return Number.isFinite(value) && value > 0;
}

/* normalizePresentationPrice: convierte "precio de la presentacion comercial"
   a "precio por unidad del APU". Ejemplos reales soportados:
   - tubo $600 / presentacion 6 m, unidad APU "m" -> $100/m
   - saco de cemento $X / presentacion 50 kg, unidad APU "kg" -> $X/50 por kg
   - caja $720 / presentacion 1.44 m2, unidad APU "m2" -> $500/m2
   - rollo $Y / presentacion 100 m, unidad APU "m" -> $Y/100 por m
   - 1 m3 -> 1000 L cuando la unidad APU es "l" y la presentacion es "m3"

   Protecciones obligatorias (regla 7): 0, NaN, Infinity, unidades
   incompatibles, factor negativo, presentacion invalida -- ninguno de estos
   casos produce un numero inventado, todos devuelven NORMALIZATION_REQUIRED
   con la razon exacta. */
export function normalizePresentationPrice({ presentationPrice, presentationQty, presentationUnit, targetUnit } = {}){
  const price = Number(presentationPrice);
  const qty = Number(presentationQty);

  if(!Number.isFinite(price) || !Number.isFinite(qty)){
    return { normalizationRequired: true, reason: 'Precio o cantidad de presentacion no son numeros finitos.' };
  }
  if(price < 0 || qty < 0){
    return { normalizationRequired: true, reason: 'Precio o cantidad de presentacion son negativos: una presentacion valida no puede tener signo negativo.' };
  }
  if(!isPositiveFinite(qty)){
    return { normalizationRequired: true, reason: 'La cantidad de la presentacion debe ser mayor a 0 para poder dividir el precio.' };
  }
  if(!isPositiveFinite(price)){
    // Precio 0 no es un precio valido (regla 3): no se normaliza, se marca
    // como requerido en vez de devolver $0/unidad silenciosamente.
    return { normalizationRequired: true, reason: 'El precio de la presentacion es $0 o no valido: un precio $0 nunca se convierte en precio normalizado valido.' };
  }

  const fromInfo = unitInfo(presentationUnit);
  const toInfo = unitInfo(targetUnit);
  if(!fromInfo || !toInfo){
    return { normalizationRequired: true, reason: `Unidad no reconocida para conversion determinista ("${presentationUnit}" -> "${targetUnit}").` };
  }
  if(fromInfo.dimension !== toInfo.dimension){
    return { normalizationRequired: true, reason: `Unidades incompatibles: "${presentationUnit}" es de dimension ${fromInfo.dimension}, "${targetUnit}" es de dimension ${toInfo.dimension}. No existe conversion valida entre magnitudes distintas.` };
  }

  // Cantidad de la presentacion expresada en la unidad canonica de la
  // dimension, luego convertida a la unidad objetivo real.
  const qtyInCanonical = qty * fromInfo.factor;
  const qtyInTargetUnit = qtyInCanonical / toInfo.factor;
  if(!isPositiveFinite(qtyInTargetUnit)){
    return { normalizationRequired: true, reason: 'La conversion de unidades produjo una cantidad no valida (0, negativa o no finita).' };
  }

  const pricePerUnit = price / qtyInTargetUnit;
  if(!Number.isFinite(pricePerUnit) || pricePerUnit <= 0){
    return { normalizationRequired: true, reason: 'El precio normalizado resultante no es un numero finito y positivo.' };
  }

  const factor = 1 / qtyInTargetUnit;
  return {
    normalizationRequired: false,
    pricePerUnit: Number(pricePerUnit.toFixed(6)),
    factor: Number(factor.toFixed(9)),
    dimension: fromInfo.dimension,
    presentationQtyInTargetUnit: Number(qtyInTargetUnit.toFixed(6))
  };
}
