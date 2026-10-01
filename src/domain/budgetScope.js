/* F2 -- UNA SOLA CANTIDAD ECONOMICA + trazabilidad Presupuesto/Explosion.
   Modulo PURO (sin React/red): unica fuente de verdad de QUE conceptos/APUs
   participan y con QUE cantidad, compartida por PresupuestoModule, el panel
   de Explosiones y los exportadores PDF/XLSX de la Explosion.

   REGLA AUTORITATIVA (documentada, sin excepciones silenciosas)
   ------------------------------------------------------------
   1. APU VINCULADO A CONCEPTO (concepto activo del catalogo con apuId, y ese
      APU existe y no esta archivado):
        cantidad autoritativa   = concepto.qty
        P.U.                    = calcAPUv2(composicion del APU, cantidadContractual = concepto.qty)
        importe del concepto    = concepto.qty x P.U.
        explosion (por renglon) = consumo unitario del APU x concepto.qty
      apu.cantidadObra (cantidad historica guardada en el APU al generarlo) se
      IGNORA para este calculo. El APU aporta el precio unitario y su
      composicion; el concepto aporta la cantidad.
   2. APU INDEPENDIENTE (ningun concepto activo lo referencia):
        cantidad = apu.cantidadObra (comportamiento historico intacto).
      NUNCA entra en la Explosion consolidada del PRESUPUESTO; solo en la
      explosion de PROYECTO, etiquetado como independiente.
   3. Renglones POR_LOTE (y equipo POR_LOTE/POR_JORNADA...): calcAPUv2 ya
      reparte el lote entre la cantidad contractual -- por eso el P.U. se
      calcula con concepto.qty. Si el APU tiene renglones POR_LOTE, su P.U.
      depende de la cantidad (`puDependeDeCantidad:true`); si no, el P.U. es
      identico con cualquier cantidad. Con cantidad 0 no hay lote ni consumo.
   4. Poblacion: Presupuesto y Explosion del presupuesto usan EXACTAMENTE los
      mismos conceptos: los conceptos activos (no archivados) del proyecto.
      Un concepto sin APU (o con APU archivado/inexistente) aparece en el
      presupuesto con importe 0 y en `excluded` de la explosion, nunca aporta
      consumo.
   5. Un mismo APU asociado a varios conceptos produce UNA contribucion por
      concepto, cada una con su propia cantidad.

   DESACTUALIZACION: se distingue
     CANTIDAD_ACTUALIZADA   -- concepto.qty != apu.cantidadObra: NO requiere
                               regenerar el APU; importe/explosion/totales ya
                               se recalculan con concepto.qty.
     COMPOSICION_CAMBIADA   -- el APU tiene una version vigente distinta de la
                               que se asocio al concepto (apuVersionId): el
                               P.U. cambio por edicion del APU; conviene revisar.
*/
import { calcAPUv2, toSafeNonNegativeNumber } from '../lib/apuCalc.js';
import { normalizeCapitulo, capituloLabel } from './presupuestoCapitulos.js';

export const QUANTITY_SOURCE = Object.freeze({
  CONCEPTO: 'CONCEPTO',
  APU_INDEPENDIENTE: 'APU_INDEPENDIENTE'
});

export const APU_STATUS = Object.freeze({
  OK: 'OK',
  SIN_APU: 'SIN_APU',
  APU_NO_DISPONIBLE: 'APU_NO_DISPONIBLE' // apuId apunta a un APU archivado o inexistente
});

export const SYNC_STATUS = Object.freeze({
  AL_DIA: 'AL_DIA',
  CANTIDAD_ACTUALIZADA: 'CANTIDAD_ACTUALIZADA',
  COMPOSICION_CAMBIADA: 'COMPOSICION_CAMBIADA'
});

const QTY_EPS = 1e-9;

/* Acepta el documento del servidor ({id, snapshot, archivedAt, ...}) o el APU
   plano "unwrapped" (projectApusCloud/useAuthoritativeApus) y regresa SIEMPRE
   la forma documento. */
export function normalizeApuDoc(x){
  if(!x || typeof x !== 'object') return null;
  if(x.snapshot && typeof x.snapshot === 'object'){
    return { ...x, id: x.id ?? x.snapshot.id ?? null };
  }
  return {
    id: x.id ?? null, snapshot: x,
    projectId: x.projectId ?? null, organizationId: x.organizationId ?? null,
    currentVersion: x.currentVersion ?? null, archivedAt: x.archivedAt ?? null
  };
}

export function hasLotRows(snapshot){
  const lote = r => r?.integracion === 'POR_LOTE';
  return ['materials', 'consumables', 'equipment', 'seguridad'].some(k => (snapshot?.[k] || []).some(lote));
}

/* P.U. del APU evaluado con la cantidad autoritativa (regla 1/3). */
export function effectiveApuTotals(snapshot, qty){
  const q = toSafeNonNegativeNumber(qty);
  const totals = calcAPUv2({ ...(snapshot || {}), cantidadObra: q });
  // F5 (aditivo): la cascada que calcAPUv2 YA calculo (direct + indirect +
  // finance + utility + cargos = pu), por unidad; los reportes la muestran
  // sin recalcularla. Ningun valor existente cambia.
  const breakdown = { direct: totals.direct, indirect: totals.indirect, finance: totals.finance, utility: totals.utility, cargos: totals.cargos };
  return { pu: totals.pu, direct: totals.direct, iva: totals.iva, importe: q * totals.pu, puDependeDeCantidad: hasLotRows(snapshot), breakdown };
}

export function classifySync({ concepto, apuDoc }){
  const snap = apuDoc?.snapshot || {};
  const versionAsociada = concepto?.apuVersionId || null;
  const versionVigente = apuDoc?.currentVersion || null;
  if(versionAsociada && versionVigente && versionAsociada !== versionVigente){
    return { status: SYNC_STATUS.COMPOSICION_CAMBIADA, versionAsociada, versionVigente };
  }
  const qty = toSafeNonNegativeNumber(concepto?.qty);
  const cantidadObraApu = snap.cantidadObra == null ? null : toSafeNonNegativeNumber(snap.cantidadObra);
  if(cantidadObraApu != null && Math.abs(cantidadObraApu - qty) > QTY_EPS){
    return { status: SYNC_STATUS.CANTIDAD_ACTUALIZADA, cantidadObraApu, cantidadConcepto: qty, requiereRegenerar: false };
  }
  return { status: SYNC_STATUS.AL_DIA };
}

function conceptRef(c){
  const capitulo = normalizeCapitulo(c?.capitulo);
  return { id: c.id, clave: c.clave || null, concept: c.concept || '', unit: c.unit || '', capitulo, capituloLabel: capituloLabel(capitulo), projectId: c.projectId ?? null };
}

/* Alcance del PRESUPUESTO. `conceptos` = catalogConceptos del proyecto;
   `apuDocs` = APUs del proyecto (servidor o unwrapped).
   Regresa:
     rows  -> un renglon por concepto activo (entrada de aggregatePresupuesto)
     lines -> una linea de explosion por concepto con APU disponible
     excluded -> por que algo NO aporta a la explosion (auditable) */
export function buildBudgetScope({ conceptos = [], apuDocs = [] } = {}){
  const docs = (Array.isArray(apuDocs) ? apuDocs : []).map(normalizeApuDoc).filter(d => d && d.id);
  const apuById = new Map(docs.map(d => [String(d.id), d]));
  const activos = (Array.isArray(conceptos) ? conceptos : []).filter(c => c && !c.archivedAt);
  const archivados = (Array.isArray(conceptos) ? conceptos : []).filter(c => c && c.archivedAt).map(c => c.id);
  const rows = [];
  const lines = [];
  const excluded = { conceptosArchivados: archivados, conceptosSinApu: [], conceptosConApuNoDisponible: [], apusFueraDelPresupuesto: [] };
  const referenced = new Set();

  for(const c of activos){
    const ref = conceptRef(c);
    const qty = toSafeNonNegativeNumber(c.qty);
    const base = { conceptoId: c.id, clave: c.clave, capitulo: ref.capitulo, concept: c.concept, unit: c.unit, qty, apuId: c.apuId || null, apuVersionId: c.apuVersionId || null, origenPlano: c.origenPlano || null };
    if(!c.apuId){
      excluded.conceptosSinApu.push(c.id);
      rows.push({ ...base, hasApu: false, apuStatus: APU_STATUS.SIN_APU, pu: 0, direct: 0, iva: 0, sync: null });
      continue;
    }
    referenced.add(String(c.apuId));
    const doc = apuById.get(String(c.apuId));
    if(!doc || doc.archivedAt){
      excluded.conceptosConApuNoDisponible.push({ conceptoId: c.id, apuId: c.apuId, reason: doc ? 'APU_ARCHIVADO' : 'APU_NO_ENCONTRADO' });
      rows.push({ ...base, hasApu: false, apuStatus: APU_STATUS.APU_NO_DISPONIBLE, pu: 0, direct: 0, iva: 0, sync: null });
      continue;
    }
    const totals = effectiveApuTotals(doc.snapshot, qty);
    const sync = classifySync({ concepto: c, apuDoc: doc });
    rows.push({ ...base, hasApu: true, apuStatus: APU_STATUS.OK, pu: totals.pu, direct: totals.direct, iva: totals.iva, puDependeDeCantidad: totals.puDependeDeCantidad, breakdown: totals.breakdown, sync, apuDoc: doc });
    lines.push({
      lineId: `${c.id}::${doc.id}`, apuDoc: doc, qty,
      quantitySource: QUANTITY_SOURCE.CONCEPTO, concepto: ref
    });
  }
  for(const d of docs){
    if(!referenced.has(String(d.id)) && !d.archivedAt) excluded.apusFueraDelPresupuesto.push(d.id);
  }
  return { rows, lines, excluded };
}

/* Explosion de PROYECTO: lineas del presupuesto + APUs independientes (con
   su propia cantidadObra, etiquetados). Los APUs referenciados por un
   concepto NUNCA se duplican como independientes. */
export function buildProjectScope({ conceptos = [], apuDocs = [] } = {}){
  const budget = buildBudgetScope({ conceptos, apuDocs });
  const independent = budget.excluded.apusFueraDelPresupuesto
    .map(id => (Array.isArray(apuDocs) ? apuDocs : []).map(normalizeApuDoc).find(d => d && String(d.id) === String(id)))
    .filter(Boolean)
    .map(independentLine);
  return { ...budget, lines: [...budget.lines, ...independent], independentCount: independent.length };
}

export function independentLine(apuDocLike){
  const doc = normalizeApuDoc(apuDocLike);
  return {
    lineId: `APU::${doc.id}`, apuDoc: doc, qty: toSafeNonNegativeNumber(doc.snapshot?.cantidadObra),
    quantitySource: QUANTITY_SOURCE.APU_INDEPENDIENTE, concepto: null
  };
}

/* Normaliza la entrada de los motores de explosion: acepta lineas (F2) o,
   por compatibilidad, un arreglo de documentos APU (cada uno se trata como
   APU INDEPENDIENTE con su cantidadObra, comportamiento historico). */
export function toExplosionLines(input){
  return (Array.isArray(input) ? input : []).filter(Boolean)
    .map(x => (x.apuDoc && x.quantitySource) ? x : independentLine(x));
}
