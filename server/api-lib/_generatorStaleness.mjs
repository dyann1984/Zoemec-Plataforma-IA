/* F4 -- DETECCION AUTOMATICA de generadores desactualizados.
   Cada vez que se guarda la geometria de un plano (borrador o checkpoint),
   el servidor compara los generadores PERSISTIDOS de cada concepto ligado a
   ese plano contra los que produce la geometria vigente (misma funcion pura
   que el cliente: buildConceptGenerators). Si difieren, marca el concepto:
     concepto.generatorStaleness[planoId] = { stale, changes, fromQty, toQty, planoRevision, detectedAt }
   NUNCA cambia concepto.qty: la actualizacion economica sigue requiriendo la
   confirmacion explicita del usuario (set-generators). Best-effort: un fallo
   aqui jamas impide guardar el plano. */
import { buildConceptGenerators, diffGenerators, aggregateGenerators } from '../../src/domain/quantityGenerators.js';

const CONCEPTS = 'catalogConceptos';

export function modelAssignedConceptIds(model){
  return new Set([...(model?.walls || []), ...(model?.openings || []), ...(model?.spaces || []), ...(model?.dimensions || [])]
    .map(el => el.assignment?.conceptId).filter(Boolean));
}

export function computeConceptStaleness(concept, planoId, model, planoRevision){
  const stored = (concept.generadores || []).filter(g => g.planoId === planoId);
  const fresh = buildConceptGenerators(model, concept.id, { planoId, projectId: concept.projectId });
  const diff = diffGenerators(stored, fresh);
  const others = (concept.generadores || []).filter(g => g.planoId !== planoId);
  const toQty = aggregateGenerators([...others, ...fresh], concept.unit).qty;
  return { stale: diff.stale, changes: diff.changes, fromQty: Number(concept.qty) || 0, toQty, planoRevision: planoRevision ?? null, detectedAt: new Date().toISOString() };
}

/* Cada concepto se marca en SU PROPIA transaccion: se relee el concepto (una
   confirmacion concurrente de set-generators nunca se revierte con una copia
   vieja) y el plano (si ya avanzo de revision, esta evaluacion es obsoleta:
   la marca la hace el guardado mas nuevo). */
export async function markGeneratorStaleness(db, planoDoc){
  try{
    const model = planoDoc?.snapshot?.cadModel;
    if(!model || !planoDoc.projectId) return { checked: 0, marked: 0 };
    const planoId = String(planoDoc.id);
    let query = db.collection(CONCEPTS).where('projectId', '==', String(planoDoc.projectId));
    if(planoDoc.organizationId) query = query.where('organizationId', '==', planoDoc.organizationId);
    const snap = await query.get();
    const planoRef = db.collection('planoTakeoffs').doc(planoId);
    let checked = 0, marked = 0;
    for(const d of snap.docs){
      const ref = db.collection(CONCEPTS).doc(String(d.id || d.data().id));
      const outcome = await db.runTransaction(async (tx) => {
        const [cSnap, pSnap] = await Promise.all([tx.get(ref), tx.get(planoRef)]);
        if(!cSnap.exists) return null;
        if(pSnap.exists && Number(pSnap.data().revision || 0) !== Number(planoDoc.revision || 0)) return null; // evaluacion obsoleta
        const c = cSnap.data();
        if(c.archivedAt) return null;
        if(!planoDoc.organizationId && c.ownerUid !== planoDoc.ownerUid) return null;
        if(!(c.generadores || []).some(g => g.planoId === planoId)) return null; // solo conceptos que YA dependen de este plano
        const st = computeConceptStaleness(c, planoId, model, planoDoc.revision);
        const prev = c.generatorStaleness?.[planoId] || null;
        const same = prev ? (prev.stale === st.stale && JSON.stringify(prev.changes) === JSON.stringify(st.changes)) : !st.stale;
        if(same) return { checked: true, marked: false };
        const nextMap = { ...(c.generatorStaleness || {}) };
        if(st.stale) nextMap[planoId] = st; else delete nextMap[planoId];
        tx.set(ref, { ...c, generatorStaleness: nextMap, generatorsStale: Object.values(nextMap).some(x => x.stale) });
        return { checked: true, marked: st.stale };
      });
      if(outcome?.checked) checked++;
      if(outcome?.marked) marked++;
    }
    // Conceptos recien ligados en el modelo pero aun sin generadores de este
    // plano no se marcan: su vinculacion inicial ya es una accion explicita.
    return { checked, marked };
  }catch(err){
    console.warn('[generatorStaleness] no se pudo evaluar', err?.message || err);
    return { checked: 0, marked: 0, error: err?.message || String(err) };
  }
}
