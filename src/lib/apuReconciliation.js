/* Control matematico (punto 24 del spec del usuario): verifica de forma
   INDEPENDIENTE que
     SUMA(insumos por categoria) == COSTO_DIRECTO
     COSTO_DIRECTO + INDIRECTOS + FINANCIAMIENTO + UTILIDAD + CARGOS == PU
   con una tolerancia monetaria configurable. La cascada de calcAPUv2
   (src/lib/apuCalc.js) ya es correcta por construccion -- cada rubro se
   deriva aritmeticamente del anterior, nunca podria "no cuadrar" consigo
   misma. El valor real de este modulo es el control 3: comparar contra
   `claimedTotals` (tipicamente apu.calculated, lo que YA se serializo a
   pantalla/Excel/PDF) recalculando fresco desde los renglones actuales --
   eso SI puede divergir, si alguien edito un renglon despues del ultimo
   calculo y el documento exportado quedo desactualizado. Logica pura (sin
   React, sin Firebase). */
import { calcAPUv2 } from './apuCalc.js';

export const DEFAULT_RECONCILIATION_TOLERANCE = 0.01; // $0.01 en la moneda del APU

const CASCADE_FIELDS = ['direct', 'indirect', 'finance', 'utility', 'cargos', 'pu'];

/* options.claimedTotals (opcional): totales ya calculados en otro momento
   (ej. apu.calculated) a verificar contra un recalculo fresco. Sin este
   parametro, solo se verifican los controles 1 y 2 (siempre exactos por
   construccion salvo un bug real en calcAPUv2/applyCascade). */
export function reconcileAPU(apu = {}, options = {}){
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : DEFAULT_RECONCILIATION_TOLERANCE;
  const fresh = calcAPUv2(apu);
  const diffs = [];

  const sumaInsumos = fresh.mat + fresh.mo + fresh.equipo + fresh.herramienta + fresh.consumibles + fresh.seguridad;
  if(Math.abs(sumaInsumos - fresh.direct) > tolerance){
    diffs.push({ code: 'suma_insumos_vs_costo_directo', esperado: sumaInsumos, obtenido: fresh.direct, diferencia: sumaInsumos - fresh.direct });
  }

  const cascadeSum = fresh.direct + fresh.indirect + fresh.finance + fresh.utility + fresh.cargos;
  if(Math.abs(cascadeSum - fresh.pu) > tolerance){
    diffs.push({ code: 'cascada_vs_precio_unitario', esperado: cascadeSum, obtenido: fresh.pu, diferencia: cascadeSum - fresh.pu });
  }

  const claimed = options.claimedTotals;
  if(claimed && typeof claimed === 'object'){
    CASCADE_FIELDS.forEach(field => {
      const claimedValue = Number(claimed[field]);
      const freshValue = Number(fresh[field]);
      if(Number.isFinite(claimedValue) && Number.isFinite(freshValue) && Math.abs(claimedValue - freshValue) > tolerance){
        diffs.push({ code: 'totales_desactualizados', field, esperado: freshValue, obtenido: claimedValue, diferencia: freshValue - claimedValue });
      }
    });
  }

  return { ok: diffs.length === 0, diffs, fresh, tolerance };
}
