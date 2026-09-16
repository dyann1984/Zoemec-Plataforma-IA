import React, { useState } from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { ProjectHeader } from './ProjectHeader.jsx';
import { ProjectStepper } from './ProjectStepper.jsx';
import { ProjectStagePlaceholder } from './ProjectStagePlaceholder.jsx';
import { EvidenceStage } from './EvidenceStage.jsx';

export function ProjectWorkspace({
  projectId,
  projects = [],
  apus = [],
  budgets = [],
  surveys = [],
  evidenceItems: propEvidenceItems = [],
  planos: propPlanos = [],
  onBackToProjects,
  onNavigateToLevantamiento,
  onNavigateToPlano,
  initialStage = 'evidencia'
}) {
  const { t: tr } = useI18n();
  const [selectedStage, setSelectedStage] = useState(initialStage);
  const [evidenceData, setEvidenceData] = useState({
    evidenceItems: propEvidenceItems,
    planos: propPlanos
  });

  const project = projects.find(p => p.id === projectId);

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
      ) : (
        <ProjectStagePlaceholder
          selectedStage={selectedStage}
          project={project}
          apus={apus}
          budgets={budgets}
          surveys={surveys}
          evidenceItems={evidenceData.evidenceItems}
          planos={evidenceData.planos}
        />
      )}
    </div>
  );
}

export default ProjectWorkspace;
