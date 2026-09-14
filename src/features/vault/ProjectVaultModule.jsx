/* Project Vault / Expediente del Proyecto (Fase F). Vista AGREGADORA --
   nunca copia datos, solo lee y presenta lo que ya calculo el servidor en
   un unico round-trip (/api/project-vault, ver
   server/api-lib/_route-project-vault.mjs). Prioriza resumen ejecutivo,
   tarjetas KPI, salud, riesgos y actividad sobre tablas (seccion 15 del
   pedido) -- las tablas completas viven en sus modulos existentes
   (Catálogo, APU, Presupuesto, Control Presupuestal), aqui solo se navega
   hacia ellos. */
import { useState } from 'react';
import { PageHead, EmptyState } from '../../components/ui/PageElements.jsx';
import { useProjectVault } from './projectVaultCloud.js';
import { money } from '../../lib/apuExport.js';
import { exportProjectVaultPDF, exportProjectVaultExcel } from '../../lib/projectVaultExport.js';

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

const DIMENSION_LABEL = {
  costos: 'Costos', avance: 'Avance', riesgo: 'Riesgo', datos: 'Datos',
  confianzaPrecios: 'Confianza de precios', cambios: 'Cambios', documentacion: 'Documentación', forecast: 'Forecast'
};

export function ProjectVaultModule({ user, activeProjectId, activeProject, onNeedProject, setModule }){
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

      {/* Alertas consolidadas */}
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
    </section>
  );
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
