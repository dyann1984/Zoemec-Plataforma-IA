import { isQuantifiable } from '../../../domain/planoReview.js';
import { computeReviewStageModel } from './reviewStageModel.js';
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
export function computeStageProgress(stageKey, { project, apus = [], budgets = [], surveys, evidenceItems, planos, planoTakeoffs = [], catalogConceptos = [], reviewModel = null, deliveryModel = null }) {
  const projectId = project?.id;
  if (!projectId) return 'pendiente';

  const projectApus = (apus || []).filter(a => (a?.projectId ?? null) === projectId);
  const projectBudgets = (budgets || []).filter(b => (b?.projectId ?? null) === projectId);
  const projectSurveys = (surveys || []).filter(s => (s?.projectId ?? null) === projectId);
  const projectEvidenceItems = (evidenceItems || []).filter(e => (e?.projectId ?? null) === projectId);
  const projectPlanos = (planos || []).filter(p => (p?.projectId ?? null) === projectId);
  const projectTakeoffs = (planoTakeoffs || []).filter(t => (t?.projectId ?? null) === projectId);

  switch (stageKey) {
    case 'evidencia': {
      // Prioridad 1: Información real persistida y consultada para el projectId actual
      if (projectSurveys.length > 0 || projectEvidenceItems.length > 0 || projectPlanos.length > 0) {
        return 'completado';
      }
      // Fallback secundario: solo si las colecciones no fueron provistas/consultadas
      const collectionsProvided = surveys !== undefined || evidenceItems !== undefined || planos !== undefined;
      if (!collectionsProvided && Number(project?.evidenceCount) > 0) {
        return 'completado';
      }
      return 'pendiente';
    }

    case 'cuantificacion': {
      // Regla determinista estricta:
      // 1. Existe al menos un planoTakeoff persistido del projectId con elementos confirmados/validados (> 0)
      const hasConfirmedTakeoff = projectTakeoffs.some(takeoff => {
        const elementos = Array.isArray(takeoff?.snapshot?.elementos)
          ? takeoff.snapshot.elementos
          : (Array.isArray(takeoff?.elementos) ? takeoff.elementos : []);
        return elementos.some(el => {
          const isConfirmed = isQuantifiable(el?.estado);
          const qty = Number(el?.cantidadCorregida ?? el?.cantidadPropuesta ?? el?.dimension?.area ?? el?.dimension?.longitud ?? 0);
          return isConfirmed && qty > 0;
        });
      });

      // 2. OR existe al menos un survey persistido del projectId con cantidades geométricas reales mayores a cero
      const hasQuantifiedSurvey = projectSurveys.some(survey => {
        const spaces = Array.isArray(survey?.spaces) ? survey.spaces : [];
        const hasSpaceQuantities = spaces.some(s => {
          const floorArea = Number(s?.floorArea || 0);
          const wallNetArea = Number(s?.wallNetArea || 0);
          const perimeter = Number(s?.perimeter || 0);
          const volume = Number(s?.volume || 0);
          const length = Number(s?.length || 0);
          return floorArea > 0 || wallNetArea > 0 || perimeter > 0 || volume > 0 || length > 0;
        });
        const totals = survey?.totals;
        const hasTotals = Number(totals?.floorArea || 0) > 0 || Number(totals?.wallNetArea || 0) > 0;
        return hasSpaceQuantities || hasTotals;
      });

      if (hasConfirmedTakeoff || hasQuantifiedSurvey) {
        return 'completado';
      }
      return 'pendiente';
    }

    case 'costos': {
      const concepts = (catalogConceptos || []).filter(c => (c?.projectId ?? null) === projectId);
      const quantified = concepts.filter(c => Number(c?.qty) > 0);
      if (quantified.length === 0) return 'pendiente';
      const apuById = new Map(projectApus.map(apu => [apu.id, apu]));
      const ready = quantified.filter(c => {
        const pu = Number(apuById.get(c.apuId)?.calculated?.pu);
        return Boolean(c.apuId) && Number.isFinite(pu) && pu > 0;
      });
      return ready.length > 0 && ready.length === quantified.length ? 'completado' : 'atencion';
    }

    case 'revision': {
      if (reviewModel?.projectId === projectId) return reviewModel.status;
      return computeReviewStageModel({
        projectId,
        apus: projectApus,
        catalogConceptos
      }).status;
    }

    case 'entrega': {
      if (deliveryModel?.projectId === projectId) {
        return deliveryModel.status;
      }

      if (projectApus.length === 0) {
        return 'pendiente';
      }

      return 'atencion';
    }

    default:
      return 'pendiente';
  }
}

/**
 * Deriva la etapa actual del ciclo del proyecto exclusivamente de datos reales.
 * Si no puede determinarse con certeza, devuelve null (nunca inventar).
 */
export function deriveProjectLifecycleStage({ project, apus = [], budgets = [], surveys = [], evidenceItems = [], planos = [], planoTakeoffs = [], catalogConceptos = [], reviewModel = null, deliveryModel = null }) {
  if (!project?.id) return null;

  const status = String(project?.status || '').toLowerCase();
  if (status.includes('termin') || status.includes('cerrad')) {
    return WORKSPACE_STAGES[4]; // Entrega
  }

  // Secuencia determinista: la primera etapa que no esté completada es la etapa actual de obra
  for (const stage of WORKSPACE_STAGES) {
    const progress = computeStageProgress(stage.key, { project, apus, budgets, surveys, evidenceItems, planos, planoTakeoffs, catalogConceptos, reviewModel, deliveryModel });
    if (progress !== 'completado') {
      return stage;
    }
  }

  return WORKSPACE_STAGES[WORKSPACE_STAGES.length - 1]; // Todas completadas -> Entrega
}
