/* F4 -- Acceso UNICO al plano CAD persistido (planoTakeoffs) desde el
   cliente: lo usan el CAD de Levantamiento (SurveyCadTab) y el Plano
   Inteligente (PlanoTakeoffWorkspace).
     save-draft   = autosave (borrador vigente, sin version historica)
     save-version = checkpoint inmutable (boton "Guardar version")
   Ambos llevan expectedRevision: un 409 REVISION_CONFLICT nunca se
   sobrescribe; el llamador avisa y ofrece recargar. */
import { apiGetSafe, apiPost } from '../../services/apiClient.js';

export async function loadPlano(planoId){
  const data = await apiGetSafe(`/api/plano-takeoffs?id=${encodeURIComponent(planoId)}`);
  return data?.planoTakeoff || null;
}
export async function loadPlanoVersions(planoId){
  const data = await apiGetSafe(`/api/plano-takeoffs?id=${encodeURIComponent(planoId)}`);
  return Array.isArray(data?.versions) ? data.versions : [];
}

export async function createPlano({ planoId, projectId, fileName = '', mimeType = '', numPages = 1, cadModel, elementos = [], escalaResuelta = null, sourceKind = null, surveyId = null, spaceId = null, reason = null }){
  const res = await apiPost('/api/plano-takeoffs', {
    action: 'create', id: planoId, projectId, fileName, mimeType, numPages, sourceKind, surveyId, spaceId, reason,
    snapshot: { elementos, escalaResuelta, fileName, cadModel }
  });
  return res.planoTakeoff;
}

export async function saveDraft({ planoId, snapshot, expectedRevision }){
  const res = await apiPost('/api/plano-takeoffs', { action: 'save-draft', id: planoId, snapshot, expectedRevision });
  return res.planoTakeoff;
}

export async function saveCheckpoint({ planoId, snapshot, expectedRevision, reason = 'Checkpoint' }){
  const res = await apiPost('/api/plano-takeoffs', { action: 'save-version', id: planoId, snapshot, expectedRevision, reason });
  return res.planoTakeoff;
}

export const isRevisionConflict = err => err?.status === 409 && (err?.code === 'REVISION_CONFLICT' || err?.code === 'VERSION_CONFLICT');
