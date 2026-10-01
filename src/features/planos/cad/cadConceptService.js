/* Puente del Plano Inteligente hacia Catalogo de conceptos y APU (punto 15).
   Solo red: la cantidad SIEMPRE se calcula en src/domain/cadTakeoff.js a
   partir del objeto geometrico; aqui unicamente se envia. Reusa los
   endpoints existentes (/api/catalogo-conceptos, /api/apus) y el mismo
   contrato de origen que ya usa el flujo de takeoff
   (syncQuantificationToCatalog, origenElementoId `${planoId}:${elementId}`),
   asi que reenviar el mismo objeto actualiza su concepto en vez de
   duplicarlo. */
import { apiGetSafe, apiPost } from '../../../services/apiClient.js';
import { syncQuantificationToCatalog } from '../../../domain/quantificationCostBridge.js';
import { buildConceptGenerators, diffGenerators, aggregateGenerators } from '../../../domain/quantityGenerators.js';

export async function listProjectConcepts(projectId){
  if(!projectId) return [];
  const data = await apiGetSafe(`/api/catalogo-conceptos?projectId=${encodeURIComponent(projectId)}`);
  return Array.isArray(data?.conceptos) ? data.conceptos : [];
}

export async function listProjectApus(projectId){
  if(!projectId) return [];
  const data = await apiGetSafe(`/api/apus?projectId=${encodeURIComponent(projectId)}`);
  return Array.isArray(data?.apus) ? data.apus : [];
}

/* Crea (o actualiza, si ya existia desde este mismo objeto) el concepto. */
export async function createConceptFromElement({ projectId, planoId, elementId, concept, unit, qty, capitulo, fileName, user }){
  const res = await syncQuantificationToCatalog([{
    projectId, concept, unit, qty, sourceType: 'takeoff',
    sourceRecordId: planoId, sourceElementId: elementId, planId: planoId, page: 1, fileName: fileName || '',
    clave: elementId, capitulo: capitulo || 'OTROS', confirmedBy: user || null
  }], { reason: `Cuantificado desde el plano (${elementId})` });
  const created = Array.isArray(res?.conceptos) ? res.conceptos[0] : null;
  if(!created) throw new Error('El catalogo no devolvio el concepto creado.');
  return created;
}

/* Cantidad del concepto = suma de los objetos ligados (conceptQuantityFromModel).
   F3: se conserva solo para conceptos MANUALES; los ligados al plano usan
   syncConceptGenerators (el servidor rechaza con 409 editar a mano una
   cantidad que proviene de generadores). */
export async function updateConceptQuantity(conceptId, qty){
  const res = await apiPost('/api/catalogo-conceptos', { action: 'update', id: conceptId, patch: { qty } });
  return res?.concepto || null;
}

/* F3 -- Construye (determinista, sin IA) los generadores de TODOS los
   elementos de ESTE plano ligados al concepto y los persiste. El servidor
   verifica la aritmetica y recalcula concepto.qty = SUM(generadores);
   F2 toma esa cantidad para Presupuesto y Explosion. expectedRevision:
   revision del plano que este cliente conoce (409 si otro la cambio). */
export async function syncConceptGenerators({ conceptId, projectId, planoId, fileName = '', model, expectedRevision = undefined, reason = null, planoRevision = null }){
  const generators = buildConceptGenerators(model, conceptId, { planoId, projectId, fileName });
  // F4: planoRevision = revision de la geometria que el usuario reviso; el
  // servidor reconstruye los generadores desde el plano persistido y
  // responde 409 GEOMETRY_CHANGED si no coinciden.
  const res = await apiPost('/api/catalogo-conceptos', { action: 'set-generators', id: conceptId, planoId, generators, expectedRevision, reason, planoRevision });
  return { concepto: res?.concepto || null, diff: res?.diff || null, aggregate: res?.aggregate || null, generators, geometryVerified: Boolean(res?.geometryVerified) };
}

/* F3 -- Vista previa de "Recalcular generadores" de un plano: por cada
   concepto con generadores de este plano (o con elementos ligados en el
   modelo), que cambiaria. No escribe nada. */
export function previewPlanoGenerators({ concepts = [], planoId, projectId, model }){
  const assigned = new Set([...(model?.walls || []), ...(model?.openings || []), ...(model?.spaces || []), ...(model?.dimensions || [])]
    .map(el => el.assignment?.conceptId).filter(Boolean));
  return concepts
    .filter(c => assigned.has(c.id) || (c.generadores || []).some(g => g.planoId === planoId))
    .map(c => {
      const stored = (c.generadores || []).filter(g => g.planoId === planoId);
      const fresh = buildConceptGenerators(model, c.id, { planoId, projectId });
      const others = (c.generadores || []).filter(g => g.planoId !== planoId);
      const newQty = aggregateGenerators([...others, ...fresh], c.unit).qty;
      return { concepto: c, diff: diffGenerators(stored, fresh), fresh, fromQty: Number(c.qty) || 0, toQty: newQty, expectedRevision: Number(c.generatorRevisions?.[planoId] || 0) };
    });
}

/* F3 -- Aplica la vista previa (solo los conceptos desactualizados). */
export async function recalculatePlanoGenerators({ projectId, planoId, fileName = '', model, preview, planoRevision = null }){
  const results = [];
  for(const p of preview.filter(x => x.diff.stale || Math.abs(x.toQty - x.fromQty) > 0.00005)){
    results.push(await syncConceptGenerators({ conceptId: p.concepto.id, projectId, planoId, fileName, model, expectedRevision: p.expectedRevision, reason: 'Recalcular generadores del plano', planoRevision }));
  }
  return results;
}

/* F4 -- deteccion AUTOMATICA en el CAD (sin escribir nada): conceptos que ya
   dependen de este plano y cuyos generadores guardados ya no coinciden con
   la geometria vigente. */
export function staleConceptsForModel({ concepts = [], planoId, projectId, model }){
  return previewPlanoGenerators({ concepts, planoId, projectId, model })
    .filter(p => (p.concepto.generadores || []).some(g => g.planoId === planoId) && p.diff.stale);
}

export async function associateConceptApu(conceptId, apuId){
  const res = await apiPost('/api/catalogo-conceptos', { action: 'associate-apu', id: conceptId, apuId, matchMethod: 'manual-plano' });
  return res?.concepto || null;
}
