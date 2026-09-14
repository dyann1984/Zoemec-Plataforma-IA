/* Project Vault / Expediente del Proyecto (Fase F + Fase G). Vista
   AGREGADORA -- nunca copia datos, solo lee y presenta lo que ya calculo
   el servidor en un unico round-trip (/api/project-vault). Prioriza
   resumen ejecutivo, tarjetas KPI, salud, riesgos y actividad sobre
   tablas -- las tablas completas viven en sus modulos existentes.

   Fase G agrega 2 tabs nuevos sobre la misma base: Sentinel (motor de
   vigilancia proactiva -- alertas PERSISTENTES con estado/historial, ver
   sentinelCloud.js) y Activo (ciclo de vida del activo una vez el
   proyecto se entrega, ver assetCloud.js). El panel "Atencion requerida"
   de Resumen (Fase F, ephemero, recalculado en cada carga) y el
   dashboard de Sentinel (Fase G, persistente, con estados/dedup) son
   COMPLEMENTARIOS, no duplicados: uno es una foto instantanea, el otro es
   el registro con seguimiento real. */
import { useState } from 'react';
import { PageHead, EmptyState } from '../../components/ui/PageElements.jsx';
import { useProjectVault } from './projectVaultCloud.js';
import { useSentinel } from './sentinelCloud.js';
import { useAsset } from './assetCloud.js';
import { money } from '../../lib/apuExport.js';
import { exportProjectVaultPDF, exportProjectVaultExcel } from '../../lib/projectVaultExport.js';
import { ASSET_COMPONENT_TYPE } from '../../domain/assetComponentSchema.js';

function pct(n){ return n == null ? '—' : `${Number(n).toFixed(1)}%`; }
function safeMoney(n){ return n == null ? 'Sin información' : money(n); }
function safeText(v){ return v == null || v === '' ? 'Sin información' : v; }

const HEALTH_BADGE_CLASS = { SALUDABLE: 'zi-badge-medium', ATENCION: 'zi-badge-high', RIESGO: 'zi-badge-high', CRITICO: 'zi-badge-critical' };
function HealthBadge({ level, label }){
  return <span className={`zi-badge ${HEALTH_BADGE_CLASS[level] || 'zi-badge-info'}`}>{label}</span>;
}
const PRIORITY_BADGE_CLASS = { CRITICA: 'zi-badge-critical', ALTA: 'zi-badge-high', MEDIA: 'zi-badge-medium', BAJA: 'zi-badge-info' };
function PriorityBadge({ priority }){
  return <span className={`zi-badge ${PRIORITY_BADGE_CLASS[priority] || 'zi-badge-info'}`}>{priority}</span>;
}
const SECTION_STATUS_CLASS = { CON_DATOS: 'zi-badge-medium', SIN_DATOS: 'zi-badge-info', BASELINE_APROBADO: 'zi-badge-medium', SIN_BASELINE: 'zi-badge-high', CRITICO: 'zi-badge-critical', ATENCION: 'zi-badge-high', SALUDABLE: 'zi-badge-medium' };
function SectionStatusBadge({ status }){
  return <span className={`zi-badge ${SECTION_STATUS_CLASS[status] || 'zi-badge-info'}`}>{status.replace(/_/g, ' ')}</span>;
}
const ALERT_STATUS_CLASS = { NUEVA: 'zi-badge-critical', EN_REVISION: 'zi-badge-high', RESUELTA: 'zi-badge-medium', DESCARTADA: 'zi-badge-info' };
function AlertStatusBadge({ status }){
  return <span className={`zi-badge ${ALERT_STATUS_CLASS[status] || 'zi-badge-info'}`}>{status}</span>;
}
const WARRANTY_BADGE_CLASS = { VIGENTE: 'zi-badge-medium', POR_VENCER: 'zi-badge-high', VENCIDA: 'zi-badge-critical', SIN_DATOS: 'zi-badge-info' };
function WarrantyBadge({ status }){
  return <span className={`zi-badge ${WARRANTY_BADGE_CLASS[status] || 'zi-badge-info'}`}>{(status || 'SIN_DATOS').replace(/_/g, ' ')}</span>;
}
function KpiCard({ label, value, sub }){
  return <div className="info-card"><small>{label}</small><b>{value}</b>{sub && <span>{sub}</span>}</div>;
}

// Navegacion "Ver detalle" solo hacia modulos que existen hoy de forma
// inequivoca -- secciones sin un modulo dedicado (Documentos, Riesgos,
// Auditoria, Modelos 3D, Evidencia) no ofrecen boton para no prometer una
// pantalla que no existe.
const SECTION_TARGET_MODULE = {
  planos: 'visual', cuantificacion: 'catalogo', catalogo: 'catalogo', apu: 'apu',
  presupuesto: 'presupuestos', explosiones: 'presupuestos',
  controlPresupuestal: 'control-presupuestal', ordenesCambio: 'control-presupuestal',
  avance: 'control-presupuestal', estimaciones: 'control-presupuestal', pagos: 'control-presupuestal'
};
// Mismo mapeo que arriba, para el actionRoute.module de cada alerta de Sentinel (seccion 8: navegacion directa).
const ALERT_TARGET_MODULE = { ...SECTION_TARGET_MODULE, vault: 'vault' };

const DIMENSION_LABEL = {
  costos: 'Costos', avance: 'Avance', riesgo: 'Riesgo', datos: 'Datos',
  confianzaPrecios: 'Confianza de precios', cambios: 'Cambios', documentacion: 'Documentación', forecast: 'Forecast'
};

const SENTINEL_FILTER_CATEGORIES = [
  ['costo', 'Costo', ['PRESUPUESTO_POR_AGOTARSE', 'FORECAST_SOBRE_PRESUPUESTO', 'COMPROMISO_EXCESIVO', 'SOBRECONSUMO_CONCEPTO']],
  ['avance', 'Avance', ['AVANCE_FISICO_RETRASADO', 'AVANCE_FINANCIERO_DESALINEADO']],
  ['riesgo', 'Riesgo', ['CAMBIO_PROJECT_HEALTH', 'DATO_CRITICO_SIN_CONFIRMAR']],
  ['precios', 'Precios', ['PRECIO_ANOMALO', 'CONFIANZA_PRECIO_BAJA']],
  ['documentacion', 'Documentación', ['DOCUMENTO_FALTANTE', 'DOCUMENTACION_GARANTIA_FALTANTE']],
  ['pagos', 'Pagos', ['ESTIMACION_PENDIENTE', 'PAGO_PENDIENTE']],
  ['cambios', 'Cambios', ['ORDEN_CAMBIO_PENDIENTE', 'GARANTIA_POR_VENCER', 'GARANTIA_VENCIDA']]
];

const TABS = [['resumen', 'Resumen'], ['sentinel', 'Sentinel'], ['activo', 'Activo']];

export function ProjectVaultModule({ user, activeProjectId, activeProject, onNeedProject, setModule, onNavigateToPlano }){
  const [tab, setTab] = useState('resumen');
  const { vault, loading, error, generateDnaVersion, generatingDna } = useProjectVault(user, activeProjectId);
  const [exporting, setExporting] = useState(false);

  if(!activeProjectId){
    return <section>
      <PageHead kicker="Project Vault" title="Expediente del Proyecto" desc="Vista central de planos, catálogo, APU, presupuesto, control presupuestal, riesgos y auditoría." />
      <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '14px 18px' }}>
        <p className="muted" style={{ margin: 0 }}>Necesitas un proyecto activo para ver su expediente.</p>
        <button onClick={onNeedProject}>Crear/elegir proyecto</button>
      </div>
    </section>;
  }

  if(loading && !vault) return <section><PageHead kicker="Project Vault" title={activeProject?.name || 'Expediente del Proyecto'} desc="Cargando…" /><p className="muted">Cargando…</p></section>;
  if(error) return <section><PageHead kicker="Project Vault" title={activeProject?.name || 'Expediente del Proyecto'} desc="" /><div className="panel"><p className="muted">{error}</p></div></section>;
  if(!vault) return null;

  const { project, resumenEjecutivo: r, health, dataQuality, alerts, timeline, baselineComparison: bc, sections, constructionDna } = vault;

  const handleExportPdf = () => { exportProjectVaultPDF({ vault, company: { name: 'ZOEMEC' } }); };
  const handleExportExcel = async () => { setExporting(true); try{ await exportProjectVaultExcel({ vault }); } finally { setExporting(false); } };

  return (
    <section>
      <PageHead
        kicker="Project Vault"
        title={project.name || 'Expediente del Proyecto'}
        desc="Vista central de planos, catálogo, APU, presupuesto, control presupuestal, riesgos y auditoría — sin duplicar ningún dato."
        action={<div style={{ display: 'flex', gap: 8 }}><button className="soft" onClick={handleExportPdf}>PDF</button><button className="soft" disabled={exporting} onClick={handleExportExcel}>{exporting ? 'Generando…' : 'Excel'}</button></div>}
      />

      <div className="visual-modes" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {tab === 'resumen' && (
        <ResumenTab
          project={project} r={r} health={health} dataQuality={dataQuality} alerts={alerts} timeline={timeline}
          bc={bc} constructionDna={constructionDna} generateDnaVersion={generateDnaVersion} generatingDna={generatingDna}
          sections={sections} setModule={setModule}
        />
      )}
      {tab === 'sentinel' && <SentinelTab user={user} activeProjectId={activeProjectId} setModule={setModule} onNavigateToPlano={onNavigateToPlano} />}
      {tab === 'activo' && <ActivoTab user={user} activeProjectId={activeProjectId} project={project} constructionDna={constructionDna} />}
    </section>
  );
}

function ResumenTab({ project, r, health, dataQuality, alerts, timeline, bc, constructionDna, generateDnaVersion, generatingDna, sections, setModule }){
  return <>
    {/* Resumen ejecutivo */}
    <div className="panel" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div><small className="muted">Cliente</small><div>{safeText(r.client)}</div></div>
        <div><small className="muted">Ubicación</small><div>{safeText(r.ubicacion)}</div></div>
        <div><small className="muted">Etapa</small><div>{safeText(r.etapa)}</div></div>
        <div><small className="muted">Tipo de obra</small><div>{safeText(r.tipoDeObra)}</div></div>
        <div><small className="muted">Superficie</small><div>{safeText(r.superficie)}</div></div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 700 }}>{health.score}/100</span>
          <HealthBadge level={health.level} label={health.label} />
        </div>
      </div>
      <div className="info-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <KpiCard label="Baseline" value={safeMoney(r.presupuestoBaseline)} />
        <KpiCard label="Vigente" value={safeMoney(r.presupuestoVigente)} />
        <KpiCard label="Ejecutado" value={safeMoney(r.ejecutado)} sub={pct(r.avanceFisicoPct)} />
        <KpiCard label="Pagado" value={safeMoney(r.pagado)} sub={pct(r.avanceFinancieroPct)} />
        <KpiCard label="Forecast (EAC)" value={safeMoney(r.forecast)} />
        <KpiCard label="Confidence" value={r.confidence ? `${r.confidence.averageScore ?? '—'}` : 'Sin información'} />
        <KpiCard label="Bid Risk" value={r.bidRisk ? `${r.bidRisk.critical + r.bidRisk.high} en riesgo alto` : 'Sin información'} />
        <KpiCard label="Bid Readiness" value={r.bidReadiness?.score != null ? `${r.bidReadiness.score}/100` : 'Sin información'} sub={r.bidReadiness?.status} />
      </div>
    </div>

    {/* Project Health explicable */}
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="module-subhead"><h2 style={{ margin: 0 }}>Project Health</h2><HealthBadge level={health.level} label={health.label} /></div>
      <p className="muted">{health.description}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
        {Object.entries(health.dimensions).map(([key, d]) => (
          <div key={key} className="info-card">
            <small>{DIMENSION_LABEL[key] || key} <span className="muted">(peso {d.weight})</span></small>
            <b>{d.score}{d.insufficientData && <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> · sin datos</span>}</b>
          </div>
        ))}
      </div>
      {health.drivers?.length > 0 && <>
        <b>Qué está bajando el score</b>
        <ul>{health.drivers.map(d => <li key={d.key}>{DIMENSION_LABEL[d.key] || d.key}{d.reasons?.length ? `: ${d.reasons.join(' ')}` : ''}</li>)}</ul>
      </>}
    </div>

    {/* Calidad de datos */}
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="module-subhead"><h2 style={{ margin: 0 }}>Calidad de datos</h2><b>{dataQuality.overallPct}% completo</b></div>
      {dataQuality.missing.length > 0 && <p className="muted">Falta: {dataQuality.missing.join(', ')}.</p>}
    </div>

    {/* Alertas consolidadas (ephemero, ver Sentinel para el historial persistente) */}
    <div className="panel" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>Atención requerida</h2>
      {!alerts.length ? <p className="muted">Sin alertas — el proyecto está dentro de los parámetros esperados.</p> : (
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
          {alerts.map(a => <li key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><PriorityBadge priority={a.priority} /><span>{a.message}</span></li>)}
        </ul>
      )}
    </div>

    {/* Baseline vs Actual */}
    <div className="panel" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>Baseline vs. Actual</h2>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: bc.cantidadesModificadas.length ? 12 : 0 }}>
        <div><small className="muted">Baseline</small><div>{safeMoney(bc.presupuestoBase)}</div></div>
        <div><small className="muted">Vigente</small><div>{safeMoney(bc.presupuestoVigente)}</div></div>
        <div><small className="muted">Variación</small><div>{safeMoney(bc.variacion)} ({pct(bc.variacionPct)})</div></div>
        <div><small className="muted">Impacto en plazo</small><div>{bc.plazo.impactoTiempoDiasTotal != null ? `${bc.plazo.impactoTiempoDiasTotal} días` : 'Sin información'}</div></div>
      </div>
      {bc.cantidadesModificadas.length > 0 && (
        <div className="apu-table-scroll">
          <table className="budget-table">
            <thead><tr><th>Folio</th><th>Clave</th><th>Cantidad anterior</th><th>Cantidad nueva</th></tr></thead>
            <tbody>{bc.cantidadesModificadas.map((c, i) => <tr key={i}><td>{c.folio || '—'}</td><td>{c.clave || '—'}</td><td>{c.cantidadAnterior}</td><td>{c.cantidadNueva}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>

    {/* Construction DNA */}
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="module-subhead">
        <h2 style={{ margin: 0 }}>Construction DNA</h2>
        <button className="soft" disabled={generatingDna} onClick={() => generateDnaVersion('Generado desde Project Vault')}>{generatingDna ? 'Generando…' : (constructionDna ? 'Generar nueva versión' : 'Generar Construction DNA')}</button>
      </div>
      {!constructionDna
        ? <p className="muted">Sin Construction DNA generado todavía.</p>
        : <>
          <p><span className="zi-badge zi-badge-medium">Versión {constructionDna.currentVersion}</span></p>
          <ConstructionDnaSummary dna={constructionDna.snapshot} />
        </>}
    </div>

    {/* Timeline */}
    <div className="panel" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>Actividad</h2>
      {!timeline.length ? <p className="muted">Sin actividad registrada todavía.</p> : (
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, listStyle: 'none', padding: 0, margin: 0 }}>
          {timeline.slice(0, 20).map((t, i) => (
            <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <small className="muted" style={{ minWidth: 130 }}>{t.at ? new Date(t.at).toLocaleString('es-MX') : ''}</small>
              <span>{t.label}</span>
              {t.actor && <small className="muted">· {t.actor}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>

    {/* Secciones del expediente */}
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Secciones del expediente</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {sections.map(s => (
          <div key={s.key} className="info-card">
            <small>{s.label}</small>
            <b>{s.count} registro{s.count === 1 ? '' : 's'}</b>
            <span><SectionStatusBadge status={s.status} />{s.alertsCount > 0 && <span className="zi-badge zi-badge-high" style={{ marginLeft: 6 }}>{s.alertsCount} alerta{s.alertsCount === 1 ? '' : 's'}</span>}</span>
            {s.lastUpdatedAt && <span className="muted" style={{ fontSize: 11 }}>Actualizado: {new Date(s.lastUpdatedAt).toLocaleDateString('es-MX')}{s.lastUpdatedBy ? ` · ${s.lastUpdatedBy}` : ''}</span>}
            {s.note && <span className="muted" style={{ fontSize: 11 }}>{s.note}</span>}
            {SECTION_TARGET_MODULE[s.key] && <button className="soft" style={{ marginTop: 6 }} onClick={() => setModule?.(SECTION_TARGET_MODULE[s.key])}>Ver detalle</button>}
          </div>
        ))}
      </div>
    </div>
  </>;
}

function ConstructionDnaSummary({ dna }){
  if(!dna) return null;
  const sistemas = ['cimentacion', 'estructura', 'muros', 'cubiertas', 'acabados'].filter(k => dna.sistemaConstructivo?.[k]?.value);
  const familias = dna.costos?.familiasPrincipales?.value || [];
  const materiales = dna.recursos?.materialesPrincipales?.value || [];
  const hayAlgo = sistemas.length || familias.length || materiales.length;
  if(!hayAlgo) return <EmptyState text="Sin evidencia suficiente todavía para derivar el DNA de este proyecto." />;
  return <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
    {sistemas.length > 0 && <div><small className="muted">Sistema constructivo detectado</small><div>{sistemas.join(', ')}</div></div>}
    {familias.length > 0 && <div><small className="muted">Familias de costo principales</small><div>{familias.map(f => f.label).join(', ')}</div></div>}
    {materiales.length > 0 && <div><small className="muted">Materiales principales</small><div>{materiales.map(m => m.descripcion).join(', ')}</div></div>}
  </div>;
}

/* Sentinel (Fase G, secciones 7-8): dashboard de alertas PERSISTENTES con
   estado/historial -- "Analizar ahora" es la unica accion que recalcula
   (nunca se dispara solo, ver sentinelCloud.js). Cada alerta explica que
   paso/por que importa/evidencia/impacto/accion recomendada y navega
   directo al modulo correspondiente (seccion 8: nunca una alerta sin ruta). */
function SentinelTab({ user, activeProjectId, setModule, onNavigateToPlano }){
  const { alerts, healthTrend, loading, evaluating, evaluate, setStatus } = useSentinel(user, activeProjectId);
  const [filter, setFilter] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const counts = {
    criticas: alerts.filter(a => a.severity === 'CRITICA' && (a.status === 'NUEVA' || a.status === 'EN_REVISION')).length,
    altas: alerts.filter(a => a.severity === 'ALTA' && (a.status === 'NUEVA' || a.status === 'EN_REVISION')).length,
    nuevas: alerts.filter(a => a.status === 'NUEVA').length,
    abiertas: alerts.filter(a => a.status === 'NUEVA' || a.status === 'EN_REVISION').length,
    resueltas: alerts.filter(a => a.status === 'RESUELTA').length
  };

  const filterTypes = filter ? SENTINEL_FILTER_CATEGORIES.find(c => c[0] === filter)?.[2] || [] : null;
  const visibleAlerts = (filterTypes ? alerts.filter(a => filterTypes.includes(a.alertType)) : alerts)
    .slice().sort((x, y) => (x.status === y.status ? 0 : x.status === 'NUEVA' ? -1 : 1));

  const navigateFromAlert = (route) => {
    if(!route?.module) return;
    if(route.module === 'visual' && onNavigateToPlano) { onNavigateToPlano({ kind: 'plano-takeoff-vector' }); return; }
    setModule?.(ALERT_TARGET_MODULE[route.module] || route.module);
  };

  return <>
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="module-subhead">
        <h2 style={{ margin: 0 }}>Sentinel</h2>
        <button className="soft" disabled={evaluating} onClick={evaluate}>{evaluating ? 'Analizando…' : 'Analizar ahora'}</button>
      </div>
      <div className="info-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
        <KpiCard label="Críticas" value={counts.criticas} />
        <KpiCard label="Altas" value={counts.altas} />
        <KpiCard label="Nuevas" value={counts.nuevas} />
        <KpiCard label="Abiertas" value={counts.abiertas} />
        <KpiCard label="Resueltas" value={counts.resueltas} />
      </div>
      {healthTrend.scoresLabel && <p className="muted" style={{ marginTop: 10 }}>Tendencia de Project Health: {healthTrend.scoresLabel}</p>}
    </div>

    <div className="panel" style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="muted">Filtrar por:</span>
      <button className={!filter ? 'soft active' : 'soft'} onClick={() => setFilter(null)}>Todas</button>
      {SENTINEL_FILTER_CATEGORIES.map(([key, label]) => <button key={key} className={filter === key ? 'soft active' : 'soft'} onClick={() => setFilter(key)}>{label}</button>)}
    </div>

    <div className="panel">
      {loading && !alerts.length ? <p className="muted">Cargando…</p> : null}
      {!loading && !visibleAlerts.length
        ? <EmptyState icon="alerta" title="Sin alertas" text="Presiona “Analizar ahora” para que Sentinel evalúe el proyecto con los datos más recientes." />
        : <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, listStyle: 'none', padding: 0, margin: 0 }}>
          {visibleAlerts.map(a => (
            <li key={a.id} className="panel" style={{ padding: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <PriorityBadgeForSeverity severity={a.severity} />
                <AlertStatusBadge status={a.status} />
                <b style={{ flex: 1 }}>{a.title}</b>
                <button className="soft" onClick={() => setExpandedId(id => id === a.id ? null : a.id)}>{expandedId === a.id ? 'Ocultar' : 'Detalle'}</button>
              </div>
              <p style={{ margin: '6px 0 0' }}>{a.message}</p>
              {expandedId === a.id && <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {a.why && <p className="muted" style={{ margin: 0 }}><b>Por qué importa:</b> {a.why}</p>}
                {a.evidence && Object.keys(a.evidence).length > 0 && <p className="muted" style={{ margin: 0 }}><b>Evidencia:</b> {Object.entries(a.evidence).map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toFixed(2) : v}`).join(' · ')}</p>}
                {a.impactoEstimado != null && <p className="muted" style={{ margin: 0 }}><b>Impacto estimado:</b> {money(a.impactoEstimado)}</p>}
                {a.accionRecomendada && <p className="muted" style={{ margin: 0 }}><b>Acción recomendada:</b> {a.accionRecomendada}</p>}
                <p className="muted" style={{ margin: 0, fontSize: 11 }}>Detectada: {new Date(a.firstDetectedAt).toLocaleString('es-MX')} · Vista por última vez: {new Date(a.lastSeenAt).toLocaleString('es-MX')}</p>
                {a.resolution && <p className="muted" style={{ margin: 0, fontSize: 11 }}>Resolución: {a.resolution} {a.resolvedBy ? `(${a.resolvedBy})` : ''}</p>}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {a.actionRoute?.module && <button className="soft" onClick={() => navigateFromAlert(a.actionRoute)}>Ir a {a.actionRoute.module}</button>}
                  {a.status === 'NUEVA' && <button className="soft" onClick={() => setStatus(a.id, 'EN_REVISION')}>Marcar en revisión</button>}
                  {(a.status === 'NUEVA' || a.status === 'EN_REVISION') && <button className="soft" onClick={() => setStatus(a.id, 'RESUELTA', 'Resuelta manualmente desde el Vault.')}>Resolver</button>}
                  {(a.status === 'NUEVA' || a.status === 'EN_REVISION') && <button className="soft" onClick={() => setStatus(a.id, 'DESCARTADA', 'Descartada manualmente desde el Vault.')}>Descartar</button>}
                </div>
              </div>}
            </li>
          ))}
        </ul>}
    </div>
  </>;
}
function PriorityBadgeForSeverity({ severity }){ return <span className={`zi-badge ${PRIORITY_BADGE_CLASS[severity === 'CRITICA' ? 'CRITICA' : severity === 'ALTA' ? 'ALTA' : severity === 'MEDIA' ? 'MEDIA' : severity === 'BAJA' ? 'BAJA' : 'BAJA'] || 'zi-badge-info'}`}>{severity}</span>; }

/* Activo (Fase G, secciones 11-17): antes de crear el activo, solo ofrece
   el boton de entrega; despues, muestra componentes/garantias/CapEx/plan
   de renovacion -- todo calculado por el servidor (assetCloud.js), nunca
   recalculado aqui. */
function ActivoTab({ user, activeProjectId, project, constructionDna }){
  const { asset, components, capex, renewalPlan, loading, createFromProject, addComponent } = useAsset(user, activeProjectId);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ tipo: ASSET_COMPONENT_TYPE.ESTRUCTURA, nombre: '', fabricante: '', modelo: '', proveedor: '', fechaInstalacion: '', garantiaMeses: '', vidaUtilAnios: '', costo: '', documentoGarantiaUrl: '' });
  const [saving, setSaving] = useState(false);

  if(loading && !asset) return <p className="muted">Cargando…</p>;

  if(!asset){
    return <div className="panel">
      <EmptyState icon="edificio" title="Este proyecto todavía no es un activo" text="Cuando el proyecto se entregue/termine, conviértelo en un Activo para dar seguimiento a sus componentes, garantías y CapEx futuro." />
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <button disabled={creating} onClick={async () => { setCreating(true); try{ await createFromProject({ nombre: project?.name, ubicacion: project?.ubicacion }); } finally { setCreating(false); } }}>
          {creating ? 'Creando…' : 'Marcar como entregado y crear Activo'}
        </button>
      </div>
    </div>;
  }

  const submitComponent = async () => {
    setSaving(true);
    try{
      await addComponent({
        tipo: draft.tipo, nombre: draft.nombre, fabricante: draft.fabricante || null, modelo: draft.modelo || null,
        proveedor: draft.proveedor || null, fechaInstalacion: draft.fechaInstalacion ? new Date(draft.fechaInstalacion).toISOString() : null,
        garantiaMeses: draft.garantiaMeses ? Number(draft.garantiaMeses) : null, vidaUtilAnios: draft.vidaUtilAnios ? Number(draft.vidaUtilAnios) : null,
        costo: draft.costo ? Number(draft.costo) : null, documentoGarantiaUrl: draft.documentoGarantiaUrl || null,
        trazabilidad: { constructionDnaVersion: constructionDna?.currentVersion || null }
      });
      setDraft({ tipo: ASSET_COMPONENT_TYPE.ESTRUCTURA, nombre: '', fabricante: '', modelo: '', proveedor: '', fechaInstalacion: '', garantiaMeses: '', vidaUtilAnios: '', costo: '', documentoGarantiaUrl: '' });
      setShowForm(false);
    } finally { setSaving(false); }
  };

  return <>
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="module-subhead"><h2 style={{ margin: 0 }}>{asset.nombre}</h2><span className="zi-badge zi-badge-medium">{asset.status}</span></div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div><small className="muted">Ubicación</small><div>{safeText(asset.ubicacion)}</div></div>
        <div><small className="muted">Fecha de entrega</small><div>{asset.fechaEntrega ? new Date(asset.fechaEntrega).toLocaleDateString('es-MX') : 'Sin información'}</div></div>
        <div><small className="muted">Superficie</small><div>{safeText(asset.superficie)}</div></div>
        <div><small className="muted">Construction DNA</small><div>{asset.constructionDnaVersion || 'Sin información'}</div></div>
      </div>
    </div>

    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="module-subhead"><h2 style={{ margin: 0 }}>Componentes / Sistemas</h2><button className="soft" onClick={() => setShowForm(v => !v)}>{showForm ? 'Cancelar' : '+ Agregar componente'}</button></div>
      {showForm && <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="nf"><label>Tipo</label><select value={draft.tipo} onChange={e => setDraft({ ...draft, tipo: e.target.value })}>{Object.values(ASSET_COMPONENT_TYPE).map(t => <option key={t} value={t}>{t}</option>)}</select></div>
        <div className="nf wide"><label>Nombre</label><input value={draft.nombre} onChange={e => setDraft({ ...draft, nombre: e.target.value })} placeholder="Ej. Aire acondicionado central" /></div>
        <div className="nf"><label>Fabricante</label><input value={draft.fabricante} onChange={e => setDraft({ ...draft, fabricante: e.target.value })} /></div>
        <div className="nf"><label>Modelo</label><input value={draft.modelo} onChange={e => setDraft({ ...draft, modelo: e.target.value })} /></div>
        <div className="nf"><label>Proveedor</label><input value={draft.proveedor} onChange={e => setDraft({ ...draft, proveedor: e.target.value })} /></div>
        <div className="nf"><label>Fecha de instalación</label><input type="date" value={draft.fechaInstalacion} onChange={e => setDraft({ ...draft, fechaInstalacion: e.target.value })} /></div>
        <div className="nf"><label>Garantía (meses)</label><input type="number" min="0" value={draft.garantiaMeses} onChange={e => setDraft({ ...draft, garantiaMeses: e.target.value })} /></div>
        <div className="nf"><label>Vida útil (años)</label><input type="number" min="0" value={draft.vidaUtilAnios} onChange={e => setDraft({ ...draft, vidaUtilAnios: e.target.value })} /></div>
        <div className="nf"><label>Costo</label><input type="number" min="0" value={draft.costo} onChange={e => setDraft({ ...draft, costo: e.target.value })} /></div>
        <div className="nf wide"><label>Documento de garantía (URL)</label><input value={draft.documentoGarantiaUrl} onChange={e => setDraft({ ...draft, documentoGarantiaUrl: e.target.value })} /></div>
        <div className="nf" style={{ alignSelf: 'flex-end' }}><button disabled={saving || !draft.nombre} onClick={submitComponent}>{saving ? 'Guardando…' : 'Registrar componente'}</button></div>
      </div>}
      <div className="apu-table-scroll">
        <table className="budget-table">
          <thead><tr><th>Tipo</th><th>Nombre</th><th>Fabricante</th><th>Garantía</th><th>Vida útil</th><th>Costo</th></tr></thead>
          <tbody>
            {components.map(c => (
              <tr key={c.id}>
                <td>{c.tipo}</td><td>{c.nombre}</td><td>{c.fabricante || '—'}</td>
                <td><WarrantyBadge status={c.warrantyStatus} />{c.diasRestantes != null && <small className="muted" style={{ marginLeft: 6 }}>{c.diasRestantes >= 0 ? `${c.diasRestantes} días` : `venció hace ${Math.abs(c.diasRestantes)} días`}</small>}</td>
                <td>{c.vidaUtilAnios != null ? `${c.vidaUtilAnios} años` : '—'}</td>
                <td>{c.costo != null ? money(c.costo) : '—'}</td>
              </tr>
            ))}
            {!components.length && <tr><td colSpan={6} className="muted">Sin componentes registrados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>

    <div className="panel" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>CapEx futuro</h2>
      <div className="apu-table-scroll">
        <table className="budget-table">
          <thead><tr><th>Componente</th><th>Año esperado de reemplazo</th><th>Costo actual</th><th>Costo proyectado</th><th>Prioridad</th></tr></thead>
          <tbody>
            {capex.map(c => (
              <tr key={c.componentId}>
                <td>{c.nombre}</td>
                <td>{c.confiable ? c.anioEsperadoReemplazo : <span className="muted">Sin proyección confiable</span>}</td>
                <td>{c.confiable ? money(c.costoActual) : '—'}</td>
                <td>{c.confiable ? money(c.costoProyectado) : '—'}</td>
                <td>{c.confiable ? <span className={`zi-badge ${c.prioridad === 'ALTA' ? 'zi-badge-critical' : c.prioridad === 'MEDIA' ? 'zi-badge-high' : 'zi-badge-info'}`}>{c.prioridad}</span> : '—'}</td>
              </tr>
            ))}
            {!capex.length && <tr><td colSpan={5} className="muted">Sin componentes para proyectar.</td></tr>}
          </tbody>
        </table>
      </div>
      {capex.some(c => !c.confiable) && <p className="muted" style={{ marginTop: 8 }}>{capex.filter(c => !c.confiable).map(c => c.reason).join(' ')}</p>}
    </div>

    {renewalPlan && <div className="panel">
      <h2 style={{ marginTop: 0 }}>Plan de renovación</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {renewalPlan.horizons.map(h => (
          <div key={h.key} className="info-card">
            <small>{h.label}</small>
            <b>{h.hasItems ? money(h.totalCost) : 'Sin datos suficientes'}</b>
            {h.hasItems && <span className="muted">{h.items.length} componente{h.items.length === 1 ? '' : 's'}</span>}
          </div>
        ))}
      </div>
    </div>}
  </>;
}
