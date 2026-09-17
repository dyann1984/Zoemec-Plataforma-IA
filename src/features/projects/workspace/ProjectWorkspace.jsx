import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { ProjectHeader } from './ProjectHeader.jsx';
import { ProjectStepper } from './ProjectStepper.jsx';
import { ProjectStagePlaceholder } from './ProjectStagePlaceholder.jsx';
import { EvidenceStage } from './EvidenceStage.jsx';
import { QuantificationStage } from './QuantificationStage.jsx';
import { CostStage } from './CostStage.jsx';
import { ReviewStage } from './ReviewStage.jsx';
import { DeliveryStage } from './DeliveryStage.jsx';
import { fetchProjectPlanoTakeoffs } from './planoTakeoffQuery.js';
import { useCatalogConceptos } from '../../catalogo/catalogConceptosCloud.js';
import { useProjectApus } from '../../catalogo/projectApusCloud.js';
import { apiGetSafe } from '../../../services/apiClient.js';
import { computeDeliveryStageModel } from './deliveryStageModel.js';

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
  onNavigateToApu,
  onNavigateToBudget,
  onStageChange,
  initialStage = 'evidencia'
}) {
  const { t: tr } = useI18n();
  const [selectedStage, setSelectedStage] = useState(initialStage);
  const [evidenceData, setEvidenceData] = useState({
    evidenceItems: propEvidenceItems,
    planos: propPlanos
  });
  const [planoTakeoffs, setPlanoTakeoffs] = useState([]);
  const [reviewModel, setReviewModel] = useState(null);
  const [exportEvents, setExportEvents] = useState([]);
  const [exportEventsError, setExportEventsError] = useState(null);
  const [exportEventsLoading, setExportEventsLoading] = useState(false);
  const [takeoffsError, setTakeoffsError] = useState(null);
  const { conceptos: catalogConceptos } = useCatalogConceptos(user, projectId);
  const { apus: projectApus } = useProjectApus(user, projectId);
  const selectStage = useCallback((stage) => {
    setSelectedStage(stage);
    onStageChange?.(stage);
  }, [onStageChange]);

  const project = projects.find(p => p.id === projectId);

  const refreshExportEvents = useCallback(async () => {
    if (!projectId || !user?.uid) {
      setExportEvents([]);
      setExportEventsError(null);
      return;
    }

    setExportEventsLoading(true);
    setExportEventsError(null);

    try {
      const response = await apiGetSafe('/api/export-events');

      if (!response) {
        setExportEvents([]);
        setExportEventsError('No fue posible consultar el historial de entregas.');
        return;
      }

      setExportEvents(Array.isArray(response.events) ? response.events : []);
    } finally {
      setExportEventsLoading(false);
    }
  }, [projectId, user?.uid]);

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

  useEffect(() => {
    refreshExportEvents();
  }, [refreshExportEvents]);

  useEffect(() => {
    setReviewModel(null);
    setExportEvents([]);
    setExportEventsError(null);
  }, [projectId]);

  const deliveryModel = useMemo(() => {
    const model = computeDeliveryStageModel({
      projectId,
      apuDocs: projectApus,
      exportEvents
    });

    if (exportEventsError && model.apuCount > 0) {
      return {
        ...model,
        status: 'atencion',
        reason: 'EXPORT_HISTORY_UNAVAILABLE'
      };
    }

    return model;
  }, [projectId, projectApus, exportEvents, exportEventsError]);

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
        apus={projectApus}
        budgets={budgets}
        surveys={surveys}
        planoTakeoffs={planoTakeoffs}
        catalogConceptos={catalogConceptos}
        reviewModel={reviewModel}
        deliveryModel={deliveryModel}
        evidenceItems={evidenceData.evidenceItems}
        planos={evidenceData.planos}
        onBackToProjects={onBackToProjects}
      />

      <ProjectStepper
        selectedStage={selectedStage}
        onSelectStage={selectStage}
        project={project}
        apus={projectApus}
        budgets={budgets}
        surveys={surveys}
        planoTakeoffs={planoTakeoffs}
        evidenceItems={evidenceData.evidenceItems}
        planos={evidenceData.planos}
        catalogConceptos={catalogConceptos}
        reviewModel={reviewModel}
        deliveryModel={deliveryModel}
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
      ) : selectedStage === 'costos' ? (
        <CostStage
          project={project}
          user={user}
          conceptos={catalogConceptos}
          apus={projectApus}
          onCreateApu={() => onNavigateToApu?.()}
          onOpenApu={(apu) => onNavigateToApu?.(apu)}
          onOpenBudget={onNavigateToBudget}
        />
      ) : selectedStage === 'revision' ? (
        <ReviewStage
          project={project}
          user={user}
          apus={projectApus}
          catalogConceptos={catalogConceptos}
          onModelChange={setReviewModel}
          onOpenApu={(apu) => onNavigateToApu?.(apu)}
        />
      ) : selectedStage === 'entrega' ? (
        <DeliveryStage
          project={project}
          user={user}
          apus={projectApus}
          deliveryModel={deliveryModel}
          loadingEvents={exportEventsLoading}
          eventsError={exportEventsError}
          onReloadExportEvents={refreshExportEvents}
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
