/* Orquestador de Fase B: PDF acotado -> calibracion -> overlays -> revision
   -> cantidades. Unico punto donde se conectan:
     - api/visual-ai.mjs action=takeoffVector (analisis vector-first + IA)
     - server/api-lib/_route-plano-takeoffs.mjs (persistencia real,
       organizationId SIEMPRE server-side -- este componente nunca lo
       calcula ni lo envia)
     - src/domain/planoReview.js (estados/revision, SIN cambios de contrato)
     - src/domain/planoElementBuilder.js#recalibrateVectorElement
     - src/domain/planoQuantification.js (resumen final, punto 10)
     - PlanoOverlayViewer (visor 2D con capas, punto 8)
   Autosave (punto 11): cada cambio de `elementos` dispara un guardado
   debounced via action=save-version con expectedParentVersionId -- nunca se
   pierde un cambio por cerrar la pestaña, y un conflicto de version (otra
   pestaña/dispositivo guardo primero) se avisa explicitamente, nunca se
   sobreescribe en silencio. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { apiPost, apiGetSafe } from '../../services/apiClient.js';
import { uid } from '../../utils/id.js';
import PlanoOverlayViewer from './PlanoOverlayViewer.jsx';
import { PLANO_ELEMENT_STATES, ESCALA_FUENTES, applyPlanoElementReview } from '../../domain/planoReview.js';
import { recalibrateVectorElement, resolveEffectiveDimension } from '../../domain/planoElementBuilder.js';
import { calibrateScale } from '../../domain/planoMeasurement.js';
import { buildPlanoQuantification, summarizePlanoQuantification } from '../../domain/planoQuantification.js';

const LAYERS = ['muros', 'puertas', 'ventanas', 'columnas', 'areas', 'cotas', 'ejes'];
// Mapa best-effort tipo de elemento -> capitulo del Presupuesto (Fase D.1):
// un tipo sin entrada aqui cae en 'OTROS' via normalizeCapitulo del lado del
// servidor, nunca rompe la creacion del concepto -- esto es solo una
// sugerencia razonable, el usuario puede corregir el capitulo despues en el
// Catalogo.
const TIPO_A_CAPITULO = { muro: 'ALBANILERIA', puerta: 'CANCELERIA_CARPINTERIA', ventana: 'CANCELERIA_CARPINTERIA', columna: 'ESTRUCTURA', losa: 'ESTRUCTURA', piso: 'ACABADOS' };
// Estados que representan una revision humana YA aceptada (con o sin
// correccion) -- ambos son elegibles para "Agregar al catalogo", a
// diferencia de toApuSeed (planoReview.js) que historicamente solo acepta
// VALIDADO_POR_USUARIO; aqui se acepta tambien CORREGIDO_POR_USUARIO porque
// ES una revision humana aceptada, solo que con datos corregidos.
const CATALOG_ELIGIBLE_STATES = new Set(['VALIDADO_POR_USUARIO', 'CORREGIDO_POR_USUARIO']);
const ESCALA_LABEL = {
  [ESCALA_FUENTES.ESCALA_GRAFICA]: 'Escala gráfica declarada',
  [ESCALA_FUENTES.COTAS_TEXTO]: 'Cota detectada en el plano',
  [ESCALA_FUENTES.REFERENCIA_USUARIO]: 'Calibración manual del usuario',
  [ESCALA_FUENTES.NO_DETERMINADA]: 'Sin determinar'
};
const ORIGIN_LABEL = { VECTOR_DETECTED: 'Geometría vectorial real', AI_APPROXIMATION: 'Aproximación de IA', USER_DRAWN: 'Dibujado por el usuario', USER_CORRECTED: 'Corregido por el usuario' };
const ESTADO_LABEL = { PROPUESTO_POR_IA: 'Propuesto por IA', DETECTADO_VECTORIAL: 'Detectado (vectorial)', REQUIERE_REVISION: 'Requiere revisión', VALIDADO_POR_USUARIO: 'Validado', CORREGIDO_POR_USUARIO: 'Corregido', RECHAZADO: 'Rechazado' };

function readFileAsDataUrl(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function PlanoTakeoffWorkspace({ user, projectId = null, organizationId = null, onNeedProject, navigationTarget = null, onNavigationTargetConsumed }){
  const { t: tr } = useI18n();
  const [file, setFile] = useState(null);
  const [catalogAddedIds, setCatalogAddedIds] = useState(() => new Set());
  const [catalogBusyId, setCatalogBusyId] = useState(null);
  const [dataUrl, setDataUrl] = useState('');
  const [analysis, setAnalysis] = useState({ status: 'idle', data: null, error: null });
  const [elementos, setElementos] = useState([]);
  const [resolvedScale, setResolvedScale] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [visibleLayers, setVisibleLayers] = useState(Object.fromEntries(LAYERS.map(l => [l, true])));
  const [selectedId, setSelectedId] = useState(null);
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [pendingCalibration, setPendingCalibration] = useState(null); // {pixelDistance}
  const [calibrationDistance, setCalibrationDistance] = useState('');
  const [editDraft, setEditDraft] = useState({});
  const [saveState, setSaveState] = useState({ status: 'idle' }); // idle|saving|saved|error|conflict
  const [existingPlanos, setExistingPlanos] = useState([]);

  const planoIdRef = useRef(null);
  const currentVersionRef = useRef(null);
  const saveTimerRef = useRef(null);

  const persistSnapshot = useCallback(async (nextElementos, nextScale) => {
    if(!planoIdRef.current) return;
    setSaveState({ status: 'saving' });
    try{
      const snapshot = { elementos: nextElementos, escalaResuelta: nextScale, fileName: file?.name || '' };
      const res = await apiPost('/api/plano-takeoffs', {
        action: 'save-version', id: planoIdRef.current, snapshot, expectedParentVersionId: currentVersionRef.current
      });
      currentVersionRef.current = res.planoTakeoff.currentVersion;
      setSaveState({ status: 'saved', at: Date.now() });
    }catch(err){
      if(err?.code === 'VERSION_CONFLICT'){
        setSaveState({ status: 'conflict', message: tr('planoTakeoff.saveConflict') });
      }else{
        setSaveState({ status: 'error', message: err.message });
      }
    }
  }, [file, tr]);

  const scheduleAutosave = useCallback((nextElementos, nextScale) => {
    if(saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persistSnapshot(nextElementos, nextScale), 900);
  }, [persistSnapshot]);

  useEffect(() => () => { if(saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  const loadExistingPlanos = useCallback(async () => {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const data = await apiGetSafe(`/api/plano-takeoffs${query}`);
    setExistingPlanos(Array.isArray(data?.planoTakeoffs) ? data.planoTakeoffs : []);
  }, [projectId]);

  useEffect(() => { loadExistingPlanos(); }, [loadExistingPlanos]);

  const handleFile = async (selected) => {
    if(!selected) return;
    setFile(selected);
    const url = await readFileAsDataUrl(selected);
    setDataUrl(url);
    setAnalysis({ status: 'analyzing', data: null, error: null });
    setElementos([]);
    setSelectedId(null);
    try{
      const result = await apiPost('/api/visual-ai', { action: 'takeoffVector', fileName: selected.name, mimeType: selected.type, dataBase64: url });
      setAnalysis({ status: 'ready', data: result, error: null });
      setElementos(result.elementos);
      setResolvedScale(result.resolvedScale);
      setPageNumber(1);

      const planoId = `PLANO-${uid()}-${Date.now().toString(36)}`;
      planoIdRef.current = planoId;
      const created = await apiPost('/api/plano-takeoffs', {
        action: 'create', id: planoId, projectId,
        fileName: selected.name, mimeType: selected.type, numPages: result.numPages,
        snapshot: { elementos: result.elementos, escalaResuelta: result.resolvedScale, fileName: selected.name }
      });
      currentVersionRef.current = created.planoTakeoff.currentVersion;
      setSaveState({ status: 'saved', at: Date.now() });
      loadExistingPlanos();
    }catch(err){
      setAnalysis({ status: 'error', data: null, error: err.message || 'No se pudo analizar el plano.' });
      window.zoemecNotify?.(err.message || 'No se pudo analizar el plano.', 'error');
    }
  };

  const reopenPlanoTakeoff = async (id) => {
    const data = await apiGetSafe(`/api/plano-takeoffs?id=${encodeURIComponent(id)}`);
    if(!data?.planoTakeoff) return;
    planoIdRef.current = data.planoTakeoff.id;
    currentVersionRef.current = data.planoTakeoff.currentVersion;
    // El PDF original solo se re-descarga si Storage esta configurado en
    // este entorno (ver storeOriginalPlano, api/visual-ai.mjs) -- sin eso,
    // los elementos/cantidades SI se recuperan completos (persistencia
    // real, punto 11), pero el visor 2D no tiene sobre que dibujar el
    // fondo. Nunca se finge un PDF que no esta disponible.
    setFile({ name: data.planoTakeoff.fileName, type: data.planoTakeoff.mimeType });
    setDataUrl('');
    setElementos(data.planoTakeoff.snapshot?.elementos || []);
    setResolvedScale(data.planoTakeoff.snapshot?.escalaResuelta || null);
    setAnalysis({ status: 'ready', data: { numPages: data.planoTakeoff.numPages, vectorSummary: null }, error: null });
    setSaveState({ status: 'saved', at: Date.now() });
  };

  // "Ver en plano" (Fase D.1): reabre el planoTakeoff correcto, la pagina
  // correcta, y resalta (selecciona) el elemento de origen -- consume el
  // destino UNA sola vez (onNavigationTargetConsumed limpia el estado en
  // main.jsx para no reabrir en bucle en cada render).
  useEffect(() => {
    if(!navigationTarget?.planoTakeoffId) return;
    (async () => {
      if(planoIdRef.current !== navigationTarget.planoTakeoffId){
        await reopenPlanoTakeoff(navigationTarget.planoTakeoffId);
      }
      if(navigationTarget.page) setPageNumber(Number(navigationTarget.page) || 1);
      if(navigationTarget.elementId) setSelectedId(navigationTarget.elementId);
      onNavigationTargetConsumed?.();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationTarget]);

  const addElementToCatalog = async (el) => {
    if(!projectId){ window.zoemecNotify?.(tr('planoTakeoff.needsProjectMsg'), 'error'); onNeedProject?.(); return; }
    const concept = el.descripcionCorregida || el.descripcion;
    const unit = el.unidadCorregida || el.unidad;
    const qtyRaw = el.cantidadCorregida != null ? el.cantidadCorregida : el.cantidadPropuesta;
    const qty = Number(qtyRaw);
    if(!concept || !unit || !Number.isFinite(qty) || qty <= 0){
      window.zoemecNotify?.(tr('takeoff.notValidatedMsg'), 'error');
      return;
    }
    setCatalogBusyId(el.id);
    try{
      const origenElementoId = `${planoIdRef.current}:${el.id}`;
      const res = await apiPost('/api/catalogo-conceptos', {
        action: 'create', projectId,
        conceptos: [{
          clave: el.id, capitulo: TIPO_A_CAPITULO[el.tipo] || 'OTROS', concept, unit, qty,
          origenElementoId,
          origenPlano: {
            origen: 'plano-takeoff-vector', planoTakeoffId: planoIdRef.current, elementoId: el.id,
            page: pageNumber, bbox: el.geometry || null, fileName: file?.name || '',
            evidencia: el.evidencia || el.descripcion || '', fuenteEscala: resolvedScale?.fuente || null,
            confianza: el.confianzaIA ?? null, validatedBy: el.validatedBy || null, validatedAt: el.validatedAt || null
          }
        }]
      });
      setCatalogAddedIds(prev => new Set(prev).add(el.id));
      const wasUpdate = (res.updated || 0) > 0;
      window.zoemecNotify?.(tr(wasUpdate ? 'planoTakeoff.updatedInCatalogMsg' : 'planoTakeoff.addedToCatalogMsg', { concept }), 'success');
    }catch(err){
      window.zoemecNotify?.(err?.message || tr('planoTakeoff.addToCatalogFailMsg'), 'error');
    }finally{
      setCatalogBusyId(null);
    }
  };

  const updateElements = (updater) => {
    setElementos(prev => {
      const next = updater(prev);
      scheduleAutosave(next, resolvedScale);
      return next;
    });
  };

  const handleReview = (elementId, state, extra = {}) => {
    updateElements(prev => prev.map(el => el.id === elementId
      ? applyPlanoElementReview(el, { state, validatedBy: user?.email || user?.uid, ...extra })
      : el));
  };

  const handleCalibrationPoints = (points) => {
    const [a, b] = points;
    const pixelDistance = Math.hypot(b.x - a.x, b.y - a.y);
    setPendingCalibration({ pixelDistance });
  };

  const confirmCalibration = () => {
    const realDistance = Number(calibrationDistance);
    if(!pendingCalibration || !(realDistance > 0)) return;
    const scaleValue = calibrateScale(pendingCalibration.pixelDistance, realDistance);
    const nextScale = { fuente: ESCALA_FUENTES.REFERENCIA_USUARIO, realUnitsPerPdfPoint: scaleValue, evidencia: `Calibración manual: ${realDistance} m en ${pendingCalibration.pixelDistance.toFixed(1)}pt.` };
    setResolvedScale(nextScale);
    updateElements(prev => prev.map(el => recalibrateVectorElement(el, nextScale)));
    setPendingCalibration(null);
    setCalibrationDistance('');
    setCalibrationMode(false);
  };

  const selectedElement = elementos.find(el => el.id === selectedId) || null;
  const quantification = useMemo(() => buildPlanoQuantification(elementos), [elementos]);
  const summary = useMemo(() => summarizePlanoQuantification(quantification), [quantification]);
  const needsScale = !resolvedScale || resolvedScale.fuente === ESCALA_FUENTES.NO_DETERMINADA;

  return <div className="plano-takeoff-workspace">
    {analysis.status === 'idle' && existingPlanos.length > 0 && <div className="panel">
      <h3>{tr('planoTakeoff.existingTitle')}</h3>
      <ul>
        {existingPlanos.map(p => <li key={p.id}>
          {p.fileName || p.id} — {p.currentVersion} — <button type="button" className="soft" onClick={() => reopenPlanoTakeoff(p.id)}>{tr('planoTakeoff.reopen')}</button>
        </li>)}
      </ul>
    </div>}
    <div className="panel visual-uploader">
      <label className="visual-drop">
        <div><b>{file?.name || tr('planoTakeoff.uploadPdf')}</b><span>{tr('planoTakeoff.uploadPdfHint')}</span></div>
        <input type="file" accept="application/pdf" hidden onChange={e => handleFile(e.target.files[0])} />
      </label>
      {analysis.status === 'analyzing' && <p className="muted">{tr('planoTakeoff.analyzing')}</p>}
      {analysis.status === 'error' && <p style={{ color: 'var(--danger)' }}>{analysis.error}</p>}
      {saveState.status === 'saving' && <small className="muted">{tr('planoTakeoff.saving')}</small>}
      {saveState.status === 'saved' && <small className="muted">{tr('planoTakeoff.saved')}</small>}
      {saveState.status === 'conflict' && <small style={{ color: 'var(--danger)' }}>{saveState.message}</small>}
    </div>

    {analysis.status === 'ready' && <>
      {analysis.data?.vectorSummary && <p className="muted" style={{ fontSize: '.8rem' }}>
        {analysis.data.vectorSummary.hasUsableVectorGeometry
          ? tr('planoTakeoff.vectorFound', { count: elementos.filter(e => e.origin === 'VECTOR_DETECTED').length })
          : tr('planoTakeoff.vectorNotFound')}
      </p>}

      {needsScale && <div className="trial-banner" style={{ borderColor: 'var(--danger)' }}>
        <div><b>{tr('planoTakeoff.needsScaleTitle')}</b><p className="muted">{tr('planoTakeoff.needsScaleDesc')}</p></div>
        <div className="resume-banner-actions">
          <button type="button" onClick={() => setCalibrationMode(m => !m)}>{calibrationMode ? tr('planoTakeoff.cancelCalibration') : tr('planoTakeoff.startCalibration')}</button>
        </div>
      </div>}
      {!needsScale && resolvedScale && <p className="muted" style={{ fontSize: '.78rem' }}>{tr('planoTakeoff.scaleSourceLabel')}: <b>{ESCALA_LABEL[resolvedScale.fuente]}</b> — {resolvedScale.evidencia}</p>}

      {pendingCalibration && <div className="panel" style={{ maxWidth: 420 }}>
        <label>{tr('planoTakeoff.realDistanceLabel')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="number" step="any" value={calibrationDistance} onChange={e => setCalibrationDistance(e.target.value)} placeholder="4.20" />
          <button type="button" onClick={confirmCalibration}>{tr('planoTakeoff.confirmCalibration')}</button>
        </div>
      </div>}

      <div className="sc-actions" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
        {LAYERS.map(l => <label key={l} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: '.8rem' }}>
          <input type="checkbox" checked={visibleLayers[l]} onChange={e => setVisibleLayers(prev => ({ ...prev, [l]: e.target.checked }))} />{l}
        </label>)}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {dataUrl ? <PlanoOverlayViewer
          dataUrl={dataUrl} mimeType={file?.type} pageNumber={pageNumber} elementos={elementos}
          visibleLayers={visibleLayers} selectedElementId={selectedId} onElementClick={el => setSelectedId(el.id)}
          calibrationMode={calibrationMode} onCalibrationPoints={handleCalibrationPoints}
        /> : <p className="muted">{tr('planoTakeoff.noVisualAvailable')}</p>}
        {selectedElement && <div className="panel" style={{ minWidth: 260 }}>
          <h3>{selectedElement.tipo}</h3>
          <p>{selectedElement.descripcionCorregida || selectedElement.descripcion}</p>
          {(() => { const dim = resolveEffectiveDimension(selectedElement); return <>
            {dim.longitud != null && <p>{tr('planoTakeoff.length')}: {dim.longitud} m</p>}
            {dim.area != null && <p>{tr('planoTakeoff.area')}: {dim.area} m²</p>}
            {dim.altura != null && <p>{tr('planoTakeoff.height')}: {dim.altura} m</p>}
            {dim.volumen != null && <p>{tr('planoTakeoff.volume')}: {dim.volumen} m³</p>}
          </>; })()}
          <p className="muted">{tr('planoTakeoff.confidence')}: {selectedElement.confianzaIA}%</p>
          <p className="muted">{tr('planoTakeoff.origin')}: {ORIGIN_LABEL[selectedElement.origin] || selectedElement.origin}</p>
          <p className="muted">{tr('planoTakeoff.status')}: <b>{ESTADO_LABEL[selectedElement.estado]}</b></p>
          {selectedElement.estado !== 'RECHAZADO' && <div className="sc-actions">
            <button className="soft" onClick={() => handleReview(selectedElement.id, PLANO_ELEMENT_STATES.VALIDADO_POR_USUARIO)}>{tr('planoTakeoff.validate')}</button>
            <button className="soft" onClick={() => setEditDraft({ [selectedElement.id]: { cantidad: selectedElement.cantidadPropuesta, unidad: selectedElement.unidad } })}>{tr('planoTakeoff.correct')}</button>
            <button className="row-del" onClick={() => handleReview(selectedElement.id, PLANO_ELEMENT_STATES.RECHAZADO, { motivo: 'Rechazado desde el visor.' })}>{tr('planoTakeoff.reject')}</button>
          </div>}
          {CATALOG_ELIGIBLE_STATES.has(selectedElement.estado) && (
            catalogAddedIds.has(selectedElement.id)
              ? <p className="muted" style={{ marginTop: 8 }}>✓ {tr('planoTakeoff.alreadyInCatalog')}</p>
              : <div className="sc-actions" style={{ marginTop: 8 }}>
                <button disabled={catalogBusyId === selectedElement.id} onClick={() => addElementToCatalog(selectedElement)}>
                  {catalogBusyId === selectedElement.id ? tr('planoTakeoff.saving') : tr('planoTakeoff.addToCatalog')}
                </button>
              </div>
          )}
          {editDraft[selectedElement.id] && <div className="field-grid" style={{ marginTop: 8 }}>
            <input type="number" step="any" value={editDraft[selectedElement.id].cantidad} onChange={e => setEditDraft(prev => ({ ...prev, [selectedElement.id]: { ...prev[selectedElement.id], cantidad: e.target.value } }))} />
            <input value={editDraft[selectedElement.id].unidad} onChange={e => setEditDraft(prev => ({ ...prev, [selectedElement.id]: { ...prev[selectedElement.id], unidad: e.target.value } }))} />
            <button type="button" onClick={() => { handleReview(selectedElement.id, PLANO_ELEMENT_STATES.CORREGIDO_POR_USUARIO, { cantidadCorregida: editDraft[selectedElement.id].cantidad, unidadCorregida: editDraft[selectedElement.id].unidad }); setEditDraft({}); }}>{tr('planoTakeoff.saveCorrection')}</button>
          </div>}
        </div>}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h2>{tr('planoTakeoff.reviewSummaryTitle')}</h2>
        <ul>
          <li>{tr('planoTakeoff.summaryWalls')}: {summary.muros}</li>
          <li>{tr('planoTakeoff.summaryFloors')}: {summary.pisos}</li>
          <li>{tr('planoTakeoff.summarySlabs')}: {summary.losas}</li>
          <li>{tr('planoTakeoff.summaryDoors')}: {summary.puertas}</li>
          <li>{tr('planoTakeoff.summaryWindows')}: {summary.ventanas}</li>
        </ul>
        <p className="muted">{tr('planoTakeoff.pendingReview', { count: summary.pendientesRevision })}</p>
      </div>
    </>}
  </div>;
}
