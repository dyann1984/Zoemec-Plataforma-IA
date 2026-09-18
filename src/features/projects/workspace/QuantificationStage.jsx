import React, { useMemo } from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { Icon } from '../../../components/ui/Icon.jsx';
import {
  buildProjectQuantityList,
  calculateQuantificationSummary,
  QUANTITY_SOURCE,
  QUANTITY_STATUS
} from './quantificationAdapter.js';

function formatNumber(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function QuantificationStage({
  project,
  surveys = [],
  evidenceItems = [],
  planoTakeoffs = [],
  onQuantifyPlano,
  onOpenTakeoff,
  onUseEvidence,
  onUseModel3d
}) {
  const { t: tr } = useI18n();
  const records = useMemo(() => buildProjectQuantityList({
    projectId: project?.id,
    planoTakeoffs,
    surveys,
    evidenceItems
  }), [project?.id, planoTakeoffs, surveys, evidenceItems]);
  const summary = useMemo(() => calculateQuantificationSummary(records), [records]);
  const hasModel3d = records.some(record => record.source === QUANTITY_SOURCE.MODEL_3D);

  return (
    <div className="project-stage-content">
      <div className="stage-placeholder-card quantification-stage">
        <div className="stage-placeholder-header">
          <div className="stage-placeholder-badge-wrap">
            <span className="stage-num-tag">{tr('quantification.stageTag')}</span>
            <span className={`stepper-status-badge badge-status-${summary.confirmedCount > 0 ? 'completado' : 'pendiente'}`}>
              {summary.confirmedCount > 0 ? tr('workspace.status.completado') : tr('workspace.status.pendiente')}
            </span>
          </div>
          <div className="stage-placeholder-title-group">
            <div className="stage-placeholder-icon"><Icon name="cuantificaciones" size={28} /></div>
            <div>
              <h2 className="stage-placeholder-h2">{tr('quantification.title')}</h2>
              <p className="stage-placeholder-desc">{tr('quantification.description')}</p>
            </div>
          </div>
        </div>

        <div className="quantification-summary-grid">
          <div className="stage-context-box"><span className="context-box-label">{tr('quantification.quantifiedItems')}</span><strong>{summary.confirmedCount}</strong><span className="context-box-hint">{summary.pendingReviewCount} {tr('quantification.pendingReview')}</span></div>
          <div className="stage-context-box"><span className="context-box-label">{tr('quantification.processedPlans')}</span><strong>{summary.planosCount}</strong><span className="context-box-hint">{tr('quantification.activeProjectTakeoffs')}</span></div>
          <div className="stage-context-box"><span className="context-box-label">{tr('quantification.measurements')}</span><strong>{formatNumber(summary.totalArea)} m² · {formatNumber(summary.totalLength)} m · {formatNumber(summary.totalVolume)} m³</strong><span className="context-box-hint">{tr('quantification.measurementTypes')}</span></div>
          <div className="stage-context-box"><span className="context-box-label">{tr('quantification.concepts')}</span><strong>{summary.categoriesCount}</strong><span className="context-box-hint">{summary.categories.join(', ') || tr('quantification.noConcepts')}</span></div>
          <div className="stage-context-box"><span className="context-box-label">{tr('quantification.lastUpdated')}</span><strong>{formatDate(summary.lastUpdated)}</strong><span className="context-box-hint">{tr('quantification.persistedData')}</span></div>
        </div>

        <div className="quantification-actions">
          <button type="button" onClick={onQuantifyPlano}>{tr('quantification.quantifyPlan')}</button>
          <button type="button" className="soft" onClick={onOpenTakeoff}>{tr('quantification.openTakeoff')}</button>
          <button type="button" className="soft" onClick={onUseEvidence}>{tr('quantification.useEvidence')}</button>
          {hasModel3d && <button type="button" className="soft" onClick={onUseModel3d}>{tr('quantification.useModel3d')}</button>}
        </div>

        <div className="quantification-table-wrap">
          <table className="quantification-table">
            <thead><tr><th>{tr('quantification.concept')}</th><th>{tr('quantification.quantity')}</th><th>{tr('quantification.unit')}</th><th>{tr('quantification.source')}</th><th>{tr('quantification.status')}</th></tr></thead>
            <tbody>
              {records.length === 0
                ? <tr><td colSpan="5" className="muted">{tr('quantification.noPersistedQuantities')}</td></tr>
                : records.map(record => (
                  <tr key={record.id}>
                    <td>{record.concept}</td>
                    <td>{formatNumber(record.quantity)}</td>
                    <td>{record.unit || '—'}</td>
                    <td>{record.source === QUANTITY_SOURCE.PLANO ? tr('quantification.sourcePlano') : record.source === QUANTITY_SOURCE.SURVEY ? tr('quantification.sourceSurvey') : tr('quantification.sourceModel3d')}</td>
                    <td>{record.status === QUANTITY_STATUS.CONFIRMADO ? tr('quantification.statusConfirmed') : record.status === QUANTITY_STATUS.ESTIMADO ? tr('quantification.statusEstimated') : tr('quantification.statusProposed')}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default QuantificationStage;
