import React from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { Icon } from '../../../components/ui/Icon.jsx';
import { WORKSPACE_STAGES, computeStageProgress } from './stageStatus.js';

export function ProjectStagePlaceholder({
  selectedStage,
  currentStage, // Compatibilidad retroactiva
  project,
  apus = [],
  budgets = [],
  surveys = []
}) {
  const { t: tr } = useI18n();

  const activeStageKey = selectedStage || currentStage || 'evidencia';
  const stage = WORKSPACE_STAGES.find(s => s.key === activeStageKey) || WORKSPACE_STAGES[0];
  const stageProgress = computeStageProgress(stage.key, { project, apus, budgets, surveys });

  const stageTitle = tr(stage.titleKey) || stage.defaultTitle;
  const stageDesc = tr(stage.descKey) || stage.defaultDesc;

  const projectId = project?.id;
  const projectApus = apus.filter(a => (a?.projectId ?? null) === projectId);
  const projectBudgets = budgets.filter(b => (b?.projectId ?? null) === projectId);
  const projectSurveys = surveys.filter(s => (s?.projectId ?? null) === projectId);

  const statusLabel = (status) => {
    switch (status) {
      case 'completado': return tr('workspace.status.completado');
      case 'atencion': return tr('workspace.status.atencion');
      default: return tr('workspace.status.pendiente');
    }
  };

  return (
    <div className="project-stage-content">
      <div className="stage-placeholder-card">
        <div className="stage-placeholder-header">
          <div className="stage-placeholder-badge-wrap">
            <span className="stage-num-tag">{tr('workspace.stageTag', { num: stage.order })}</span>
            <span className={`stepper-status-badge badge-status-${stageProgress}`}>
              {statusLabel(stageProgress)}
            </span>
          </div>

          <div className="stage-placeholder-title-group">
            <div className="stage-placeholder-icon">
              <Icon name={stage.icon} size={28} />
            </div>
            <div>
              <h2 className="stage-placeholder-h2">{stageTitle}</h2>
              <p className="stage-placeholder-desc">{stageDesc}</p>
            </div>
          </div>
        </div>

        {/* Bloque contextual según etapa — sin inventar datos */}
        <div className="stage-placeholder-context-grid">
          {stage.key === 'evidencia' && (
            <>
              <div className="stage-context-box">
                <span className="context-box-label">{tr('workspace.context.evidenceRecords')}</span>
                <span className="context-box-value">{projectSurveys.length}</span>
                <span className="context-box-hint">
                  {projectSurveys.length > 0
                    ? tr('workspace.context.evidenceLoaded')
                    : tr('workspace.context.noEvidenceYet')}
                </span>
              </div>
              <div className="stage-context-box">
                <span className="context-box-label">{tr('workspace.context.supportedFormats')}</span>
                <span className="context-box-value">Fotos, Video, PDF, IFC</span>
                <span className="context-box-hint">{tr('workspace.context.formatsHint')}</span>
              </div>
            </>
          )}

          {stage.key === 'cuantificacion' && (
            <>
              <div className="stage-context-box">
                <span className="context-box-label">{tr('workspace.context.takeoffItems')}</span>
                <span className="context-box-value">
                  {projectApus.filter(a => Number(a?.sourceQty ?? a?.calculated?.qty ?? 0) > 0).length}
                </span>
                <span className="context-box-hint">
                  {projectApus.length > 0
                    ? tr('workspace.context.takeoffActive')
                    : tr('workspace.context.noTakeoffYet')}
                </span>
              </div>
              <div className="stage-context-box">
                <span className="context-box-label">{tr('workspace.context.metricBases')}</span>
                <span className="context-box-value">m², m³, kg, pza, ml</span>
                <span className="context-box-hint">{tr('workspace.context.standardUnits')}</span>
              </div>
            </>
          )}

          {stage.key === 'costos' && (
            <>
              <div className="stage-context-box">
                <span className="context-box-label">{tr('workspace.context.linkedApus')}</span>
                <span className="context-box-value">{projectApus.length}</span>
                <span className="context-box-hint">
                  {projectApus.length > 0
                    ? tr('workspace.context.apusCountHint', { count: projectApus.length })
                    : tr('workspace.context.noApusLinked')}
                </span>
              </div>
              <div className="stage-context-box">
                <span className="context-box-label">{tr('workspace.context.linkedBudgets')}</span>
                <span className="context-box-value">{projectBudgets.length}</span>
                <span className="context-box-hint">
                  {projectBudgets.length > 0
                    ? tr('workspace.context.budgetsLinkedHint', { count: projectBudgets.length })
                    : tr('workspace.context.noBudgetsLinked')}
                </span>
              </div>
            </>
          )}

          {stage.key === 'revision' && (
            <>
              <div className="stage-context-box">
                <span className="context-box-label">{tr('workspace.context.auditState')}</span>
                <span className="context-box-value">
                  {projectApus.some(a => {
                    const r = a?.riskLevel || a?.risk?.level;
                    return r === 'Critico' || r === 'Crítico' || r === 'Alto';
                  })
                    ? tr('workspace.context.auditWarning')
                    : tr('workspace.context.auditClean')}
                </span>
                <span className="context-box-hint">{tr('workspace.context.auditHint')}</span>
              </div>
              <div className="stage-context-box">
                <span className="context-box-label">{tr('workspace.context.confidenceCheck')}</span>
                <span className="context-box-value">
                  {projectApus.length > 0 ? `${projectApus.length} APUs` : '—'}
                </span>
                <span className="context-box-hint">{tr('workspace.context.confidenceHint')}</span>
              </div>
            </>
          )}

          {stage.key === 'entrega' && (
            <>
              <div className="stage-context-box">
                <span className="context-box-label">{tr('workspace.context.deliverables')}</span>
                <span className="context-box-value">PDF / Excel / Dossier</span>
                <span className="context-box-hint">{tr('workspace.context.deliverablesHint')}</span>
              </div>
              <div className="stage-context-box">
                <span className="context-box-label">{tr('workspace.context.projectStatus')}</span>
                <span className="context-box-value">{project?.status || 'activo'}</span>
                <span className="context-box-hint">{tr('workspace.context.statusHint')}</span>
              </div>
            </>
          )}
        </div>

        {/* Callout de integración futura */}
        <div className="stage-placeholder-notice">
          <Icon name="tecnico" size={16} />
          <span>{tr('workspace.futureIntegrationNotice')}</span>
        </div>
      </div>
    </div>
  );
}
