/* Panel derecho del Plano Inteligente: propiedades REALES del objeto
   seleccionado (todas derivadas del modelo comun en cada render -- nunca
   copias guardadas), edicion de campos compatibles, acciones contextuales
   segun el tipo de objeto (punto 14) y la cadena objeto -> cantidad ->
   concepto -> APU (puntos 3 y 15). */
import { useEffect, useMemo, useState } from 'react';
import {
  CAD_KIND, OPENING_TYPE, REVIEW_STATUS, CAD_SOURCE, findElement, updateWall, updateOpening, updateSpace,
  updateDimension, deleteElement, setElementReview, setElementAssignment, openingsOnWall, elementDisplayStatus,
  computeWallMetrics, resolveDimension, confidenceLevel
} from '../../../domain/cadModel.js';
import { buildElementTakeoff, isAssignmentStale, conceptQuantityFromModel, markConceptSynced } from '../../../domain/cadTakeoff.js';
import { listProjectConcepts, listProjectApus, createConceptFromElement, updateConceptQuantity, associateConceptApu } from './cadConceptService.js';

const fmt = (n, d = 2) => (Number.isFinite(Number(n)) ? Number(n).toFixed(d) : '—');
const SOURCE_LABEL = { [CAD_SOURCE.USER]: 'Dibujado por el usuario', [CAD_SOURCE.VECTOR]: 'Geometría vectorial del PDF', [CAD_SOURCE.AI]: 'Propuesto por IA', [CAD_SOURCE.FIXTURE]: 'Fixture de prueba' };

function NumField({ label, value, unit = 'm', onCommit, disabled = false, min = null, autoFocusKey }){
  const [draft, setDraft] = useState(fmt(value, 3));
  useEffect(() => { setDraft(fmt(value, 3)); }, [value]);
  const commit = () => {
    const n = Number(String(draft).replace(',', '.'));
    if(!Number.isFinite(n) || (min != null && n < min)){ setDraft(fmt(value, 3)); return; }
    if(Math.abs(n - Number(value)) > 1e-6) onCommit(n);
  };
  return <label className="cad-field">
    <span>{label}</span>
    <span className="cad-field-input">
      <input type="text" inputMode="decimal" aria-label={`${label} (${unit})`} value={draft} disabled={disabled} data-autofocus={autoFocusKey || undefined}
        onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if(e.key === 'Enter'){ e.currentTarget.blur(); } if(e.key === 'Escape'){ setDraft(fmt(value, 3)); e.currentTarget.blur(); } }} />
      <em>{unit}</em>
    </span>
  </label>;
}

function ReadRow({ label, value, unit, strong = false }){
  return <div className={`cad-row ${strong ? 'is-strong' : ''}`}><span>{label}</span><b>{value}{unit ? <em> {unit}</em> : null}</b></div>;
}

function StatusChip({ status, review }){
  if(status === 'error') return <span className="cad-chip is-error" title="Revisa las advertencias">! Error</span>;
  if(status === 'pendiente'){
    const lvl = review?.level || confidenceLevel(review?.confidence);
    return <span className="cad-chip is-pending" title="Detectado automáticamente, requiere tu confirmación">? Pendiente{review?.confidence != null ? ` · ${Math.round(review.confidence)}%` : ''}{lvl ? ` ${lvl}` : ''}</span>;
  }
  return <span className="cad-chip is-ok">✓ Confirmado</span>;
}

const KIND_TITLE = { wall: 'Muro', space: 'Espacio', dimension: 'Cota' };

export default function CadPropertiesPanel({
  model, getModel, selectedId, issues, onChange, onError, onNotify, onSelect, onAction,
  projectId, planoId, fileName, user, onNeedProject
}){
  const found = selectedId ? findElement(model, selectedId) : null;
  const [quantifyOpen, setQuantifyOpen] = useState(false);
  const [quantityField, setQuantityField] = useState(null);
  const [conceptMode, setConceptMode] = useState(null); // 'search' | 'create' | 'apu'
  const [concepts, setConcepts] = useState(null);
  const [apus, setApus] = useState(null);
  const [query, setQuery] = useState('');
  const [newConcept, setNewConcept] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setQuantifyOpen(false); setConceptMode(null); setQuantityField(null); setQuery(''); }, [selectedId]);

  const takeoff = useMemo(() => (found && found.kind !== CAD_KIND.DIMENSION ? buildElementTakeoff(model, selectedId) : null), [model, selectedId, found]);
  const myIssues = (issues || []).filter(i => i.id === selectedId);
  const status = selectedId ? elementDisplayStatus(issues, selectedId) : null;

  if(!found){
    return <div className="cad-props-empty">
      <p className="muted">Selecciona un muro, puerta, ventana, espacio o cota en la planta o en el 3D para ver sus propiedades.</p>
      <p className="muted" style={{ fontSize: '.74rem' }}>Atajos: V seleccionar · E editar · W muro · P puerta · N ventana · S espacio · C cota · D distancia · A área · Supr eliminar · Ctrl+Z / Ctrl+Y</p>
    </div>;
  }
  const { kind, element } = found;
  const apply = (fn, label) => { try{ onChange(fn(model), label); }catch(err){ onError?.(err.message); } };

  const openQuantify = (field = null) => {
    setQuantifyOpen(true);
    setQuantityField(field || element.assignment?.quantityField || takeoff?.primary.field || null);
    setConceptMode(null);
  };
  const activeLine = takeoff?.lines.find(l => l.key === (quantityField || takeoff?.primary.field)) || null;

  /* ----- concepto / APU ----- */
  const requireProject = () => {
    if(projectId && planoId) return true;
    onError?.(!projectId ? 'Selecciona un proyecto para ligar conceptos y APU.' : 'Guarda el plano en el proyecto antes de ligar conceptos.');
    if(!projectId) onNeedProject?.();
    return false;
  };
  const loadConcepts = async () => {
    if(!requireProject()) return;
    setConceptMode('search'); setConcepts(null);
    try{ setConcepts(await listProjectConcepts(projectId)); }catch(err){ onError?.(err.message); setConcepts([]); }
  };
  const loadApus = async () => {
    if(!requireProject()) return;
    setConceptMode('apu'); setApus(null);
    try{ setApus(await listProjectApus(projectId)); }catch(err){ onError?.(err.message); setApus([]); }
  };

  const syncConcept = async (conceptId, unit, baseModel, extraPatch = {}) => {
    const { qty, mismatched } = conceptQuantityFromModel(baseModel, conceptId, unit);
    if(mismatched.length) onNotify?.(`Objetos con unidad distinta no se sumaron: ${mismatched.join(', ')}`, 'error');
    if(qty > 0) await updateConceptQuantity(conceptId, qty);
    return { next: markConceptSynced(baseModel, conceptId, extraPatch), qty };
  };

  const linkConcept = async (c) => {
    if(!activeLine) return;
    setBusy(true);
    try{
      const base = setElementAssignment(getModel(), element.id, {
        conceptId: c.id, clave: c.clave || '', concept: c.concept, unit: c.unit, capitulo: c.capitulo || null,
        quantityField: activeLine.key, apuId: c.apuId || null, apuLabel: c.apuId || null
      });
      const { next, qty } = await syncConcept(c.id, c.unit, base);
      onChange(next, `Ligar ${element.id} a concepto`);
      onNotify?.(`${element.id} ligado a "${c.concept}" · cantidad del concepto ${fmt(qty)} ${c.unit}`, 'success');
      setConceptMode(null);
    }catch(err){ onError?.(err.message); }finally{ setBusy(false); }
  };

  const createConcept = async () => {
    if(!activeLine || !requireProject()) return;
    const conceptText = newConcept.trim();
    if(!conceptText){ onError?.('Escribe la descripción del concepto.'); return; }
    if(!(Number(activeLine.value) > 0)){ onError?.('La cantidad debe ser mayor que cero para crear el concepto.'); return; }
    setBusy(true);
    try{
      const c = await createConceptFromElement({
        projectId, planoId, elementId: element.id, concept: conceptText, unit: activeLine.unit, qty: activeLine.value,
        capitulo: takeoff.capitulo, fileName, user: user?.email || user?.uid || null
      });
      const base = setElementAssignment(getModel(), element.id, {
        conceptId: c.id, clave: c.clave || '', concept: c.concept, unit: c.unit, capitulo: c.capitulo || null,
        quantityField: activeLine.key, apuId: c.apuId || null, apuLabel: c.apuId || null
      });
      onChange(markConceptSynced(base, c.id), `Crear concepto para ${element.id}`);
      onNotify?.(`Concepto creado en el catálogo: ${c.concept}`, 'success');
      setConceptMode(null);
    }catch(err){ onError?.(err.message); }finally{ setBusy(false); }
  };

  const resync = async () => {
    const a = element.assignment;
    if(!a || !requireProject()) return;
    setBusy(true);
    try{
      const { next, qty } = await syncConcept(a.conceptId, a.unit, getModel());
      onChange(next, `Sincronizar cantidad de ${a.concept}`);
      onNotify?.(`Cantidad actualizada en el catálogo: ${fmt(qty)} ${a.unit}`, 'success');
    }catch(err){ onError?.(err.message); }finally{ setBusy(false); }
  };

  const unlink = async () => {
    const a = element.assignment;
    if(!a) return;
    const base = setElementAssignment(getModel(), element.id, null);
    onChange(base, `Quitar concepto de ${element.id}`);
    if(projectId){
      try{
        const { qty } = conceptQuantityFromModel(base, a.conceptId, a.unit);
        if(qty > 0) await updateConceptQuantity(a.conceptId, qty);
      }catch(err){ onError?.(err.message); }
    }
  };

  const assignApu = async (apu) => {
    const a = element.assignment;
    if(!a) return;
    setBusy(true);
    try{
      await associateConceptApu(a.conceptId, apu.id);
      const label = apu.clave || apu.id;
      const next = markConceptSynced(getModel(), a.conceptId, { apuId: apu.id, apuLabel: label });
      onChange(next, `Asignar APU a ${a.concept}`);
      onNotify?.(`APU ${label} asociado al concepto "${a.concept}"`, 'success');
      setConceptMode(null);
    }catch(err){ onError?.(err.message); }finally{ setBusy(false); }
  };

  /* ----- secciones por tipo ----- */
  let title = KIND_TITLE[kind] || '';
  let fields = null, metrics = null, relations = null, actions = [];

  if(kind === CAD_KIND.WALL){
    const m = computeWallMetrics(model, element);
    const ops = openingsOnWall(model, element.id);
    fields = <div className="cad-fields">
      <NumField label="Longitud" value={m.length} autoFocusKey="edit" onCommit={v => apply(md => updateWall(md, element.id, { length: v }), `Longitud ${element.id}`)} />
      <NumField label="Espesor" value={element.thickness} onCommit={v => apply(md => updateWall(md, element.id, { thickness: v }), `Espesor ${element.id}`)} />
      <NumField label="Altura" value={element.height} onCommit={v => apply(md => updateWall(md, element.id, { height: v }), `Altura ${element.id}`)} />
      <details className="cad-coords"><summary>Coordenadas (inicio / final)</summary>
        <div className="cad-fields is-grid">
          <NumField label="Inicio X" value={element.x1} onCommit={v => apply(md => updateWall(md, element.id, { x1: v }), `Mover inicio ${element.id}`)} />
          <NumField label="Inicio Y" value={element.y1} onCommit={v => apply(md => updateWall(md, element.id, { y1: v }), `Mover inicio ${element.id}`)} />
          <NumField label="Final X" value={element.x2} onCommit={v => apply(md => updateWall(md, element.id, { x2: v }), `Mover final ${element.id}`)} />
          <NumField label="Final Y" value={element.y2} onCommit={v => apply(md => updateWall(md, element.id, { y2: v }), `Mover final ${element.id}`)} />
        </div>
      </details>
    </div>;
    metrics = <div className="cad-metrics">
      <ReadRow label="Área bruta" value={fmt(m.grossArea)} unit="m²" />
      <ReadRow label="Huecos" value={fmt(m.openingsArea)} unit="m²" />
      <ReadRow label="Área neta" value={fmt(m.netArea)} unit="m²" strong />
      <ReadRow label="Volumen neto" value={fmt(m.netVolume)} unit="m³" />
    </div>;
    relations = ops.length > 0 && <div className="cad-relations"><span className="muted">Huecos en este muro:</span>
      {ops.map(o => <button key={o.id} type="button" className="cad-link" onClick={() => onSelect(o.id)}>{o.id}</button>)}</div>;
    actions = [
      ['Editar', () => onAction('edit')], ['Ver en 3D', () => onAction('view3d')], ['Cuantificar', () => openQuantify()],
      ['Asignar concepto/APU', () => { openQuantify(); }], ['Acotar', () => onAction('dimensionWall')]
    ];
  } else if(kind === CAD_KIND.OPENING){
    const isDoor = element.type === OPENING_TYPE.DOOR;
    title = isDoor ? 'Puerta' : 'Ventana';
    const walls = model.walls || [];
    fields = <div className="cad-fields">
      <label className="cad-field"><span>Muro anfitrión</span>
        <select value={element.wallId} onChange={e => apply(md => updateOpening(md, element.id, { wallId: e.target.value }), `Cambiar muro de ${element.id}`)}>
          {walls.map(w => <option key={w.id} value={w.id}>{w.id}</option>)}
        </select>
      </label>
      <NumField label="Posición desde inicio" value={element.offset} onCommit={v => apply(md => updateOpening(md, element.id, { offset: v }), `Mover ${element.id}`)} />
      <NumField label="Ancho" value={element.width} autoFocusKey="edit" min={0.01} onCommit={v => apply(md => updateOpening(md, element.id, { width: v }), `Ancho ${element.id}`)} />
      <NumField label="Alto" value={element.height} min={0.01} onCommit={v => apply(md => updateOpening(md, element.id, { height: v }), `Alto ${element.id}`)} />
      {!isDoor && <NumField label="Antepecho" value={element.sill} min={0} onCommit={v => apply(md => updateOpening(md, element.id, { sill: v }), `Antepecho ${element.id}`)} />}
      {isDoor && <label className="cad-field"><span>Abatimiento</span>
        <select value={element.swing || 'left'} onChange={e => apply(md => updateOpening(md, element.id, { swing: e.target.value }), `Abatimiento ${element.id}`)}>
          <option value="left">Izquierdo</option><option value="right">Derecho</option>
        </select></label>}
    </div>;
    metrics = <div className="cad-metrics">
      <ReadRow label="Área del vano" value={fmt(element.width * element.height)} unit="m²" strong />
    </div>;
    relations = <div className="cad-relations"><span className="muted">Alojada en:</span><button type="button" className="cad-link" onClick={() => onSelect(element.wallId)}>{element.wallId}</button></div>;
    actions = [
      ['Editar dimensiones', () => onAction('focusField')], ['Ver en 3D', () => onAction('view3d')],
      ['Asignar concepto', () => openQuantify()], ['Cuantificar', () => openQuantify()]
    ];
  } else if(kind === CAD_KIND.SPACE){
    fields = <div className="cad-fields">
      <label className="cad-field"><span>Nombre</span>
        <input type="text" defaultValue={element.name} key={element.id + element.name}
          onBlur={e => { if(e.target.value.trim() && e.target.value !== element.name) apply(md => updateSpace(md, element.id, { name: e.target.value }), `Renombrar ${element.id}`); }}
          onKeyDown={e => { if(e.key === 'Enter') e.currentTarget.blur(); }} />
      </label>
      <NumField label="Altura de plafón" value={element.ceilingHeight ?? model.defaults.wallHeight} onCommit={v => apply(md => updateSpace(md, element.id, { ceilingHeight: v }), `Altura ${element.id}`)} />
    </div>;
    metrics = <div className="cad-metrics">
      {takeoff.lines.filter(l => l.key !== 'volume').map(l => <ReadRow key={l.key} label={l.label} value={fmt(l.value)} unit={l.unit} strong={l.primary} />)}
    </div>;
    actions = [
      ['Área', () => openQuantify('area')], ['Piso', () => openQuantify('floorArea')], ['Plafón', () => openQuantify('ceilingArea')],
      ['Ver en 3D', () => onAction('view3d')], ['Cuantificar', () => openQuantify()]
    ];
  } else {
    const r = resolveDimension(model, element);
    const pendingVal = element.status === 'PENDIENTE_VALIDACION';
    fields = <div className="cad-fields">
      <NumField label="Desfase de la línea" value={element.offset} onCommit={v => apply(md => updateDimension(md, element.id, { offset: v }), `Desfase ${element.id}`)} />
    </div>;
    metrics = <div className="cad-metrics">
      <ReadRow label="Distancia" value={fmt(r.value)} unit="m" strong />
      <ReadRow label="Origen" value={element.ref ? `Ligada a ${element.ref.id}` : `(${fmt(element.a?.x)}, ${fmt(element.a?.y)}) → (${fmt(element.b?.x)}, ${fmt(element.b?.y)})`} />
      {element.declaredValue != null && <ReadRow label="Valor escrito en el plano" value={fmt(element.declaredValue)} unit="m" />}
      {pendingVal && <p className="cad-warn">Pendiente de validación: cota tomada del plano original sin certeza.</p>}
    </div>;
    actions = pendingVal ? [['Validar cota', () => apply(md => setElementReview(md, element.id, REVIEW_STATUS.CONFIRMADO), `Validar ${element.id}`)]] : [];
    if(element.ref) actions.push(['Ir al muro', () => onSelect(element.ref.id)]);
  }

  const reviewPending = element.review?.status === REVIEW_STATUS.PENDIENTE;
  const a = element.assignment;
  const stale = a && isAssignmentStale(model, element);
  const assignedLine = a ? takeoff?.lines.find(l => l.key === a.quantityField) : null;
  const filteredConcepts = (concepts || []).filter(c => !query || `${c.clave} ${c.concept}`.toLowerCase().includes(query.toLowerCase()));

  return <div className="cad-props">
    <header className="cad-props-head">
      <div><small className="muted">{title}</small><h3>{element.id}</h3></div>
      <StatusChip status={status} review={element.review} />
    </header>
    {element.source && <p className="cad-source">{SOURCE_LABEL[element.source] || element.source}{element.review?.confidence != null ? ` · confianza ${Math.round(element.review.confidence)}% (${element.review.level || confidenceLevel(element.review.confidence)})` : ''}</p>}

    {reviewPending && <div className="cad-review-box">
      <span>Detectado automáticamente. ¿Es correcto?</span>
      <div>
        <button type="button" onClick={() => apply(md => setElementReview(md, element.id, REVIEW_STATUS.CONFIRMADO), `Aceptar ${element.id}`)}>✓ Aceptar</button>
        <button type="button" className="soft" onClick={() => onAction('edit')}>Corregir</button>
        <button type="button" className="soft danger" onClick={() => apply(md => deleteElement(md, element.id), `Descartar ${element.id}`)}>Descartar</button>
      </div>
    </div>}

    {myIssues.filter(i => i.severity === 'error').map((i, k) => <p key={k} className="cad-warn is-error">! {i.message}</p>)}

    {fields}
    {metrics}
    {relations}

    {kind !== CAD_KIND.DIMENSION && <div className="cad-chain">
      <span className="cad-chain-title">Concepto / APU</span>
      {a ? <>
        <div className="cad-chain-flow">
          <b>{element.id}</b><i>→</i>
          <span>{assignedLine ? `${fmt(assignedLine.value)} ${assignedLine.unit}` : '—'}</span><i>→</i>
          <span title={a.concept}>{a.clave ? `${a.clave} · ` : ''}{a.concept}</span><i>→</i>
          <span>{a.apuId ? `APU ${a.apuLabel || a.apuId}` : 'Sin APU'}</span>
        </div>
        {stale && <p className="cad-warn">La geometría cambió desde la última sincronización ({fmt(a.syncedQty)} → {fmt(assignedLine?.value)} {a.unit}).</p>}
        <div className="cad-actions">
          {stale && <button type="button" disabled={busy} onClick={resync}>Sincronizar cantidad</button>}
          <button type="button" className="soft" disabled={busy} onClick={loadApus}>{a.apuId ? 'Cambiar APU' : 'Asignar APU'}</button>
          <button type="button" className="soft" disabled={busy} onClick={unlink}>Quitar liga</button>
        </div>
      </> : <p className="muted" style={{ margin: '2px 0' }}>Sin asignar</p>}
    </div>}

    {actions.length > 0 && <div className="cad-actions">
      {actions.map(([label, fn]) => <button key={label} type="button" className="soft" onClick={fn}>{label}</button>)}
      <button type="button" className="soft danger" onClick={() => apply(md => deleteElement(md, element.id), `Eliminar ${element.id}`)}>Eliminar</button>
    </div>}

    {quantifyOpen && takeoff && <section className="cad-quantify">
      <header><b>Cuantificar {element.id}</b><button type="button" className="cad-x" onClick={() => setQuantifyOpen(false)} aria-label="Cerrar">×</button></header>
      <table><tbody>
        {takeoff.lines.map(l => <tr key={l.key} className={l.key === activeLine?.key ? 'is-active' : ''} onClick={() => setQuantityField(l.key)} title="Usar esta cantidad para el concepto">
          <td>{l.label}</td><td>{fmt(l.value)} {l.unit}</td>
        </tr>)}
      </tbody></table>
      <p className="muted" style={{ fontSize: '.72rem', margin: '4px 0' }}>Cantidad para el concepto: <b>{activeLine ? `${activeLine.label} ${fmt(activeLine.value)} ${activeLine.unit}` : '—'}</b> (clic en una fila para cambiarla)</p>
      <div className="cad-row"><span>Concepto</span><b>{a ? a.concept : 'Sin asignar'}</b></div>
      <div className="cad-actions">
        <button type="button" className="soft" disabled={busy} onClick={loadConcepts}>Buscar concepto</button>
        <button type="button" className="soft" disabled={busy} onClick={() => { if(requireProject()){ setConceptMode('create'); setNewConcept(takeoff.suggestedConcept || ''); } }}>Crear concepto</button>
      </div>
      {conceptMode === 'search' && <div className="cad-picker">
        <input type="search" placeholder="Buscar por clave o descripción" value={query} onChange={e => setQuery(e.target.value)} />
        {concepts == null ? <p className="muted">Cargando catálogo…</p> : filteredConcepts.length === 0 ? <p className="muted">No hay conceptos en el catálogo de este proyecto.</p> :
          <ul>{filteredConcepts.slice(0, 40).map(c => <li key={c.id}>
            <button type="button" disabled={busy} onClick={() => linkConcept(c)} className={activeLine && c.unit !== activeLine.unit ? 'is-mismatch' : ''}>
              <b>{c.clave || c.id}</b> {c.concept} <em>{c.unit}</em>{c.apuId ? <small> · APU</small> : null}
            </button>
          </li>)}</ul>}
        {activeLine && <p className="muted" style={{ fontSize: '.7rem' }}>Al ligar, la cantidad del concepto pasa a ser la suma vigente de todos los objetos del plano ligados a él.</p>}
      </div>}
      {conceptMode === 'create' && <div className="cad-picker">
        <input type="text" value={newConcept} onChange={e => setNewConcept(e.target.value)} placeholder="Descripción del concepto" />
        <div className="cad-row"><span>Cantidad</span><b>{fmt(activeLine?.value)} {activeLine?.unit}</b></div>
        <button type="button" disabled={busy} onClick={createConcept}>{busy ? 'Guardando…' : 'Crear en el catálogo'}</button>
      </div>}
    </section>}

    {conceptMode === 'apu' && <section className="cad-quantify">
      <header><b>Asignar APU a “{a?.concept}”</b><button type="button" className="cad-x" onClick={() => setConceptMode(null)} aria-label="Cerrar">×</button></header>
      {apus == null ? <p className="muted">Cargando APU del proyecto…</p> : apus.length === 0 ? <p className="muted">Este proyecto todavía no tiene APU.</p> :
        <div className="cad-picker"><ul>{apus.slice(0, 60).map(apu => <li key={apu.id}>
          <button type="button" disabled={busy} onClick={() => assignApu(apu)}><b>{apu.clave || apu.id}</b> {apu.concept || apu.descripcion || ''} <em>{apu.unit || ''}</em></button>
        </li>)}</ul></div>}
    </section>}
  </div>;
}
