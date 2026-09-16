import { apiGetSafe } from '../../../services/apiClient.js';

export function filterProjectPlanoTakeoffs(planoTakeoffs, projectId) {
  if (!projectId || !Array.isArray(planoTakeoffs)) return [];
  return planoTakeoffs.filter(takeoff => (takeoff?.projectId ?? null) === projectId);
}

export async function fetchProjectPlanoTakeoffs(projectId) {
  if (!projectId) return [];
  const data = await apiGetSafe(`/api/plano-takeoffs?projectId=${encodeURIComponent(projectId)}`);
  return filterProjectPlanoTakeoffs(data?.planoTakeoffs, projectId);
}
