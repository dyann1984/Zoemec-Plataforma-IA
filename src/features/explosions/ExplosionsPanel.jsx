/* Panel "Explosiones" de un proyecto (Fase A). Consume EXCLUSIVAMENTE
   loadScopedExplosion (F2: APUs + conceptos del servidor -> alcance
   PRESUPUESTO/PROYECTO, ver src/lib/explosionInputs.js y
   src/domain/budgetScope.js) -- nunca recibe un arreglo de APUs armado por
   el llamador -- y pasa el MISMO objeto calculado a exportExplosionPdf/
   exportExplosionExcel: la tabla en pantalla y los archivos exportados
   nunca pueden divergir porque nunca hay dos calculos.

   Multi-tenant: la seguridad real vive en el servidor (_route-apus.mjs
   filtra por organizationId/ownerUid derivado del token) y en
   assertSingleTenantScope (explosionEngine.js) como segunda barrera -- este
   componente no agrega ni retira ninguna verificacion, solo muestra el
   resultado o el error tal cual. */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { loadScopedExplosion, assertExplosionHasLines, EXPLOSION_SCOPE } from '../../lib/explosionInputs.js';
import { originLabel } from '../../domain/explosionEngine.js';
import { laborEconomicView, laborResourceView } from '../../domain/laborExplosion.js';
import { exportExplosionPdf } from '../../lib/explosionPdf.js';
import { exportExplosionFromScreen } from '../../lib/reports/reportExports.js';
import { exportExplosionExcel } from '../../lib/explosionXlsx.js';
import { money, num } from '../../lib/apuExport.js';

const RULE_LABEL_KEY = { UNICO: 'reconciliationUnico', MAYOR_CONFIANZA: 'reconciliationMayorConfianza', EMPATE_MEDIANA: 'reconciliationEmpateMediana' };
const TABS = ['materials', 'labor', 'machinery', 'auxiliares'];
const TAB_LABEL_KEY = { materials: 'tabMaterials', labor: 'tabLabor', machinery: 'tabMachinery', auxiliares: 'tabAuxiliaries' };

function ResourceTable({ rows, tab, tr, expanded, toggleExpand }){
  if(!rows.length) return <p className="muted">{tr('explosions.noRows')}</p>;
  return <div className="apu-table-scroll"><table className="data-table">
    <thead><tr>
      <th>{tr('explosions.colClave')}</th><th>{tr('explosions.colDescripcion')}</th><th>{tr('explosions.colUnidad')}</th>
      {tab === 'machinery' ? <th>{tr('explosions.colHoras')}</th> : <>
        <th>{tr('explosions.colCantidadBase')}</th><th>{tr('explosions.colDesperdicio')}</th><th>{tr('explosions.colCantidadFinal')}</th>
      </>}
      <th>{tr('explosions.colPrecio')}</th><th>{tr('explosions.colImporte')}</th>
      <th>{tr('explosions.ruleLabel')}</th><th>{tr('explosions.confidenceLabel')}</th><th />
    </tr></thead>
    <tbody>
      {rows.map((r, i) => {
        const key = `${r.clave || 'k'}-${r.descripcion}-${i}`;
        const isOpen = expanded.has(key);
        const precio = tab === 'machinery' ? r.tarifaReferencia : r.precioUnitario;
        return <Fragment key={key}>
          <tr>
            <td>{r.clave || '—'}</td><td>{r.descripcion}{tab === 'machinery' && r.categoria ? <small className="muted"> — {tr(`explosions.${r.categoria}`)}</small> : null}</td>
            <td>{r.unidad || '—'}</td>
            {tab === 'machinery' ? <td>{r.horas != null ? num(r.horas) : 'N/D'}</td> : <>
              <td>{num(r.cantidadBase)}</td><td>{num(r.desperdicioPct)}%</td><td>{num(r.cantidadFinal)}</td>
            </>}
            <td>{precio != null ? money(precio) : '—'}</td><td>{money(r.importe)}</td>
            <td>{r.reconciliationRule ? tr(`explosions.${RULE_LABEL_KEY[r.reconciliationRule]}`) : '—'}</td>
            <td>{r.confianza != null ? `${Math.round(r.confianza)}%` : '—'}</td>
            <td>{r.origenes?.length ? <button type="button" className="soft" onClick={() => toggleExpand(key)}>{isOpen ? tr('explosions.hideBreakdown') : tr('explosions.viewBreakdown')}</button> : null}</td>
          </tr>
          {isOpen && r.origenes.map((o, oi) => <tr key={oi} className="muted">
            <td /><td>&rarr; {originLabel(o)}</td><td />
            {tab === 'machinery' ? <td>{o.horasAportadas != null ? num(o.horasAportadas) : 'N/D'}</td> : <>
              <td>{num(o.cantidadBaseAportada)}</td><td /><td>{num(o.cantidadFinalAportada)}</td>
            </>}
            <td>{money(o.precioUnitario ?? o.tarifa ?? 0)}</td>
            <td>{money(o.importeConsolidado ?? o.importeAportadoReal ?? 0)}</td>
            <td /><td>{o.priceConfidence != null ? `${Math.round(o.priceConfidence)}%` : '—'}</td><td />
          </tr>)}
        </Fragment>;
      })}
    </tbody>
  </table></div>;
}

function LaborTable({ rows, tr, expanded, toggleExpand }){
  const [view, setView] = useState('economic');
  if(!rows.length) return <p className="muted">{tr('explosions.noRows')}</p>;
  const economica = laborEconomicView(rows);
  const recursos = laborResourceView(rows);
  return <>
    <div className="sc-actions" style={{ marginBottom: 8 }}>
      <button type="button" className={view === 'economic' ? '' : 'soft'} onClick={() => setView('economic')}>{tr('explosions.economicView')}</button>
      <button type="button" className={view === 'resource' ? '' : 'soft'} onClick={() => setView('resource')}>{tr('explosions.resourceView')}</button>
    </div>
    <div className="apu-table-scroll"><table className="data-table">
      <thead><tr>
        <th>{tr('explosions.colOficio')}</th><th>{tr('explosions.colCategoria')}</th>
        {view === 'economic' ? <>
          <th>{tr('explosions.colCosto')}</th><th>{tr('explosions.colJornadas')}</th><th>{tr('explosions.colImporte')}</th>
          <th>{tr('explosions.ruleLabel')}</th><th>{tr('explosions.confidenceLabel')}</th>
        </> : <>
          <th>{tr('explosions.colCuadrilla')}</th><th>{tr('explosions.colHoras')}</th><th>{tr('explosions.colJornadas')}</th>
          <th>{tr('explosions.workersEquivalent')}</th>
        </>}
        <th />
      </tr></thead>
      <tbody>
        {rows.map((r, i) => {
          const key = `${r.clave || 'k'}-${r.descripcion}-${i}`;
          const isOpen = expanded.has(key);
          const eco = economica[i], rec = recursos[i];
          return <Fragment key={key}>
            <tr>
              <td>{eco.oficio}</td><td>{eco.categoria}</td>
              {view === 'economic' ? <>
                <td>{money(eco.costoUnitarioPorJornada)}</td><td>{num(eco.jornadas)}</td><td>{money(eco.importe)}</td>
                <td>{tr(`explosions.${RULE_LABEL_KEY[r.reconciliationRule]}`)}</td><td>{Math.round(r.confianza)}%</td>
              </> : <>
                <td>{Array.isArray(rec.cuadrilla) ? rec.cuadrilla.join('/') : (rec.cuadrilla ?? '—')}</td>
                <td>{num(rec.horas)}</td><td>{num(rec.jornadas)}</td>
                <td>{rec.trabajadoresEquivalentes != null ? num(rec.trabajadoresEquivalentes) : <small className="muted" title={rec.trabajadoresEquivalentesNota}>{tr('explosions.workersEquivalentNote')}</small>}</td>
              </>}
              <td><button type="button" className="soft" onClick={() => toggleExpand(key)}>{isOpen ? tr('explosions.hideBreakdown') : tr('explosions.viewBreakdown')}</button></td>
            </tr>
            {isOpen && r.origenes.map((o, oi) => <tr key={oi} className="muted">
              <td /><td>&rarr; {originLabel(o)}</td>
              <td colSpan={view === 'economic' ? 4 : 3}>{num(o.jornadasAportadas)} jornadas — {money(o.importeConsolidado)}</td>
              <td /><td />
            </tr>)}
          </Fragment>;
        })}
      </tbody>
    </table></div>
  </>;
}

/* F2: `scope` = PRESUPUESTO (abierto desde Presupuesto: solo conceptos con
   APU, cantidad del concepto) o PROYECTO (default: conceptos + APUs
   independientes con su propia cantidad). El objeto calculado se pasa TAL
   CUAL a los exportadores: pantalla, PDF y XLSX nunca divergen. */
export default function ExplosionsPanel({ projectId, onClose, scope = EXPLOSION_SCOPE.PROYECTO }){
  const { t: tr } = useI18n();
  const [state, setState] = useState({ status: 'loading', data: null, error: null, explosion: null });
  const [tab, setTab] = useState('materials');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('importe');
  const [expanded, setExpanded] = useState(new Set());
  const [exportState, setExportState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null, explosion: null });
    loadScopedExplosion({ projectId, scope }).then(explosion => {
      if(cancelled) return;
      try{ assertExplosionHasLines(explosion); }
      catch(err){ setState({ status: 'error', data: null, error: err.message, explosion }); return; }
      setState({ status: 'ready', data: explosion.data, error: null, explosion });
    }).catch(err => { if(!cancelled) setState({ status: 'error', data: null, error: err.message, explosion: null }); });
    return () => { cancelled = true; };
  }, [projectId, scope]);

  const flatRows = useMemo(() => {
    if(state.status !== 'ready') return [];
    if(tab === 'materials') return state.data.materials;
    if(tab === 'auxiliares') return state.data.auxiliares;
    if(tab === 'labor') return state.data.labor;
    if(tab === 'machinery') return [
      ...state.data.machinery.maquinaria.map(r => ({ ...r, categoria: 'machineryHeavy' })),
      ...state.data.machinery.equipo.map(r => ({ ...r, categoria: 'machineryLight' })),
      ...state.data.machinery.herramientaMenor.map(r => ({ ...r, categoria: 'handTools' }))
    ];
    return [];
  }, [state, tab]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? flatRows.filter(r => String(r.clave || '').toLowerCase().includes(q) || String(r.descripcion || '').toLowerCase().includes(q)) : flatRows;
    return [...base].sort((a, b) => sortBy === 'importe' ? b.importe - a.importe : String(a.descripcion || '').localeCompare(String(b.descripcion || '')));
  }, [flatRows, search, sortBy]);

  const total = filtered.reduce((s, r) => s + r.importe, 0);
  const toggleExpand = key => setExpanded(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const changeTab = id => { setTab(id); setExpanded(new Set()); setSearch(''); };

  const runExport = async format => {
    setExportState({ format, status: 'generating' });
    try{
      // F5: alcance PRESUPUESTO -> documento unificado del Centro de Reportes
      // con el MISMO objeto de pantalla; alcance PROYECTO conserva el
      // exportador F2 (el Centro de Reportes solo emite el alcance presupuesto).
      if(scope === EXPLOSION_SCOPE.PRESUPUESTO) await exportExplosionFromScreen(projectId, state.explosion, format);
      else await (format === 'PDF' ? exportExplosionPdf : exportExplosionExcel)({ projectId, scope, explosion: state.explosion });
      setExportState(null);
    }catch(err){ setExportState({ format, status: 'error', message: err.message }); }
  };

  return <div className="record-modal" role="dialog" aria-modal="true">
    <div className="record-backdrop" onClick={onClose}></div>
    <div className="panel record-form" style={{ maxWidth: 1100, width: '95vw' }}>
      <div className="record-form-head">
        <div><span>{tr('explosions.subtitle')}</span><h2>{tr('explosions.title')}</h2></div>
        <button type="button" className="secondary" onClick={onClose}>{tr('explosions.close')}</button>
      </div>

      {state.status === 'loading' && <p className="muted">{tr('explosions.loading')}</p>}
      {state.status === 'error' && <p style={{ color: 'var(--danger)' }}>{tr('explosions.errorLoading', { message: state.error })}</p>}

      {state.status === 'ready' && <>
        {state.explosion?.summary && <p className="muted" style={{ marginTop: 0 }}>
          {scope === EXPLOSION_SCOPE.PRESUPUESTO
            ? `Alcance: presupuesto — ${state.explosion.summary.conceptosConApu} concepto(s) con APU, cantidad = cantidad vigente del concepto. Excluidos: ${state.explosion.summary.conceptosSinApu} sin APU, ${state.explosion.summary.conceptosConApuNoDisponible} con APU archivado/inexistente, ${state.explosion.summary.apusFueraDelPresupuesto} APU(s) fuera del presupuesto.`
            : `Alcance: proyecto — ${state.explosion.summary.conceptosConApu} concepto(s) con APU (cantidad del concepto) + ${state.explosion.summary.apusIndependientes} APU(s) independiente(s) (cantidad propia del APU).`}
        </p>}
        <div className="sc-actions" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          {TABS.map(id => <button key={id} type="button" className={tab === id ? '' : 'soft'} onClick={() => changeTab(id)}>{tr(`explosions.${TAB_LABEL_KEY[id]}`)}</button>)}
        </div>

        {tab !== 'labor' && <div className="field-grid" style={{ marginBottom: 12 }}>
          <input placeholder={tr('explosions.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
          <div className="nf">
            <label>{tr('explosions.sortLabel')}</label>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="importe">{tr('explosions.sortByImporte')}</option>
              <option value="descripcion">{tr('explosions.sortByDescripcion')}</option>
            </select>
          </div>
        </div>}

        {tab === 'auxiliares' && <p className="muted">{tr('explosions.auxiliariesNote')}</p>}

        {tab === 'labor'
          ? <LaborTable rows={filtered} tr={tr} expanded={expanded} toggleExpand={toggleExpand} />
          : <ResourceTable rows={filtered} tab={tab} tr={tr} expanded={expanded} toggleExpand={toggleExpand} />}

        <div className="form-actions" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <b>{tr('explosions.totalLabel')}: {money(total)}</b>
          <span className="muted">{tr('explosions.rowCount', { count: filtered.length })}</span>
          <button type="button" className="soft" disabled={exportState?.status === 'generating'} onClick={() => runExport('PDF')}>
            {exportState?.format === 'PDF' && exportState?.status === 'generating' ? tr('explosions.generatingPdf') : tr('explosions.exportPdf')}
          </button>
          <button type="button" className="soft" disabled={exportState?.status === 'generating'} onClick={() => runExport('XLSX')}>
            {exportState?.format === 'XLSX' && exportState?.status === 'generating' ? tr('explosions.generatingExcel') : tr('explosions.exportExcel')}
          </button>
          {exportState?.status === 'error' && <small style={{ color: 'var(--danger)' }}>{exportState.message}</small>}
        </div>
      </>}
    </div>
  </div>;
}
