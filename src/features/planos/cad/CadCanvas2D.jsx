/* Canvas 2D del Plano Inteligente (B.1). SVG en coordenadas de MUNDO
   (metros) con una sola transformacion de vista (centro + pixeles por
   metro): el plano original, la geometria, las cotas y las etiquetas viven
   en el mismo sistema, asi que nunca se desalinean al hacer zoom/pan.

   Este componente NO guarda geometria propia: recibe `model` (cadModel.js)
   y reporta cambios con onPreview (estado intermedio de un arrastre, sin
   historial) y onCommit (paso de historial). Toda decision geometrica
   (snap, seleccion, mutaciones) sale de src/domain/cad*.js. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CAD_KIND, OPENING_TYPE, REVIEW_STATUS, CAD_SOURCE, addWall, addOpening, addSpace, addDimension, deleteElement,
  moveWallEndpoint, updateOpening, moveSpaceVertex, updateDimension, wallPlanPieces, wallLength, wallDirection,
  wallNormal, pointAlongWall, polygonArea, polygonPerimeter, polygonCentroid, modelBounds, elementBounds,
  computeWallMetrics, computeSpaceMetrics, elementDisplayStatus, projectPointOnSegment, findElement
} from '../../../domain/cadModel.js';
import { findSnap, orthoConstrain, SNAP_KIND } from '../../../domain/cadSnap.js';
import { hitTestCad, dimensionLayout } from '../../../domain/cadHitTest.js';

export function layerOf(kind, el){
  if(kind === CAD_KIND.WALL) return 'walls';
  if(kind === CAD_KIND.OPENING) return el?.type === OPENING_TYPE.WINDOW ? 'windows' : 'doors';
  if(kind === CAD_KIND.SPACE) return 'spaces';
  return 'dimensions';
}

const SNAP_LABEL = {
  [SNAP_KIND.ENDPOINT]: 'Extremo', [SNAP_KIND.MIDPOINT]: 'Punto medio',
  [SNAP_KIND.INTERSECTION]: 'Intersección', [SNAP_KIND.NEAREST]: 'Cercano'
};

const C = {
  wall: '#34424E', wallPending: '#F6E7C8', amber: '#B7791F', error: '#C0392B', sel: '#0F6BA8', hover: '#3BA0D9',
  line: '#1D2B36', dim: '#4A5763', space: 'rgba(15,107,168,0.06)', spaceSel: 'rgba(15,107,168,0.14)', ok: '#1E8E5A'
};

const fmt = n => (Number.isFinite(n) ? n.toFixed(2) : '—');
const pts = list => list.map(p => `${p.x},${p.y}`).join(' ');

function statusMark(status, review){
  if(status === 'error') return { icon: '!', color: C.error, text: 'Error' };
  if(status === 'pendiente') return { icon: '?', color: C.amber, text: review?.confidence != null ? `${Math.round(review.confidence)}%` : 'Pendiente' };
  return null;
}

export default function CadCanvas2D({
  model, underlay = null, layers, selectedId, tool, snapSettings, issues = [], showGrid = true,
  onSelect, onCommit, onPreview, onError, onViewChange, cursorRef, focusRequest, fitKey,
  onCalibrationPoints, onMeasure, onRequestTool
}){
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [size, setSize] = useState(null);
  const [view, setView] = useState(null);
  const baseScaleRef = useRef(null);
  const [pending, setPending] = useState([]); // puntos de la herramienta activa
  const [cursor, setCursor] = useState(null); // {x,y} ya con snap
  const [snap, setSnap] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const [measure, setMeasure] = useState(null); // resultado persistente de medicion
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const isSelectable = useCallback((kind, el) => {
    const l = layers?.[layerOf(kind, el)];
    return !l || (l.visible && !l.locked);
  }, [layers]);
  const isVisible = key => !layers?.[key] || layers[key].visible;

  /* ---------- tamano y vista ---------- */
  useEffect(() => {
    const el = wrapRef.current;
    if(!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if(r && r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitTo = useCallback((b, pad = 36) => {
    if(!b){ setView({ cx: 5, cy: 5, ppm: 40 }); baseScaleRef.current = 40; return; }
    const bw = Math.max(b.maxX - b.minX, 0.5), bh = Math.max(b.maxY - b.minY, 0.5);
    if(!size) return null;
    const ppm = Math.max(1, Math.min(2000, Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh)));
    setView({ cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, ppm });
    return ppm;
  }, [size]);

  const fitAll = useCallback(() => {
    const b = modelBounds(model);
    const ppm = fitTo(b ? { minX: b.minX - 1, minY: b.minY - 1.2, maxX: b.maxX + 1, maxY: b.maxY + 1 } : null);
    if(ppm) baseScaleRef.current = ppm;
  }, [model, fitTo]);

  // Encuadre inicial y cada vez que cambia fitKey (otro plano, o cambio de
  // vista Planta/Dividido). El contenedor cambia de tamano DESPUES del
  // cambio de fitKey, asi que se vuelve a encuadrar con el tamano nuevo si
  // llega poco despues -- un redimensionado posterior (ventana) respeta el
  // zoom del usuario.
  const hasSize = !!size;
  const fitStampRef = useRef({ key: null, at: 0 });
  useEffect(() => {
    if(!hasSize) return;
    const stamp = fitStampRef.current;
    if(stamp.key !== fitKey){ fitStampRef.current = { key: fitKey, at: Date.now() }; fitAll(); }
    else if(Date.now() - stamp.at < 700) fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, size]);

  useEffect(() => {
    if(!focusRequest?.id) return;
    const b = elementBounds(model, focusRequest.id);
    if(!b) return;
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const m = Math.max(1.5, Math.max(w, h) * 0.35);
    fitTo({ minX: b.minX - m, minY: b.minY - m, maxX: b.maxX + m, maxY: b.maxY + m });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce]);

  useEffect(() => {
    if(view && baseScaleRef.current) onViewChange?.({ zoomPct: Math.round((view.ppm / baseScaleRef.current) * 100), ppm: view.ppm });
  }, [view, onViewChange]);

  // Cambiar de herramienta limpia lo que estaba a medias.
  useEffect(() => { setPending([]); setMeasure(null); onMeasure?.(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tool]);

  const toWorld = useCallback((sx, sy) => {
    const v = viewRef.current;
    return { x: v.cx + (sx - size.w / 2) / v.ppm, y: v.cy + (sy - size.h / 2) / v.ppm };
  }, [size]);

  const eventPoint = e => {
    const rect = svgRef.current.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };

  // Zoom con rueda centrado en el cursor (listener no pasivo para poder
  // cancelar el scroll de la pagina).
  useEffect(() => {
    const svg = svgRef.current;
    if(!svg) return;
    const onWheel = e => {
      e.preventDefault();
      const v = viewRef.current;
      if(!v) return;
      const rect = svg.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const ppm = Math.max(1, Math.min(4000, v.ppm * factor));
      const wx = v.cx + (sx - size.w / 2) / v.ppm, wy = v.cy + (sy - size.h / 2) / v.ppm;
      setView({ ppm, cx: wx - (sx - size.w / 2) / ppm, cy: wy - (sy - size.h / 2) / ppm });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [size, view != null]);

  const zoomBy = factor => setView(v => v && ({ ...v, ppm: Math.max(1, Math.min(4000, v.ppm * factor)) }));

  /* ---------- snap ---------- */
  const tolWorld = view ? 10 / view.ppm : 0.2;
  const drawingTools = ['wall', 'measureDistance', 'measureArea', 'space', 'dimension', 'calibrate'];

  const resolvePoint = (raw, e, { excludeWallId = null } = {}) => {
    const last = pending[pending.length - 1];
    if(e?.shiftKey && last) return { point: orthoConstrain(last, raw), snap: null };
    const s = findSnap(model, raw, { tolerance: tolWorld, settings: snapSettings, excludeWallId });
    return s ? { point: { x: s.x, y: s.y }, snap: s } : { point: raw, snap: null };
  };

  /* ---------- herramientas ---------- */
  const commit = (next, label, selectId) => {
    onCommit?.(next, label);
    if(selectId !== undefined) onSelect?.(selectId);
  };
  const safe = fn => { try{ fn(); }catch(err){ onError?.(err.message); } };

  const hoveredWallAt = p => {
    let best = null;
    for(const w of model.walls || []){
      if(!isSelectable(CAD_KIND.WALL, w)) continue;
      const proj = projectPointOnSegment(p, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
      if(proj.dist <= (w.thickness || 0) / 2 + tolWorld && (!best || proj.dist < best.dist)) best = { wall: w, dist: proj.dist, point: proj.point };
    }
    return best;
  };

  const finishPolygon = () => {
    if(pending.length < 3){ setPending([]); return; }
    if(tool === 'space'){
      safe(() => {
        const { model: next, id } = addSpace(model, { points: pending });
        commit(next, `Crear espacio ${id}`, id);
      });
      setPending([]);
    } else if(tool === 'measureArea'){
      const result = { kind: 'area', points: pending, area: polygonArea(pending), perimeter: polygonPerimeter(pending) };
      setMeasure(result); onMeasure?.(result); setPending([]);
    }
  };

  const handleClick = (p, e) => {
    if(tool === 'wall'){
      const last = pending[pending.length - 1];
      if(last){
        if(Math.hypot(p.x - last.x, p.y - last.y) < 0.02) return;
        safe(() => {
          const { model: next, id } = addWall(model, { x1: last.x, y1: last.y, x2: p.x, y2: p.y });
          commit(next, `Crear muro ${id}`, id);
          setPending([p]);
        });
      } else setPending([p]);
      return;
    }
    if(tool === 'measureDistance'){
      if(pending.length === 1){
        const a = pending[0];
        const result = { kind: 'distance', a, b: p, value: Math.hypot(p.x - a.x, p.y - a.y) };
        setMeasure(result); onMeasure?.(result); setPending([]);
      } else { setMeasure(null); onMeasure?.(null); setPending([p]); }
      return;
    }
    if(tool === 'measureArea' || tool === 'space'){
      if(pending.length >= 3 && Math.hypot(p.x - pending[0].x, p.y - pending[0].y) <= tolWorld){ finishPolygon(); return; }
      if(tool === 'measureArea' && !pending.length){ setMeasure(null); onMeasure?.(null); }
      setPending(prev => [...prev, p]);
      return;
    }
    if(tool === 'dimension'){
      if(!pending.length){
        // Clic sobre el cuerpo de un muro (no en un extremo) -> cota ligada al muro.
        const hw = hoveredWallAt(p);
        if(hw && (!snap || snap.kind === SNAP_KIND.NEAREST)){
          safe(() => {
            const n = wallNormal(hw.wall);
            const side = (p.x - hw.point.x) * n.x + (p.y - hw.point.y) * n.y >= 0 ? 1 : -1;
            const { model: next, id } = addDimension(model, { wallId: hw.wall.id, offset: side * Math.max(0.5, hw.wall.thickness + 0.35) });
            commit(next, `Acotar ${hw.wall.id}`, id);
          });
          return;
        }
        setPending([p]);
      } else {
        safe(() => {
          const { model: next, id } = addDimension(model, { a: pending[0], b: p, offset: 0.4 });
          commit(next, `Crear cota ${id}`, id);
        });
        setPending([]);
      }
      return;
    }
    if(tool === 'calibrate'){
      if(pending.length === 1){ onCalibrationPoints?.(pending[0], p); setPending([]); }
      else setPending([p]);
      return;
    }
    if(tool === 'door' || tool === 'window'){
      const hw = hoveredWallAt(p);
      if(!hw){ onError?.(`Haz clic sobre un muro para alojar la ${tool === 'door' ? 'puerta' : 'ventana'}.`); return; }
      safe(() => {
        const { model: next, id } = addOpening(model, { type: tool === 'door' ? OPENING_TYPE.DOOR : OPENING_TYPE.WINDOW, wallId: hw.wall.id, at: hw.point });
        commit(next, `Crear ${id}`, id);
      });
      return;
    }
    if(tool === 'delete'){
      const id = hitTestCad(model, p, tolWorld, { isSelectable });
      if(id){ safe(() => commit(deleteElement(model, id), `Eliminar ${id}`, null)); }
      return;
    }
    if(tool === 'zoom'){ zoomBy(e?.altKey ? 1 / 1.5 : 1.5); return; }
    if(tool === 'select' || tool === 'edit'){
      onSelect?.(hitTestCad(model, p, tolWorld, { isSelectable }));
    }
  };

  /* ---------- puntero ---------- */
  const handlesFor = () => {
    if(tool !== 'edit' || !selectedId) return [];
    const found = findElement(model, selectedId);
    if(!found || !isSelectable(found.kind, found.element)) return [];
    const { kind, element } = found;
    if(kind === CAD_KIND.WALL) return [
      { key: 'start', x: element.x1, y: element.y1, drag: { type: 'wallEnd', id: element.id, which: 'start' } },
      { key: 'end', x: element.x2, y: element.y2, drag: { type: 'wallEnd', id: element.id, which: 'end' } }
    ];
    if(kind === CAD_KIND.SPACE) return element.points.map((p, i) => ({ key: `v${i}`, x: p.x, y: p.y, drag: { type: 'spaceVertex', id: element.id, index: i } }));
    if(kind === CAD_KIND.OPENING){
      const wall = (model.walls || []).find(w => w.id === element.wallId);
      if(!wall) return [];
      const c = pointAlongWall(wall, element.offset + element.width / 2);
      return [{ key: 'center', x: c.x, y: c.y, drag: { type: 'opening', id: element.id } }];
    }
    if(kind === CAD_KIND.DIMENSION){
      const lay = dimensionLayout(model, element);
      return lay ? [{ key: 'mid', x: lay.mid.x, y: lay.mid.y, drag: { type: 'dimOffset', id: element.id } }] : [];
    }
    return [];
  };

  const onPointerDown = e => {
    if(!view) return;
    const { sx, sy } = eventPoint(e);
    const raw = toWorld(sx, sy);
    const isPanGesture = e.button === 1 || (tool === 'pan' && e.button === 0);
    if(isPanGesture){
      panRef.current = { sx, sy, cx: view.cx, cy: view.cy, moved: false };
      svgRef.current.setPointerCapture?.(e.pointerId);
      return;
    }
    if(e.button !== 0) return;
    // Arrastre de manija (herramienta Editar)
    const handle = handlesFor().find(h => Math.hypot(h.x - raw.x, h.y - raw.y) <= tolWorld * 1.2);
    if(handle){
      dragRef.current = { ...handle.drag, base: model, last: null };
      svgRef.current.setPointerCapture?.(e.pointerId);
      return;
    }
    if(tool === 'edit'){
      const id = hitTestCad(model, raw, tolWorld, { isSelectable });
      const found = id && findElement(model, id);
      if(found?.kind === CAD_KIND.OPENING){
        onSelect?.(id);
        dragRef.current = { type: 'opening', id, base: model, last: null };
        svgRef.current.setPointerCapture?.(e.pointerId);
        return;
      }
    }
    if(tool === 'select' || tool === 'edit'){
      // clic -> seleccionar; arrastre sobre vacio -> pan
      panRef.current = { sx, sy, cx: view.cx, cy: view.cy, moved: false, clickPoint: raw, selectOnUp: true };
      svgRef.current.setPointerCapture?.(e.pointerId);
      return;
    }
    const { point } = drawingTools.includes(tool) ? resolvePoint(raw, e) : { point: raw };
    handleClick(point, e);
  };

  const onPointerMove = e => {
    if(!view) return;
    const { sx, sy } = eventPoint(e);
    const raw = toWorld(sx, sy);
    if(cursorRef?.current) cursorRef.current.textContent = `X ${raw.x.toFixed(2)}  Y ${raw.y.toFixed(2)} m`;

    if(panRef.current){
      const pr = panRef.current;
      const dx = sx - pr.sx, dy = sy - pr.sy;
      if(Math.abs(dx) + Math.abs(dy) > 3) pr.moved = true;
      if(pr.moved) setView(v => ({ ...v, cx: pr.cx - dx / v.ppm, cy: pr.cy - dy / v.ppm }));
      return;
    }
    if(dragRef.current){
      const d = dragRef.current;
      try{
        let next = null;
        if(d.type === 'wallEnd'){
          const { point, snap: s } = resolvePoint(raw, e, { excludeWallId: d.id });
          setSnap(s);
          next = moveWallEndpoint(d.base, d.id, d.which, point, { connected: !e.altKey });
        } else if(d.type === 'spaceVertex'){
          const { point, snap: s } = resolvePoint(raw, e);
          setSnap(s);
          next = moveSpaceVertex(d.base, d.id, d.index, point);
        } else if(d.type === 'opening'){
          next = updateOpening(d.base, d.id, { at: raw });
        } else if(d.type === 'dimOffset'){
          const dim = d.base.dimensions.find(x => x.id === d.id);
          const lay = dimensionLayout(d.base, { ...dim, offset: 0 });
          if(lay) next = updateDimension(d.base, d.id, { offset: (raw.x - lay.a.x) * lay.n.x + (raw.y - lay.a.y) * lay.n.y });
        }
        if(next){ d.last = next; onPreview?.(next); }
      }catch{ /* posicion invalida durante el arrastre: se ignora ese cuadro */ }
      return;
    }
    if(drawingTools.includes(tool) || tool === 'door' || tool === 'window'){
      const { point, snap: s } = drawingTools.includes(tool) ? resolvePoint(raw, e) : { point: raw, snap: null };
      setCursor(point); setSnap(s);
    } else if(cursor){ setCursor(null); setSnap(null); }
    if(['select', 'edit', 'delete', 'door', 'window'].includes(tool)){
      const id = (tool === 'door' || tool === 'window') ? (hoveredWallAt(raw)?.wall.id || null) : hitTestCad(model, raw, tolWorld, { isSelectable });
      if(id !== hoverId) setHoverId(id);
    }
  };

  const onPointerUp = e => {
    if(panRef.current){
      const pr = panRef.current;
      panRef.current = null;
      if(!pr.moved && pr.selectOnUp) handleClick(pr.clickPoint, e);
      return;
    }
    if(dragRef.current){
      const d = dragRef.current;
      dragRef.current = null;
      setSnap(null);
      if(d.last){
        const label = d.type === 'wallEnd' ? `Mover extremo de ${d.id}` : d.type === 'opening' ? `Mover ${d.id}` : d.type === 'spaceVertex' ? `Editar ${d.id}` : `Mover cota ${d.id}`;
        onCommit?.(d.last, label);
      } else onPreview?.(null);
    }
  };

  const onDoubleClick = e => {
    if(tool === 'wall'){ setPending([]); return; }
    if(tool === 'space' || tool === 'measureArea'){ finishPolygon(); return; }
    if(tool === 'select'){
      const { sx, sy } = eventPoint(e);
      const id = hitTestCad(model, toWorld(sx, sy), tolWorld, { isSelectable });
      if(id){ onSelect?.(id); onRequestTool?.('edit'); }
    }
  };

  useEffect(() => {
    const onKey = e => {
      const tag = e.target?.tagName;
      if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if(e.key === 'Escape'){
        // preventDefault avisa al CadWorkspace que este Esc ya se consumio
        // (terminar el trazo) y no debe ademas cambiar de herramienta.
        if(pending.length){ setPending([]); e.preventDefault(); }
        else if(measure){ setMeasure(null); onMeasure?.(null); e.preventDefault(); }
      } else if(e.key === 'Enter' && (tool === 'space' || tool === 'measureArea')) finishPolygon();
      else if(e.key === 'Backspace' && pending.length){ e.preventDefault(); setPending(prev => prev.slice(0, -1)); }
    };
    // Fase de captura: corre SIEMPRE antes que el listener de CadWorkspace,
    // sin depender del orden en que React re-registro cada efecto.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  /* ---------- render ---------- */
  const statusOf = useMemo(() => {
    const map = new Map();
    const all = [...(model.walls || []), ...(model.openings || []), ...(model.spaces || []), ...(model.dimensions || [])];
    all.forEach(el => map.set(el.id, elementDisplayStatus(issues, el.id)));
    return map;
  }, [model, issues]);

  if(!view || !size){
    return <div ref={wrapRef} className="cad-canvas-wrap"><svg ref={svgRef} className="cad-canvas" /></div>;
  }

  const px = n => n / view.ppm; // pixeles de pantalla -> metros
  const tx = `translate(${size.w / 2 - view.cx * view.ppm} ${size.h / 2 - view.cy * view.ppm}) scale(${view.ppm})`;
  const visibleWorld = { minX: view.cx - size.w / 2 / view.ppm, maxX: view.cx + size.w / 2 / view.ppm, minY: view.cy - size.h / 2 / view.ppm, maxY: view.cy + size.h / 2 / view.ppm };
  const gridStep = view.ppm < 6 ? 10 : view.ppm < 25 ? 5 : 1;
  // Texto que acompana al zoom (8-12 px): legible de cerca y sin encimarse
  // de lejos, como el texto anotativo de un CAD.
  const fontPx = Math.max(8, Math.min(12, 0.24 * view.ppm));
  const fontSize = px(fontPx);

  const underlayW = underlay && model.underlay?.metersPerUnit ? model.underlay.widthUnits * model.underlay.metersPerUnit : null;
  const underlayH = underlay && model.underlay?.metersPerUnit ? model.underlay.heightUnits * model.underlay.metersPerUnit : null;

  const tag = (x, y, text, { color = C.line, bg = 'rgba(255,255,255,0.88)', bold = false, key } = {}) => {
    const w = px(text.length * fontPx * 0.6 + 8), h = px(fontPx + 5);
    return <g key={key} pointerEvents="none">
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={px(3)} fill={bg} stroke={color} strokeWidth={px(0.6)} />
      <text x={x} y={y + px(fontPx * 0.35)} fontSize={fontSize} textAnchor="middle" fill={color} fontWeight={bold ? 700 : 500} fontFamily="JetBrains Mono, ui-monospace, monospace">{text}</text>
    </g>;
  };

  const wallsEls = isVisible('walls') && (model.walls || []).map(w => {
    const st = statusOf.get(w.id);
    const pendingReview = w.review?.status === REVIEW_STATUS.PENDIENTE;
    const selected = w.id === selectedId, hovered = w.id === hoverId && !selected;
    const fill = selected ? C.sel : pendingReview ? C.wallPending : C.wall;
    const stroke = st === 'error' ? C.error : selected ? C.sel : hovered ? C.hover : pendingReview ? C.amber : C.wall;
    return <g key={w.id} data-id={w.id}>
      {wallPlanPieces(model, w).map((poly, i) => <polygon key={i} points={pts(poly)} fill={fill} stroke={stroke}
        strokeWidth={px(selected || hovered || st === 'error' ? 2 : 1)} strokeDasharray={pendingReview ? `${px(5)} ${px(3)}` : undefined} />)}
    </g>;
  });

  const openingEls = (model.openings || []).map(o => {
    const layerKey = o.type === OPENING_TYPE.WINDOW ? 'windows' : 'doors';
    if(!isVisible(layerKey)) return null;
    const wall = (model.walls || []).find(w => w.id === o.wallId);
    if(!wall) return null;
    const st = statusOf.get(o.id);
    const selected = o.id === selectedId, hovered = o.id === hoverId && !selected;
    const pendingReview = o.review?.status === REVIEW_STATUS.PENDIENTE;
    const color = st === 'error' ? C.error : selected ? C.sel : hovered ? C.hover : pendingReview ? C.amber : C.line;
    const sw = px(selected ? 2 : 1.2);
    const dash = pendingReview ? `${px(4)} ${px(3)}` : undefined;
    const n = wallNormal(wall), half = wall.thickness / 2;
    const a = pointAlongWall(wall, o.offset), b = pointAlongWall(wall, o.offset + o.width);
    const jamb = p => <line x1={p.x + n.x * half} y1={p.y + n.y * half} x2={p.x - n.x * half} y2={p.y - n.y * half} stroke={color} strokeWidth={sw} />;
    if(o.type === OPENING_TYPE.WINDOW){
      const quad = [
        { x: a.x + n.x * half, y: a.y + n.y * half }, { x: b.x + n.x * half, y: b.y + n.y * half },
        { x: b.x - n.x * half, y: b.y - n.y * half }, { x: a.x - n.x * half, y: a.y - n.y * half }
      ];
      return <g key={o.id} data-id={o.id}>
        <polygon points={pts(quad)} fill={selected ? 'rgba(15,107,168,0.18)' : '#FFFFFF'} stroke={color} strokeWidth={sw} strokeDasharray={dash} />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={sw} />
        <line x1={a.x + n.x * half * 0.35} y1={a.y + n.y * half * 0.35} x2={b.x + n.x * half * 0.35} y2={b.y + n.y * half * 0.35} stroke={color} strokeWidth={px(0.7)} />
      </g>;
    }
    const right = o.swing === 'right';
    const hinge = right ? b : a, other = right ? a : b;
    const leafEnd = { x: hinge.x + n.x * o.width, y: hinge.y + n.y * o.width };
    return <g key={o.id} data-id={o.id}>
      {jamb(a)}{jamb(b)}
      <line x1={hinge.x} y1={hinge.y} x2={leafEnd.x} y2={leafEnd.y} stroke={color} strokeWidth={sw} strokeDasharray={dash} />
      <path d={`M ${leafEnd.x} ${leafEnd.y} A ${o.width} ${o.width} 0 0 ${right ? 1 : 0} ${other.x} ${other.y}`} fill="none" stroke={color} strokeWidth={px(0.8)} strokeDasharray={dash || `${px(3)} ${px(2)}`} />
      {selected && <rect x={Math.min(a.x, b.x) - px(2)} y={Math.min(a.y, b.y) - px(2)} width={Math.abs(b.x - a.x) + px(4)} height={Math.abs(b.y - a.y) + px(4)} fill="none" stroke={C.sel} strokeWidth={px(0.6)} />}
    </g>;
  });

  const spaceEls = isVisible('spaces') && (model.spaces || []).map(s => {
    const selected = s.id === selectedId, hovered = s.id === hoverId && !selected;
    const pendingReview = s.review?.status === REVIEW_STATUS.PENDIENTE;
    return <polygon key={s.id} data-id={s.id} points={pts(s.points)}
      fill={selected ? C.spaceSel : hovered ? 'rgba(59,160,217,0.10)' : C.space}
      stroke={selected ? C.sel : pendingReview ? C.amber : 'rgba(15,107,168,0.35)'}
      strokeWidth={px(selected ? 2 : 1)} strokeDasharray={pendingReview || !selected ? `${px(6)} ${px(4)}` : undefined} />;
  });

  const dimEls = isVisible('dimensions') && (model.dimensions || []).map(d => {
    const lay = dimensionLayout(model, d);
    if(!lay) return null;
    const selected = d.id === selectedId, hovered = d.id === hoverId && !selected;
    const pendingVal = d.status === 'PENDIENTE_VALIDACION';
    const color = statusOf.get(d.id) === 'error' ? C.error : selected ? C.sel : hovered ? C.hover : pendingVal ? C.amber : C.dim;
    const sign = Math.sign(Number(d.offset) || 1);
    const ext = px(6);
    const tick = (p) => {
      const t = { x: (lay.d.x + lay.n.x) * px(4), y: (lay.d.y + lay.n.y) * px(4) };
      return <line x1={p.x - t.x} y1={p.y - t.y} x2={p.x + t.x} y2={p.y + t.y} stroke={color} strokeWidth={px(1.3)} />;
    };
    const textPos = { x: lay.mid.x + lay.n.x * sign * px(8), y: lay.mid.y + lay.n.y * sign * px(8) };
    const label = `${fmt(lay.value)} m${pendingVal ? ' ?' : ''}`;
    return <g key={d.id} data-id={d.id}>
      <line x1={lay.a.x + lay.n.x * sign * px(3)} y1={lay.a.y + lay.n.y * sign * px(3)} x2={lay.p1.x + lay.n.x * sign * ext} y2={lay.p1.y + lay.n.y * sign * ext} stroke={color} strokeWidth={px(0.7)} />
      <line x1={lay.b.x + lay.n.x * sign * px(3)} y1={lay.b.y + lay.n.y * sign * px(3)} x2={lay.p2.x + lay.n.x * sign * ext} y2={lay.p2.y + lay.n.y * sign * ext} stroke={color} strokeWidth={px(0.7)} />
      <line x1={lay.p1.x} y1={lay.p1.y} x2={lay.p2.x} y2={lay.p2.y} stroke={color} strokeWidth={px(selected ? 1.6 : 0.9)} strokeDasharray={pendingVal ? `${px(4)} ${px(2)}` : undefined} />
      {tick(lay.p1)}{tick(lay.p2)}
      <text x={textPos.x} y={textPos.y} fontSize={fontSize} fill={color} textAnchor="middle" dominantBaseline="middle"
        transform={`rotate(${lay.angle} ${textPos.x} ${textPos.y})`} fontFamily="JetBrains Mono, ui-monospace, monospace" fontWeight={600}
        paintOrder="stroke" stroke="#FFFFFF" strokeWidth={px(3)}>
        <title>{pendingVal ? 'Cota pendiente de validación' : `Cota ${d.id}`}</title>{label}
      </text>
    </g>;
  });

  const labelEls = [];
  if(isVisible('labels') || isVisible('quantities')){
    if(isVisible('walls')) (model.walls || []).forEach(w => {
      const len = wallLength(w);
      if(len <= 0) return;
      // ID al 25% del muro y cantidad al 65%: nunca compiten con la etiqueta
      // del espacio, que va al centro.
      const n = wallNormal(w);
      const mid = pointAlongWall(w, len * 0.25), qPos = pointAlongWall(w, len * 0.65);
      const off = w.thickness / 2 + px(fontPx + 4);
      const st = statusOf.get(w.id);
      const mark = statusMark(st, w.review);
      const validatedFromAi = !mark && w.source !== CAD_SOURCE.USER && w.source !== CAD_SOURCE.FIXTURE && w.review?.status === REVIEW_STATUS.CONFIRMADO;
      if(isVisible('labels')){
        const text = `${w.id}${mark ? ` ${mark.icon} ${mark.text}` : validatedFromAi ? ' ✓' : ''}`;
        labelEls.push(tag(mid.x + n.x * off, mid.y + n.y * off, text, { key: `lbl-${w.id}`, color: mark ? mark.color : w.id === selectedId ? C.sel : validatedFromAi ? C.ok : C.line, bold: w.id === selectedId }));
      }
      if(isVisible('quantities')){
        const m = computeWallMetrics(model, w);
        labelEls.push(tag(qPos.x + n.x * off, qPos.y + n.y * off, `${fmt(m.netArea)} m²`, { key: `q-${w.id}`, color: C.dim, bg: 'rgba(233,238,243,0.92)' }));
      }
    });
    (model.openings || []).forEach(o => {
      const layerKey = o.type === OPENING_TYPE.WINDOW ? 'windows' : 'doors';
      if(!isVisible(layerKey) || !isVisible('labels')) return;
      const wall = (model.walls || []).find(w => w.id === o.wallId);
      if(!wall) return;
      // Sobre el propio vano: sin ambiguedad de a que hueco pertenece.
      const c = pointAlongWall(wall, o.offset + o.width / 2);
      const mark = statusMark(statusOf.get(o.id), o.review);
      labelEls.push(tag(c.x, c.y, `${o.id}${mark ? ` ${mark.icon} ${mark.text}` : ''}`, { key: `lbl-${o.id}`, color: mark ? mark.color : o.id === selectedId ? C.sel : C.line }));
    });
    if(isVisible('spaces')) (model.spaces || []).forEach(s => {
      const c = polygonCentroid(s.points);
      const mark = statusMark(statusOf.get(s.id), s.review);
      if(isVisible('labels')) labelEls.push(tag(c.x, c.y - px(fontPx), `${s.id} · ${s.name}${mark ? ` ${mark.icon}` : ''}`, { key: `lbl-${s.id}`, color: mark ? mark.color : s.id === selectedId ? C.sel : C.line, bold: true }));
      if(isVisible('quantities')){
        const m = computeSpaceMetrics(model, s);
        labelEls.push(tag(c.x, c.y + px(fontPx), `${fmt(m.area)} m²`, { key: `q-${s.id}`, color: C.dim, bg: 'rgba(233,238,243,0.92)' }));
      }
    });
  }

  /* ----- previsualizacion de herramientas ----- */
  const preview = [];
  const last = pending[pending.length - 1];
  if(cursor && tool === 'wall' && last){
    const len = Math.hypot(cursor.x - last.x, cursor.y - last.y);
    if(len > 0.01){
      const ghost = { id: '__ghost', x1: last.x, y1: last.y, x2: cursor.x, y2: cursor.y, thickness: model.defaults.wallThickness };
      const n = wallNormal(ghost), h = ghost.thickness / 2;
      preview.push(<polygon key="ghost" points={pts([
        { x: last.x + n.x * h, y: last.y + n.y * h }, { x: cursor.x + n.x * h, y: cursor.y + n.y * h },
        { x: cursor.x - n.x * h, y: cursor.y - n.y * h }, { x: last.x - n.x * h, y: last.y - n.y * h }])}
        fill="rgba(15,107,168,0.25)" stroke={C.sel} strokeWidth={px(1)} />);
      preview.push(tag((last.x + cursor.x) / 2 + n.x * px(18), (last.y + cursor.y) / 2 + n.y * px(18), `${fmt(len)} m`, { key: 'ghost-len', color: C.sel, bold: true }));
    }
  }
  if(cursor && (tool === 'measureDistance' || tool === 'dimension' || tool === 'calibrate') && last){
    preview.push(<line key="m" x1={last.x} y1={last.y} x2={cursor.x} y2={cursor.y} stroke={tool === 'calibrate' ? C.error : C.sel} strokeWidth={px(1.4)} strokeDasharray={`${px(5)} ${px(3)}`} />);
    preview.push(tag((last.x + cursor.x) / 2, (last.y + cursor.y) / 2 - px(12), `${fmt(Math.hypot(cursor.x - last.x, cursor.y - last.y))} m`, { key: 'm-len', color: tool === 'calibrate' ? C.error : C.sel, bold: true }));
  }
  if((tool === 'measureArea' || tool === 'space') && pending.length){
    const poly = cursor ? [...pending, cursor] : pending;
    preview.push(<polygon key="poly" points={pts(poly)} fill="rgba(15,107,168,0.12)" stroke={C.sel} strokeWidth={px(1.2)} strokeDasharray={`${px(5)} ${px(3)}`} />);
    if(poly.length >= 3){
      const c = polygonCentroid(poly);
      preview.push(tag(c.x, c.y, `${fmt(polygonArea(poly))} m²`, { key: 'poly-a', color: C.sel, bold: true }));
    }
  }
  pending.forEach((p, i) => preview.push(<circle key={`pp${i}`} cx={p.x} cy={p.y} r={px(3.5)} fill={tool === 'calibrate' ? C.error : C.sel} />));
  if(measure?.kind === 'distance'){
    preview.push(<line key="md" x1={measure.a.x} y1={measure.a.y} x2={measure.b.x} y2={measure.b.y} stroke="#7A4BB7" strokeWidth={px(1.6)} />);
    preview.push(tag((measure.a.x + measure.b.x) / 2, (measure.a.y + measure.b.y) / 2 - px(12), `${fmt(measure.value)} m`, { key: 'md-l', color: '#7A4BB7', bold: true }));
  }
  if(measure?.kind === 'area'){
    const c = polygonCentroid(measure.points);
    preview.push(<polygon key="ma" points={pts(measure.points)} fill="rgba(122,75,183,0.12)" stroke="#7A4BB7" strokeWidth={px(1.4)} />);
    preview.push(tag(c.x, c.y, `${fmt(measure.area)} m² · P ${fmt(measure.perimeter)} m`, { key: 'ma-l', color: '#7A4BB7', bold: true }));
  }
  if(cursor && (tool === 'door' || tool === 'window') && hoverId){
    const wall = (model.walls || []).find(w => w.id === hoverId);
    if(wall){
      const width = tool === 'door' ? model.defaults.doorWidth : model.defaults.windowWidth;
      const { t } = projectPointOnSegment(cursor, { x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 });
      const len = wallLength(wall);
      const off = Math.min(Math.max(t * len - width / 2, 0), Math.max(0, len - width));
      const a = pointAlongWall(wall, off), b = pointAlongWall(wall, off + width), n = wallNormal(wall), h = wall.thickness / 2 + px(2);
      preview.push(<polygon key="op" points={pts([{ x: a.x + n.x * h, y: a.y + n.y * h }, { x: b.x + n.x * h, y: b.y + n.y * h }, { x: b.x - n.x * h, y: b.y - n.y * h }, { x: a.x - n.x * h, y: a.y - n.y * h }])} fill="rgba(15,107,168,0.3)" stroke={C.sel} strokeWidth={px(1)} />);
    }
  }

  const snapMarker = snap && cursor !== undefined && (() => {
    const s = snap, r = px(6);
    let shape;
    if(s.kind === SNAP_KIND.ENDPOINT) shape = <rect x={s.x - r} y={s.y - r} width={r * 2} height={r * 2} fill="none" stroke="#D97706" strokeWidth={px(1.8)} />;
    else if(s.kind === SNAP_KIND.MIDPOINT) shape = <polygon points={pts([{ x: s.x, y: s.y - r }, { x: s.x + r, y: s.y + r }, { x: s.x - r, y: s.y + r }])} fill="none" stroke="#D97706" strokeWidth={px(1.8)} />;
    else if(s.kind === SNAP_KIND.INTERSECTION) shape = <g stroke="#D97706" strokeWidth={px(1.8)}><line x1={s.x - r} y1={s.y - r} x2={s.x + r} y2={s.y + r} /><line x1={s.x - r} y1={s.y + r} x2={s.x + r} y2={s.y - r} /></g>;
    else shape = <circle cx={s.x} cy={s.y} r={r} fill="none" stroke="#D97706" strokeWidth={px(1.8)} />;
    return <g pointerEvents="none">{shape}{tag(s.x + px(40), s.y - px(14), SNAP_LABEL[s.kind], { key: 'snap-l', color: '#B45309' })}</g>;
  })();

  const handleEls = handlesFor().map(h => <rect key={h.key} x={h.x - px(5)} y={h.y - px(5)} width={px(10)} height={px(10)} fill="#FFFFFF" stroke={C.sel} strokeWidth={px(1.6)} style={{ cursor: 'move' }} />);

  const cursorStyle = tool === 'pan' ? 'grab' : ['wall', 'measureDistance', 'measureArea', 'space', 'dimension', 'calibrate', 'door', 'window'].includes(tool) ? 'crosshair' : tool === 'delete' ? 'not-allowed' : tool === 'zoom' ? 'zoom-in' : 'default';

  return <div ref={wrapRef} className="cad-canvas-wrap">
    <svg ref={svgRef} className="cad-canvas" width={size.w} height={size.h} style={{ cursor: cursorStyle }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onDoubleClick={onDoubleClick}
      onContextMenu={e => { if(pending.length){ e.preventDefault(); setPending([]); } }}
      onPointerLeave={() => { if(!dragRef.current && !panRef.current){ setCursor(null); setSnap(null); } }}>
      <defs>
        <pattern id="cad-grid-minor" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
          <path d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`} fill="none" stroke="rgba(15,107,168,0.10)" strokeWidth={px(1)} />
        </pattern>
        <pattern id="cad-grid-major" width={gridStep * 5} height={gridStep * 5} patternUnits="userSpaceOnUse">
          <rect width={gridStep * 5} height={gridStep * 5} fill="url(#cad-grid-minor)" />
          <path d={`M ${gridStep * 5} 0 L 0 0 0 ${gridStep * 5}`} fill="none" stroke="rgba(15,107,168,0.20)" strokeWidth={px(1)} />
        </pattern>
      </defs>
      <g transform={tx}>
        {underlay && underlayW && isVisible('underlay') && <image href={underlay.url} x={0} y={0} width={underlayW} height={underlayH} preserveAspectRatio="none" opacity={0.6} />}
        {showGrid && <rect x={visibleWorld.minX} y={visibleWorld.minY} width={visibleWorld.maxX - visibleWorld.minX} height={visibleWorld.maxY - visibleWorld.minY} fill="url(#cad-grid-major)" pointerEvents="none" />}
        {spaceEls}
        {wallsEls}
        {openingEls}
        {dimEls}
        {labelEls}
        {preview}
        {handleEls}
        {snapMarker}
      </g>
    </svg>
    <div className="cad-canvas-zoom">
      <button type="button" title="Acercar" onClick={() => zoomBy(1.25)}>+</button>
      <button type="button" title="Alejar" onClick={() => zoomBy(0.8)}>−</button>
      <button type="button" title="Encuadrar todo" onClick={fitAll}>⤢</button>
    </div>
    <ScaleBar ppm={view.ppm} />
  </div>;
}

/* Barra de escala grafica: longitud "redonda" (0.5/1/2/5/10/20 m) que ocupe
   entre 60 y 160 px al zoom actual -- escala visual real, no decorativa. */
function ScaleBar({ ppm }){
  const options = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
  const meters = options.find(m => m * ppm >= 60) || options[options.length - 1];
  const w = meters * ppm;
  return <div className="cad-scalebar" aria-label={`Escala gráfica ${meters} m`}>
    <div className="cad-scalebar-bar" style={{ width: w }}><span /><span /></div>
    <small>{meters >= 1 ? `${meters} m` : `${meters * 100} cm`}</small>
  </div>;
}
