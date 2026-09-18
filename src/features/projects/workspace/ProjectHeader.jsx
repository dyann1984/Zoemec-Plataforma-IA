import React from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { Icon } from '../../../components/ui/Icon.jsx';
import { deriveProjectLifecycleStage } from './stageStatus.js';

function formatRelativeTime(ts, tr) {
  if (!ts) return tr('projects.lastActivityNone');
  const now = Date.now();
  const diffMs = now - Number(ts);
  if (diffMs < 0 || !Number.isFinite(diffMs)) return tr('projects.lastActivityNone');

  const diffMin = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) return tr('workspace.time.justNow');
  if (diffMin < 60) return tr('workspace.time.minutesAgo', { count: diffMin });
  if (diffHours < 24) return tr('workspace.time.hoursAgo', { count: diffHours });
  if (diffDays === 1) return tr('workspace.time.yesterday');
  if (diffDays < 30) return tr('workspace.time.daysAgo', { count: diffDays });

  try {
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return tr('projects.lastActivityNone');
  }
}

export function ProjectHeader({ project, apus = [], budgets = [], surveys = [], evidenceItems = [], planos = [], planoTakeoffs = [], catalogConceptos = [], reviewModel = null, deliveryModel = null, onBackToProjects }) {
  const { t: tr } = useI18n();

  const name = project?.name || tr('workspace.unnamedProject');
  const client = project?.client || '—';
  const location = project?.ubicacion || project?.locationData?.city || project?.locationData?.state || '—';
  const status = project?.status || 'activo';
  const isFinished = String(status).toLowerCase().includes('termin') || String(status).toLowerCase().includes('cerrad');
  const lastActivity = formatRelativeTime(project?.updatedAt || project?.createdAt, tr);

  const lifecycleStage = deriveProjectLifecycleStage({
    project,
    apus,
    budgets,
    surveys,
    evidenceItems,
    planos,
    planoTakeoffs,
    catalogConceptos,
    reviewModel,
    deliveryModel
  });
  const lifecycleStageTitle = lifecycleStage ? (tr(lifecycleStage.titleKey) || lifecycleStage.defaultTitle) : null;

  return (
    <div className="project-workspace-header">
      <div className="project-workspace-nav-bar">
        <button
          type="button"
          className="btn-back-projects"
          onClick={onBackToProjects}
          aria-label={tr('workspace.backToProjects')}
        >
          <Icon name="chevronDown" size={14} className="icon-rotate-left" />
          <span>{tr('workspace.backToProjects')}</span>
        </button>

        <div className="project-active-pill">
          <span className="active-dot" aria-hidden="true" />
          <span>{tr('workspace.activeProjectPill')}</span>
        </div>
      </div>

      <div className="project-workspace-title-row">
        <div className="project-workspace-title-main">
          <div className="project-status-and-type">
            <span className={`project-card-badge badge-${isFinished ? 'closed' : 'active'}`}>
              {status.toUpperCase()}
            </span>
            {project?.currency && (
              <span className="project-currency-badge">{project.currency}</span>
            )}
            {lifecycleStageTitle && (
              <span className="project-lifecycle-badge">
                <span className="lifecycle-dot" aria-hidden="true" />
                {tr('workspace.currentLifecycleStage', { stage: lifecycleStageTitle })}
              </span>
            )}
          </div>
          <h1 className="project-workspace-h1">{name}</h1>
        </div>
      </div>

      <div className="project-workspace-meta-strip">
        <div className="meta-strip-item">
          <Icon name="clientes" size={15} />
          <span className="meta-label">{tr('projects.fieldClient')}:</span>
          <b className="meta-val">{client}</b>
        </div>
        <div className="meta-strip-divider" />
        <div className="meta-strip-item">
          <Icon name="location" size={15} />
          <span className="meta-label">{tr('projects.fieldLocation')}:</span>
          <b className="meta-val">{location}</b>
        </div>
        <div className="meta-strip-divider" />
        <div className="meta-strip-item">
          <Icon name="clock" size={15} />
          <span className="meta-label">{tr('projects.lastActivity')}:</span>
          <span className="meta-val">{lastActivity}</span>
        </div>
      </div>
    </div>
  );
}
