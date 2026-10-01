/* F5 -- CENTRO DE REPORTES del proyecto. Muestra, ANTES de exportar, que
   reportes tienen datos suficientes, cuales saldrian como BORRADOR
   (generadores desactualizados) y las cifras clave que el documento va a
   contener (las mismas del modelo que se renderiza a PDF/XLSX). Ningun
   calculo vive aqui: todo sale de reportModels.js (motores F2-F4). */
import { useCallback, useEffect, useState } from 'react';
import { PageHead, EmptyState } from '../../components/ui/PageElements.jsx';
import { loadReportData, buildAllReportModels, generateReport } from '../../lib/reports/reportExports.js';
import { REPORT_TYPE, REPORT_LABEL, DRAFT_MARK, makeMoney, fmtQty } from '../../lib/reports/reportModels.js';

const DESCRIPTION = {
  PRESUPUESTO: 'Portada, resumen (costo directo, indirectos, financiamiento, utilidad, cargos, IVA) y detalle por capítulo con subtotales.',
  GENERADORES: 'Operación de cada elemento del plano, deducciones, neto y total por concepto (trazable al concepto).',
  APU: 'Análisis de precios unitarios de los conceptos del presupuesto (exportador profesional existente).',
  EXPLOSION: 'Materiales, mano de obra, maquinaria/equipo y auxiliares con trazabilidad insumo → APU → concepto → capítulo.',
  CATALOGO: 'Clave, descripción, unidad, cantidad, P.U. e importe en el orden del presupuesto.',
  RESUMEN: 'Indicadores comprobables del proyecto (sin IA): costo, capítulos principales, estado de cuantificación y generadores.',
  MEMORIA: 'Espacios, fuente de cantidad (CAD/generadores o captura manual) y procedencia de dimensiones (incluye DEFAULT).'
};
const SOURCE = {
  PRESUPUESTO: 'Presupuesto (motor F2)', GENERADORES: 'Generadores persistidos (F3)', APU: 'APUs del proyecto + cantidad del concepto (F2)',
  EXPLOSION: 'Explosión con alcance presupuesto (F2)', CATALOGO: 'Presupuesto (F2)', RESUMEN: 'Presupuesto, Generadores y Levantamientos', MEMORIA: 'Levantamientos + planos CAD (F4) y Generadores (F3)'
};
const ORDER = [REPORT_TYPE.PRESUPUESTO, REPORT_TYPE.GENERADORES, REPORT_TYPE.APU, REPORT_TYPE.EXPLOSION, REPORT_TYPE.CATALOGO, REPORT_TYPE.RESUMEN, REPORT_TYPE.MEMORIA];

function keyFigures(type, m, money){
  switch(type){
    case 'PRESUPUESTO': return m.budget.empty ? null : `${m.budget.counts.concepts} concepto(s) · ${m.budget.counts.chapters} capítulo(s) · ${money(m.budget.summary.subtotal)}${m.budget.summary.ivaAplica ? ' antes de IVA' : ''}`;
    case 'GENERADORES': return m.generators.empty ? null : `${m.generators.concepts.length} concepto(s) · ${m.generators.concepts.reduce((a, c) => a + c.elements.length, 0)} elemento(s)`;
    case 'APU': return m.apuInput.empty ? null : `${m.apuInput.apus.length} APU(s) vinculados a conceptos`;
    case 'EXPLOSION': return m.explosion.empty ? null : `${m.explosion.sections.reduce((a, s) => a + s.rows.length, 0)} insumo(s) · ${money(m.explosion.grandTotal)}`;
    case 'CATALOGO': return m.catalog.empty ? null : `${m.catalog.rows.length} concepto(s) · ${money(m.catalog.total)}`;
    case 'RESUMEN': return m.summary.empty ? null : `Actualizado: ${m.summary.updatedAt || 'sin registro'}`;
    case 'MEMORIA': return m.memory.empty ? null : `${m.memory.surveys.length} levantamiento(s) · ${m.memory.generators.concepts.length} concepto(s) con generadores`;
    default: return null;
  }
}

export function ReportCenter({ user, activeProjectId, activeProject, onNeedProject, onShowLegacy }){
  const [state, setState] = useState({ status: 'idle', models: null, error: null });
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    if(!activeProjectId){ setState({ status: 'idle', models: null, error: null }); return; }
    setState(s => ({ ...s, status: 'loading', error: null }));
    try{
      const data = await loadReportData(activeProjectId);
      setState({ status: 'ready', models: buildAllReportModels(data, { generatedBy: user?.email || null }), error: null });
    }catch(err){ setState({ status: 'error', models: null, error: err.message }); }
  }, [activeProjectId, user?.email]);
  useEffect(() => { load(); }, [load]);

  const exportIt = async (type, format) => {
    setBusy(`${type}:${format}`);
    try{
      const r = await generateReport(state.models, type, format);
      window.zoemecNotify?.(`${REPORT_LABEL[type]} (${format}) generado${r.draft ? ' como BORRADOR' : ''}: ${r.fileName}`, r.draft ? 'warning' : 'success');
    }catch(err){ window.zoemecNotify?.(err.message, 'error'); }
    finally{ setBusy(null); }
  };

  const head = <PageHead kicker="Reportes" title="Reportes del proyecto" desc="Documentos profesionales generados exclusivamente con los datos autoritativos del proyecto: pantalla, PDF y XLSX muestran las mismas cifras."
    action={<div className="visual-actions">{activeProjectId && <button className="soft" disabled={state.status === 'loading'} onClick={load}>{state.status === 'loading' ? 'Cargando…' : 'Actualizar datos'}</button>}{onShowLegacy && <button className="soft" onClick={onShowLegacy} title="Tablero anterior; se retira en F6">Tablero anterior</button>}</div>} />;

  if(!activeProjectId) return <section>{head}<div className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><p className="muted" style={{ margin: 0 }}>Selecciona un proyecto para generar sus reportes.</p><button onClick={onNeedProject}>Crear/elegir proyecto</button></div></section>;
  if(state.status === 'error') return <section>{head}<div className="panel"><p style={{ color: 'var(--danger)' }}>{state.error}</p><button className="soft" onClick={load}>Reintentar</button></div></section>;
  if(!state.models) return <section>{head}<div className="panel"><p className="muted">Cargando datos del proyecto…</p></div></section>;

  const m = state.models, money = makeMoney(m.header.moneda);
  const staleCount = m.budget.stale.length;
  return <section className="report-center">
    {head}
    <div className="panel" style={{ marginBottom: 14, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
      <div><small className="muted">Proyecto</small><div><b>{m.header.proyecto}</b></div></div>
      <div><small className="muted">Cliente</small><div>{m.header.cliente}</div></div>
      <div><small className="muted">Ubicación</small><div>{m.header.ubicacion}</div></div>
      <div><small className="muted">Moneda</small><div>{m.header.moneda}</div></div>
      <div><small className="muted">Presupuesto</small><div>{m.header.presupuestoVersion ? `${m.header.presupuestoVersion}${m.header.baselineVersion ? ` · baseline ${m.header.baselineVersion}` : ''}` : 'Vista vigente (sin versión guardada)'}</div></div>
    </div>
    {staleCount > 0 && <div className="panel" role="alert" style={{ marginBottom: 14, borderColor: '#E7B7AE', background: '#FDECEA', color: '#8E2A1E' }}>
      <b>Existen cantidades pendientes de revisión</b>: {staleCount} concepto(s) con generadores desactualizados ({m.budget.stale.map(s => `${s.clave || s.concept}: vigente ${fmtQty(s.qty)} → geometría ${s.pending.map(p => fmtQty(p.toQty)).join('/')} ${s.unit}`).join(' · ')}).
      Presupuesto, Catálogo, Explosión, Generadores, Resumen y Memoria se exportarán con la marca <b>{DRAFT_MARK}</b> hasta que confirmes los generadores en el plano.
    </div>}
    <div className="report-grid-f5" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 14 }}>
      {ORDER.map(type => {
        const av = m.availability[type];
        const figures = keyFigures(type, m, money);
        return <div key={type} className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>{REPORT_LABEL[type]}</h3>
            {!av.available ? <span className="zi-badge zi-badge-info">Sin datos</span> : av.draft ? <span className="zi-badge zi-badge-high">Borrador</span> : <span className="zi-badge zi-badge-medium">Disponible</span>}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: '.84rem' }}>{DESCRIPTION[type]}</p>
          <small className="muted">Fuente: {SOURCE[type]}</small>
          {av.available ? <b style={{ fontSize: '.9rem' }}>{figures}</b> : <EmptyState title="Sin datos suficientes" text={av.reason} />}
          {av.available && av.draft && <small style={{ color: '#8E2A1E' }}>Se exportará como BORRADOR — cantidades pendientes de revisión.</small>}
          <div className="visual-actions" style={{ marginTop: 'auto' }}>
            {av.formats.map(f => <button key={f} className={f === 'PDF' ? '' : 'soft'} disabled={!av.available || Boolean(busy)} title={!av.available ? av.reason : undefined} onClick={() => exportIt(type, f)}>{busy === `${type}:${f}` ? 'Generando…' : f}</button>)}
          </div>
        </div>;
      })}
    </div>
  </section>;
}

export default ReportCenter;
