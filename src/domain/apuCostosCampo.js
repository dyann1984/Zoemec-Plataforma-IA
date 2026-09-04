/* Costos de Campo y Ajustes Reales (Parte C/D del requerimiento de
   produccion): un registro de gastos reales de obra que normalmente NO
   estan contemplados en el costo directo inicial del APU (viaticos,
   alimentos, traslados, maniobras no previstas...), clasificado por el
   usuario en 5 categorias que determinan como impacta el resumen
   "Presupuestado vs Real" -- NUNCA se inyecta automaticamente al costo
   directo del APU (calcAPUv2 en apuCalc.js no se toca ni se lee aqui de
   vuelta): este modulo es aditivo y de solo lectura sobre apu.calculated,
   exactamente como pidio el usuario ("NO meter automaticamente todos estos
   gastos como costo directo"). */

export const COSTO_CAMPO_CATEGORIA = Object.freeze({
  COSTO_DIRECTO: 'COSTO_DIRECTO',
  INDIRECTO_OBRA: 'INDIRECTO_OBRA',
  EXTRAORDINARIO: 'EXTRAORDINARIO',
  NO_IMPUTABLE: 'NO_IMPUTABLE',
  AJUSTE_MANUAL: 'AJUSTE_MANUAL'
});

export const COSTO_CAMPO_CATEGORIA_LABEL = Object.freeze({
  [COSTO_CAMPO_CATEGORIA.COSTO_DIRECTO]: 'A. Costo directo',
  [COSTO_CAMPO_CATEGORIA.INDIRECTO_OBRA]: 'B. Indirecto de obra',
  [COSTO_CAMPO_CATEGORIA.EXTRAORDINARIO]: 'C. Gasto extraordinario',
  [COSTO_CAMPO_CATEGORIA.NO_IMPUTABLE]: 'D. No imputable al APU',
  [COSTO_CAMPO_CATEGORIA.AJUSTE_MANUAL]: 'E. Ajuste manual justificado'
});

export const COSTO_CAMPO_CATEGORIA_ORDER = [
  COSTO_CAMPO_CATEGORIA.COSTO_DIRECTO, COSTO_CAMPO_CATEGORIA.INDIRECTO_OBRA,
  COSTO_CAMPO_CATEGORIA.EXTRAORDINARIO, COSTO_CAMPO_CATEGORIA.NO_IMPUTABLE,
  COSTO_CAMPO_CATEGORIA.AJUSTE_MANUAL
];

export function makeEmptyCostoCampoRow(){
  return {
    id: '', concepto: '', categoria: COSTO_CAMPO_CATEGORIA.INDIRECTO_OBRA, descripcion: '',
    cantidad: 0, unidad: '', costoUnitario: 0, fecha: '', proveedor: '', comprobante: '',
    observacion: '', justificacion: ''
  };
}

function toNumber(value){ const n = Number(value); return Number.isFinite(n) ? n : 0; }

/* importe = cantidad x costoUnitario -- nunca se captura a mano, siempre se
   deriva (misma regla que el resto del APU: nunca confiar un total tecleado
   que pueda desincronizarse de sus factores). */
export function calcCostoCampoImporte(row){
  return toNumber(row?.cantidad) * toNumber(row?.costoUnitario);
}

/* "imputable" (campo pedido explicitamente por el usuario, punto 13 de
   Parte C): unicamente D (No imputable al APU) es NO imputable -- las otras
   4 categorias, incluido el ajuste manual, si cuentan para algun renglon del
   resumen Presupuestado vs Real. */
export function isCostoCampoImputable(row){
  return row?.categoria !== COSTO_CAMPO_CATEGORIA.NO_IMPUTABLE;
}

/* Suma el importe real por categoria. D (no imputable) se reporta aparte
   (nunca se mezcla con los totales imputables) para que quede visible sin
   afectar el costo real total. */
export function summarizeCostosCampo(costosCampo){
  const rows = Array.isArray(costosCampo) ? costosCampo : [];
  const byCategoria = {
    [COSTO_CAMPO_CATEGORIA.COSTO_DIRECTO]: 0, [COSTO_CAMPO_CATEGORIA.INDIRECTO_OBRA]: 0,
    [COSTO_CAMPO_CATEGORIA.EXTRAORDINARIO]: 0, [COSTO_CAMPO_CATEGORIA.NO_IMPUTABLE]: 0,
    [COSTO_CAMPO_CATEGORIA.AJUSTE_MANUAL]: 0
  };
  let totalRegistrado = 0;
  rows.forEach(row => {
    const importe = calcCostoCampoImporte(row);
    totalRegistrado += importe;
    const cat = Object.prototype.hasOwnProperty.call(byCategoria, row?.categoria) ? row.categoria : COSTO_CAMPO_CATEGORIA.NO_IMPUTABLE;
    byCategoria[cat] += importe;
  });
  return { count: rows.length, totalRegistrado, byCategoria };
}

/* Presupuestado vs Real (Parte D): compara el APU YA CALCULADO
   (apu.calculated, resultado de calcAPUv2 -- nunca se recalcula aqui) contra
   el costo real observado en campo. Mapeo de las 5 categorias a las 5
   lineas del resumen pedidas por el usuario:
     - Costo directo real  = costo directo presupuestado (direct x cantidadObra) + categoria A
     - Costos de campo     = total bruto registrado en la bitacora (todas las categorias, informativo)
     - Indirectos          = categoria B
     - Extraordinarios     = categoria C
     - Ajustes             = categoria E (puede ser negativo: una correccion a la baja)
     - Costo real total    = costo directo real + Indirectos + Extraordinarios + Ajustes (D SIEMPRE excluida)
   Regresa null si el APU no tiene datos de costo (apu.calculated ausente) --
   nunca inventa un presupuestado de $0 que distorsione la variacion %. */
export function calcPresupuestadoVsReal(apu){
  const calculated = apu?.calculated;
  if(!calculated || !(Number(calculated.pu) >= 0)) return null;
  const cantidadObra = toNumber(apu?.cantidadObra);
  const presupuestado = toNumber(calculated.importeTotal) || toNumber(calculated.pu) * cantidadObra;
  const directoPresupuestadoTotal = toNumber(calculated.direct) * cantidadObra;

  const { count, totalRegistrado, byCategoria } = summarizeCostosCampo(apu?.costosCampo);
  const costoDirectoReal = directoPresupuestadoTotal + byCategoria[COSTO_CAMPO_CATEGORIA.COSTO_DIRECTO];
  const indirectos = byCategoria[COSTO_CAMPO_CATEGORIA.INDIRECTO_OBRA];
  const extraordinarios = byCategoria[COSTO_CAMPO_CATEGORIA.EXTRAORDINARIO];
  const ajustes = byCategoria[COSTO_CAMPO_CATEGORIA.AJUSTE_MANUAL];
  const noImputable = byCategoria[COSTO_CAMPO_CATEGORIA.NO_IMPUTABLE];
  const costoRealTotal = costoDirectoReal + indirectos + extraordinarios + ajustes;
  const desviacionMonto = costoRealTotal - presupuestado;
  const desviacionPct = presupuestado !== 0 ? (desviacionMonto / presupuestado) * 100 : null;
  const impactoPU = cantidadObra > 0 ? desviacionMonto / cantidadObra : null;

  return {
    hasRegistros: count > 0,
    presupuestado, costoDirectoReal, costosCampo: totalRegistrado, indirectos, extraordinarios,
    ajustes, noImputable, costoRealTotal, desviacionMonto, desviacionPct, impactoPU
  };
}
