import React from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { Icon } from '../../../components/ui/Icon.jsx';
import { WORKSPACE_STAGES, computeStageProgress } from './stageStatus.js';

export function ProjectStepper({
  selectedStage,
  currentStage, // Compatibilidad retroactiva
  onSelectStage,
  project,
  apus = [],
  budgets = [],
  surveys = [],
  evidenceItems = [],
  planos = [],
  planoTakeoffs = [],
  catalogConceptos = []
}) {
  const { t: tr } = useI18n();

  const activeStageKey = selectedStage || currentStage || 'evidencia';
  const currentIndex = WORKSPACE_STAGES.findIndex(s => s.key === activeStageKey);
  const activeIndex = currentIndex >= 0 ? currentIndex : 0;
  const currentStageObj = WORKSPACE_STAGES[activeIndex] || WORKSPACE_STAGES[0];

  const stageProgressContext = { project, apus, budgets, surveys, evidenceItems, planos, planoTakeoffs, catalogConceptos };

  const handlePrev = () => {
    if (activeIndex > 0) {
      onSelectStage(WORKSPACE_STAGES[activeIndex - 1].key);
    }
  };

  const handleNext = () => {
    if (activeIndex < WORKSPACE_STAGES.length - 1) {
      onSelectStage(WORKSPACE_STAGES[activeIndex + 1].key);
    }
  };

  const statusLabel = (status) => {
    switch (status) {
      case 'completado': return tr('workspace.status.completado');
      case 'atencion': return tr('workspace.status.atencion');
      default: return tr('workspace.status.pendiente');
    }
  };

  return (
    <div className="project-stepper-container" aria-label={tr('workspace.stepperAriaLabel')}>
      {/* 1. Versión Desktop (Horizontal 5 pasos) */}
      <nav className="project-stepper-desktop" aria-label={tr('workspace.stepperDesktopLabel')}>
        <ol className="stepper-list">
          {WORKSPACE_STAGES.map((stage, idx) => {
            const progress = computeStageProgress(stage.key, stageProgressContext);
            const isSelected = stage.key === activeStageKey;
            const stageTitle = tr(stage.titleKey) || stage.defaultTitle;

            return (
              <li
                key={stage.key}
                className={`stepper-item progress-${progress}${isSelected ? ' is-selected' : ''}`}
              >
                <button
                  type="button"
                  className="stepper-btn"
                  onClick={() => onSelectStage(stage.key)}
                  aria-current={isSelected ? 'step' : undefined}
                >
                  <span className="stepper-num-box">
                    {progress === 'completado' ? (
                      <span className="stepper-check" aria-hidden="true">✓</span>
                    ) : progress === 'atencion' ? (
                      <span className="stepper-warn" aria-hidden="true">!</span>
                    ) : (
                      <span className="stepper-idx">{idx + 1}</span>
                    )}
                  </span>
                  <div className="stepper-copy">
                    <span className="stepper-title">{stageTitle}</span>
                    <span className={`stepper-status-badge badge-status-${progress}`}>
                      {statusLabel(progress)}
                    </span>
                  </div>
                  {isSelected && (
                    <span className="stepper-selected-dot" title={tr('workspace.viewingStage')} aria-label={tr('workspace.viewingStage')} />
                  )}
                </button>
                {idx < WORKSPACE_STAGES.length - 1 && (
                  <div className={`stepper-connector${progress === 'completado' ? ' is-completed' : ''}`} aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* 2. Versión Móvil (Ergonómica con Paso X de 5, Anterior / Siguiente y selector compacto) */}
      <div className="project-stepper-mobile" aria-label={tr('workspace.stepperMobileLabel')}>
        <div className="stepper-mobile-top">
          <span className="stepper-mobile-step-count">
            {tr('workspace.mobile.stepOf', { current: activeIndex + 1, total: WORKSPACE_STAGES.length })}
          </span>
          <div className="stepper-mobile-selector-wrap">
            <select
              className="stepper-mobile-select"
              value={activeStageKey}
              onChange={(e) => onSelectStage(e.target.value)}
              aria-label={tr('workspace.mobile.jumpTo')}
            >
              {WORKSPACE_STAGES.map((s, idx) => {
                const p = computeStageProgress(s.key, stageProgressContext);
                return (
                  <option key={s.key} value={s.key}>
                    {idx + 1}. {tr(s.titleKey) || s.defaultTitle} — {statusLabel(p)}
                  </option>
                );
              })}
            </select>
            <Icon name="chevronDown" size={13} className="select-chevron" />
          </div>
        </div>

        <div className="stepper-mobile-main-row">
          <div className="stepper-mobile-stage-info">
            <span className="stepper-mobile-stage-title">
              {tr(currentStageObj.titleKey) || currentStageObj.defaultTitle}
            </span>
            <span className={`stepper-status-badge badge-status-${computeStageProgress(currentStageObj.key, stageProgressContext)}`}>
              {statusLabel(computeStageProgress(currentStageObj.key, stageProgressContext))}
            </span>
          </div>

          <div className="stepper-mobile-nav-buttons">
            <button
              type="button"
              className="btn-stepper-nav"
              onClick={handlePrev}
              disabled={activeIndex === 0}
              aria-label={tr('workspace.mobile.prev')}
            >
              ← {tr('workspace.mobile.prev')}
            </button>
            <button
              type="button"
              className="btn-stepper-nav btn-stepper-primary"
              onClick={handleNext}
              disabled={activeIndex === WORKSPACE_STAGES.length - 1}
              aria-label={tr('workspace.mobile.next')}
            >
              {tr('workspace.mobile.next')} →
            </button>
          </div>
        </div>

        {/* Indicador de 5 segmentos en móvil mostrando progreso real y etapa seleccionada */}
        <div className="stepper-mobile-progress-bar" aria-hidden="true">
          {WORKSPACE_STAGES.map((s, i) => {
            const p = computeStageProgress(s.key, stageProgressContext);
            const isSel = i === activeIndex;
            return (
              <div
                key={s.key}
                className={`progress-bar-segment status-${p}${isSel ? ' is-selected' : ''}`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
