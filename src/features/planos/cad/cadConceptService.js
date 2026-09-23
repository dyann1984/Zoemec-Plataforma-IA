/* Puente del Plano Inteligente hacia Catalogo de conceptos y APU (punto 15).
   Solo red: la cantidad SIEMPRE se calcula en src/domain/cadTakeoff.js a
   partir del objeto geometrico; aqui unicamente se envia. Reusa los
   endpoints existentes (/api/catalogo-conceptos, /api/apus) y el mismo
   contrato de origen que ya usa el flujo de takeoff
   (syncQuantificationToCatalog, origenElementoId `${planoId}:${elementId}`),
   asi que reenviar el mismo objeto actualiza su concepto en vez de
   duplicarlo. */
import { apiGetSafe, apiPost } from '../../../services/apiClient.js';
import { syncQuantificationToCatalog } from '../../../domain/quantificationCostBridge.js';

export async function listProjectConcepts(projectId){
  if(!projectId) return [];
  const data = await apiGetSafe(`/api/catalogo-conceptos?projectId=${encodeURIComponent(projectId)}`);
  return Array.isArray(data?.conceptos) ? data.conceptos : [];
}

export async function listProjectApus(projectId){
  if(!projectId) return [];
  const data = await apiGetSafe(`/api/apus?projectId=${encodeURIComponent(projectId)}`);
  return Array.isArray(data?.apus) ? data.apus : [];
}

/* Crea (o actualiza, si ya existia desde este mismo objeto) el concepto. */
export async function createConceptFromElement({ projectId, planoId, elementId, concept, unit, qty, capitulo, fileName, user }){
  const res = await syncQuantificationToCatalog([{
    projectId, concept, unit, qty, sourceType: 'takeoff',
    sourceRecordId: planoId, sourceElementId: elementId, planId: planoId, page: 1, fileName: fileName || '',
    clave: elementId, capitulo: capitulo || 'OTROS', confirmedBy: user || null
  }], { reason: `Cuantificado desde el plano (${elementId})` });
  const created = Array.isArray(res?.conceptos) ? res.conceptos[0] : null;
  if(!created) throw new Error('El catalogo no devolvio el concepto creado.');
  return created;
}

/* Cantidad del concepto = suma de los objetos ligados (conceptQuantityFromModel). */
export async function updateConceptQuantity(conceptId, qty){
  const res = await apiPost('/api/catalogo-conceptos', { action: 'update', id: conceptId, patch: { qty } });
  return res?.concepto || null;
}

export async function associateConceptApu(conceptId, apuId){
  const res = await apiPost('/api/catalogo-conceptos', { action: 'associate-apu', id: conceptId, apuId, matchMethod: 'manual-plano' });
  return res?.concepto || null;
}
