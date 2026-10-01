/* F5 -- Vista del PRESUPUESTO como funcion PURA, compartida por la pantalla
   (PresupuestoModule) y por el Centro de Reportes (PDF/XLSX). Antes vivia
   dentro del componente; se movio SIN cambiar la logica para que pantalla,
   PDF y XLSX salgan de la MISMA llamada (nunca de un segundo calculo).
   Fuentes: buildBudgetScope (F2: que conceptos, con que cantidad y P.U.),
   aggregatePresupuesto (subtotales), runApuConfidence/runBidRisk. */
import { aggregatePresupuesto } from './presupuestoAggregation.js';
import { buildBudgetScope, APU_STATUS } from './budgetScope.js';
import { runApuConfidence } from './apuConfidence.js';
import { runBidRisk } from './bidRisk.js';

export function originCantidad(concepto){
  // F3: cantidad desde generadores persistentes (trazable elemento por elemento).
  if(concepto.quantitySource === 'GENERATORS') return `Generadores (${(concepto.elementIds || []).length} elemento(s))${concepto.generatorsStale ? ' · ⚠ desactualizados (geometría cambió, sin confirmar)' : ''}`;
  if(concepto.origenPlano) return `Plano${concepto.origenPlano.fileName ? ` (${concepto.origenPlano.fileName})` : ''}`;
  return 'Manual';
}
export function originPrecio(concepto, apu){
  if(concepto.status === 'ASOCIADO') return 'APU asociado';
  if(apu?.templateGenerated) return 'Paramétrico';
  if(apu) return 'IA';
  return '—';
}

/* `withIntelligence:false` omite Confidence/Bid Risk (costosos) cuando el
   llamador no los muestra; las cifras economicas son identicas. */
export function buildPresupuestoView({ conceptos = [], apuDocs = [], withIntelligence = true } = {}){
  const conceptoById = new Map((conceptos || []).map(c => [c.id, c]));
  const scope = buildBudgetScope({ conceptos, apuDocs: apuDocs || [] });
  const rows = scope.rows.map(r => {
    const c = conceptoById.get(r.conceptoId) || {};
    const apu = r.apuDoc?.snapshot ? { ...r.apuDoc.snapshot, id: r.apuDoc.id } : null;
    return {
      ...r, apuDoc: undefined,
      confidenceStatus: withIntelligence && apu ? runApuConfidence(apu).status : null,
      bidRiskSeverity: withIntelligence && apu ? runBidRisk(apu).severity : null,
      origenCantidad: originCantidad(c), origenPrecio: r.apuStatus === APU_STATUS.APU_NO_DISPONIBLE ? 'APU no disponible' : originPrecio(c, apu),
      // Trazabilidad Presupuesto -> Concepto -> APU -> Plano (Fase D.1): se
      // preserva tal cual el origenPlano del concepto (nunca se recalcula).
      origenPlano: c.origenPlano || null,
      quantitySource: c.quantitySource || 'MANUAL',
      generatorsStale: Boolean(c.generatorsStale)
    };
  });
  return aggregatePresupuesto(rows);
}
