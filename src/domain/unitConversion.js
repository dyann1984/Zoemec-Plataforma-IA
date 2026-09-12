/* Conversiones numericas de unidades para el Cuantificador Parametrico
   (Fase B). No existe hoy en el repo ningun modulo de conversion real --
   src/lib/excelImport.js#normalizeUnitLabel solo canonicaliza el TEXTO de
   una unidad (m2/m2, dia/dia, etc.), nunca hace matematica de conversion.
   Este modulo SOLO hace matematica pura -- nunca produce el string de
   unidad final (eso sigue siendo responsabilidad de normalizeUnitLabel,
   quien lo consuma debe llamarlo aparte antes de guardar un renglon). */

export function cmToM(valueCm){ return Number(valueCm) / 100; }
export function mToCm(valueM){ return Number(valueM) * 100; }
export function m3ToL(valueM3){ return Number(valueM3) * 1000; }
export function lToM3(valueL){ return Number(valueL) / 1000; }
export function kgToTon(valueKg){ return Number(valueKg) / 1000; }
export function tonToKg(valueTon){ return Number(valueTon) * 1000; }

/* Densidad del acero de refuerzo (kg/m3) -- constante fisica, no un
   supuesto de negocio ajustable. Se usa para derivar peso de acero a
   partir de un porcentaje de volumen de concreto (ver
   parametricElements.js#zapata_aislada). */
export const STEEL_DENSITY_KG_PER_M3 = 7850;

/* Peso lineal (kg/m) por numero de varilla de refuerzo, valores estandar
   de la industria (varilla corrugada, diametro nominal en octavos de
   pulgada -- #4 = 1/2", #3 = 3/8", etc.). Referencia de catalogo generica,
   no de un fabricante especifico -- documentado explicitamente como valor
   de referencia ajustable en la UI del Cuantificador. */
export const REBAR_LINEAR_WEIGHT_KG_PER_M = Object.freeze({
  2: 0.249,  // 1/4" (comunmente estribos)
  3: 0.560,  // 3/8"
  4: 0.994,  // 1/2"
  5: 1.552,  // 5/8"
  6: 2.235,  // 3/4"
  8: 3.973,  // 1"
  10: 6.196  // 1 1/4"
});

export function rebarLinearWeightKgPerM(rebarNumber){
  return REBAR_LINEAR_WEIGHT_KG_PER_M[rebarNumber] ?? null;
}
