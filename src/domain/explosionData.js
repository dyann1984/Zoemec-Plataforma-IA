/* Orquestador puro de la Explosion completa (Fase A): calcula las 4 pestañas
   (Materiales/Mano de obra/Maquinaria y Equipo/Auxiliares) a partir de los
   APUs ya cargados de un proyecto -- SIN efectos secundarios de red/escritura,
   para que la UI interactiva (src/features/explosions/ExplosionsPanel.jsx) y
   los exportadores (explosionXlsx.js/explosionPdf.js) compartan exactamente
   el mismo calculo, un solo motor, nunca dos.

   F2: la entrada puede ser "lineas" (APU + cantidad autoritativa + concepto,
   ver src/domain/budgetScope.js) o, por compatibilidad, documentos APU
   (tratados como APUs independientes con su cantidadObra). */
import { buildMaterialExplosion, buildAuxiliariesExplosion } from './materialExplosion.js';
import { buildLaborExplosion } from './laborExplosion.js';
import { buildMachineryExplosion } from './machineryExplosion.js';
import { buildBudgetScope, buildProjectScope } from './budgetScope.js';
import { explosionLinesOf } from './explosionEngine.js';

export const EXPLOSION_SCOPE = Object.freeze({ PRESUPUESTO: 'PRESUPUESTO', PROYECTO: 'PROYECTO' });

export function computeExplosionData(input){
  const lines = explosionLinesOf(input);
  return {
    materials: buildMaterialExplosion(lines),
    auxiliares: buildAuxiliariesExplosion(lines),
    labor: buildLaborExplosion(lines),
    machinery: buildMachineryExplosion(lines)
  };
}

/* F2 -- Explosion con alcance explicito. PRESUPUESTO: solo conceptos activos
   con APU disponible, cantidad = concepto.qty (MISMA poblacion que
   aggregatePresupuesto). PROYECTO: lo anterior + APUs independientes con su
   cantidadObra, etiquetados. Devuelve tambien el alcance (lineas y
   exclusiones) para que pantalla, PDF y XLSX muestren exactamente lo mismo. */
export function computeScopedExplosion({ conceptos = [], apuDocs = [], scope = EXPLOSION_SCOPE.PRESUPUESTO } = {}){
  const s = scope === EXPLOSION_SCOPE.PROYECTO ? buildProjectScope({ conceptos, apuDocs }) : buildBudgetScope({ conceptos, apuDocs });
  const data = computeExplosionData(s.lines);
  return {
    scope,
    data,
    lines: s.lines,
    excluded: s.excluded,
    budgetRows: s.rows,
    summary: {
      lineas: s.lines.length,
      conceptosConApu: s.lines.filter(l => l.concepto).length,
      apusIndependientes: s.lines.filter(l => !l.concepto).length,
      apusDistintos: new Set(s.lines.map(l => l.apuDoc.id)).size,
      conceptosSinApu: s.excluded.conceptosSinApu.length,
      conceptosConApuNoDisponible: s.excluded.conceptosConApuNoDisponible.length,
      apusFueraDelPresupuesto: s.excluded.apusFueraDelPresupuesto.length
    }
  };
}
