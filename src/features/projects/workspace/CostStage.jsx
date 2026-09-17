import React from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { usePresupuesto } from '../../presupuesto/presupuestoCloud.js';
import { buildCostRows, summarizeCosts } from './costStageModel.js';

const money = value => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 2
}).format(Number(value) || 0);

const STATUS_LABELS = {
  listo: 'Listo',
  'falta-apu': 'Falta APU',
  'apu-incompleto': 'APU incompleto',
  'sin-cantidad': 'Sin cantidad'
};

export function CostStage({
  project,
  user,
  conceptos = [],
  apus = [],
  onOpenApu,
  onCreateApu,
  onOpenBudget
}) {
  const { t: tr } = useI18n();
  const { presupuesto, loading } = usePresupuesto(user, project?.id);
  const rows = buildCostRows(conceptos, apus, project?.id);
  const summary = summarizeCosts(rows);

  return (
    <section className="project-stage-content cost-stage">
      <div className="stage-placeholder-card">
        <div className="stage-placeholder-header">
          <div className="stage-placeholder-badge-wrap">
            <span className="stage-num-tag">Etapa 3</span>
            <span className={`stepper-status-badge badge-status-${summary.status}`}>
              {tr(`workspace.status.${summary.status}`) || (summary.status === 'atencion' ? 'Atención' : summary.status === 'completado' ? 'Completado' : 'Pendiente')}
            </span>
          </div>
          <div className="stage-placeholder-title-group">
            <div>
              <h2 className="stage-placeholder-h2">Costos</h2>
              <p className="stage-placeholder-desc">Cantidades confirmadas × P.U. vigente, sin recalcular el APU.</p>
            </div>
          </div>
        </div>

        <div className="stage-placeholder-context-grid cost-stage-summary">
          <div className="stage-context-box"><span className="context-box-label">Conceptos cuantificados</span><span className="context-box-value">{summary.quantifiedCount}</span></div>
          <div className="stage-context-box"><span className="context-box-label">APUs listos</span><span className="context-box-value">{summary.readyCount}</span></div>
          <div className="stage-context-box"><span className="context-box-label">Pendientes de costear</span><span className="context-box-value">{summary.pendingCount}</span></div>
          <div className="stage-context-box"><span className="context-box-label">Subtotal estimado</span><span className="context-box-value">{money(summary.subtotal)}</span></div>
        </div>

        <div className="cost-stage-actions">
          <button type="button" onClick={onOpenBudget}>Abrir presupuesto</button>
          {loading && <span className="muted">Cargando presupuesto…</span>}
          {!loading && presupuesto && <span className="muted">Versión vigente: {presupuesto.currentVersion || presupuesto.id}</span>}
        </div>

        <div className="table-wrap cost-stage-table-wrap">
          <table className="data-table cost-stage-table">
            <thead><tr><th>Concepto</th><th>Cantidad</th><th>Unidad</th><th>Origen</th><th>APU</th><th>P.U.</th><th>Importe</th><th>Región</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.concept.id}>
                  <td>{row.concept.concept || row.concept.clave || '—'}</td>
                  <td>{row.qty || '—'}</td>
                  <td>{row.concept.unit || '—'}</td>
                  <td>{row.origin}</td>
                  <td>{row.apu?.clave || row.apu?.id || row.concept.apuId || '—'}</td>
                  <td>{row.pu ? money(row.pu) : '—'}</td>
                  <td>{row.status === 'listo' ? money(row.importe) : '—'}</td>
                  <td>{row.regional.level === 'sin dato' ? 'Regional: sin dato' : `${row.regional.city !== '—' ? row.regional.city : row.regional.state} · ${row.regional.level}`}</td>
                  <td><span className={`badge-status-${row.status}`}>{STATUS_LABELS[row.status]}</span></td>
                  <td>{row.apu?.id ? <button type="button" className="soft" onClick={() => onOpenApu?.(row.apu)}>Abrir APU</button> : row.qty > 0 ? <button type="button" className="soft" onClick={() => onCreateApu?.(row.concept)}>Crear APU</button> : null}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan="10" className="muted">Aún no hay conceptos cuantificados costables para este proyecto.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
