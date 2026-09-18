import React, { useMemo, useState } from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';

function formatDate(value) {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

const EMPTY_MODEL = {
  projectId: null,
  status: 'pendiente',
  reason: 'PROJECT_REQUIRED',
  apuCount: 0,
  currentVersionIds: [],
  projectExports: [],
  currentExports: [],
  currentFormats: [],
  lastExport: null,
  lastCurrentExport: null,
  isStale: false
};

export function DeliveryStage({
  project,
  user,
  apus = [],
  deliveryModel,
  loadingEvents = false,
  eventsError = null,
  onReloadExportEvents
}) {
  const { t: tr } = useI18n();
  const modeLabel = mode => mode === 'CLIENTE' ? tr('deliveryStage.modeClient') : tr('deliveryStage.modeTechnical');
  const [mode, setMode] = useState('TECNICO');
  const [exporting, setExporting] = useState(null);
  const [exportError, setExportError] = useState(null);

  const model = deliveryModel || EMPTY_MODEL;

  const recentExports = useMemo(
    () => (model.projectExports || []).slice(0, 5),
    [model.projectExports]
  );

  const companyMeta = useMemo(() => ({
    name: project?.name || '',
    client: project?.client || '',
    responsible: user?.displayName || user?.email || '',
    email: user?.email || ''
  }), [
    project?.name,
    project?.client,
    user?.displayName,
    user?.email
  ]);

  async function handleExport(format) {
    if (!project?.id || model.apuCount === 0 || exporting) return;

    setExportError(null);
    setExporting(format);

    try {
      if (format === 'PDF') {
        const { exportProjectDossierPdf } = await import('../../../lib/apuProjectDossierPdf.js');

        await exportProjectDossierPdf({
          projectId: project.id,
          mode,
          company: companyMeta
        });
      } else {
        const { exportProjectDossierExcel } = await import('../../../lib/apuProjectDossierXlsx.js');

        await exportProjectDossierExcel({
          projectId: project.id,
          mode,
          company: companyMeta
        });
      }

      await onReloadExportEvents?.();
    } catch (error) {
      setExportError(
        error?.message ||
        tr('deliveryStage.exportFailedFormat', { format })
      );
    } finally {
      setExporting(null);
    }
  }

  return (
    <section className="project-stage-content delivery-stage">
      <div className="stage-placeholder-card">
        <div className="stage-placeholder-header">
          <div className="stage-placeholder-badge-wrap">
            <span className="stage-num-tag">{tr('deliveryStage.stageTag')}</span>

            <span className={`stepper-status-badge badge-status-${model.status}`}>
              {tr(`workspace.status.${model.status}`)}
            </span>
          </div>

          <div className="stage-placeholder-title-group">
            <div>
              <h2 className="stage-placeholder-h2">{tr('deliveryStage.title')}</h2>

              <p className="stage-placeholder-desc">
                {tr('deliveryStage.description')}
              </p>
            </div>
          </div>
        </div>

        <div className="stage-placeholder-context-grid delivery-stage-summary">
          <div className="stage-context-box">
            <span className="context-box-label">{tr('deliveryStage.includedApus')}</span>
            <span className="context-box-value">{model.apuCount}</span>
          </div>

          <div className="stage-context-box">
            <span className="context-box-label">{tr('deliveryStage.status')}</span>
            <span className="context-box-value">
              {tr(`workspace.status.${model.status}`)}
            </span>
          </div>

          <div className="stage-context-box">
            <span className="context-box-label">{tr('deliveryStage.currentFormats')}</span>
            <span className="context-box-value">
              {model.currentFormats?.length
                ? model.currentFormats.join(' + ')
                : tr('deliveryStage.noCurrentDelivery')}
            </span>
          </div>

          <div className="stage-context-box">
            <span className="context-box-label">{tr('deliveryStage.lastCurrentDelivery')}</span>
            <span className="context-box-value">
              {formatDate(model.lastCurrentExport?.timestamp)}
            </span>
          </div>
        </div>

        <div className={`stage-placeholder-notice delivery-notice status-${model.status}`}>
          {eventsError
            ? eventsError
            : tr(`deliveryStage.reasons.${model.reason}`)}
        </div>

        {model.isStale && model.lastExport && (
          <div className="stage-placeholder-notice">
            {tr('deliveryStage.staleNotice', { date: formatDate(model.lastExport.timestamp) })}
          </div>
        )}

        <div className="review-stage-detail">
          <h3>{tr('deliveryStage.prepareDelivery')}</h3>

          <div className="review-stage-detail-grid">
            <div>
              <strong>{tr('deliveryStage.dossierMode')}</strong>

              <p>
                {tr('deliveryStage.dossierModeDesc')}
              </p>

              <select
                value={mode}
                onChange={event => setMode(event.target.value)}
                disabled={Boolean(exporting)}
                aria-label={tr('deliveryStage.dossierMode')}
              >
                <option value="TECNICO">{tr('deliveryStage.modeTechnical')}</option>
                <option value="CLIENTE">{tr('deliveryStage.modeClient')}</option>
              </select>
            </div>

            <div>
              <strong>{tr('deliveryStage.includedVersions')}</strong>

              <p>
                {model.currentVersionIds?.length
                  ? model.currentVersionIds.join(' · ')
                  : tr('deliveryStage.noVersionedApus')}
              </p>
            </div>
          </div>

          <div className="cost-stage-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={model.apuCount === 0 || Boolean(exporting)}
              onClick={() => handleExport('PDF')}
            >
              {exporting === 'PDF'
                ? tr('deliveryStage.generatingPdf')
                : tr('deliveryStage.generatePdf')}
            </button>

            <button
              type="button"
              className="soft"
              disabled={model.apuCount === 0 || Boolean(exporting)}
              onClick={() => handleExport('XLSX')}
            >
              {exporting === 'XLSX'
                ? tr('deliveryStage.generatingExcel')
                : tr('deliveryStage.generateExcel')}
            </button>

            <button
              type="button"
              className="soft"
              disabled={loadingEvents || Boolean(exporting)}
              onClick={() => onReloadExportEvents?.()}
            >
              {loadingEvents ? tr('deliveryStage.refreshingHistory') : tr('deliveryStage.refreshHistory')}
            </button>
          </div>

          {exportError && (
            <p className="muted">
              {exportError}
            </p>
          )}
        </div>

        <div className="review-stage-detail">
          <h3>{tr('deliveryStage.deliveryHistory')}</h3>

          <div className="table-wrap cost-stage-table-wrap">
            <table className="data-table delivery-stage-table">
              <thead>
                <tr>
                  <th>{tr('deliveryStage.colDate')}</th>
                  <th>{tr('deliveryStage.colFormat')}</th>
                  <th>{tr('deliveryStage.colMode')}</th>
                  <th>{tr('deliveryStage.colVersions')}</th>
                  <th>{tr('deliveryStage.colStatus')}</th>
                </tr>
              </thead>

              <tbody>
                {recentExports.map(event => {
                  const isCurrent = model.currentExports?.includes(event);

                  return (
                    <tr key={event.id || `${event.timestamp}-${event.format}`}>
                      <td>{formatDate(event.timestamp)}</td>
                      <td>{event.format}</td>
                      <td>{modeLabel(event.mode)}</td>
                      <td>{Array.isArray(event.apuVersionIds) ? event.apuVersionIds.join(' · ') : '—'}</td>
                      <td>
                        <span className={`badge-status-${isCurrent ? 'completado' : 'atencion'}`}>
                          {isCurrent ? tr('deliveryStage.current') : tr('deliveryStage.outdated')}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {!recentExports.length && (
                  <tr>
                    <td colSpan="5" className="muted">
                      {tr('deliveryStage.noDeliveriesRegistered')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

export default DeliveryStage;
