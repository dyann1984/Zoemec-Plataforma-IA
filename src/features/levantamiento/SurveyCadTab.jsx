/* Pestaña "Editar plano 2D/3D" de un Space del Levantamiento.

   F4 -- el CAD es la FUENTE GEOMETRICA AUTORITATIVA del espacio y vive UNA
   sola vez en el servidor (planoTakeoffs, id estable surveyPlanoKey = el
   mismo planoId que ya usan generadores/catalogo). El levantamiento solo
   guarda survey.cadLinks[spaceId] -> planoId (nunca otra copia de muros).
     - Sin plano: boton "Generar plano CAD" (deriva la geometria inicial de
       largo/ancho/alto capturados con surveyToCadModel y la persiste).
     - Con plano: se carga del servidor (misma geometria para cualquier
       miembro de la empresa, en cualquier dispositivo).
     - Autosave = borrador (sin version historica); "Guardar version" =
       checkpoint inmutable; 409 si otro usuario guardo antes.
   Un levantamiento migrado del bloque local ya trae su plano creado por la
   migracion (ver levantamientoCloud.js). */
import { useCallback, useEffect, useRef, useState } from 'react';
import CadWorkspace from '../planos/cad/CadWorkspace.jsx';
import { surveyToCadModel, surveyPlanoKey } from '../../domain/surveyToCadModel.js';
import { validateCadModel } from '../../domain/cadModel.js';
import { spacePlanoId, linkSpaceToPlano } from '../../domain/levantamientoCadLink.js';
import { loadPlano, createPlano } from '../planos/cadPlanoCloud.js';
import { useCadDraftPersistence } from '../planos/useCadDraftPersistence.js';

export function SurveyCadTab({ survey, space, projectId, user, onChange, onNeedProject, onModelChange = null }){
  const linkedPlanoId = spacePlanoId(survey, space?.id);
  const planoId = linkedPlanoId || (space?.id ? surveyPlanoKey(survey.id, space.id) : null);
  const [state, setState] = useState({ status: 'loading', model: null, key: null, error: null, doc: null });
  const fileName = `${survey.name || survey.id} · ${space?.name || space?.id || ''}`;
  const persistence = useCadDraftPersistence({ buildSnapshot: model => ({ elementos: [], escalaResuelta: null, fileName, cadModel: model }) });
  const latestModelRef = useRef(null);

  const load = useCallback(async () => {
    if(!planoId) return;
    setState(s => ({ ...s, status: 'loading', error: null }));
    try{
      const doc = await loadPlano(planoId);
      if(!doc){ setState({ status: 'empty', model: null, key: null, error: null, doc: null }); return; }
      persistence.bind(planoId, Number(doc.revision || 0), doc.currentVersion);
      setState({ status: 'ready', model: doc.snapshot?.cadModel, key: `${planoId}:${doc.revision || 0}:${Date.now()}`, error: null, doc });
      // Plano existente sin vinculo (p.ej. creado antes de F4): se vincula.
      if(!linkedPlanoId) onChange(linkSpaceToPlano(survey, space.id, planoId, { by: user?.email || null }));
    }catch(err){
      setState({ status: 'error', model: null, key: null, error: err?.message || 'No se pudo cargar el plano.', doc: null });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planoId]);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    if(!projectId){ onNeedProject?.(); return; }
    setState(s => ({ ...s, status: 'loading' }));
    try{
      const { model } = surveyToCadModel(space);
      const doc = await createPlano({ planoId, projectId, fileName, mimeType: 'application/x-zoemec-survey', cadModel: model, sourceKind: 'SURVEY', surveyId: survey.id, spaceId: space.id, reason: 'Geometria inicial desde la captura del levantamiento' });
      persistence.bind(planoId, Number(doc.revision || 0), doc.currentVersion);
      onChange(linkSpaceToPlano(survey, space.id, planoId, { by: user?.email || null }));
      setState({ status: 'ready', model: doc.snapshot?.cadModel || model, key: `${planoId}:${doc.revision || 1}`, error: null, doc });
    }catch(err){
      setState({ status: 'error', model: null, key: null, error: err?.message || 'No se pudo generar el plano CAD.', doc: null });
    }
  };

  if(state.status === 'loading') return <div className="panel"><p className="muted">Cargando plano CAD…</p></div>;
  if(state.status === 'error') return <div className="panel"><p style={{ color: 'var(--danger)' }}>{state.error}</p><button type="button" className="soft" onClick={load}>Reintentar</button></div>;
  if(state.status === 'empty'){
    const hasDims = Number(space?.length) > 0 && Number(space?.width) > 0 && Number(space?.height) > 0;
    return <div className="panel">
      <p><b>Este espacio aún no tiene plano CAD.</b></p>
      <p className="muted" style={{ fontSize: '.84rem' }}>ZOEMEC generará la geometría inicial (muros, vanos, espacio y cotas) desde la captura: {(Number(space?.length) || 0).toFixed(2)} × {(Number(space?.width) || 0).toFixed(2)} × {(Number(space?.height) || 0).toFixed(2)} m. A partir de ese momento <b>el plano CAD es la fuente geométrica</b> de este espacio: sus cantidades salen del plano y las medidas de captura quedan como referencia.</p>
      {hasDims
        ? <button type="button" onClick={generate}>Generar plano CAD</button>
        : <p className="muted">Captura largo, ancho y alto en la pestaña Datos para poder generar el plano.</p>}
    </div>;
  }

  const issues = validateCadModel(state.model);
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const { saveState } = persistence;
  const topBarExtra = <>
    <span className="cad-file-name" title={planoId}>Plano del espacio · rev. {saveState.revision ?? state.doc?.revision ?? '—'}</span>
    <button type="button" className="soft" disabled={saveState.status === 'saving'} onClick={async () => {
      try{ const doc = await persistence.checkpoint(latestModelRef.current || state.model, 'Guardar versión'); if(doc) window.zoemecNotify?.(`Versión ${doc.currentVersion} guardada (rev. ${doc.revision}).`, 'success'); }
      catch(err){ window.zoemecNotify?.(err.message, 'error'); }
    }}>Guardar versión</button>
  </>;

  return <div>
    <p className="muted" style={{ fontSize: '.82rem', margin: '0 0 8px' }}>
      Plano CAD del espacio <b>{space.name || space.id}</b> — <b>fuente geométrica autoritativa</b> (guardado en el servidor, compartido con tu empresa). La captura inicial ({(Number(space.length) || 0).toFixed(2)} × {(Number(space.width) || 0).toFixed(2)} × {(Number(space.height) || 0).toFixed(2)} m) se conserva solo como referencia.
      {errorCount > 0 && <> · <b>{errorCount} advertencia{errorCount === 1 ? '' : 's'} de geometría</b>: revisa en el panel derecho.</>}
    </p>
    {saveState.status === 'conflict' && <p className="cad-banner is-error" role="alert">{saveState.message} <button type="button" className="soft" onClick={load}>Recargar</button></p>}
    <CadWorkspace
      initialModel={state.model}
      modelKey={state.key}
      underlay={null}
      onModelChange={(m) => { latestModelRef.current = m; persistence.onModelChange(m); onModelChange?.(m); }}
      persistNow={persistence.persistNow}
      saveLabel={persistence.saveLabel}
      topBarExtra={topBarExtra}
      projectId={projectId}
      planoId={planoId}
      fileName={fileName}
      user={user}
      onNeedProject={onNeedProject}
    />
  </div>;
}
