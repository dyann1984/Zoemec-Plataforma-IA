/* Modulo Programa de Obra (Fase 3 del plan integral). UI React.

   Reglas del brief cubiertas:
   §7  – vistas Lista + Gantt (toggle en cabecera).
   §22 – dashboard operativo arriba (avance fisico/financiero, alertas, atraso).
   §26 – panel contextual al seleccionar actividad.
   §6  – accion "Generar desde catalogo" con dedupe por conceptoId.
   §20 – aviso de OC aprobada que cambia cantidad vigente, sin sobreescritura.

   Persistencia: usa useCloudState en main.jsx (mismo patron que apus/
   budgets/surveys). Este componente NO llama red directa; recibe
   activities/setActivities del contenedor, junto con presupuestoRows,
   apus, progressEntries, changeOrders del proyecto. */
import { useMemo, useState } from 'react';
import { makeCalendar, DEFAULT_WORKDAYS } from '../../domain/workingCalendar.js';
import { scheduleActivities } from '../../domain/activityScheduling.js';
import { computeActivityProgress, computeWeightedPhysicalProgress, computeActivityExecutedCost } from '../../domain/activityProgress.js';
import { computeAllAlerts, ALERT_SEVERITY } from '../../domain/activityAlerts.js';
import { generateActivitiesFromCatalog, detectVigentDivergence, applyVigentDivergence } from '../../domain/programaFromCatalog.js';
import { ACTIVITY_STATUS, isLegalActivityTransition, makeEmptyActivity, ACTIVITY_ORIGIN, makePredecessor } from '../../domain/activitySchema.js';
import { computeDurationDays } from '../../domain/activityDuration.js';
import { PageHead, EmptyState } from '../../components/ui/PageElements.jsx';

const fmt = (n, d = 2) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const money = (n) => Number.isFinite(Number(n)) ? Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : '—';
const dateShort = (iso) => iso ? iso.slice(0, 10) : '—';

const STATUS_LABEL = {
  BORRADOR: 'Borrador', PLANIFICADA: 'Planificada', EN_PROCESO: 'En proceso',
  TERMINADA: 'Terminada', DETENIDA: 'Detenida', CANCELADA: 'Cancelada'
};

function daysBetweenIso(a, b){
  if(!a || !b) return 0;
  const da = new Date(a), db = new Date(b);
  return Math.round((db - da) / (1000*60*60*24));
}

export function ProgramaModule({
  activeProjectId, activities = [], setActivities,
  presupuestoRows = [], apus = [], progressEntries = [], changeOrders = [],
  presupuestoVigente = 0, projectStartDate = null, workdays = DEFAULT_WORKDAYS, holidays = [],
  onNeedProject
}){
  const [view, setView] = useState('list'); // 'list' | 'gantt'
  const [selectedId, setSelectedId] = useState(null);

  const calendar = useMemo(() => makeCalendar({ workdays, holidays }), [workdays, holidays]);
  const apusById = useMemo(() => new Map((apus || []).map(a => [a.id, a])), [apus]);
  const rowsByConcept = useMemo(() => new Map((presupuestoRows || []).map(r => [r.conceptoId, r])), [presupuestoRows]);

  // Programa las actividades con calendario y fecha proyecto.
  const scheduled = useMemo(() => {
    if(!activities.length) return { activities: [], issues: [], order: [], cycles: [] };
    return scheduleActivities({ calendar, projectStartDate, activities });
  }, [activities, calendar, projectStartDate]);

  // Progreso por actividad (rendimiento real, forecast, atraso).
  const progressByActivityId = useMemo(() => {
    const map = new Map();
    scheduled.activities.forEach(a => {
      map.set(a.id, computeActivityProgress({ activity: a, progressEntries, calendar }));
    });
    return map;
  }, [scheduled.activities, progressEntries, calendar]);

  // Costo por actividad
  const costByActivityId = useMemo(() => {
    const map = new Map();
    scheduled.activities.forEach(a => {
      const row = rowsByConcept.get(a.conceptoId);
      const pu = Number(row?.pu) || 0;
      const presupuestado = (Number(a.cantidad) || 0) * pu;
      const ejecutado = computeActivityExecutedCost(a, progressEntries);
      map.set(a.id, { presupuestado, ejecutado, pu });
    });
    return map;
  }, [scheduled.activities, rowsByConcept, progressEntries]);

  // Alertas globales
  const alerts = useMemo(() => computeAllAlerts({
    activities: scheduled.activities, progressByActivityId, costByActivityId
  }), [scheduled.activities, progressByActivityId, costByActivityId]);

  // Divergencias por OC aprobada
  const divergences = useMemo(() => {
    const map = new Map();
    scheduled.activities.forEach(a => {
      const d = detectVigentDivergence({ activity: a, changeOrders });
      if(d) map.set(a.id, d);
    });
    return map;
  }, [scheduled.activities, changeOrders]);

  // Avance fisico ponderado del proyecto
  const avanceFisicoProyecto = useMemo(() =>
    computeWeightedPhysicalProgress(scheduled.activities, progressEntries, rowsByConcept),
    [scheduled.activities, progressEntries, rowsByConcept]);

  // Costo ejecutado total
  const costoEjecutadoTotal = useMemo(() =>
    scheduled.activities.reduce((s, a) => s + (costByActivityId.get(a.id)?.ejecutado || 0), 0),
    [scheduled.activities, costByActivityId]);
  const presupuestadoTotal = useMemo(() =>
    scheduled.activities.reduce((s, a) => s + (costByActivityId.get(a.id)?.presupuestado || 0), 0),
    [scheduled.activities, costByActivityId]);
  const avanceFinancieroProyecto = presupuestadoTotal > 0 ? (costoEjecutadoTotal / presupuestadoTotal) * 100 : 0;

  // Actividades atrasadas
  const atrasadas = scheduled.activities.filter(a => progressByActivityId.get(a.id)?.riesgoAtraso);
  const mayorAtraso = atrasadas.length ? atrasadas.reduce((max, a) => {
    const d = progressByActivityId.get(a.id)?.atrasoDias || 0;
    return d > max.days ? { activity: a, days: d } : max;
  }, { activity: null, days: 0 }) : null;

  // Acciones
  const generateFromCatalog = () => {
    if(!activeProjectId){ onNeedProject?.(); return; }
    if(!presupuestoRows.length){ window.zoemecNotify?.('El proyecto no tiene renglones de presupuesto para generar actividades.', 'error'); return; }
    const { created, skipped } = generateActivitiesFromCatalog({
      rows: presupuestoRows, existingActivities: activities, apusById, projectId: activeProjectId
    });
    if(!created.length){
      window.zoemecNotify?.(`No hay conceptos nuevos que agregar (${skipped.length} ya existentes).`, 'info');
      return;
    }
    setActivities([...activities, ...created]);
    window.zoemecNotify?.(`${created.length} actividad${created.length === 1 ? '' : 'es'} agregada${created.length === 1 ? '' : 's'} desde el catalogo.`, 'success');
  };

  const addManualActivity = () => {
    if(!activeProjectId){ onNeedProject?.(); return; }
    const name = prompt('Nombre de la actividad:');
    if(!name?.trim()) return;
    const a = makeEmptyActivity({ projectId: activeProjectId, name: name.trim(), origen: ACTIVITY_ORIGIN.MANUAL, status: ACTIVITY_STATUS.PLANIFICADA });
    setActivities([...activities, a]);
    setSelectedId(a.id);
  };

  const updateActivity = (id, patch) => {
    setActivities(activities.map(a => a.id === id ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a));
  };
  const removeActivity = (id) => {
    if(!window.confirm('Eliminar esta actividad? El avance ya registrado (progressEntries) queda intacto en el ledger.')) return;
    setActivities(activities.filter(a => a.id !== id));
    if(selectedId === id) setSelectedId(null);
  };
  const applyDivergence = (activityId) => {
    const div = divergences.get(activityId);
    if(!div) return;
    if(!div.puedeAutoActualizar){
      if(!window.confirm(`La duracion de esta actividad fue editada manualmente. Actualizarla con la sugerencia sobreescribirá tu edición. Continuar?`)) return;
    }
    setActivities(activities.map(a => a.id === activityId ? applyVigentDivergence(a, div) : a));
  };

  if(!activeProjectId){
    return <section>
      <PageHead kicker="Programa de Obra" title="Programa de Obra" desc="Selecciona un proyecto para generar el programa." />
      <div className="panel"><EmptyState icon="proyectos" title="Sin proyecto activo" text="Elige un proyecto en Cartera para trabajar en su programa." actionLabel="Ir a Cartera" onAction={onNeedProject} /></div>
    </section>;
  }

  const selectedActivity = selectedId ? scheduled.activities.find(a => a.id === selectedId) : null;
  const selectedProgress = selectedActivity ? progressByActivityId.get(selectedActivity.id) : null;
  const selectedCost = selectedActivity ? costByActivityId.get(selectedActivity.id) : null;
  const selectedDiv = selectedActivity ? divergences.get(selectedActivity.id) : null;
  const selectedAlerts = selectedActivity ? alerts.filter(al => al.activityId === selectedActivity.id) : [];

  return <section>
    <PageHead kicker="Programa de Obra" title="Programa de Obra"
      desc={activities.length ? `${activities.length} actividad${activities.length === 1 ? '' : 'es'} · ${atrasadas.length} atrasada${atrasadas.length === 1 ? '' : 's'}` : 'Genera el programa desde el catalogo o captura una actividad manual.'}
      action={<>
        <button onClick={generateFromCatalog}>Generar desde catálogo</button>
        <button className="soft" onClick={addManualActivity}>Añadir actividad</button>
      </>}
    />

    {/* Dashboard operativo (regla 22) */}
    <div className="programa-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, margin: '10px 0' }}>
      <div className="panel"><small className="muted">Avance físico</small><h3>{fmt(avanceFisicoProyecto, 1)}%</h3></div>
      <div className="panel"><small className="muted">Avance financiero</small><h3>{fmt(avanceFinancieroProyecto, 1)}%</h3></div>
      <div className="panel"><small className="muted">Actividades atrasadas</small><h3>{atrasadas.length}</h3></div>
      {mayorAtraso?.activity && <div className="panel"><small className="muted">Mayor atraso</small><h3 style={{ fontSize: '0.95rem' }}>{mayorAtraso.activity.name} · {mayorAtraso.days} d</h3></div>}
      <div className="panel"><small className="muted">Costo ejercido</small><h3>{money(costoEjecutadoTotal)}</h3></div>
      <div className="panel"><small className="muted">Presupuestado (programa)</small><h3>{money(presupuestadoTotal)}</h3></div>
    </div>

    {/* Alertas globales */}
    {alerts.length > 0 && <div className="panel" style={{ marginBottom: 10 }}>
      <b>Alertas ({alerts.length})</b>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {alerts.slice(0, 5).map((al, i) => <li key={i} style={{ color: al.severity === ALERT_SEVERITY.CRITICA ? 'var(--danger)' : undefined }}>
          <b>{al.severity}</b> · {al.message}
        </li>)}
        {alerts.length > 5 && <li className="muted">y {alerts.length - 5} más…</li>}
      </ul>
    </div>}

    {/* Toggle de vista */}
    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
      <button className={view === 'list' ? '' : 'soft'} onClick={() => setView('list')}>Lista</button>
      <button className={view === 'gantt' ? '' : 'soft'} onClick={() => setView('gantt')}>Gantt</button>
    </div>

    {activities.length === 0 && <div className="panel"><EmptyState icon="check" title="Sin actividades" text="Genera el programa desde el catálogo del proyecto o añade una actividad manual." actionLabel="Generar desde catálogo" onAction={generateFromCatalog} /></div>}

    {view === 'list' && activities.length > 0 && <ProgramaListView
      scheduled={scheduled}
      progressByActivityId={progressByActivityId}
      costByActivityId={costByActivityId}
      divergences={divergences}
      selectedId={selectedId} onSelect={setSelectedId}
    />}

    {view === 'gantt' && activities.length > 0 && <ProgramaGanttView
      scheduled={scheduled}
      progressByActivityId={progressByActivityId}
      selectedId={selectedId} onSelect={setSelectedId}
    />}

    {selectedActivity && <ProgramaSidePanel
      activity={selectedActivity} progress={selectedProgress} cost={selectedCost}
      divergence={selectedDiv} alerts={selectedAlerts}
      onUpdate={(patch) => updateActivity(selectedActivity.id, patch)}
      onRemove={() => removeActivity(selectedActivity.id)}
      onApplyDivergence={() => applyDivergence(selectedActivity.id)}
      allActivities={scheduled.activities}
    />}
  </section>;
}

function ProgramaListView({ scheduled, progressByActivityId, costByActivityId, divergences, selectedId, onSelect }){
  return <div className="panel" style={{ overflowX: 'auto' }}>
    <table className="programa-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
      <thead>
        <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border,#ddd)' }}>
          <th style={{ padding: 6 }}>Actividad</th>
          <th>Cantidad</th>
          <th>Rendimiento</th>
          <th>Duración</th>
          <th>Inicio</th>
          <th>Fin</th>
          <th>Responsable</th>
          <th>Avance</th>
          <th>Estado</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {scheduled.activities.map(a => {
          const p = progressByActivityId.get(a.id);
          const c = costByActivityId.get(a.id);
          const div = divergences.get(a.id);
          const isSel = a.id === selectedId;
          return <tr key={a.id} onClick={() => onSelect(a.id)} style={{ cursor: 'pointer', background: isSel ? 'var(--accent-soft, rgba(200,200,255,0.15))' : undefined, borderBottom: '1px solid var(--border-soft,#eee)' }}>
            <td style={{ padding: 6 }}><b>{a.name}</b>{a.unit ? <em className="muted"> · {a.unit}</em> : null}</td>
            <td>{fmt(a.cantidad, 2)}</td>
            <td>{a.rendimiento != null ? `${fmt(a.rendimiento, 2)}/día` : <span className="muted">Requerido</span>}</td>
            <td>{a.duracion != null ? `${fmt(a.duracion, 2)} d` : '—'}</td>
            <td>{dateShort(a.fechaInicio)}</td>
            <td>{dateShort(a.fechaFin)}</td>
            <td>{a.responsable || <span className="muted">—</span>}</td>
            <td>{fmt(p?.avanceFisicoPct, 1)}%{p?.riesgoAtraso ? ' ⚠' : ''}{div ? ' 🔁' : ''}</td>
            <td><small>{STATUS_LABEL[a.status] || a.status}</small></td>
            <td>{c?.presupuestado ? money(c.presupuestado) : '—'}</td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}

function ProgramaGanttView({ scheduled, progressByActivityId, selectedId, onSelect }){
  const items = scheduled.activities.filter(a => a.fechaInicio && a.fechaFin);
  if(!items.length) return <div className="panel"><p className="muted">Las actividades necesitan fecha inicio y fin. Añade rendimiento y fecha de inicio del proyecto.</p></div>;
  const minStart = items.reduce((min, a) => a.fechaInicio < min ? a.fechaInicio : min, items[0].fechaInicio);
  const maxEnd = items.reduce((max, a) => a.fechaFin > max ? a.fechaFin : max, items[0].fechaFin);
  const totalDays = Math.max(1, daysBetweenIso(minStart, maxEnd) + 1);
  const rowHeight = 26;
  const width = 900;
  const leftPad = 220;
  const barArea = width - leftPad - 20;

  return <div className="panel" style={{ overflowX: 'auto' }}>
    <svg width={width} height={items.length * rowHeight + 40} role="img" aria-label="Gantt del programa">
      {/* Eje de tiempo mensual */}
      {(() => {
        const marks = [];
        const start = new Date(minStart);
        const end = new Date(maxEnd);
        const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
        while(cursor <= end){
          const daysFromStart = daysBetweenIso(minStart, `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-01`);
          const x = leftPad + (daysFromStart / totalDays) * barArea;
          marks.push(<g key={cursor.getTime()}>
            <line x1={x} y1={20} x2={x} y2={items.length * rowHeight + 30} stroke="var(--border,#ddd)" strokeDasharray="2,3" />
            <text x={x + 3} y={16} fontSize="10" fill="var(--muted,#888)">{`${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}`}</text>
          </g>);
          cursor.setMonth(cursor.getMonth() + 1);
        }
        return marks;
      })()}
      {items.map((a, i) => {
        const startOffset = daysBetweenIso(minStart, a.fechaInicio);
        const dur = daysBetweenIso(a.fechaInicio, a.fechaFin) + 1;
        const x = leftPad + (startOffset / totalDays) * barArea;
        const w = Math.max(2, (dur / totalDays) * barArea);
        const y = 30 + i * rowHeight;
        const p = progressByActivityId.get(a.id);
        const isSel = a.id === selectedId;
        const barColor = p?.riesgoAtraso ? 'var(--danger,#c0392b)' : isSel ? 'var(--accent,#8a5a34)' : 'var(--info,#2f7fd1)';
        const progressW = w * ((p?.avanceFisicoPct || 0) / 100);
        return <g key={a.id} onClick={() => onSelect(a.id)} style={{ cursor: 'pointer' }}>
          <text x={5} y={y + rowHeight/2 + 4} fontSize="11" fill="var(--ink,#1a1a1a)">{a.name.slice(0, 30)}</text>
          <rect x={x} y={y + 4} width={w} height={rowHeight - 10} fill={barColor} opacity="0.35" rx="3" />
          <rect x={x} y={y + 4} width={progressW} height={rowHeight - 10} fill={barColor} rx="3" />
          <title>{a.name} · {dateShort(a.fechaInicio)} → {dateShort(a.fechaFin)} · avance {(p?.avanceFisicoPct||0).toFixed(1)}%</title>
        </g>;
      })}
    </svg>
  </div>;
}

function ProgramaSidePanel({ activity, progress, cost, divergence, alerts, onUpdate, onRemove, onApplyDivergence, allActivities }){
  const [preAdd, setPreAdd] = useState('');
  const durationInfo = computeDurationDays({ cantidad: activity.cantidad, rendimiento: activity.rendimiento });
  const canTransition = (nextStatus) => isLegalActivityTransition(activity.status, nextStatus);

  return <div className="panel" style={{ marginTop: 12, borderLeft: '3px solid var(--accent,#8a5a34)' }}>
    <h4>{activity.name} <small className="muted">· {activity.id}</small></h4>
    {alerts.length > 0 && <div style={{ marginBottom: 8 }}>
      {alerts.map((al, i) => <p key={i} className="cad-warn" style={{ margin: '2px 0', color: al.severity === ALERT_SEVERITY.CRITICA ? 'var(--danger)' : undefined }}>{al.severity}: {al.message}</p>)}
    </div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
      <div>
        <b>DATOS</b>
        <div className="nf"><label>Cantidad</label><input type="number" defaultValue={activity.cantidad} onBlur={e => onUpdate({ cantidad: Number(e.target.value) || 0 })} /></div>
        <div className="nf"><label>Unidad</label><input defaultValue={activity.unit} onBlur={e => onUpdate({ unit: e.target.value })} /></div>
        <div className="nf"><label>Rendimiento ({activity.rendimientoFuente || '—'})</label>
          <input type="number" defaultValue={activity.rendimiento ?? ''} onBlur={e => onUpdate({ rendimiento: Number(e.target.value) || null, rendimientoFuente: 'MANUAL' })} />
        </div>
        <div className="nf"><label>Duración (días laborables)</label>
          <input type="number" defaultValue={activity.duracion ?? ''} onBlur={e => onUpdate({ duracion: Number(e.target.value) || null, duracionEditadaManual: true })} />
        </div>
        {durationInfo.days != null && activity.duracion !== durationInfo.days && <p className="muted" style={{ fontSize: '0.75rem' }}>Sugerido por rendimiento: {fmt(durationInfo.days, 2)} d</p>}
        <div className="nf"><label>Inicio</label><input type="date" defaultValue={activity.fechaInicio || ''} onBlur={e => onUpdate({ fechaInicio: e.target.value || null })} /></div>
        <div className="nf"><label>Responsable</label><input defaultValue={activity.responsable || ''} onBlur={e => onUpdate({ responsable: e.target.value || null })} /></div>
      </div>
      <div>
        <b>CUADRILLA</b>
        <p className="muted" style={{ fontSize: '0.8rem' }}>{activity.cuadrilla} integrante(s) · jornada base 8 h</p>
        <b>AVANCE</b>
        <p>Plan a la fecha: {fmt(progress?.diasHabTranscurridos && activity.duracion ? Math.min(100, (progress.diasHabTranscurridos/activity.duracion)*100) : 0, 1)}%</p>
        <p>Real: {fmt(progress?.avanceFisicoPct, 1)}% ({fmt(progress?.cantidadEjecutada, 2)} de {fmt(activity.cantidad, 2)} {activity.unit})</p>
        {progress?.rendimientoReal != null && <p>Rendimiento real: {fmt(progress.rendimientoReal, 2)}/día · desviación {fmt(progress.rendimientoDesviacionPct, 1)}%</p>}
        {progress?.fechaFinProyectada && <p>Fin proyectado: <b>{dateShort(progress.fechaFinProyectada)}</b>{progress.atrasoDias > 0 ? ` (${progress.atrasoDias} d de atraso)` : ''}</p>}
      </div>
      <div>
        <b>COSTO</b>
        <p>Presupuestado: {money(cost?.presupuestado)}</p>
        <p>Ejecutado: {money(cost?.ejecutado)}</p>
        <p>P.U.: {money(cost?.pu)}</p>
      </div>
    </div>

    {divergence && <div style={{ marginTop: 10, background: 'var(--warn-soft, rgba(200,150,0,0.08))', padding: 8, borderRadius: 4 }}>
      <b>🔁 Orden de Cambio aprobada modificó cantidad vigente</b>
      <p>Anterior: {fmt(divergence.cantidadAnterior, 2)} · Vigente: <b>{fmt(divergence.cantidadVigente, 2)}</b> · Δ {divergence.delta > 0 ? '+' : ''}{fmt(divergence.delta, 2)}</p>
      <p>Duración actual: {fmt(divergence.duracionActual, 2)} d · Sugerida por rendimiento: {fmt(divergence.duracionSugerida, 2)} d</p>
      <button onClick={onApplyDivergence}>Actualizar cantidad y duración</button>
      {!divergence.puedeAutoActualizar && <p className="muted" style={{ fontSize: '0.75rem' }}>La duración fue editada manualmente. Se pedirá confirmación.</p>}
    </div>}

    <details style={{ marginTop: 10 }}>
      <summary>Predecesoras ({activity.predecessoras?.length || 0})</summary>
      <ul style={{ paddingLeft: 18 }}>
        {(activity.predecessoras || []).map(p => <li key={p.activityId}>
          {p.activityId} <button className="soft" onClick={() => onUpdate({ predecessoras: activity.predecessoras.filter(x => x.activityId !== p.activityId) })}>Quitar</button>
        </li>)}
      </ul>
      <select value={preAdd} onChange={e => setPreAdd(e.target.value)}>
        <option value="">— Seleccionar predecesora —</option>
        {allActivities.filter(x => x.id !== activity.id && !activity.predecessoras.some(p => p.activityId === x.id)).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <button className="soft" disabled={!preAdd} onClick={() => { onUpdate({ predecessoras: [...(activity.predecessoras||[]), makePredecessor({ activityId: preAdd })] }); setPreAdd(''); }}>Agregar</button>
    </details>

    <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
      {canTransition(ACTIVITY_STATUS.EN_PROCESO) && <button onClick={() => onUpdate({ status: ACTIVITY_STATUS.EN_PROCESO })}>Iniciar</button>}
      {canTransition(ACTIVITY_STATUS.TERMINADA) && <button onClick={() => onUpdate({ status: ACTIVITY_STATUS.TERMINADA })}>Marcar terminada</button>}
      {canTransition(ACTIVITY_STATUS.DETENIDA) && <button className="soft" onClick={() => onUpdate({ status: ACTIVITY_STATUS.DETENIDA })}>Detener</button>}
      <button className="soft danger" onClick={onRemove}>Eliminar</button>
    </div>
  </div>;
}
