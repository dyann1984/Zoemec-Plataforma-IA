/* Orquestador del Plano Inteligente (B.1: plano -> reconocimiento -> objetos
   editables -> medidas -> cuantificacion -> 3D -> APU). Unico punto donde se
   conectan:
     - api/visual-ai.mjs action=takeoffVector (analisis vector-first + IA,
       SIN cambios): sus elementos se convierten en PROPUESTAS pendientes del
       modelo comun (src/domain/cadRecognition.js), nunca en datos validados.
     - server/api-lib/_route-plano-takeoffs.mjs (persistencia versionada,
       organizationId SIEMPRE server-side): el snapshot ahora incluye
       `cadModel` (geometria, escala, IDs, aberturas, cotas, validaciones y
       ligas concepto/APU) ademas de los `elementos` del analisis de siempre.
     - CadWorkspace (canvas 2D + 3D + propiedades + revision), que es dueno
       del historial de edicion.
   Autosave: cada paso de historial dispara un guardado debounced con
   expectedParentVersionId; nunca se pisan dos guardados (uno a la vez, el
   siguiente sale con la version que devolvio el anterior) y un conflicto
   real (otra pestaña/dispositivo) se avisa, nunca se sobreescribe. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { apiPost, apiGetSafe } from '../../services/apiClient.js';
import { uid } from '../../utils/id.js';
import { loadPdfDocument } from '../../lib/pdfClientRender.js';
import CadWorkspace from './cad/CadWorkspace.jsx';
import { createEmptyCadModel } from '../../domain/cadModel.js';
import { buildCadModelFromRecognition, proposeScale } from '../../domain/cadRecognition.js';
import { buildFixtureCadModel } from '../../domain/cadFixture.js';
import { saveUnderlay, loadUnderlay } from './underlayCache.js';
import { useCadDraftPersistence } from './useCadDraftPersistence.js';

const LOCAL_KEY = 'zoemec.cadPlano.local';

function readFileAsDataUrl(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImageSize(url){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    img.src = url;
  });
}

/* Pagina 1 del PDF -> imagen de fondo + mapeo PDF->viewport a escala 1.
   Render de una sola pasada (sin cancelaciones), por eso no aplica el
   problema de render colgado documentado en PlanoOverlayViewer. */
async function renderPdfUnderlay(dataUrl, pageNumber = 1){
  const doc = await loadPdfDocument(dataUrl);
  const page = await doc.getPage(pageNumber);
  const vp1 = page.getViewport({ scale: 1 });
  const renderScale = Math.min(3, Math.max(1.5, 2400 / Math.max(vp1.width, vp1.height)));
  const vp = page.getViewport({ scale: renderScale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return {
    underlay: { url: canvas.toDataURL('image/jpeg', 0.85), kind: 'pdf', page: pageNumber, widthUnits: vp1.width, heightUnits: vp1.height },
    toViewport: (x, y) => { const [vx, vy] = vp1.convertToViewportPoint(x, y); return { x: vx, y: vy }; },
    numPages: doc.numPages
  };
}

export default function PlanoTakeoffWorkspace({ user, projectId = null, organizationId = null, onNeedProject, onReturnToWorkspace, navigationTarget = null, onNavigationTargetConsumed }){
  const { t: tr } = useI18n();
  const [fileName, setFileName] = useState('');
  const [status, setStatus] = useState({ kind: 'idle', message: '' }); // idle|loading|analyzing|ready|error
  const [elementos, setElementos] = useState([]);
  const [resolvedScale, setResolvedScale] = useState(null);
  const [underlay, setUnderlay] = useState(null);
  const [cad, setCad] = useState(() => ({ model: createEmptyCadModel(), key: 'empty' }));
  const [report, setReport] = useState(null);
  const [saveState, setSaveState] = useState({ status: 'idle' });
  const [existingPlanos, setExistingPlanos] = useState([]);
  const [planoId, setPlanoId] = useState(null);
  const [focusElementId, setFocusElementId] = useState(null);
  const [localDraft] = useState(() => { try{ return JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); }catch{ return null; } });

  const [pendingPdf, setPendingPdf] = useState(null); // F4: seleccion de pagina de un PDF multipagina
  const [underlayScope, setUnderlayScope] = useState(null); // 'device' | 'missing' | null

  const planoIdRef = useRef(null);
  const latestRef = useRef({ elementos: [], resolvedScale: null, fileName: '' });
  latestRef.current = { elementos, resolvedScale, fileName };
  const latestModelRef = useRef(null);

  /* F4: AUTOSAVE = borrador vigente (save-draft, sin version historica);
     "Guardar version" = checkpoint inmutable. */
  const persistence = useCadDraftPersistence({
    buildSnapshot: model => ({ elementos: latestRef.current.elementos, escalaResuelta: latestRef.current.resolvedScale, fileName: latestRef.current.fileName, cadModel: model })
  });

  const setPlano = id => { planoIdRef.current = id; setPlanoId(id); };

  const loadExistingPlanos = useCallback(async () => {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const data = await apiGetSafe(`/api/plano-takeoffs${query}`);
    setExistingPlanos(Array.isArray(data?.planoTakeoffs) ? data.planoTakeoffs : []);
  }, [projectId]);
  useEffect(() => { loadExistingPlanos(); }, [loadExistingPlanos]);

  /* ---------- persistencia ---------- */
  const onModelChange = useCallback((model) => {
    latestModelRef.current = model;
    if(planoIdRef.current){ persistence.onModelChange(model); return; }
    // Sin plano en el servidor (sin conexion): borrador SOLO local, avisado.
    const { elementos: els, resolvedScale: sc, fileName: fn } = latestRef.current;
    try{ localStorage.setItem(LOCAL_KEY, JSON.stringify({ snapshot: { elementos: els, escalaResuelta: sc, fileName: fn, cadModel: model }, at: Date.now() })); setSaveState({ status: 'local', at: Date.now() }); }
    catch{ setSaveState({ status: 'error', message: 'No se pudo guardar localmente.' }); }
  }, [persistence]);

  const createRemotePlano = async ({ name, mimeType, numPages = 1, snapshot, underlayForCache, sourceKind = null }) => {
    const id = `PLANO-${uid()}-${Date.now().toString(36)}`;
    try{
      const created = await apiPost('/api/plano-takeoffs', { action: 'create', id, projectId, fileName: name, mimeType, numPages, snapshot, sourceKind });
      setPlano(id);
      persistence.bind(id, Number(created.planoTakeoff.revision || 0), created.planoTakeoff.currentVersion);
      setSaveState({ status: 'saved', at: Date.now(), version: created.planoTakeoff.currentVersion });
      if(underlayForCache){ saveUnderlay(id, underlayForCache); setUnderlayScope('device'); }
      loadExistingPlanos();
    }catch(err){
      setPlano(null);
      persistence.bind(null, null);
      try{ localStorage.setItem(LOCAL_KEY, JSON.stringify({ snapshot, at: Date.now() })); }catch{ /* sin espacio */ }
      setSaveState({ status: 'local', message: `Sin conexión con el servidor (${err.message || 'error'}): guardado solo en este equipo.` });
    }
  };

  const checkpoint = async () => {
    if(!planoIdRef.current){ window.zoemecNotify?.('Guarda el plano en el servidor antes de crear una versión.', 'error'); return; }
    try{
      const doc = await persistence.checkpoint(latestModelRef.current || cad.model, 'Guardar versión');
      if(doc) window.zoemecNotify?.(`Versión ${doc.currentVersion} guardada (rev. ${doc.revision}).`, 'success');
    }catch(err){ window.zoemecNotify?.(err.message, 'error'); }
  };

  const startModel = (model, { key, rep = null } = {}) => {
    setCad({ model, key: key || `${Date.now()}` });
    setReport(rep);
  };

  /* ---------- carga de plano ---------- */
  const handleFile = async (selected) => {
    if(!selected) return;
    const isPdf = /pdf/i.test(selected.type) || /\.pdf$/i.test(selected.name);
    const isImage = /^image\//i.test(selected.type);
    if(!isPdf && !isImage){ window.zoemecNotify?.('Formato no soportado: usa PDF, PNG o JPG.', 'error'); return; }
    setFileName(selected.name);
    setStatus({ kind: 'loading', message: 'Preparando el plano…' });
    setElementos([]); setResolvedScale(null); setFocusElementId(null);
    try{
      const dataUrl = await readFileAsDataUrl(selected);
      if(isImage){
        const { width, height } = await loadImageSize(dataUrl);
        const ul = { url: dataUrl, kind: 'image', page: 1, widthUnits: width, heightUnits: height };
        const scale = proposeScale(null, { unitKind: 'image' });
        const model = createEmptyCadModel({ scale, underlay: { kind: 'image', page: 1, widthUnits: width, heightUnits: height, metersPerUnit: scale.metersPerUnit } });
        setUnderlay(ul);
        startModel(model);
        setStatus({ kind: 'ready', message: 'Imagen cargada: calibra la escala con una medida conocida y traza encima.' });
        await createRemotePlano({ name: selected.name, mimeType: selected.type, snapshot: { elementos: [], escalaResuelta: null, fileName: selected.name, cadModel: model }, underlayForCache: ul, sourceKind: 'PLANO_IMAGEN' });
        return;
      }
      // F4: PDF multipagina -> el usuario elige la pagina a trazar (una por plano).
      const pdfDoc = await loadPdfDocument(dataUrl);
      if(pdfDoc.numPages > 1){
        setPendingPdf({ dataUrl, name: selected.name, type: selected.type, numPages: pdfDoc.numPages, page: 1 });
        setStatus({ kind: 'ready', message: `El PDF tiene ${pdfDoc.numPages} páginas: elige cuál trazar.` });
        return;
      }
      await processPdfPage({ dataUrl, name: selected.name, type: selected.type }, 1);
    }catch(err){
      setStatus({ kind: 'error', message: err.message || 'No se pudo abrir el plano.' });
      window.zoemecNotify?.(err.message || 'No se pudo abrir el plano.', 'error');
    }
  };

  const processPdfPage = async ({ dataUrl, name, type }, pageNumber) => {
    setPendingPdf(null);
    const selected = { name, type };
    try{
      const rendered = await renderPdfUnderlay(dataUrl, pageNumber);
      setUnderlay(rendered.underlay);
      setStatus({ kind: 'analyzing', message: tr('planoTakeoff.analyzing') });
      let result = null, analysisError = null;
      try{
        result = await apiPost('/api/visual-ai', { action: 'takeoffVector', fileName: selected.name, mimeType: selected.type || 'application/pdf', dataBase64: dataUrl });
      }catch(err){ analysisError = err; }
      const els = result?.elementos || [];
      const scaleRes = result?.resolvedScale || null;
      setElementos(els); setResolvedScale(scaleRes);
      const { model, report: rep } = buildCadModelFromRecognition({
        elementos: els, resolvedScale: scaleRes, pageNumber, toViewport: rendered.toViewport,
        underlay: { kind: 'pdf', page: pageNumber, widthUnits: rendered.underlay.widthUnits, heightUnits: rendered.underlay.heightUnits }
      });
      startModel(model, { rep });
      setStatus(analysisError
        ? { kind: 'error', message: `El análisis automático no está disponible (${analysisError.message || 'error'}). Puedes trazar el plano manualmente.` }
        : { kind: 'ready', message: `Análisis: ${rep.walls} muros, ${rep.doors} puertas, ${rep.windows} ventanas, ${rep.spaces} espacios propuestos — revisa y acepta.` });
      await createRemotePlano({
        name: pageNumber > 1 ? `${selected.name} (pág. ${pageNumber})` : selected.name, mimeType: selected.type || 'application/pdf', numPages: result?.numPages || rendered.numPages,
        snapshot: { elementos: els, escalaResuelta: scaleRes, fileName: selected.name, cadModel: model }, underlayForCache: rendered.underlay, sourceKind: 'PLANO_PDF'
      });
    }catch(err){
      setStatus({ kind: 'error', message: err.message || 'No se pudo abrir el plano.' });
      window.zoemecNotify?.(err.message || 'No se pudo abrir el plano.', 'error');
    }
  };

  const loadFixture = async () => {
    const model = buildFixtureCadModel();
    const name = 'Fixture 8x8 m (prueba)';
    setFileName(name); setUnderlay(null); setElementos([]); setResolvedScale(null); setFocusElementId(null);
    startModel(model);
    setStatus({ kind: 'ready', message: 'Fixture 8.00 × 8.00 m, altura 3.00 m, puerta 0.90 × 2.10 m, ventana 2.00 × 1.20 m.' });
    await createRemotePlano({ name, mimeType: 'application/x-zoemec-fixture', snapshot: { elementos: [], escalaResuelta: null, fileName: name, cadModel: model }, sourceKind: 'FIXTURE' });
  };

  const reopenPlanoTakeoff = async (id) => {
    const data = await apiGetSafe(`/api/plano-takeoffs?id=${encodeURIComponent(id)}`);
    if(!data?.planoTakeoff){ window.zoemecNotify?.('No se encontró el plano.', 'error'); return false; }
    const p = data.planoTakeoff;
    setPlano(p.id);
    persistence.bind(p.id, Number(p.revision || 0), p.currentVersion);
    const snap = p.snapshot || {};
    const els = snap.elementos || [];
    setFileName(p.fileName || p.id); setElementos(els); setResolvedScale(snap.escalaResuelta || null);
    let model = snap.cadModel || null, rep = null;
    if(!model){
      // Plano guardado antes del Plano Inteligente: se reconstruye desde el
      // analisis original (propuestas pendientes), sin fingir un fondo.
      ({ model, report: rep } = buildCadModelFromRecognition({ elementos: els, resolvedScale: snap.escalaResuelta || null, pageNumber: 1 }));
    }
    const cached = await loadUnderlay(p.id);
    setUnderlay(cached && model.underlay ? cached : null);
    setUnderlayScope(!model.underlay ? null : cached ? 'device' : 'missing');
    startModel(model, { key: `${p.id}:${p.revision || 0}:${p.currentVersion}`, rep });
    setSaveState({ status: 'saved', at: Date.now(), version: p.currentVersion });
    setStatus({ kind: 'ready', message: cached || !model.underlay ? '' : 'El plano original no está en este equipo; la geometría y las cantidades sí se recuperaron del servidor.' });
    return true;
  };

  const restoreLocalDraft = () => {
    const snap = localDraft?.snapshot;
    if(!snap?.cadModel) return;
    setPlano(null); persistence.bind(null, null);
    setFileName(snap.fileName || 'Borrador local'); setElementos(snap.elementos || []); setResolvedScale(snap.escalaResuelta || null);
    setUnderlay(null);
    startModel(snap.cadModel, { key: `local:${localDraft.at}` });
    setStatus({ kind: 'ready', message: 'Borrador local recuperado (no está guardado en el servidor).' });
  };

  // "Ver en plano" desde el catalogo: reabre el plano y enfoca el objeto.
  useEffect(() => {
    if(!navigationTarget?.planoTakeoffId) return;
    (async () => {
      if(planoIdRef.current !== navigationTarget.planoTakeoffId) await reopenPlanoTakeoff(navigationTarget.planoTakeoffId);
      if(navigationTarget.elementId) setFocusElementId(navigationTarget.elementId);
      onNavigationTargetConsumed?.();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationTarget]);

  // F4: con plano en el servidor manda el estado del borrador/checkpoint;
  // sin servidor, el aviso de guardado SOLO local.
  const saveLabel = planoId
    ? persistence.saveLabel
    : ({ local: saveState.message || 'Guardado solo en este equipo', error: saveState.message }[saveState.status] || null);

  const topBarExtra = <>
    <label className="cad-file-btn">
      <input type="file" accept="application/pdf,image/png,image/jpeg" hidden onChange={e => { handleFile(e.target.files[0]); e.target.value = ''; }} />
      <span>Cargar plano</span>
    </label>
    {(existingPlanos.length > 0 || localDraft?.snapshot?.cadModel) && <select className="cad-open-select" value="" onChange={e => { if(e.target.value === '__local__') restoreLocalDraft(); else if(e.target.value) reopenPlanoTakeoff(e.target.value); }} aria-label={tr('planoTakeoff.existingTitle')}>
      <option value="">{tr('planoTakeoff.reopen')}…</option>
      {existingPlanos.map(p => <option key={p.id} value={p.id}>{p.fileName || p.id} · {p.currentVersion}{p.revision ? ` · rev. ${p.revision}` : ''}</option>)}
      {localDraft?.snapshot?.cadModel && <option value="__local__">Borrador local · {new Date(localDraft.at).toLocaleString()}</option>}
    </select>}
    <button type="button" className="soft" onClick={loadFixture}>Fixture 8×8</button>
    {planoId && <button type="button" className="soft" onClick={checkpoint} disabled={persistence.saveState.status === 'saving'}>Guardar versión</button>}
    {fileName && <span className="cad-file-name" title={fileName}>{fileName}</span>}
  </>;

  return <div className="plano-takeoff-workspace">
    {onReturnToWorkspace && <div className="sc-actions" style={{ marginBottom: 8 }}>
      <button type="button" className="soft" onClick={onReturnToWorkspace}>Volver a Cuantificación</button>
    </div>}
    {status.message && <p className={`cad-banner is-${status.kind}`} role="status">{status.message}</p>}
    {pendingPdf && <div className="cad-banner is-ready" role="dialog" aria-label="Elegir página del PDF">
      Página a trazar:{' '}
      <select value={pendingPdf.page} onChange={e => setPendingPdf(p => ({ ...p, page: Number(e.target.value) }))}>
        {Array.from({ length: pendingPdf.numPages }, (_, i) => <option key={i + 1} value={i + 1}>Página {i + 1}</option>)}
      </select>{' '}
      <button type="button" onClick={() => processPdfPage(pendingPdf, pendingPdf.page)}>Abrir página</button>{' '}
      <button type="button" className="soft" onClick={() => { setPendingPdf(null); setStatus({ kind: 'idle', message: '' }); }}>Cancelar</button>
    </div>}
    {underlayScope === 'device' && <p className="muted" style={{ fontSize: '.78rem', margin: '0 0 6px' }}>Plano original disponible únicamente en este dispositivo. La geometría, la escala y las cantidades sí están guardadas en el servidor.</p>}
    {persistence.saveState.status === 'conflict' && <p className="cad-banner is-error" role="alert">{persistence.saveState.message} <button type="button" className="soft" onClick={() => planoId && reopenPlanoTakeoff(planoId)}>Recargar</button></p>}
    <CadWorkspace
      persistNow={planoId ? persistence.persistNow : null}
      initialModel={cad.model} modelKey={cad.key} underlay={underlay} onModelChange={onModelChange}
      projectId={projectId} planoId={planoId} fileName={fileName} user={user} onNeedProject={onNeedProject}
      focusElementId={focusElementId} recognitionReport={report} saveLabel={saveLabel}
      topBarExtra={topBarExtra} onLoadFixture={loadFixture}
    />
  </div>;
}
