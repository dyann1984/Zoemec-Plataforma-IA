import React from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { usePresupuesto } from '../../presupuesto/presupuestoCloud.js';
import { buildCostRows, summarizeCosts } from './costStageModel.js';

const money = value => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 2
}).format(Number(value) || 0);

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
  const STATUS_LABELS = {
    listo: tr('costStage.statusReady'),
    'falta-apu': tr('costStage.statusMissingApu'),
    'apu-incompleto': tr('costStage.statusIncompleteApu'),
    'sin-cantidad': tr('costStage.statusMissingQty')
  };
  const { presupuesto, loading } = usePresupuesto(user, project?.id);
  const rows = buildCostRows(conceptos, apus, project?.id);
  const summary = summarizeCosts(rows);

  return (
    <section className="project-stage-content cost-stage">
      <div className="stage-placeholder-card">
        <div className="stage-placeholder-header">
          <div className="stage-placeholder-badge-wrap">
            <span className="stage-num-tag">{tr('costStage.stageTag')}</span>
            <span className={`stepper-status-badge badge-status-${summary.status}`}>
              {tr(`workspace.status.${summary.status}`)}
            </span>
          </div>
          <div className="stage-placeholder-title-group">
            <div>
              <h2 className="stage-placeholder-h2">{tr('costStage.title')}</h2>
              <p className="stage-placeholder-desc">{tr('costStage.description')}</p>
            </div>
          </div>
        </div>

        <div className="stage-placeholder-context-grid cost-stage-summary">
          <div className="stage-context-box"><span className="context-box-label">{tr('costStage.quantifiedConcepts')}</span><span className="context-box-value">{summary.quantifiedCount}</span></div>
          <div className="stage-context-box"><span className="context-box-label">{tr('costStage.readyApus')}</span><span className="context-box-value">{summary.readyCount}</span></div>
          <div className="stage-context-box"><span className="context-box-label">{tr('costStage.pendingToCost')}</span><span className="context-box-value">{summary.pendingCount}</span></div>
          <div className="stage-context-box"><span className="context-box-label">{tr('costStage.estimatedSubtotal')}</span><span className="context-box-value">{money(summary.subtotal)}</span></div>
        </div>

        <div className="cost-stage-actions">
          <button type="button" onClick={onOpenBudget}>{tr('costStage.openBudget')}</button>
          {loading && <span className="muted">{tr('costStage.loadingBudget')}</span>}
          {!loading && presupuesto && <span className="muted">{tr('costStage.currentVersion', { version: presupuesto.currentVersion || presupuesto.id })}</span>}
        </div>

        <div className="table-wrap cost-stage-table-wrap">
          <table className="data-table cost-stage-table">
            <thead>
              <tr>
                <th>{tr('costStage.colConcept')}</th>
                <th>{tr('costStage.colQuantity')}</th>
                <th>{tr('costStage.colUnit')}</th>
                <th>{tr('costStage.colOrigin')}</th>
                <th>{tr('costStage.colApu')}</th>
                <th>{tr('costStage.colUnitPrice')}</th>
                <th>{tr('costStage.colAmount')}</th>
                <th>{tr('costStage.colRegion')}</th>
                <th>{tr('costStage.colStatus')}</th>
                <th />
              </tr>
            </thead>
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
                  <td>{row.regional.level === 'sin dato' ? tr('costStage.regionNoData') : `${row.regional.city !== '—' ? row.regional.city : row.regional.state} · ${row.regional.level}`}</td>
                  <td><span className={`badge-status-${row.status}`}>{STATUS_LABELS[row.status]}</span></td>
                  <td>{row.apu?.id ? <button type="button" className="soft" onClick={() => onOpenApu?.(row.apu)}>{tr('costStage.openApu')}</button> : row.qty > 0 ? <button type="button" className="soft" onClick={() => onCreateApu?.(row.concept)}>{tr('costStage.createApu')}</button> : null}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan="10" className="muted">{tr('costStage.noCostableConcepts')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
