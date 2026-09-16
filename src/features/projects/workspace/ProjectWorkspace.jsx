import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { ProjectHeader } from './ProjectHeader.jsx';
import { ProjectStepper } from './ProjectStepper.jsx';
import { ProjectStagePlaceholder } from './ProjectStagePlaceholder.jsx';
import { EvidenceStage } from './EvidenceStage.jsx';
import { QuantificationStage } from './QuantificationStage.jsx';
import { fetchProjectPlanoTakeoffs } from './planoTakeoffQuery.js';

export function ProjectWorkspace({
  projectId,
  projects = [],
  user,
  organizationId = null,
  apus = [],
  budgets = [],
  surveys = [],
  evidenceItems: propEvidenceItems = [],
  planos: propPlanos = [],
  onBackToProjects,
  onNavigateToLevantamiento,
  onNavigateToPlano,
  onNavigateToVault,
  initialStage = 'evidencia'
}) {
  const { t: tr } = useI18n();
  const [selectedStage, setSelectedStage] = useState(initialStage);
  const [evidenceData, setEvidenceData] = useState({
    evidenceItems: propEvidenceItems,
    planos: propPlanos
  });
  const [planoTakeoffs, setPlanoTakeoffs] = useState([]);
  const [takeoffsError, setTakeoffsError] = useState(null);

  const project = projects.find(p => p.id === projectId);
  const refreshPlanoTakeoffs = useCallback(async () => {
    try {
      setTakeoffsError(null);
      setPlanoTakeoffs(await fetchProjectPlanoTakeoffs(projectId));
    } catch (error) {
      setTakeoffsError(error);
      setPlanoTakeoffs([]);
      window.zoemecNotify?.(error.message || 'No se pudieron cargar los takeoffs del proyecto.', 'error');
    }
  }, [projectId]);

  useEffect(() => {
    refreshPlanoTakeoffs();
  }, [refreshPlanoTakeoffs]);

  if (!project) {
    return (
      <div className="project-workspace-container">
        <div className="project-workspace-not-found">
          <h2>{tr('workspace.projectNotFoundTitle') || 'Proyecto no encontrado'}</h2>
          <p>{tr('workspace.projectNotFoundDesc') || 'El proyecto seleccionado no existe o no tienes permisos para acceder.'}</p>
          <button
            type="button"
            className="btn-primary"
            onClick={onBackToProjects}
          >
            {tr('workspace.backToProjects') || 'Volver a Proyectos'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="project-workspace-container">
      <ProjectHeader
        project={project}
        apus={apus}
        budgets={budgets}
        surveys={surveys}
        planoTakeoffs={planoTakeoffs}
        evidenceItems={evidenceData.evidenceItems}
        planos={evidenceData.planos}
        onBackToProjects={onBackToProjects}
      />

      <ProjectStepper
        selectedStage={selectedStage}
        onSelectStage={setSelectedStage}
        project={project}
        apus={apus}
        budgets={budgets}
        surveys={surveys}
        planoTakeoffs={planoTakeoffs}
        evidenceItems={evidenceData.evidenceItems}
        planos={evidenceData.planos}
      />

      {selectedStage === 'evidencia' ? (
        <EvidenceStage
          project={project}
          surveys={surveys}
          initialEvidenceItems={evidenceData.evidenceItems}
          onNavigateToLevantamiento={onNavigateToLevantamiento}
          onNavigateToPlano={onNavigateToPlano}
          onEvidenceUpdated={setEvidenceData}
        />
      ) : selectedStage === 'cuantificacion' ? (
        <QuantificationStage
          project={project}
          surveys={surveys}
          evidenceItems={evidenceData.evidenceItems}
          planoTakeoffs={planoTakeoffs}
          onQuantifyPlano={() => onNavigateToPlano?.({ kind: 'plano-takeoff-vector', returnToWorkspace: true })}
          onOpenTakeoff={() => onNavigateToPlano?.({ kind: 'plano-takeoff-vector', returnToWorkspace: true })}
          onUseEvidence={onNavigateToLevantamiento}
          onUseModel3d={onNavigateToVault}
        />
      ) : (
        <ProjectStagePlaceholder
          selectedStage={selectedStage}
          project={project}
          apus={apus}
          budgets={budgets}
          surveys={surveys}
          planoTakeoffs={planoTakeoffs}
          evidenceItems={evidenceData.evidenceItems}
          planos={evidenceData.planos}
        />
      )}
      {takeoffsError && <small className="muted">No se pudo actualizar la consulta de planos.</small>}
    </div>
  );
}

export default ProjectWorkspace;
