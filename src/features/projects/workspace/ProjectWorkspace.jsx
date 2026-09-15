import React, { useState } from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { ProjectHeader } from './ProjectHeader.jsx';
import { ProjectStepper } from './ProjectStepper.jsx';
import { ProjectStagePlaceholder } from './ProjectStagePlaceholder.jsx';

export function ProjectWorkspace({
  projectId,
  projects = [],
  apus = [],
  budgets = [],
  surveys = [],
  onBackToProjects,
  initialStage = 'evidencia'
}) {
  const { t: tr } = useI18n();
  const [selectedStage, setSelectedStage] = useState(initialStage);

  const project = projects.find(p => p.id === projectId);

  if (!project) {
    return (
      <div className="project-workspace-container">
        <div className="project-workspace-not-found">
          <h2>{tr('workspace.projectNotFoundTitle')}</h2>
          <p>{tr('workspace.projectNotFoundDesc')}</p>
          <button
            type="button"
            className="btn-primary"
            onClick={onBackToProjects}
          >
            {tr('workspace.backToProjects')}
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
        onBackToProjects={onBackToProjects}
      />

      <ProjectStepper
        selectedStage={selectedStage}
        onSelectStage={setSelectedStage}
        project={project}
        apus={apus}
        budgets={budgets}
        surveys={surveys}
      />

      <ProjectStagePlaceholder
        selectedStage={selectedStage}
        project={project}
        apus={apus}
        budgets={budgets}
        surveys={surveys}
      />
    </div>
  );
}

export default ProjectWorkspace;
