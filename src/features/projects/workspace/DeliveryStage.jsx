import React, { useMemo, useState } from 'react';

const STATUS_LABEL = {
  pendiente: 'Pendiente',
  atencion: 'Atención',
  completado: 'Completado'
};

const REASON_TEXT = {
  PROJECT_REQUIRED: 'Selecciona un proyecto para preparar la entrega.',
  NO_DELIVERABLE_APUS: 'Todavía no existen APUs guardados para generar una entrega.',
  NOT_EXPORTED: 'El proyecto tiene APUs listos, pero todavía no existe una entrega emitida.',
  DELIVERY_OUTDATED: 'La entrega existente está desactualizada porque cambiaron uno o más APUs.',
  CURRENT_DELIVERY_EXISTS: 'La entrega corresponde a las versiones actuales de los APUs.',
  EXPORT_HISTORY_UNAVAILABLE: 'No fue posible verificar el historial de entregas. El estado permanece en Atención.'
};

function formatDate(value) {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function modeLabel(mode) {
  return mode === 'CLIENTE' ? 'Cliente' : 'Técnico';
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
        `No fue posible generar la entrega ${format}.`
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
            <span className="stage-num-tag">Etapa 5</span>

            <span className={`stepper-status-badge badge-status-${model.status}`}>
              {STATUS_LABEL[model.status] || 'Pendiente'}
            </span>
          </div>

          <div className="stage-placeholder-title-group">
            <div>
              <h2 className="stage-placeholder-h2">Entrega</h2>

              <p className="stage-placeholder-desc">
                Genera el dossier auditable del proyecto con las versiones vigentes de sus APUs.
              </p>
            </div>
          </div>
        </div>

        <div className="stage-placeholder-context-grid delivery-stage-summary">
          <div className="stage-context-box">
            <span className="context-box-label">APUs incluidos</span>
            <span className="context-box-value">{model.apuCount}</span>
          </div>

          <div className="stage-context-box">
            <span className="context-box-label">Estado</span>
            <span className="context-box-value">
              {STATUS_LABEL[model.status]}
            </span>
          </div>

          <div className="stage-context-box">
            <span className="context-box-label">Formatos actuales</span>
            <span className="context-box-value">
              {model.currentFormats?.length
                ? model.currentFormats.join(' + ')
                : 'Sin entrega actual'}
            </span>
          </div>

          <div className="stage-context-box">
            <span className="context-box-label">Última entrega actual</span>
            <span className="context-box-value">
              {formatDate(model.lastCurrentExport?.timestamp)}
            </span>
          </div>
        </div>

        <div className={`stage-placeholder-notice delivery-notice status-${model.status}`}>
          {eventsError
            ? eventsError
            : REASON_TEXT[model.reason] || 'Estado de entrega disponible.'}
        </div>

        {model.isStale && model.lastExport && (
          <div className="stage-placeholder-notice">
            La última emisión fue el {formatDate(model.lastExport.timestamp)}, pero ya no coincide con las versiones actuales de los APUs.
          </div>
        )}

        <div className="review-stage-detail">
          <h3>Preparar entrega</h3>

          <div className="review-stage-detail-grid">
            <div>
              <strong>Modo del dossier</strong>

              <p>
                Técnico incluye información de auditoría y revisión interna.
                Cliente presenta una salida orientada a entrega externa.
              </p>

              <select
                value={mode}
                onChange={event => setMode(event.target.value)}
                disabled={Boolean(exporting)}
                aria-label="Modo del dossier"
              >
                <option value="TECNICO">Técnico</option>
                <option value="CLIENTE">Cliente</option>
              </select>
            </div>

            <div>
              <strong>Versiones incluidas</strong>

              <p>
                {model.currentVersionIds?.length
                  ? model.currentVersionIds.join(' · ')
                  : 'Sin APUs versionados disponibles'}
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
                ? 'Generando PDF…'
                : 'Generar dossier PDF'}
            </button>

            <button
              type="button"
              className="soft"
              disabled={model.apuCount === 0 || Boolean(exporting)}
              onClick={() => handleExport('XLSX')}
            >
              {exporting === 'XLSX'
                ? 'Generando Excel…'
                : 'Generar dossier Excel'}
            </button>

            <button
              type="button"
              className="soft"
              disabled={loadingEvents || Boolean(exporting)}
              onClick={() => onReloadExportEvents?.()}
            >
              {loadingEvents ? 'Actualizando…' : 'Actualizar historial'}
            </button>
          </div>

          {exportError && (
            <p className="muted">
              {exportError}
            </p>
          )}
        </div>

        <div className="review-stage-detail">
          <h3>Historial de entregas</h3>

          <div className="table-wrap cost-stage-table-wrap">
            <table className="data-table delivery-stage-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Formato</th>
                  <th>Modo</th>
                  <th>Versiones</th>
                  <th>Estado</th>
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
                          {isCurrent ? 'Actual' : 'Desactualizada'}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {!recentExports.length && (
                  <tr>
                    <td colSpan="5" className="muted">
                      No existen entregas registradas para este proyecto.
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
