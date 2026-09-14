/* Control Presupuestal (Fase E). Convierte el Presupuesto Baseline (Fase D,
   `usePresupuesto`) en una herramienta real de control de obra: Presupuesto
   vigente -> Comprometido -> Ejecutado -> Estimado -> Pagado -> Forecast.
   Reusa SIN reimplementar: aggregatePresupuesto (Fase D, renglones
   qty/pu/direct por concepto), calcAPUv2 (P.U./direct de cada APU),
   aggregateControlPresupuestal/computeControlPresupuestalAlerts/
   buildSCurveData (Fase E, dominio puro ya probado), y las 5 rutas nuevas
   via controlPresupuestalCloud.js. Ninguna formula de costo se recalcula
   aqui -- este archivo solo ordena/presenta lo que el dominio ya calculo. */
import { useMemo, useState } from 'react';
import { PageHead, EmptyState } from '../../components/ui/PageElements.jsx';
import { useCatalogConceptos } from '../catalogo/catalogConceptosCloud.js';
import { useProjectApus } from '../catalogo/projectApusCloud.js';
import { usePresupuesto } from '../presupuesto/presupuestoCloud.js';
import { useChangeOrders, useCommitments, useProgressEntries, useEstimates, usePayments } from './controlPresupuestalCloud.js';
import { aggregatePresupuesto } from '../../domain/presupuestoAggregation.js';
import { aggregateControlPresupuestal } from '../../domain/controlPresupuestalAggregation.js';
import { computeControlPresupuestalAlerts } from '../../domain/controlPresupuestalAlerts.js';
import { buildSCurveData } from '../../domain/sCurveData.js';
import { isLegalChangeOrderTransition } from '../../domain/changeOrderSchema.js';
import { COMMITMENT_TYPE } from '../../domain/commitmentSchema.js';
import { PAYMENT_METHOD } from '../../domain/paymentSchema.js';
import { calcAPUv2 } from '../../lib/apuCalc.js';
import { money } from '../../lib/apuExport.js';

const TABS = [
  ['resumen', 'Resumen'],
  ['presupuesto', 'Presupuesto'],
  ['ordenes', 'Órdenes de cambio'],
  ['avance', 'Avance'],
  ['estimaciones', 'Estimaciones'],
  ['pagos', 'Pagos'],
  ['forecast', 'Forecast']
];

// new Date('2026-07-01') parsea como UTC medianoche; en un huso horario
// detras de UTC (Mexico, UTC-6) toLocaleDateString lo muestra un dia antes.
// Una fecha-solo (sin hora) se construye en horario LOCAL directamente para
// que "14/9/2026" capturado en el formulario nunca se muestre como 13.
function formatDateOnly(value){
  if(!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if(dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).toLocaleDateString('es-MX');
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('es-MX');
}

function SeverityBadge({ severity }){
  if(!severity) return null;
  return <span className={`zi-badge zi-badge-${severity.toLowerCase()}`}>{severity}</span>;
}
function num(n){ return Number.isFinite(Number(n)) ? Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 }) : '—'; }
function pct(n){ return n == null ? '—' : `${num(n)}%`; }

function KpiCard({ label, value, sub }){
  return <div className="info-card"><small>{label}</small><b>{value}</b>{sub && <span>{sub}</span>}</div>;
}

function ConceptSelect({ conceptos, value, onChange }){
  return <select value={value} onChange={e => onChange(e.target.value)}>
    <option value="">Selecciona un concepto…</option>
    {conceptos.map(c => <option key={c.id} value={c.id}>{c.clave ? `${c.clave} — ` : ''}{c.concept}</option>)}
  </select>;
}

export function ControlPresupuestalModule({ user, activeProjectId, activeProject, onNeedProject }){
  const [tab, setTab] = useState('resumen');
  const { conceptos } = useCatalogConceptos(user, activeProjectId);
  const { apus: rawApus } = useProjectApus(user, activeProjectId);
  const { presupuesto } = usePresupuesto(user, activeProjectId);
  const changeOrders = useChangeOrders(user, activeProjectId);
  const commitments = useCommitments(user, activeProjectId);
  const progress = useProgressEntries(user, activeProjectId);
  const estimates = useEstimates(user, activeProjectId);
  const payments = usePayments(user, activeProjectId);

  const apuById = useMemo(() => new Map((rawApus || []).map(a => [a.id, a])), [rawApus]);
  const conceptosActivos = useMemo(() => conceptos.filter(c => !c.archivedAt), [conceptos]);

  const presupuestoRows = useMemo(() => {
    const rows = conceptosActivos.map(c => {
      const apu = c.apuId ? apuById.get(c.apuId) : null;
      const totals = apu ? (apu.calculated || calcAPUv2(apu)) : null;
      return { conceptoId: c.id, clave: c.clave, capitulo: c.capitulo, concept: c.concept, unit: c.unit, qty: c.qty, apuId: c.apuId || null, pu: totals?.pu ?? 0, direct: totals?.direct ?? 0 };
    });
    return aggregatePresupuesto(rows).rows;
  }, [conceptosActivos, apuById]);

  const aggregation = useMemo(() => aggregateControlPresupuestal({
    presupuestoRows, changeOrders: changeOrders.items, commitments: commitments.items,
    progressEntries: progress.items, estimates: estimates.items, payments: payments.items
  }), [presupuestoRows, changeOrders.items, commitments.items, progress.items, estimates.items, payments.items]);

  const alerts = useMemo(() => computeControlPresupuestalAlerts({ aggregation, changeOrders: changeOrders.items, payments: payments.items }), [aggregation, changeOrders.items, payments.items]);

  const sCurve = useMemo(() => buildSCurveData({ progressEntries: progress.items, payments: payments.items, presupuestoVigente: aggregation.totals.vigente }), [progress.items, payments.items, aggregation.totals.vigente]);

  if(!activeProjectId){
    return <section>
      <PageHead kicker="Control Presupuestal" title="Control Presupuestal" desc="Presupuesto vigente, comprometido, ejecutado, estimado, pagado y forecast al cierre." />
      <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '14px 18px' }}>
        <p className="muted" style={{ margin: 0 }}>Necesitas un proyecto activo para ver su Control Presupuestal.</p>
        <button onClick={onNeedProject}>Crear/elegir proyecto</button>
      </div>
    </section>;
  }

  if(!presupuesto?.baselineVersion){
    return <section>
      <PageHead kicker="Control Presupuestal" title={activeProject?.name || 'Control Presupuestal'} desc="Presupuesto vigente, comprometido, ejecutado, estimado, pagado y forecast al cierre." />
      <div className="panel"><EmptyState icon="presupuestos" title="Sin Baseline todavía" text="Aprueba un Presupuesto como Baseline (módulo Presupuesto) antes de abrir el Control Presupuestal — el Baseline es el punto de partida de todo el control." /></div>
    </section>;
  }

  return (
    <section>
      <PageHead kicker="Control Presupuestal" title={activeProject?.name || 'Control Presupuestal'} desc="Presupuesto vigente, comprometido, ejecutado, estimado, pagado y forecast al cierre." />
      <div className="visual-modes" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {tab === 'resumen' && <ResumenTab aggregation={aggregation} alerts={alerts} presupuesto={presupuesto} />}
      {tab === 'presupuesto' && <PresupuestoTab rows={aggregation.rows} totals={aggregation.totals} conceptos={conceptosActivos} commitments={commitments} />}
      {tab === 'ordenes' && <OrdenesTab conceptos={conceptosActivos} changeOrders={changeOrders} />}
      {tab === 'avance' && <AvanceTab conceptos={conceptosActivos} rows={aggregation.rows} progress={progress} />}
      {tab === 'estimaciones' && <EstimacionesTab conceptos={conceptosActivos} estimates={estimates} />}
      {tab === 'pagos' && <PagosTab estimates={estimates.items} payments={payments} />}
      {tab === 'forecast' && <ForecastTab rows={aggregation.rows} totals={aggregation.totals} sCurve={sCurve} />}
    </section>
  );
}

function ResumenTab({ aggregation, alerts, presupuesto }){
  const t = aggregation.totals;
  return <>
    <div className="panel" style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="zi-badge zi-badge-medium">Baseline: {presupuesto.baselineVersion}</span>
      <span className="muted">Presupuesto vigente actual: {presupuesto.currentVersion}</span>
    </div>
    <div className="info-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
      <KpiCard label="Baseline" value={money(t.baseline)} />
      <KpiCard label="Cambios aprobados" value={money(t.cambiosAprobados)} />
      <KpiCard label="Presupuesto vigente" value={money(t.vigente)} />
      <KpiCard label="Comprometido" value={money(t.comprometido)} sub={`Pendiente: ${money(t.comprometidoPendiente)}`} />
      <KpiCard label="Ejecutado" value={money(t.ejecutado)} sub={pct(t.avanceFisicoPct)} />
      <KpiCard label="Estimado" value={money(t.estimado)} sub={pct(t.avanceFinancieroPct)} />
      <KpiCard label="Pagado" value={money(t.pagado)} sub={t.pagadoSinEstimacion > 0 ? `${money(t.pagadoSinEstimacion)} sin estimación` : undefined} />
      <KpiCard label="Saldo" value={money(t.saldo)} />
      <KpiCard label="Forecast (EAC)" value={money(t.eac)} sub={`ETC: ${money(t.etc)}`} />
      <KpiCard label="Variación" value={money(t.variacion)} sub={pct(t.variacionPct)} />
      <KpiCard label="Avance físico" value={pct(t.avanceFisicoPct)} />
      <KpiCard label="Avance financiero" value={pct(t.avanceFinancieroPct)} />
    </div>
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Alertas</h2>
      {!alerts.length
        ? <p className="muted">Sin alertas — el proyecto está dentro de los parámetros esperados.</p>
        : <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
          {alerts.map((a, i) => <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><SeverityBadge severity={a.severity} /><span>{a.message}</span></li>)}
        </ul>}
    </div>
  </>;
}

function PresupuestoTab({ rows, totals, conceptos, commitments }){
  const [draft, setDraft] = useState({ conceptoId: '', capitulo: 'OTROS', tipo: COMMITMENT_TYPE.ORDEN_COMPRA, proveedor: '', monto: '', fecha: '', referencia: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError(null); setSaving(true);
    try{
      await commitments.create({ conceptoId: draft.conceptoId || null, capitulo: draft.capitulo, tipo: draft.tipo, proveedor: draft.proveedor, monto: Number(draft.monto) || 0, fecha: draft.fecha || null, referencia: draft.referencia });
      setDraft({ conceptoId: '', capitulo: 'OTROS', tipo: COMMITMENT_TYPE.ORDEN_COMPRA, proveedor: '', monto: '', fecha: '', referencia: '' });
    }catch(err){ setError(err.message); }
    finally{ setSaving(false); }
  };

  return <>
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="apu-table-scroll">
        <table className="budget-table">
          <thead><tr><th>Clave</th><th>Concepto</th><th>Cant. vigente</th><th>P.U.</th><th>Vigente</th><th>Comprometido</th><th>Ejecutado</th><th>Estimado</th><th>Pagado</th><th>Saldo</th><th>Av. físico</th><th>Av. financiero</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.conceptoId}>
                <td>{r.clave || '—'}</td><td>{r.concept}</td><td>{num(r.cantidadVigente)}</td><td>{money(r.pu)}</td>
                <td>{money(r.presupuestoVigente)}</td><td>{money(r.comprometido)}</td><td>{money(r.ejecutado)}</td>
                <td>{money(r.estimado)}</td><td>{money(r.pagado)}</td><td>{money(r.saldo)}</td>
                <td>{pct(r.avanceFisicoPct)}</td><td>{pct(r.avanceFinancieroPct)}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 600 }}>
              <td colSpan={4}>Total</td>
              <td>{money(totals.vigente)}</td><td>{money(totals.comprometido)}</td><td>{money(totals.ejecutado)}</td>
              <td>{money(totals.estimado)}</td><td>{money(totals.pagado)}</td><td>{money(totals.saldo)}</td>
              <td>{pct(totals.avanceFisicoPct)}</td><td>{pct(totals.avanceFinancieroPct)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Comprometido — órdenes de compra, contratos y subcontratos</h2>
      <div className="form-grid" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="nf wide"><label>Concepto (opcional)</label><ConceptSelect conceptos={conceptos} value={draft.conceptoId} onChange={v => setDraft({ ...draft, conceptoId: v })} /></div>
        <div className="nf"><label>Tipo</label>
          <select value={draft.tipo} onChange={e => setDraft({ ...draft, tipo: e.target.value })}>
            {Object.values(COMMITMENT_TYPE).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="nf"><label>Proveedor/contratista</label><input value={draft.proveedor} onChange={e => setDraft({ ...draft, proveedor: e.target.value })} /></div>
        <div className="nf"><label>Monto</label><input type="number" min="0" step="any" value={draft.monto} onChange={e => setDraft({ ...draft, monto: e.target.value })} /></div>
        <div className="nf"><label>Fecha</label><input type="date" value={draft.fecha} onChange={e => setDraft({ ...draft, fecha: e.target.value })} /></div>
        <div className="nf"><label>Referencia</label><input value={draft.referencia} onChange={e => setDraft({ ...draft, referencia: e.target.value })} /></div>
        <div className="nf" style={{ alignSelf: 'flex-end' }}><button className="soft" disabled={saving || !draft.proveedor || !draft.monto} onClick={submit}>{saving ? 'Guardando…' : 'Registrar compromiso'}</button></div>
      </div>
      {error && <p className="muted" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="apu-table-scroll">
        <table className="budget-table">
          <thead><tr><th>Concepto</th><th>Tipo</th><th>Proveedor</th><th>Monto</th><th>Fecha</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {commitments.items.map(c => (
              <tr key={c.id}>
                <td>{conceptos.find(x => x.id === c.conceptoId)?.clave || (c.capitulo || '—')}</td>
                <td>{c.tipo}</td><td>{c.proveedor}</td><td>{money(c.monto)}</td>
                <td>{formatDateOnly(c.fecha) || '—'}</td>
                <td><span className={`zi-badge ${c.status === 'ACTIVO' ? 'zi-badge-medium' : c.status === 'CANCELADO' ? 'zi-badge-critical' : 'zi-badge-info'}`}>{c.status}</span></td>
                <td>{c.status === 'ACTIVO' && <>
                  <button className="soft" onClick={() => commitments.setStatus(c.id, 'CERRADO')}>Cerrar</button>{' '}
                  <button className="soft" onClick={() => commitments.setStatus(c.id, 'CANCELADO')}>Cancelar</button>
                </>}</td>
              </tr>
            ))}
            {!commitments.items.length && <tr><td colSpan={7} className="muted">Sin compromisos registrados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  </>;
}

// Botones de accion derivados de isLegalChangeOrderTransition (dominio puro,
// ya probado) -- nunca se duplica la tabla de transiciones legales aqui.
const CHANGE_ORDER_ACTION_LABEL = { EN_REVISION: 'Enviar a revisión', APROBADA: 'Aprobar', RECHAZADA: 'Rechazar', CANCELADA: 'Cancelar' };
function nextChangeOrderActions(status){
  return Object.keys(CHANGE_ORDER_ACTION_LABEL).filter(next => isLegalChangeOrderTransition(status, next) && next !== status).map(next => [next, CHANGE_ORDER_ACTION_LABEL[next]]);
}

function OrdenesTab({ conceptos, changeOrders }){
  const [draft, setDraft] = useState({ conceptoId: '', motivo: '', descripcion: '', cantidadNueva: '', impactoTiempoDias: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState(null);

  const submit = async () => {
    setError(null); setSaving(true);
    try{
      await changeOrders.create({ conceptoId: draft.conceptoId, motivo: draft.motivo, descripcion: draft.descripcion, cantidadNueva: Number(draft.cantidadNueva) || 0, impactoTiempoDias: Number(draft.impactoTiempoDias) || 0 });
      setDraft({ conceptoId: '', motivo: '', descripcion: '', cantidadNueva: '', impactoTiempoDias: '' });
    }catch(err){ setError(err.message); }
    finally{ setSaving(false); }
  };

  const doTransition = async (id, status) => {
    setActionError(null);
    try{ await changeOrders.setStatus(id, status); }
    catch(err){ setActionError(err.message); }
  };

  return <>
    <div className="panel" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>Nueva orden de cambio</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="nf wide"><label>Concepto</label><ConceptSelect conceptos={conceptos} value={draft.conceptoId} onChange={v => setDraft({ ...draft, conceptoId: v })} /></div>
        <div className="nf"><label>Cantidad nueva</label><input type="number" step="any" value={draft.cantidadNueva} onChange={e => setDraft({ ...draft, cantidadNueva: e.target.value })} /></div>
        <div className="nf"><label>Impacto en tiempo (días)</label><input type="number" step="any" value={draft.impactoTiempoDias} onChange={e => setDraft({ ...draft, impactoTiempoDias: e.target.value })} /></div>
        <div className="nf wide"><label>Motivo</label><input value={draft.motivo} onChange={e => setDraft({ ...draft, motivo: e.target.value })} placeholder="Ej. Ajuste de volumen real de obra" /></div>
        <div className="nf wide"><label>Descripción</label><input value={draft.descripcion} onChange={e => setDraft({ ...draft, descripcion: e.target.value })} /></div>
        <div className="nf" style={{ alignSelf: 'flex-end' }}><button className="soft" disabled={saving || !draft.conceptoId || !draft.motivo || !draft.cantidadNueva} onClick={submit}>{saving ? 'Creando…' : 'Crear orden'}</button></div>
      </div>
      {error && <p className="muted" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
    {actionError && <div className="panel" style={{ borderColor: 'var(--danger)', marginBottom: 16 }}><p className="muted">{actionError}</p></div>}
    <div className="panel">
      <div className="apu-table-scroll">
        <table className="budget-table">
          <thead><tr><th>Folio</th><th>Concepto</th><th>Motivo</th><th>Cant. anterior → nueva</th><th>P.U.</th><th>Impacto $</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {changeOrders.items.map(o => (
              <tr key={o.id}>
                <td>{o.folio}</td><td>{o.clave ? `${o.clave} — ` : ''}{o.concept}</td><td>{o.motivo}</td>
                <td>{num(o.cantidadAnterior)} → {num(o.cantidadNueva)}</td><td>{money(o.pu)}</td><td>{money(o.impactoEconomico)}</td>
                <td><span className={`zi-badge ${o.status === 'APROBADA' ? 'zi-badge-medium' : o.status === 'RECHAZADA' || o.status === 'CANCELADA' ? 'zi-badge-critical' : 'zi-badge-info'}`}>{o.status}</span></td>
                <td>{nextChangeOrderActions(o.status).map(([next, label]) => <button key={next} className="soft" style={{ marginRight: 4 }} onClick={() => doTransition(o.id, next)}>{label}</button>)}</td>
              </tr>
            ))}
            {!changeOrders.items.length && <tr><td colSpan={8} className="muted">Sin órdenes de cambio.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  </>;
}

function AvanceTab({ conceptos, rows, progress }){
  const [draft, setDraft] = useState({ conceptoId: '', delta: '', fecha: '', motivo: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError(null); setSaving(true);
    try{
      await progress.create({ conceptoId: draft.conceptoId, delta: Number(draft.delta) || 0, fecha: draft.fecha || null, motivo: draft.motivo });
      setDraft({ conceptoId: '', delta: '', fecha: '', motivo: '' });
    }catch(err){ setError(err.message); }
    finally{ setSaving(false); }
  };

  const sorted = [...progress.items].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

  return <>
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="apu-table-scroll">
        <table className="budget-table">
          <thead><tr><th>Clave</th><th>Concepto</th><th>Cant. vigente</th><th>Ejecutada</th><th>Pendiente</th><th>% Avance físico</th></tr></thead>
          <tbody>
            {rows.map(r => <tr key={r.conceptoId}><td>{r.clave || '—'}</td><td>{r.concept}</td><td>{num(r.cantidadVigente)}</td><td>{num(r.cantidadEjecutada)}</td><td>{num(r.cantidadPendiente)}</td><td>{pct(r.avanceFisicoPct)}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>

    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Registrar avance</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="nf wide"><label>Concepto</label><ConceptSelect conceptos={conceptos} value={draft.conceptoId} onChange={v => setDraft({ ...draft, conceptoId: v })} /></div>
        <div className="nf"><label>Cantidad (delta)</label><input type="number" step="any" value={draft.delta} onChange={e => setDraft({ ...draft, delta: e.target.value })} placeholder="Positiva o negativa" /></div>
        <div className="nf"><label>Fecha</label><input type="date" value={draft.fecha} onChange={e => setDraft({ ...draft, fecha: e.target.value })} /></div>
        <div className="nf wide"><label>Motivo</label><input value={draft.motivo} onChange={e => setDraft({ ...draft, motivo: e.target.value })} /></div>
        <div className="nf" style={{ alignSelf: 'flex-end' }}><button className="soft" disabled={saving || !draft.conceptoId || !draft.delta} onClick={submit}>{saving ? 'Guardando…' : 'Registrar'}</button></div>
      </div>
      {error && <p className="muted" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="apu-table-scroll">
        <table className="budget-table">
          <thead><tr><th>Fecha</th><th>Concepto</th><th>Delta</th><th>Acumulado</th><th>Motivo</th><th>Usuario</th><th>Aviso</th></tr></thead>
          <tbody>
            {sorted.map(p => (
              <tr key={p.id}>
                <td>{formatDateOnly(p.fecha) || '—'}</td>
                <td>{conceptos.find(c => c.id === p.conceptoId)?.clave || p.conceptoId}</td>
                <td>{num(p.delta)}</td><td>{num(p.accumulated)}</td><td>{p.motivo}</td><td>{p.usuario}</td>
                <td>{p.hasWarning ? <span className="zi-badge zi-badge-high">{(p.warnings || []).join(', ')}</span> : '—'}</td>
              </tr>
            ))}
            {!sorted.length && <tr><td colSpan={7} className="muted">Sin avance registrado.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  </>;
}

function EstimacionesTab({ conceptos, estimates }){
  const [rows, setRows] = useState([{ conceptoId: '', cantidadPeriodo: '' }]);
  const [meta, setMeta] = useState({ periodoDesde: '', periodoHasta: '', retencionPct: '', amortizacionPct: '', deducciones: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState(null);

  const addRow = () => setRows(r => [...r, { conceptoId: '', cantidadPeriodo: '' }]);
  const updateRow = (i, patch) => setRows(r => r.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  const removeRow = (i) => setRows(r => r.filter((_, idx) => idx !== i));

  const submit = async () => {
    setError(null); setSaving(true);
    try{
      const validRows = rows.filter(r => r.conceptoId && r.cantidadPeriodo);
      await estimates.create({
        periodoDesde: meta.periodoDesde || null, periodoHasta: meta.periodoHasta || null,
        conceptos: validRows.map(r => ({ conceptoId: r.conceptoId, cantidadPeriodo: Number(r.cantidadPeriodo) || 0 })),
        retencionPct: Number(meta.retencionPct) || 0, amortizacionPct: Number(meta.amortizacionPct) || 0, deducciones: Number(meta.deducciones) || 0
      });
      setRows([{ conceptoId: '', cantidadPeriodo: '' }]);
      setMeta({ periodoDesde: '', periodoHasta: '', retencionPct: '', amortizacionPct: '', deducciones: '' });
    }catch(err){ setError(err.message); }
    finally{ setSaving(false); }
  };

  const authorize = async (id) => {
    setActionError(null);
    try{ await estimates.setStatus(id, 'AUTORIZADA'); }
    catch(err){ setActionError(err.message); }
  };

  return <>
    <div className="panel" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>Nueva estimación de obra</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div className="nf"><label>Periodo desde</label><input type="date" value={meta.periodoDesde} onChange={e => setMeta({ ...meta, periodoDesde: e.target.value })} /></div>
        <div className="nf"><label>Periodo hasta</label><input type="date" value={meta.periodoHasta} onChange={e => setMeta({ ...meta, periodoHasta: e.target.value })} /></div>
        <div className="nf"><label>Retención %</label><input type="number" step="any" value={meta.retencionPct} onChange={e => setMeta({ ...meta, retencionPct: e.target.value })} /></div>
        <div className="nf"><label>Amortización %</label><input type="number" step="any" value={meta.amortizacionPct} onChange={e => setMeta({ ...meta, amortizacionPct: e.target.value })} /></div>
        <div className="nf"><label>Deducciones ($)</label><input type="number" step="any" value={meta.deducciones} onChange={e => setMeta({ ...meta, deducciones: e.target.value })} /></div>
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 }}>
          <div className="nf wide"><label>Concepto</label><ConceptSelect conceptos={conceptos} value={row.conceptoId} onChange={v => updateRow(i, { conceptoId: v })} /></div>
          <div className="nf"><label>Cantidad del periodo</label><input type="number" step="any" value={row.cantidadPeriodo} onChange={e => updateRow(i, { cantidadPeriodo: e.target.value })} /></div>
          {rows.length > 1 && <button className="soft" onClick={() => removeRow(i)}>Quitar</button>}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="soft" onClick={addRow}>+ Agregar concepto</button>
        <button className="soft" disabled={saving || !rows.some(r => r.conceptoId && r.cantidadPeriodo)} onClick={submit}>{saving ? 'Creando…' : 'Crear estimación'}</button>
      </div>
      {error && <p className="muted" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
    {actionError && <div className="panel" style={{ borderColor: 'var(--danger)', marginBottom: 16 }}><p className="muted">{actionError}</p></div>}
    <div className="panel">
      <div className="apu-table-scroll">
        <table className="budget-table">
          <thead><tr><th>№</th><th>Periodo</th><th>Importe bruto</th><th>Retención</th><th>Amortización</th><th>Deducciones</th><th>Total estimado</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {estimates.items.map(e => (
              <tr key={e.id}>
                <td>{e.numero}</td>
                <td>{formatDateOnly(e.periodoDesde) || '—'} – {formatDateOnly(e.periodoHasta) || '—'}</td>
                <td>{money(e.importeBruto)}</td><td>{money(e.retencion)}</td><td>{money(e.amortizacion)}</td><td>{money(e.deducciones)}</td>
                <td>{money(e.totalEstimado)}</td>
                <td><span className={`zi-badge ${e.status === 'AUTORIZADA' ? 'zi-badge-medium' : 'zi-badge-info'}`}>{e.status}</span></td>
                <td>{e.status === 'BORRADOR' && <button className="soft" onClick={() => authorize(e.id)}>Autorizar</button>}</td>
              </tr>
            ))}
            {!estimates.items.length && <tr><td colSpan={9} className="muted">Sin estimaciones.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  </>;
}

function PagosTab({ estimates, payments }){
  const [draft, setDraft] = useState({ estimacionId: '', monto: '', fecha: '', proveedor: '', referencia: '', metodo: PAYMENT_METHOD.TRANSFERENCIA });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError(null); setSaving(true);
    try{
      await payments.create({ estimacionId: draft.estimacionId || null, monto: Number(draft.monto) || 0, fecha: draft.fecha || null, proveedor: draft.proveedor, referencia: draft.referencia, metodo: draft.metodo });
      setDraft({ estimacionId: '', monto: '', fecha: '', proveedor: '', referencia: '', metodo: PAYMENT_METHOD.TRANSFERENCIA });
    }catch(err){ setError(err.message); }
    finally{ setSaving(false); }
  };

  return <>
    <div className="panel" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>Registrar pago</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="nf wide"><label>Estimación (opcional)</label>
          <select value={draft.estimacionId} onChange={e => setDraft({ ...draft, estimacionId: e.target.value })}>
            <option value="">Sin estimación vinculada</option>
            {estimates.map(e => <option key={e.id} value={e.id}>№{e.numero} — {money(e.totalEstimado)}</option>)}
          </select>
        </div>
        <div className="nf"><label>Monto</label><input type="number" min="0" step="any" value={draft.monto} onChange={e => setDraft({ ...draft, monto: e.target.value })} /></div>
        <div className="nf"><label>Fecha</label><input type="date" value={draft.fecha} onChange={e => setDraft({ ...draft, fecha: e.target.value })} /></div>
        <div className="nf"><label>Proveedor/contratista</label><input value={draft.proveedor} onChange={e => setDraft({ ...draft, proveedor: e.target.value })} /></div>
        <div className="nf"><label>Referencia</label><input value={draft.referencia} onChange={e => setDraft({ ...draft, referencia: e.target.value })} /></div>
        <div className="nf"><label>Método</label>
          <select value={draft.metodo} onChange={e => setDraft({ ...draft, metodo: e.target.value })}>
            {Object.values(PAYMENT_METHOD).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="nf" style={{ alignSelf: 'flex-end' }}><button className="soft" disabled={saving || !draft.proveedor || !draft.monto} onClick={submit}>{saving ? 'Guardando…' : 'Registrar pago'}</button></div>
      </div>
      {error && <p className="muted" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
    <div className="panel">
      <div className="apu-table-scroll">
        <table className="budget-table">
          <thead><tr><th>Fecha</th><th>Estimación</th><th>Monto</th><th>Proveedor</th><th>Método</th><th>Referencia</th><th>Aviso</th></tr></thead>
          <tbody>
            {[...payments.items].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).map(p => (
              <tr key={p.id}>
                <td>{formatDateOnly(p.fecha) || '—'}</td>
                <td>{p.estimacionId ? estimates.find(e => e.id === p.estimacionId)?.numero ?? p.estimacionId : <span className="muted">Sin vincular</span>}</td>
                <td>{money(p.monto)}</td><td>{p.proveedor}</td><td>{p.metodo}</td><td>{p.referencia || '—'}</td>
                <td>{p.exceedsEstimate ? <span className="zi-badge zi-badge-high">{p.exceedsEstimateReason}</span> : '—'}</td>
              </tr>
            ))}
            {!payments.items.length && <tr><td colSpan={7} className="muted">Sin pagos registrados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  </>;
}

function ForecastTab({ rows, totals, sCurve }){
  return <>
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="apu-table-scroll">
        <table className="budget-table">
          <thead><tr><th>Clave</th><th>Concepto</th><th>Ejecutado</th><th>ETC (pendiente)</th><th>EAC</th><th>Variación $</th><th>Variación %</th></tr></thead>
          <tbody>
            {rows.map(r => <tr key={r.conceptoId}><td>{r.clave || '—'}</td><td>{r.concept}</td><td>{money(r.ejecutado)}</td><td>{money(r.etc)}</td><td>{money(r.eac)}</td><td>{money(r.variacion)}</td><td>{pct(r.variacionPct)}</td></tr>)}
            <tr style={{ fontWeight: 600 }}><td colSpan={2}>Total</td><td>{money(totals.ejecutado)}</td><td>{money(totals.etc)}</td><td>{money(totals.eac)}</td><td>{money(totals.variacion)}</td><td>{pct(totals.variacionPct)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Curva S</h2>
      {!sCurve.available
        ? <p className="muted">{sCurve.reason}</p>
        : <div className="apu-table-scroll">
          <table className="budget-table">
            <thead><tr><th>Periodo</th><th>Avance programado</th><th>Avance real</th><th>Costo programado</th><th>Costo real</th></tr></thead>
            <tbody>
              {sCurve.periods.map((period, i) => (
                <tr key={period}>
                  <td>{period}</td>
                  <td className="muted">Sin línea base de programa</td>
                  <td>{pct(sCurve.series.avanceRealPct[i]?.value)}</td>
                  <td className="muted">Sin línea base de programa</td>
                  <td>{money(sCurve.series.costoReal[i]?.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
    </div>
  </>;
}
