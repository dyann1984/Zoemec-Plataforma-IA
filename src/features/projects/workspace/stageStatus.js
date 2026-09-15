/* Definición de etapas del ciclo de vida de obra en ZOEMEC y lógica determinista
   de estados de progreso reales (Completado, Pendiente, Atención).
   Regla fundamental: NUNCA inventar progreso. Si no hay datos suficientes, Pendiente.
   Separación estricta: selectedStage (navegación visual) vs progressStatus (progreso de obra). */

export const WORKSPACE_STAGES = [
  {
    key: 'evidencia',
    order: 1,
    titleKey: 'workspace.stages.evidencia',
    descKey: 'workspace.stageDesc.evidencia',
    defaultTitle: 'Evidencia',
    defaultDesc: 'Aquí se integrarán fotos, video, planos y modelos 3D.',
    icon: 'bim'
  },
  {
    key: 'cuantificacion',
    order: 2,
    titleKey: 'workspace.stages.cuantificacion',
    descKey: 'workspace.stageDesc.cuantificacion',
    defaultTitle: 'Cuantificación',
    defaultDesc: 'Aquí se integrarán mediciones, takeoff y cantidades.',
    icon: 'cuantificaciones'
  },
  {
    key: 'costos',
    order: 3,
    titleKey: 'workspace.stages.costos',
    descKey: 'workspace.stageDesc.costos',
    defaultTitle: 'Costos',
    defaultDesc: 'Aquí se integrarán APU, presupuesto y precios regionales.',
    icon: 'apu'
  },
  {
    key: 'revision',
    order: 4,
    titleKey: 'workspace.stages.revision',
    descKey: 'workspace.stageDesc.revision',
    defaultTitle: 'Revisión',
    defaultDesc: 'Aquí se integrarán confianza, riesgos, auditoría y hallazgos.',
    icon: 'comparativa'
  },
  {
    key: 'entrega',
    order: 5,
    titleKey: 'workspace.stages.entrega',
    descKey: 'workspace.stageDesc.entrega',
    defaultTitle: 'Entrega',
    defaultDesc: 'Aquí se integrarán PDF, Excel, dossier y memoria técnica.',
    icon: 'reportes'
  }
];

/**
 * Calcula el estado de progreso real de una etapa sin inventar datos.
 * Estados posibles: 'completado' | 'atencion' | 'pendiente'
 * IMPORTANTE: No depende de la navegación (selectedStage).
 */
export function computeStageProgress(stageKey, { project, apus = [], budgets = [], surveys = [] }) {
  const projectId = project?.id;
  if (!projectId) return 'pendiente';

  const projectApus = apus.filter(a => (a?.projectId ?? null) === projectId);
  const projectBudgets = budgets.filter(b => (b?.projectId ?? null) === projectId);
  const projectSurveys = surveys.filter(s => (s?.projectId ?? null) === projectId);

  switch (stageKey) {
    case 'evidencia': {
      if (projectSurveys.length > 0 || (project?.evidenceCount ?? 0) > 0) {
        return 'completado';
      }
      return 'pendiente';
    }

    case 'cuantificacion': {
      const hasQuantities = projectApus.some(a => Number(a?.sourceQty ?? a?.calculated?.qty ?? 0) > 0) || (project?.takeoffCount ?? 0) > 0;
      if (hasQuantities) {
        return 'completado';
      }
      return 'pendiente';
    }

    case 'costos': {
      if (projectApus.length > 0 || projectBudgets.length > 0) {
        return 'completado';
      }
      return 'pendiente';
    }

    case 'revision': {
      if (projectApus.length === 0) {
        return 'pendiente';
      }
      const hasRisk = projectApus.some(a => {
        const r = a?.riskLevel || a?.risk?.level;
        return r === 'Critico' || r === 'Crítico' || r === 'Alto';
      });
      if (hasRisk) {
        return 'atencion';
      }
      const allVerified = projectApus.every(a => {
        const c = a?.confidence;
        const score = typeof c === 'number' ? c : Number(c?.score) || 0;
        return score >= 70;
      });
      if (allVerified && projectApus.length > 0) {
        return 'completado';
      }
      return 'pendiente';
    }

    case 'entrega': {
      const status = String(project?.status || '').toLowerCase();
      if (status.includes('termin') || status.includes('cerrad') || (project?.dossierExported)) {
        return 'completado';
      }
      return 'pendiente';
    }

    default:
      return 'pendiente';
  }
}

/**
 * Deriva la etapa actual del ciclo del proyecto exclusivamente de datos reales.
 * Si no puede determinarse con certeza, devuelve null (nunca inventar).
 */
export function deriveProjectLifecycleStage({ project, apus = [], budgets = [], surveys = [] }) {
  if (!project?.id) return null;

  const status = String(project?.status || '').toLowerCase();
  if (status.includes('termin') || status.includes('cerrad')) {
    return WORKSPACE_STAGES[4]; // Entrega
  }

  // Secuencia determinista: la primera etapa que no esté completada es la etapa actual de obra
  for (const stage of WORKSPACE_STAGES) {
    const progress = computeStageProgress(stage.key, { project, apus, budgets, surveys });
    if (progress !== 'completado') {
      return stage;
    }
  }

  return WORKSPACE_STAGES[4]; // Todas completadas -> Entrega
}
