/* Panel derecho del Plano Inteligente: propiedades REALES del objeto
   seleccionado (todas derivadas del modelo comun en cada render -- nunca
   copias guardadas), edicion de campos compatibles, acciones contextuales
   segun el tipo de objeto (punto 14) y la cadena objeto -> cantidad ->
   concepto -> APU (puntos 3 y 15). */
import { useEffect, useMemo, useState } from 'react';
import {
  CAD_KIND, OPENING_TYPE, REVIEW_STATUS, CAD_SOURCE, findElement, updateWall, updateOpening, updateSpace,
  updateDimension, deleteElement, setElementReview, setElementAssignment, openingsOnWall, elementDisplayStatus,
  computeWallMetrics, resolveDimension, confidenceLevel,
  setWallLength, resizeRectangularSpace, rectangularSpaceBox, wallHeightSource, wallThicknessSource, spaceCeilingHeightSource, dimensionSourceLabel, DIMENSION_SOURCE
} from '../../../domain/cadModel.js';
import { buildElementTakeoff, isAssignmentStale, conceptQuantityFromModel, markConceptSynced } from '../../../domain/cadTakeoff.js';
import { listProjectConcepts, listProjectApus, createConceptFromElement, associateConceptApu, syncConceptGenerators } from './cadConceptService.js';
import { computeGeometryImpact, formatImpactSummary } from '../../../domain/economicImpact.js';
import { calcAPU } from '../../../lib/apuCalc.js';
import { isConceptInApprovedBudget, detectSpecChange, BASELINE_STATUS } from '../../../domain/budgetBaselineLookup.js';
import { composeGeometryChangeDescription, composeGeometryChangeMotivo, buildGeometryEvidence, buildChangeOrderPayload, findDuplicateChangeOrder } from '../../../domain/changeOrderFromGeometry.js';
import { listProjectPresupuestos, listProjectChangeOrders, createChangeOrder } from './budgetBaselineService.js';

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

/* F4: procedencia visible de una dimension (una DEFAULT nunca parece medida). */
function SourceNote({ source }){
  const isDefault = source === DIMENSION_SOURCE.DEFAULT;
  return <small className={isDefault ? 'cad-warn' : 'muted'} style={{ display: 'block', margin: '-4px 0 6px', fontSize: '.72rem' }}>{isDefault ? '⚠ ' : ''}Origen: {dimensionSourceLabel(source)}</small>;
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
  projectId, planoId, fileName, user, onNeedProject,
  persistNow = null, onConceptsChanged = null
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
  // Fase 2 del plan integral: contexto de baseline y OCs del proyecto.
  // Se carga on-demand la primera vez que el usuario selecciona un
  // elemento con `assignment` (evita hacer red al abrir el CAD).
  const [baselineCtx, setBaselineCtx] = useState(null); // {status, presupuestoId, cantidadContractual, puContractual, ...}
  const [changeOrders, setChangeOrders] = useState(null);
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [createdOc, setCreatedOc] = useState(null); // OC recien creada desde este panel, para dar feedback inmediato

  useEffect(() => {
    setQuantifyOpen(false); setConceptMode(null); setQuantityField(null); setQuery('');
    // Se resetea el contexto de baseline al cambiar de elemento -- el
    // baseline es especifico al concepto asociado al elemento.
    setBaselineCtx(null); setCreatedOc(null);
  }, [selectedId]);

  const takeoff = useMemo(() => (found && found.kind !== CAD_KIND.DIMENSION ? buildElementTakeoff(model, selectedId) : null), [model, selectedId, found]);
  const myIssues = (issues || []).filter(i => i.id === selectedId);
  const status = selectedId ? elementDisplayStatus(issues, selectedId) : null;

  // Fase 2: carga el contexto de baseline (presupuestos + OCs del proyecto)
  // cuando el elemento seleccionado tiene assignment.conceptId. Se hace UNA
  // vez por (projectId, conceptoId) para no golpear la red en cada re-render.
  const activeConceptId = found?.element?.assignment?.conceptId || null;
  useEffect(() => {
    if(!projectId || !activeConceptId){ setBaselineCtx(null); return; }
    let alive = true;
    setBaselineLoading(true);
    Promise.all([listProjectPresupuestos(projectId), listProjectChangeOrders(projectId)])
      .then(([presupuestos, ocs]) => {
        if(!alive) return;
        const ctx = isConceptInApprovedBudget(presupuestos, activeConceptId);
        setBaselineCtx(ctx);
        setChangeOrders(ocs);
      })
      .catch(() => { if(alive){ setBaselineCtx(null); setChangeOrders(null); } })
      .finally(() => { if(alive) setBaselineLoading(false); });
    return () => { alive = false; };
  }, [projectId, activeConceptId]);

  const refreshBaselineCtx = async () => {
    if(!projectId || !activeConceptId) return;
    try{
      const [presupuestos, ocs] = await Promise.all([listProjectPresupuestos(projectId), listProjectChangeOrders(projectId)]);
      setBaselineCtx(isConceptInApprovedBudget(presupuestos, activeConceptId));
      setChangeOrders(ocs);
    }catch(err){ onError?.(err.message); }
  };

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

  /* F3: la cantidad del concepto ya no se envia como numero suelto -- se
     envian los GENERADORES de todos los elementos de este plano ligados al
     concepto (operacion, deducciones, cantidad por elemento) y el servidor
     recalcula qty = SUM(generadores). Incluye qty 0 cuando ya no queda
     ningun elemento (antes `if(qty > 0)` dejaba la cantidad vieja). */
  const syncConcept = async (conceptId, unit, baseModel, extraPatch = {}, expectedRevision = undefined) => {
    const { mismatched } = conceptQuantityFromModel(baseModel, conceptId, unit);
    if(mismatched.length) onNotify?.(`Objetos con unidad distinta no se sumaron: ${mismatched.join(', ')}`, 'error');
    // F4: la geometria (incluida la liga elemento->concepto) se guarda YA en
    // el servidor; el servidor reconstruye los generadores desde ESE plano.
    const planoRevision = persistNow ? await persistNow(baseModel) : null;
    const res = await syncConceptGenerators({ conceptId, projectId, planoId, fileName, model: baseModel, expectedRevision, reason: `Sincronizado desde el plano ${fileName || planoId}`, planoRevision });
    onConceptsChanged?.();
    const agg = res.aggregate || {};
    if(agg.incomplete?.length) onNotify?.(`Generadores incompletos (no suman): ${agg.incomplete.join(', ')}`, 'error');
    if(agg.inconsistent?.length) onNotify?.(`Generadores inconsistentes (deducciones > bruto): ${agg.inconsistent.join(', ')}`, 'error');
    const generatorRevision = res.concepto?.generatorRevisions?.[planoId] ?? null;
    return { next: markConceptSynced(baseModel, conceptId, { ...extraPatch, generatorRevision }), qty: res.concepto?.qty ?? 0 };
  };

  const linkConcept = async (c) => {
    if(!activeLine) return;
    setBusy(true);
    try{
      const base = setElementAssignment(getModel(), element.id, {
        conceptId: c.id, clave: c.clave || '', concept: c.concept, unit: c.unit, capitulo: c.capitulo || null,
        quantityField: activeLine.key, apuId: c.apuId || null, apuLabel: c.apuId || null
      });
      const { next, qty } = await syncConcept(c.id, c.unit, base, {}, Number(c.generatorRevisions?.[planoId] || 0));
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
      // F3: el concepto nace con la cantidad del elemento y en seguida pasa a
      // cantidad DESDE GENERADORES (con su operacion persistida).
      const { next } = await syncConcept(c.id, c.unit, base, {}, Number(c.generatorRevisions?.[planoId] || 0));
      onChange(next, `Crear concepto para ${element.id}`);
      onNotify?.(`Concepto creado en el catálogo: ${c.concept}`, 'success');
      setConceptMode(null);
    }catch(err){ onError?.(err.message); }finally{ setBusy(false); }
  };

  const resync = async () => {
    const a = element.assignment;
    if(!a || !requireProject()) return;
    // Regla 2 del encargo -- "Si el concepto SI esta en presupuesto
    // aprobado: NO permitir modificar directamente la cantidad
    // contractual". El bloqueo es DURO: no se ofrece "continuar de todas
    // formas". La ruta unica es Crear Orden de Cambio (createOcFromGeometry).
    if(baselineCtx?.status === BASELINE_STATUS.APPROVED){
      onError?.('Este concepto pertenece a un presupuesto aprobado. La cantidad contractual no puede sobrescribirse directamente: usa "Crear Orden de Cambio".');
      return;
    }
    // Para presupuestos BORRADOR o sin presupuesto, sigue la confirmacion
    // suave de Fase 1 (informativa, no bloqueante).
    if(assignedLine && Number.isFinite(Number(a.syncedQty)) && Number(a.syncedQty) !== Number(assignedLine.value) && a.apuId){
      const impactCheck = computeGeometryImpact({
        previousQty: a.syncedQty, currentQty: assignedLine.value, pu: a.apuPu
      });
      const money = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
      const summary = impactCheck.deltaAmount != null
        ? `Se modifica la cantidad del concepto de ${fmt(a.syncedQty)} a ${fmt(assignedLine.value)} ${a.unit}. Impacto economico ${impactCheck.deltaAmount >= 0 ? '+' : ''}${money(impactCheck.deltaAmount)}.`
        : `Se modifica la cantidad del concepto de ${fmt(a.syncedQty)} a ${fmt(assignedLine.value)} ${a.unit}.`;
      const ok = window.confirm(`${summary}\n\nEste concepto todavia no esta en un presupuesto aprobado, la sincronizacion es directa. Continuar?`);
      if(!ok) return;
    }
    setBusy(true);
    try{
      const { next, qty } = await syncConcept(a.conceptId, a.unit, getModel(), {}, a.generatorRevision ?? undefined);
      onChange(next, `Sincronizar cantidad de ${a.concept}`);
      onNotify?.(`Cantidad actualizada en el catálogo: ${fmt(qty)} ${a.unit}`, 'success');
    }catch(err){ onError?.(err.message); }finally{ setBusy(false); }
  };

  /* Fase 2: crear Orden de Cambio desde el CAD cuando el concepto esta
     protegido por baseline aprobado. NUNCA modifica el baseline
     directamente -- delega en /api/change-orders?action=create, el server
     recalcula cantidadAnterior/pu con datos reales, y la OC nace en
     BORRADOR (regla 6 del encargo: baseline intacto hasta que la OC pase
     por su propio flujo de aprobacion). */
  const createOcFromGeometry = async () => {
    const a = element.assignment;
    if(!a || !requireProject() || !baselineCtx) return;
    if(baselineCtx.status !== BASELINE_STATUS.APPROVED){
      onError?.('Este concepto no esta en un presupuesto aprobado. Usa Sincronizar cantidad.');
      return;
    }
    const cantidadNueva = Number(assignedLine?.value);
    if(!(cantidadNueva >= 0)){ onError?.('Cantidad actual invalida.'); return; }
    const origenElementoId = `${planoId || ''}:${element.id}`;
    // Dedupe (regla 8 del encargo)
    const { duplicate, staleDraft } = findDuplicateChangeOrder({
      changeOrders: changeOrders || [], conceptoId: a.conceptId, origenElementoId, cantidadNueva
    });
    if(duplicate){
      setCreatedOc(duplicate);
      onNotify?.(`Ya existe una Orden de Cambio (${duplicate.folio || duplicate.id}) para este cambio.`, 'info');
      return;
    }
    if(staleDraft){
      const ok = window.confirm(`Ya existe una OC en borrador (${staleDraft.folio || staleDraft.id}) para ${a.concept} sobre este mismo elemento, pero con una cantidad distinta (${fmt(staleDraft.cantidadNueva)} ${a.unit}). Se creara una nueva OC en lugar de duplicar; puedes cancelar la borrador anterior manualmente. Continuar?`);
      if(!ok) return;
    }
    // Deteccion de cambio de especificacion (regla 12): si la unidad
    // vigente del takeoff difiere de la contractual, se marca como
    // extraordinario y se advierte al usuario.
    const spec = detectSpecChange({
      contractualUnit: baselineCtx.unit, currentUnit: a.unit,
      contractualApuId: baselineCtx.apuId, currentApuId: a.apuId
    });
    if(spec.requiresNewApu){
      const ok = window.confirm(`Advertencia: ${spec.reason}\n\nSe registrara la OC pero requerira un APU nuevo antes de aprobarse. Continuar?`);
      if(!ok) return;
    }
    const elementLabel = element.id;
    const evidencia = buildGeometryEvidence({
      origenElementoId,
      planoId, surveyId: null, spaceId: null,
      cadElementId: element.id, cadElementKind: found?.kind || null,
      // propertyChanged es informativo -- se toma "cantidad" cuando no hay
      // un cambio de propiedad geometrica identificable en este momento
      // (el panel no rastrea el detalle de que edicion cambio la cantidad,
      // solo el estado actual del takeoff vs syncedQty).
      propertyChanged: 'cantidad',
      oldValue: Number(a.syncedQty) || Number(baselineCtx.cantidadContractual),
      newValue: cantidadNueva,
      requiresNewApu: spec.requiresNewApu, requiresNewApuReason: spec.reason,
      createdBy: user?.email || user?.uid || null
    });
    const motivo = composeGeometryChangeMotivo({ elementLabel });
    const descripcion = composeGeometryChangeDescription({
      elementLabel,
      cantidadAnterior: baselineCtx.cantidadContractual,
      cantidadNueva,
      unit: a.unit,
      conceptLabel: a.concept
    });
    const payload = buildChangeOrderPayload({
      projectId, conceptoId: a.conceptId, cantidadNueva, motivo, descripcion, evidencia
    });
    setBusy(true);
    try{
      const oc = await createChangeOrder(payload);
      if(oc){
        setCreatedOc(oc);
        setChangeOrders(prev => [...(prev || []), oc]);
        onNotify?.(`Orden de Cambio ${oc.folio || oc.id} creada en borrador. El baseline permanece intacto hasta que se apruebe.`, 'success');
      }
    }catch(err){ onError?.(err.message); }finally{ setBusy(false); }
  };

  const unlink = async () => {
    const a = element.assignment;
    if(!a) return;
    const base = setElementAssignment(getModel(), element.id, null);
    onChange(base, `Quitar concepto de ${element.id}`);
    if(projectId && planoId){
      // F3: el elemento deja de aportar con trazabilidad (historial), aun si
      // la cantidad resultante es 0.
      try{
        const { next } = await syncConcept(a.conceptId, a.unit, base, {}, a.generatorRevision ?? undefined);
        onChange(next, `Recalcular generadores de ${a.concept}`);
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
      // apuPu (Fase 1 del plan integral): el P.U. calculado del APU se
      // estampa en el assignment para que el panel pueda mostrar el
      // impacto economico de un cambio de geometria sin tener que hacer
      // una llamada de red adicional. Sigue siendo aditivo: assignment.pu
      // ausente => la UI muestra solo el delta de cantidad. calcAPU no
      // muta el apu; puede lanzar si el shape es completamente invalido
      // -- se cubre y se degrada a null en vez de romper el assignment.
      let apuPu = null;
      try{ apuPu = Number(calcAPU(apu)?.pu) || null; }catch{ apuPu = null; }
      const next = markConceptSynced(getModel(), a.conceptId, { apuId: apu.id, apuLabel: label, apuPu });
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
      {/* F4: cota manual REAL -- mueve el nodo final conectado (muros/espacio), no es una etiqueta */}
      <NumField label="Longitud" value={m.length} autoFocusKey="edit" onCommit={v => apply(md => setWallLength(md, element.id, v), `Longitud ${element.id} → ${fmt(v)} m`)} />
      <NumField label="Espesor" value={element.thickness} onCommit={v => apply(md => updateWall(md, element.id, { thickness: v }), `Espesor ${element.id}`)} />
      <SourceNote source={wallThicknessSource(element)} />
      <NumField label="Altura" value={element.height} onCommit={v => apply(md => updateWall(md, element.id, { height: v }), `Altura ${element.id}`)} />
      <SourceNote source={wallHeightSource(element)} />
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
      {rectangularSpaceBox(element) && <>
        {/* F4: dimensiones reales del espacio rectangular: estiran muros, vertices y cotas */}
        <NumField label="Largo (X)" value={rectangularSpaceBox(element).length} onCommit={v => apply(md => resizeRectangularSpace(md, element.id, { length: v }), `Largo ${element.id} → ${fmt(v)} m`)} />
        <NumField label="Ancho (Y)" value={rectangularSpaceBox(element).width} onCommit={v => apply(md => resizeRectangularSpace(md, element.id, { width: v }), `Ancho ${element.id} → ${fmt(v)} m`)} />
      </>}
      <NumField label="Altura de plafón" value={element.ceilingHeight ?? model.defaults.wallHeight} onCommit={v => apply(md => updateSpace(md, element.id, { ceilingHeight: v }), `Altura ${element.id}`)} />
      <SourceNote source={spaceCeilingHeightSource(element)} />
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
      <span className="cad-chain-title">Costo · Concepto / APU</span>
      {a ? (() => {
        // Fase 2: cuando el concepto pertenece a un presupuesto aprobado,
        // se muestra el bloque CAMBIO CONTRACTUAL con Cantidad
        // contractual/actual/variacion/P.U./impacto y el boton "Crear
        // Orden de Cambio" -- el boton "Sincronizar cantidad" no aparece
        // en este caso (regla 2 del encargo: bloqueo duro).
        const isBaselineApproved = baselineCtx?.status === BASELINE_STATUS.APPROVED;
        const isBaselineDraft = baselineCtx?.status === BASELINE_STATUS.DRAFT;
        // Cantidad "anterior" a comparar:
        //   - Baseline aprobado: la CONTRACTUAL (baselineCtx.cantidadContractual)
        //     -- es la que la OC debe cambiar.
        //   - Otros: la ultima sincronizada al catalogo (a.syncedQty)
        //     -- el flujo de Fase 1.
        const previousQty = isBaselineApproved ? baselineCtx.cantidadContractual : a.syncedQty;
        // P.U. a usar para el impacto:
        //   - Baseline: el contractual (baselineCtx.puContractual) -- regla
        //     11 del encargo ("preservar PU contractual si el alcance sigue
        //     siendo el mismo").
        //   - Otros: el que el CAD tiene cacheado del APU asignado.
        const puForImpact = isBaselineApproved ? baselineCtx.puContractual : a.apuPu;
        const impact = computeGeometryImpact({
          previousQty, currentQty: assignedLine?.value ?? 0, pu: puForImpact
        });
        const summary = formatImpactSummary(impact, { unit: a.unit || '', currency: 'MXN' });
        // Cambio de especificacion (regla 12): mostrar aviso si aplica.
        const spec = isBaselineApproved
          ? detectSpecChange({ contractualUnit: baselineCtx.unit, currentUnit: a.unit, contractualApuId: baselineCtx.apuId, currentApuId: a.apuId })
          : { requiresNewApu: false, reason: null };
        // Detectar OC existente para este cambio (dedupe visual)
        const originKey = `${planoId || ''}:${element.id}`;
        const existingOc = createdOc || findDuplicateChangeOrder({
          changeOrders: changeOrders || [], conceptoId: a.conceptId,
          origenElementoId: originKey, cantidadNueva: assignedLine?.value ?? 0
        }).duplicate;
        return <>
          <div className="cad-chain-flow">
            <b>{element.id}</b><i>→</i>
            <span title={a.concept}>{a.clave ? `${a.clave} · ` : ''}{a.concept}</span><i>→</i>
            <span>{a.apuId ? `APU ${a.apuLabel || a.apuId}` : 'Sin APU'}</span>
          </div>
          {isBaselineApproved && <p className="cad-source" style={{ background: 'var(--warn-soft, rgba(200,150,0,0.08))', padding: '4px 8px', borderRadius: 4 }}>
            ⚠ Cambio contractual · Presupuesto <b>{baselineCtx.presupuestoId}</b> baseline <b>{baselineCtx.baselineVersion}</b>
          </p>}
          {isBaselineDraft && <p className="cad-source">Concepto en presupuesto borrador ({baselineCtx.presupuestoId}) — sincronización directa permitida.</p>}
          <div className="cad-metrics">
            <ReadRow label={isBaselineApproved ? 'Cantidad contractual' : 'Cantidad sincronizada'} value={summary.previousQtyText} />
            <ReadRow label="Cantidad actual" value={summary.currentQtyText} strong={stale} />
            <ReadRow label="Variación" value={summary.deltaQtyText} strong={stale} />
            <ReadRow label={isBaselineApproved ? 'P.U. contractual' : 'P.U.'} value={summary.puText} />
            <ReadRow label="Impacto económico" value={summary.deltaAmountText} strong={summary.hasCostImpact} />
          </div>
          {spec.requiresNewApu && <p className="cad-warn is-error">⚠ Cambio de especificación: {spec.reason}</p>}
          {isBaselineApproved && stale && !existingOc && <p className="cad-warn">Este concepto pertenece a un presupuesto aprobado. La cantidad contractual no puede sobrescribirse directamente.</p>}
          {stale && !isBaselineApproved && summary.hasCostImpact && <p className="cad-warn">Este cambio de geometría todavía no se ha aplicado al catálogo.</p>}
          {existingOc && <p className="cad-source" style={{ background: 'var(--info-soft, rgba(47,127,209,0.08))', padding: '4px 8px', borderRadius: 4 }}>
            Orden de Cambio: <b>{existingOc.folio || existingOc.id}</b> · Estado: <b>{existingOc.status}</b>
          </p>}
          <div className="cad-actions">
            {baselineLoading && <span className="muted" style={{ fontSize: '.72rem' }}>Verificando presupuesto…</span>}
            {isBaselineApproved && stale && !existingOc && <button type="button" disabled={busy} onClick={createOcFromGeometry}>Crear Orden de Cambio</button>}
            {existingOc && <button type="button" className="soft" disabled={busy} onClick={() => onAction('openChangeOrder', { changeOrderId: existingOc.id })}>Abrir Orden de Cambio</button>}
            {stale && !isBaselineApproved && <button type="button" disabled={busy} onClick={resync}>Sincronizar cantidad</button>}
            {a.apuId && <button type="button" className="soft" disabled={busy} onClick={() => onAction('openApu', { apuId: a.apuId })}>Abrir APU</button>}
            <button type="button" className="soft" disabled={busy} onClick={loadApus}>{a.apuId ? 'Cambiar APU' : 'Asignar APU'}</button>
            <button type="button" className="soft" disabled={busy} onClick={unlink}>Quitar liga</button>
            {baselineCtx && <button type="button" className="soft" disabled={busy || baselineLoading} onClick={refreshBaselineCtx} title="Volver a consultar presupuestos y OCs del proyecto">Actualizar contexto</button>}
          </div>
        </>;
      })() : <p className="muted" style={{ margin: '2px 0' }}>Sin asignar</p>}
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
