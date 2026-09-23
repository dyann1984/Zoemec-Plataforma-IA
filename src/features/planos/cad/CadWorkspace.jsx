/* Area de trabajo del Plano Inteligente (B.1): herramientas a la izquierda,
   canvas 2D / 3D / dividido al centro, propiedades-revision-capas a la
   derecha y barra de estado abajo. Dueno UNICO del historial de edicion
   (cadHistory.js): 2D, 3D y el panel de propiedades reciben el mismo
   `model` y proponen cambios; aqui se convierten en pasos de historial y se
   notifican al orquestador (PlanoTakeoffWorkspace) para persistir. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './cad.css';
import CadCanvas2D, { layerOf } from './CadCanvas2D.jsx';
import CadViewer3D from './CadViewer3D.jsx';
import CadPropertiesPanel from './CadPropertiesPanel.jsx';
import {
  REVIEW_STATUS, SCALE_STATUS, findElement, deleteElement, setElementReview, addDimension, addSpace,
  rescaleModel, setScale, validateCadModel, confidenceLevel
} from '../../../domain/cadModel.js';
import { createHistory, commitHistory, undoHistory, redoHistory, canUndo, canRedo } from '../../../domain/cadHistory.js';
import { summarizeCadModel } from '../../../domain/cadTakeoff.js';
import { DEFAULT_SNAP_SETTINGS } from '../../../domain/cadSnap.js';

const I = {
  select: 'M4 3l12 7-5 1.5L8.5 17z',
  pan: 'M10 2v16M2 10h16M10 2l-2.5 2.5M10 2l2.5 2.5M10 18l-2.5-2.5M10 18l2.5-2.5M2 10l2.5-2.5M2 10l2.5 2.5M18 10l-2.5-2.5M18 10l-2.5 2.5',
  zoom: 'M8.5 3a5.5 5.5 0 110 11 5.5 5.5 0 010-11zM12.5 12.5L17 17M6 8.5h5M8.5 6v5',
  measureDistance: 'M2 14l12-12 4 4-12 12zM5 11l1.5 1.5M8 8l1.5 1.5M11 5l1.5 1.5',
  measureArea: 'M3 5l7-2 7 4-2 9-9 1zM3 5v0',
  wall: 'M2 8h16v4H2z',
  edit: 'M3 17l1-4L14 3l3 3L7 16zM12 5l3 3',
  door: 'M4 17V3h2v14M6 3a11 11 0 0111 11H6',
  window: 'M2 7h16v6H2zM2 10h16',
  space: 'M3 3h14v14H3zM6 6h8v8H6z',
  dimension: 'M2 6v8M18 6v8M2 10h16M5 8l-3 2 3 2M15 8l3 2-3 2',
  delete: 'M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11',
  undo: 'M7 5L3 9l4 4M3 9h9a5 5 0 010 10H9',
  redo: 'M13 5l4 4-4 4M17 9H8a5 5 0 000 10h3'
};
function Icon({ d }){
  return <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"><path d={d} /></svg>;
}

const TOOL_GROUPS = [
  { title: 'Navegar', tools: [['select', 'Seleccionar', 'V'], ['pan', 'Pan / mover vista', 'H'], ['zoom', 'Zoom (Alt+clic aleja)', 'Z']] },
  { title: 'Medir', tools: [['measureDistance', 'Medir distancia', 'D'], ['measureArea', 'Medir área', 'A']] },
  { title: 'Muros', tools: [['wall', 'Crear muro (clic a clic, Shift ortogonal)', 'W'], ['edit', 'Editar muro / arrastrar geometría', 'E']] },
  { title: 'Crear apertura', tools: [['door', 'Puerta', 'P'], ['window', 'Ventana', 'N']] },
  { title: 'Espacios y cotas', tools: [['space', 'Crear espacio (Enter cierra)', 'S'], ['dimension', 'Cota (clic en muro o 2 puntos)', 'C']] },
  { title: 'Editar', tools: [['delete', 'Eliminar elemento', 'X']] }
];
const TOOL_KEYS = { v: 'select', h: 'pan', z: 'zoom', d: 'measureDistance', a: 'measureArea', w: 'wall', e: 'edit', p: 'door', n: 'window', s: 'space', c: 'dimension', x: 'delete' };
const TOOL_HINT = {
  select: 'Clic para seleccionar · arrastra para mover la vista · doble clic para editar',
  pan: 'Arrastra para mover la vista (también con el botón central)',
  zoom: 'Clic para acercar · Alt+clic para alejar · rueda del mouse en cualquier herramienta',
  measureDistance: 'Clic en dos puntos · usa el snap para medir entre extremos exactos',
  measureArea: 'Clic en cada vértice · Enter o doble clic para cerrar',
  wall: 'Clic en el inicio y en cada esquina · Esc o doble clic termina · Shift = ortogonal',
  edit: 'Arrastra las manijas: extremos de muro (Alt = despegar), vértices, huecos a lo largo del muro, cotas',
  door: 'Clic sobre un muro para alojar la puerta', window: 'Clic sobre un muro para alojar la ventana',
  space: 'Clic en cada vértice · clic en el primero o Enter para cerrar',
  dimension: 'Clic sobre un muro = cota ligada · o dos puntos = cota libre',
  delete: 'Clic sobre el elemento a eliminar (se puede deshacer)',
  calibrate: 'Calibrar escala: clic en dos puntos de una medida conocida'
};

export const CAD_LAYERS = [
  ['underlay', 'Plano original'], ['walls', 'Muros'], ['doors', 'Puertas'], ['windows', 'Ventanas'],
  ['spaces', 'Espacios'], ['dimensions', 'Cotas'], ['labels', 'Etiquetas'], ['quantities', 'Cuantificación']
];
const DEFAULT_LAYERS = Object.fromEntries(CAD_LAYERS.map(([k]) => [k, { visible: k !== 'quantities', locked: k === 'underlay' }]));
const SNAP_LABELS = [['endpoint', 'Extremo'], ['midpoint', 'Punto medio'], ['intersection', 'Intersección'], ['nearest', 'Cercano']];
const TYPE_LABEL = { wall: 'Muro', door: 'Puerta', window: 'Ventana', space: 'Espacio', dimension: 'Cota' };

function elementTypeLabel(found){
  if(!found) return '';
  if(found.kind === 'opening') return TYPE_LABEL[found.element.type];
  return TYPE_LABEL[found.kind];
}

function scaleText(scale){
  if(!scale) return '—';
  if(scale.ratio) return `1:${Math.round(scale.ratio)}`;
  if(scale.fuente === 'modelo_en_metros') return 'Real (m)';
  if(scale.metersPerUnit) return `${(scale.metersPerUnit * 100).toFixed(2)} cm/px`;
  return '—';
}

export default function CadWorkspace({
  initialModel, modelKey, underlay = null, onModelChange, projectId = null, planoId = null, fileName = '',
  user = null, onNeedProject, focusElementId = null, recognitionReport = null, saveLabel = null,
  topBarExtra = null, onLoadFixture
}){
  const [history, setHistory] = useState(() => createHistory(initialModel));
  const [draft, setDraft] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [tool, setTool] = useState('select');
  const [viewMode, setViewMode] = useState('plan'); // plan | 3d | split
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [snapSettings, setSnapSettings] = useState({ ...DEFAULT_SNAP_SETTINGS });
  const [showGrid, setShowGrid] = useState(true);
  const [rightTab, setRightTab] = useState('props');
  const [zoomPct, setZoomPct] = useState(100);
  const [focus2D, setFocus2D] = useState(null);
  const [focus3D, setFocus3D] = useState(null);
  const [calibration, setCalibration] = useState(null); // {measured, real}
  const [measure, setMeasure] = useState(null);
  const cursorRef = useRef(null);
  const historyRef = useRef(history);
  historyRef.current = history;
  const lastNotifiedRef = useRef(initialModel);

  // Otro plano cargado -> historial nuevo (nunca se deshace hacia un plano
  // distinto). Reset DURANTE el render (patron de estado derivado de React),
  // no en un efecto: asi el canvas recibe fitKey nuevo y modelo nuevo en el
  // mismo render y encuadra el plano correcto, nunca el anterior.
  const [activeKey, setActiveKey] = useState(modelKey);
  if(activeKey !== modelKey){
    setActiveKey(modelKey);
    setHistory(createHistory(initialModel));
    setDraft(null); setSelectedId(null); setTool('select'); setMeasure(null); setCalibration(null);
    if(recognitionReport) setRightTab('review');
    lastNotifiedRef.current = initialModel;
  }

  // Persistencia: cada paso de historial (incluye deshacer/rehacer).
  useEffect(() => {
    if(history.present === lastNotifiedRef.current) return;
    lastNotifiedRef.current = history.present;
    onModelChange?.(history.present);
  }, [history.present, onModelChange]);

  const model = draft || history.present;
  const getModel = useCallback(() => historyRef.current.present, []);
  const issues = useMemo(() => validateCadModel(model), [model]);
  const summary = useMemo(() => summarizeCadModel(model), [model]);
  const notify = useCallback((msg, kind = 'info') => window.zoemecNotify?.(msg, kind), []);
  const onError = useCallback(msg => notify(msg, 'error'), [notify]);

  const commit = useCallback((next, label) => {
    setDraft(null);
    setHistory(h => commitHistory(h, next, label));
  }, []);
  const undo = useCallback(() => { setDraft(null); setHistory(h => undoHistory(h)); }, []);
  const redo = useCallback(() => { setDraft(null); setHistory(h => redoHistory(h)); }, []);

  // La seleccion nunca apunta a un objeto que ya no existe (eliminado/deshecho).
  useEffect(() => { if(selectedId && !findElement(model, selectedId)) setSelectedId(null); }, [model, selectedId]);

  // "Ver en plano" desde el catalogo: seleccionar y encuadrar.
  useEffect(() => {
    if(!focusElementId) return;
    const m = historyRef.current.present;
    const direct = findElement(m, focusElementId) ? focusElementId
      : [...(m.walls || []), ...(m.openings || [])].find(el => String(el.sourceElementId || '').split(',').includes(focusElementId))?.id;
    if(direct){ setSelectedId(direct); setFocus2D({ id: direct, nonce: Date.now() }); }
  }, [focusElementId, modelKey]);

  const select = useCallback(id => { setSelectedId(id); if(id) setRightTab('props'); }, []);
  const focusOn = (id, { in3d = viewMode !== 'plan' } = {}) => {
    select(id);
    setFocus2D({ id, nonce: Date.now() });
    if(in3d) setFocus3D({ id, nonce: Date.now() + 1 });
  };

  const onAction = (name) => {
    if(name === 'edit'){ setTool('edit'); if(viewMode === '3d') setViewMode('split'); }
    else if(name === 'view3d'){
      if(viewMode === 'plan') setViewMode('split');
      setFocus3D({ id: selectedId, nonce: Date.now() });
    } else if(name === 'focusField'){
      setTimeout(() => document.querySelector('.cad-props [data-autofocus="edit"]')?.focus(), 0);
    } else if(name === 'dimensionWall' && selectedId){
      try{
        const { model: next, id } = addDimension(getModel(), { wallId: selectedId, offset: -0.7 });
        commit(next, `Acotar ${selectedId}`); select(id);
      }catch(err){ onError(err.message); }
    }
  };

  const deleteSelected = () => {
    const found = selectedId && findElement(getModel(), selectedId);
    if(!found) return;
    const l = layers[layerOf(found.kind, found.element)];
    if(l?.locked){ onError('La capa de este elemento está bloqueada.'); return; }
    commit(deleteElement(getModel(), selectedId), `Eliminar ${selectedId}`);
  };

  // Atajos de teclado (ignorados mientras se escribe en un campo).
  useEffect(() => {
    const onKey = e => {
      const tag = e.target?.tagName;
      if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      const k = e.key.toLowerCase();
      if((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey){ e.preventDefault(); undo(); return; }
      if((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))){ e.preventDefault(); redo(); return; }
      if(e.ctrlKey || e.metaKey || e.altKey) return;
      if(e.key === 'Delete' || e.key === 'Supr'){ e.preventDefault(); deleteSelected(); return; }
      if(e.key === 'Escape'){
        if(e.defaultPrevented) return; // el canvas ya lo uso para cerrar un trazo
        if(calibration){ setCalibration(null); setTool('select'); return; }
        if(tool !== 'select') setTool('select'); else setSelectedId(null);
        return;
      }
      if(TOOL_KEYS[k]){ setTool(TOOL_KEYS[k]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onCalibrationPoints = (a, b) => {
    const measured = Math.hypot(b.x - a.x, b.y - a.y);
    if(measured < 0.001){ onError('Los dos puntos de calibración coinciden.'); return; }
    setCalibration({ measured, real: '' });
  };
  const applyCalibration = () => {
    const real = Number(String(calibration?.real || '').replace(',', '.'));
    if(!(real > 0)){ onError('Captura la distancia real en metros.'); return; }
    const factor = real / calibration.measured;
    let next = rescaleModel(getModel(), factor);
    next = setScale(next, { status: SCALE_STATUS.CONFIRMADA, fuente: 'referencia_usuario', confidenceLevel: 'ALTA', evidencia: `Calibración manual: ${real} m (dibujo medía ${calibration.measured.toFixed(3)} m).` });
    commit(next, 'Calibrar escala');
    setCalibration(null); setTool('select');
    notify(`Escala calibrada (factor ${factor.toFixed(4)}). Todas las medidas se recalcularon.`, 'success');
  };
  const confirmScale = () => {
    commit(setScale(getModel(), { status: SCALE_STATUS.CONFIRMADA, confidenceLevel: 'ALTA', evidencia: `${model.scale?.evidencia || ''} Confirmada por el usuario.`.trim() }), 'Confirmar escala');
  };

  const acceptAllHigh = () => {
    let next = getModel();
    const ids = [...(next.walls || []), ...(next.openings || []), ...(next.spaces || [])]
      .filter(el => el.review?.status === REVIEW_STATUS.PENDIENTE && (el.review.level || confidenceLevel(el.review.confidence)) === 'ALTA')
      .map(el => el.id);
    if(!ids.length){ notify('No hay pendientes con confianza ALTA.', 'info'); return; }
    ids.forEach(id => { next = setElementReview(next, id, REVIEW_STATUS.CONFIRMADO); });
    commit(next, `Aceptar ${ids.length} propuestas de confianza alta`);
    notify(`${ids.length} elementos aceptados. Revisa el resto uno por uno.`, 'success');
  };

  const onViewChange = useCallback(v => setZoomPct(v.zoomPct), []);
  const toggleLayer = (key, prop) => setLayers(prev => ({ ...prev, [key]: { ...prev[key], [prop]: !prev[key][prop] } }));

  const selectedFound = selectedId ? findElement(model, selectedId) : null;
  const isEmpty = !(model.walls?.length || model.spaces?.length || model.dimensions?.length) && !underlay;
  const pendingCount = summary.pending.length, errorCount = summary.errors.length;
  const scale = model.scale || {};
  const scaleNeedsAction = scale.status && scale.status !== SCALE_STATUS.CONFIRMADA;
  const canvasTool = calibration ? 'select' : tool;

  const canvas = <div className="cad-view-pane">
    <CadCanvas2D
      model={model} underlay={underlay} layers={layers} selectedId={selectedId} tool={canvasTool}
      snapSettings={snapSettings} issues={issues} showGrid={showGrid}
      onSelect={select} onCommit={commit} onPreview={setDraft} onError={onError}
      onViewChange={onViewChange} cursorRef={cursorRef} focusRequest={focus2D} fitKey={`${modelKey}|${viewMode}`}
      onCalibrationPoints={onCalibrationPoints} onMeasure={setMeasure} onRequestTool={setTool}
    />
    <div className="cad-tool-hint">{TOOL_HINT[tool]}</div>
    {measure && <div className="cad-measure">
      {measure.kind === 'distance'
        ? <><b>Distancia: {measure.value.toFixed(3)} m</b>
          <button type="button" className="soft" onClick={() => { try{ const { model: next, id } = addDimension(getModel(), { a: measure.a, b: measure.b, offset: 0.4 }); commit(next, `Crear cota ${id}`); select(id); setMeasure(null); }catch(err){ onError(err.message); } }}>Convertir en cota</button></>
        : <><b>Área: {measure.area.toFixed(3)} m² · Perímetro {measure.perimeter.toFixed(3)} m</b>
          <button type="button" className="soft" onClick={() => { try{ const { model: next, id } = addSpace(getModel(), { points: measure.points }); commit(next, `Crear espacio ${id}`); select(id); setMeasure(null); }catch(err){ onError(err.message); } }}>Crear espacio</button></>}
      <button type="button" className="cad-x" onClick={() => setMeasure(null)} aria-label="Cerrar medición">×</button>
    </div>}
    {calibration && <div className="cad-calibration" role="dialog" aria-label="Calibrar escala">
      <b>Calibrar escala</b>
      <span className="muted">En el dibujo esa distancia mide {calibration.measured.toFixed(3)} m con la escala actual.</span>
      <label>Distancia real (m)
        <input type="text" inputMode="decimal" autoFocus value={calibration.real} onChange={e => setCalibration(c => ({ ...c, real: e.target.value }))} onKeyDown={e => { if(e.key === 'Enter') applyCalibration(); }} placeholder="4.20" />
      </label>
      <div className="cad-actions"><button type="button" onClick={applyCalibration}>Aplicar</button><button type="button" className="soft" onClick={() => { setCalibration(null); setTool('select'); }}>Cancelar</button></div>
    </div>}
    {isEmpty && <div className="cad-empty">
      <b>Plano vacío</b>
      <span>Carga un plano (PDF o imagen) para trazar encima, o dibuja muros directamente con la herramienta Muro (W).</span>
      {onLoadFixture && <button type="button" className="soft" onClick={onLoadFixture}>Cargar fixture 8 × 8 m</button>}
    </div>}
  </div>;

  const viewer3d = <div className="cad-view-pane">
    <CadViewer3D model={model} layers={layers} selectedId={selectedId} onSelect={select} focusRequest={focus3D} compact={viewMode === 'split'} />
  </div>;

  return <div className="cad-ws">
    <div className="cad-topbar">
      <div className="cad-segmented" role="tablist" aria-label="Vista">
        {[['plan', 'Planta'], ['3d', '3D'], ['split', 'Dividido']].map(([k, label]) =>
          <button key={k} type="button" role="tab" aria-selected={viewMode === k} className={viewMode === k ? 'is-active' : ''} onClick={() => setViewMode(k)}>{label}</button>)}
      </div>
      <div className="cad-topbar-extra">{topBarExtra}</div>
    </div>

    <nav className="cad-tools" aria-label="Herramientas">
      {TOOL_GROUPS.map(g => <div key={g.title} className="cad-tool-group">
        <span className="cad-tool-group-title">{g.title}</span>
        {g.tools.map(([key, label, sc]) => <button key={key} type="button" className={`cad-tool ${tool === key ? 'is-active' : ''}`}
          title={`${label} (${sc})`} aria-label={label} aria-pressed={tool === key} onClick={() => setTool(key)}>
          <Icon d={I[key]} /><span className="cad-tool-label">{label.split(' (')[0]}</span>
        </button>)}
      </div>)}
      <div className="cad-tool-group">
        <button type="button" className="cad-tool" title="Deshacer (Ctrl+Z)" aria-label="Deshacer" disabled={!canUndo(history)} onClick={undo}><Icon d={I.undo} /><span className="cad-tool-label">Deshacer</span></button>
        <button type="button" className="cad-tool" title="Rehacer (Ctrl+Y)" aria-label="Rehacer" disabled={!canRedo(history)} onClick={redo}><Icon d={I.redo} /><span className="cad-tool-label">Rehacer</span></button>
      </div>
    </nav>

    <main className={`cad-center is-${viewMode}`}>
      {(viewMode === 'plan' || viewMode === 'split') && canvas}
      {(viewMode === '3d' || viewMode === 'split') && viewer3d}
    </main>

    <aside className="cad-right">
      <div className="cad-tabs" role="tablist">
        {[['props', 'Propiedades'], ['review', `Revisión${pendingCount + errorCount ? ` (${pendingCount + errorCount})` : ''}`], ['layers', 'Capas']].map(([k, label]) =>
          <button key={k} type="button" role="tab" aria-selected={rightTab === k} className={rightTab === k ? 'is-active' : ''} onClick={() => setRightTab(k)}>{label}</button>)}
      </div>
      <div className="cad-right-body">
        {rightTab === 'props' && <CadPropertiesPanel
          model={model} getModel={getModel} selectedId={selectedId} issues={issues}
          onChange={commit} onError={onError} onNotify={notify} onSelect={id => focusOn(id)} onAction={onAction}
          projectId={projectId} planoId={planoId} fileName={fileName} user={user} onNeedProject={onNeedProject}
        />}

        {rightTab === 'review' && <div className="cad-review">
          <section>
            <h4>Escala</h4>
            <div className="cad-row"><span>{scaleText(scale)}</span>
              <b className={scaleNeedsAction ? 'is-warn' : 'is-ok'}>{scale.status === SCALE_STATUS.CONFIRMADA ? '✓ Confirmada' : scale.status === SCALE_STATUS.PENDIENTE ? `? ${scale.confidenceLevel || ''} · requiere confirmación` : `! ${scale.confidenceLevel || 'BAJA'} · provisional`}</b></div>
            {scale.evidencia && <p className="muted cad-small">{scale.evidencia}</p>}
            <div className="cad-actions">
              {scale.status === SCALE_STATUS.PENDIENTE && <button type="button" className="soft" onClick={confirmScale}>Confirmar escala</button>}
              <button type="button" className="soft" onClick={() => { setTool('calibrate'); setViewMode(v => v === '3d' ? 'split' : v); }}>Calibrar con medida conocida</button>
            </div>
          </section>
          <section>
            <h4>Detectados</h4>
            <div className="cad-counts">
              <span><b>{summary.counts.walls}</b> muros</span><span><b>{summary.counts.doors}</b> puertas</span>
              <span><b>{summary.counts.windows}</b> ventanas</span><span><b>{summary.counts.spaces}</b> espacios</span>
              <span><b>{summary.counts.dimensions}</b> cotas</span>
            </div>
            <div className="cad-row"><span>Muros, área neta total</span><b>{summary.totals.wallNetArea.toFixed(2)} <em>m²</em></b></div>
            <div className="cad-row"><span>Espacios, área total</span><b>{summary.totals.spaceArea.toFixed(2)} <em>m²</em></b></div>
          </section>
          <section>
            <h4>Pendientes: {pendingCount} {pendingCount === 1 ? 'elemento' : 'elementos'} por validar</h4>
            {pendingCount > 0 && <button type="button" className="soft" onClick={acceptAllHigh}>Aceptar los de confianza ALTA</button>}
            <ul className="cad-list">
              {summary.pending.map(id => {
                const f = findElement(model, id);
                const rv = f?.element.review;
                const lvl = rv?.level || confidenceLevel(rv?.confidence);
                return <li key={id}><button type="button" className={id === selectedId ? 'is-active' : ''} onClick={() => focusOn(id)}>
                  <b>{id}</b><span>{elementTypeLabel(f)}{f?.kind === 'dimension' ? ' · pendiente de validación' : ''}</span>
                  {rv?.confidence != null && <em className={`lvl-${(lvl || '').toLowerCase()}`}>{Math.round(rv.confidence)}% {lvl}</em>}
                </button></li>;
              })}
            </ul>
          </section>
          {errorCount > 0 && <section>
            <h4>Errores: {errorCount}</h4>
            <ul className="cad-list">
              {issues.filter(i => i.severity === 'error').map((i, k) => <li key={k}><button type="button" onClick={() => i.id && focusOn(i.id)}><b>! {i.id}</b><span>{i.message}</span></button></li>)}
            </ul>
          </section>}
          {recognitionReport?.unplaced?.length > 0 && <section>
            <h4>Propuestas de IA sin ubicación ({recognitionReport.unplaced.length})</h4>
            <p className="muted cad-small">La IA las mencionó pero no dio una posición confiable en el plano; dibújalas con las herramientas si existen.</p>
            <ul className="cad-list is-static">
              {recognitionReport.unplaced.map(u => <li key={u.id}><span><b>{u.tipo}</b> {u.descripcion}{u.confianza != null ? ` · ${u.confianza}% ${confidenceLevel(u.confianza) || ''}` : ''}</span><small className="muted">{u.reason}</small></li>)}
            </ul>
          </section>}
          {!pendingCount && !errorCount && <p className="cad-ok">✓ Sin pendientes ni errores en la geometría.</p>}
        </div>}

        {rightTab === 'layers' && <div className="cad-layers">
          <table><thead><tr><th>Capa</th><th>Ver</th><th>Bloq.</th></tr></thead><tbody>
            {CAD_LAYERS.map(([k, label]) => <tr key={k}>
              <td>{label}{k === 'underlay' && !underlay ? <small className="muted"> (no cargado)</small> : null}</td>
              <td><input type="checkbox" aria-label={`Mostrar ${label}`} checked={layers[k].visible} onChange={() => toggleLayer(k, 'visible')} /></td>
              <td>{['labels', 'quantities'].includes(k) ? null : <input type="checkbox" aria-label={`Bloquear ${label}`} checked={layers[k].locked} onChange={() => toggleLayer(k, 'locked')} />}</td>
            </tr>)}
          </tbody></table>
          <label className="cad-check"><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} /> Cuadrícula</label>
          <h4>Snap</h4>
          {SNAP_LABELS.map(([k, label]) => <label key={k} className="cad-check"><input type="checkbox" checked={snapSettings[k]} onChange={e => setSnapSettings(s => ({ ...s, [k]: e.target.checked }))} /> {label}</label>)}
          <h4>Estados</h4>
          <ul className="cad-legend">
            <li><i className="lg-normal" /> Normal</li><li><i className="lg-selected" /> Seleccionado</li>
            <li><i className="lg-pending" /> ? Detectado, pendiente</li><li><i className="lg-ok" /> ✓ Validado</li><li><i className="lg-error" /> ! Error</li>
          </ul>
        </div>}
      </div>
    </aside>

    <footer className="cad-status">
      <span>Escala: <b>{scaleText(scale)}</b>{scaleNeedsAction ? <em className="is-warn"> (sin confirmar)</em> : null}</span>
      <span>Unidad: <b>metros</b></span>
      <span>Zoom: <b>{zoomPct}%</b></span>
      <span>Cursor: <b ref={cursorRef}>—</b></span>
      <span>Estado: <b className={summary.isValidated ? 'is-ok' : 'is-warn'}>{summary.isValidated ? '✓ Plano validado' : `${pendingCount} pendientes${errorCount ? ` · ${errorCount} errores` : ''}${!summary.scaleConfirmed ? ' · escala' : ''}`}</b></span>
      {selectedFound && <span>Sel.: <b>{selectedId}</b></span>}
      {history.lastLabel && <span className="cad-status-last" title="Última acción">{history.lastLabel}</span>}
      {saveLabel && <span className="cad-status-save">{saveLabel}</span>}
    </footer>
  </div>;
}
