/* F3/F4 -- Generadores del plano en el CAD.
   - usePlanoConcepts: conceptos del proyecto (para comparar lo guardado con
     la geometria vigente). Se recarga tras cada confirmacion.
   - CadStalenessBanner (F4, AUTOMATICO): al editar la geometria, marca
     "Generadores desactualizados" en cuanto un concepto que ya depende del
     plano deja de coincidir. NUNCA recalcula: solo avisa.
   - CadGeneratorsSection: REVISAR CAMBIOS (elemento, antes -> nuevo,
     concepto antes -> despues) y RECALCULAR GENERADORES solo al confirmar.
     Antes de enviar, guarda YA la geometria (persistNow) para que el
     servidor valide contra el mismo plano (planoRevision). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { listProjectConcepts, previewPlanoGenerators, recalculatePlanoGenerators, staleConceptsForModel } from './cadConceptService.js';
import { fmtQ, GENERATOR_CHANGE, generatorOperationText } from '../../../domain/quantityGenerators.js';

const CHANGE_LABEL = { [GENERATOR_CHANGE.MODIFICADO]: 'modificado', [GENERATOR_CHANGE.NUEVO]: 'nuevo', [GENERATOR_CHANGE.ELIMINADO]: 'eliminado' };

export function usePlanoConcepts(projectId, planoId){
  const [concepts, setConcepts] = useState([]);
  const refresh = useCallback(async () => {
    if(!projectId || !planoId){ setConcepts([]); return []; }
    try{ const list = await listProjectConcepts(projectId); setConcepts(list); return list; }catch{ return []; }
  }, [projectId, planoId]);
  useEffect(() => { refresh(); }, [refresh]);
  return { concepts, refresh };
}

export function CadStalenessBanner({ concepts, projectId, planoId, model, onReview }){
  const stale = useMemo(() => (projectId && planoId ? staleConceptsForModel({ concepts, planoId, projectId, model }) : []), [concepts, planoId, projectId, model]);
  if(!stale.length) return null;
  return <p className="cad-banner is-error" role="status">
    <b>Generadores desactualizados</b>: {stale.length} concepto(s) del catálogo ya no coinciden con la geometría ({stale.map(p => `${p.concepto.clave || p.concepto.concept}: ${fmtQ(p.fromQty)} → ${fmtQ(p.toQty)} ${p.concepto.unit}`).join(' · ')}). El presupuesto NO cambia hasta que confirmes.{' '}
    <button type="button" className="soft" onClick={onReview}>Revisar cambios</button>
  </p>;
}

export default function CadGeneratorsSection({ projectId, planoId, fileName, getModel, persistNow = null, concepts = null, refreshConcepts = null, onNotify, onError, autoOpenKey = 0 }){
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const review = useCallback(async () => {
    setBusy(true);
    try{
      const list = refreshConcepts ? await refreshConcepts() : (concepts || await listProjectConcepts(projectId));
      setPreview(previewPlanoGenerators({ concepts: list, planoId, projectId, model: getModel() }));
    }catch(err){ onError?.(err.message); }finally{ setBusy(false); }
  }, [refreshConcepts, concepts, projectId, planoId, getModel, onError]);

  // El banner automatico abre la revision directamente.
  useEffect(() => { if(autoOpenKey) review(); }, [autoOpenKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if(!projectId || !planoId) return null;

  const apply = async () => {
    setBusy(true);
    try{
      const model = getModel();
      const planoRevision = persistNow ? await persistNow(model) : null;
      const results = await recalculatePlanoGenerators({ projectId, planoId, fileName, model, preview, planoRevision });
      onNotify?.(`${results.length} concepto(s) actualizados desde sus generadores${results.some(r => r.geometryVerified) ? ' (verificados contra el plano guardado)' : ''}.`, 'success');
      setPreview(null);
      await refreshConcepts?.();
    }catch(err){ onError?.(err.code === 'GEOMETRY_CHANGED' ? `${err.message}` : err.message); }finally{ setBusy(false); }
  };

  const stale = (preview || []).filter(p => p.diff.stale || Math.abs(p.toQty - p.fromQty) > 0.00005);
  return <section>
    <h4>Generadores</h4>
    <p className="muted cad-small">Cantidades del catálogo que provienen de este plano. Revisa los cambios antes de aplicarlos: el presupuesto solo cambia al confirmar.</p>
    <div className="cad-actions"><button type="button" className="soft" disabled={busy} onClick={review}>{busy && !preview ? 'Revisando…' : 'Revisar generadores'}</button></div>
    {preview && (stale.length === 0
      ? <p className="muted cad-small">Todos los generadores de este plano están al día ({preview.length} concepto(s)).</p>
      : <>
        {stale.map(p => <div key={p.concepto.id} className="cad-row" style={{ display: 'block' }}>
          <b>{p.concepto.clave ? `${p.concepto.clave} · ` : ''}{p.concepto.concept}</b>
          <div className="cad-small">Cantidad: {fmtQ(p.fromQty)} → <b>{fmtQ(p.toQty)}</b> {p.concepto.unit}</div>
          {p.diff.changes.map(c => <div key={c.generatorId} className="cad-small">{c.elementId} ({CHANGE_LABEL[c.change] || c.change}):
            <div>ANTES {generatorOperationText((p.concepto.generadores || []).find(g => g.generatorId === c.generatorId), p.concepto.unit)}</div>
            <div><b>NUEVO {generatorOperationText((p.fresh || []).find(g => g.generatorId === c.generatorId), p.concepto.unit)}</b></div>
          </div>)}
        </div>)}
        <div className="cad-actions">
          <button type="button" disabled={busy} onClick={apply}>{busy ? 'Aplicando…' : `Recalcular generadores (${stale.length})`}</button>
          <button type="button" className="soft" disabled={busy} onClick={() => setPreview(null)}>Cancelar</button>
        </div>
      </>)}
  </section>;
}
