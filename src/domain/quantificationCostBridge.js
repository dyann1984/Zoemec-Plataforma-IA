/* Canonical bridge from confirmed quantities to catalog concepts.
   This module never calculates geometry, prices, or APU totals. The catalog
   quantity is the economic quantity; APU sourceQty/cantidadObra remain
   compatibility snapshots only. */
import { apiPost } from '../services/apiClient.js';

const SOURCE_TYPES = new Set(['takeoff', 'survey', 'manual', 'import']);

function requiredText(value, field){
  const text = String(value ?? '').trim();
  if(!text) throw new Error(`Falta ${field}.`);
  return text;
}

export function normalizeConfirmedQuantity(input = {}){
  const projectId = requiredText(input.projectId, 'projectId');
  const concept = requiredText(input.concept, 'concept');
  const unit = requiredText(input.unit, 'unit');
  const qty = Number(input.qty);
  if(!Number.isFinite(qty) || qty <= 0) throw new Error('La cantidad confirmada debe ser mayor que cero.');
  const sourceType = requiredText(input.sourceType, 'sourceType').toLowerCase();
  if(!SOURCE_TYPES.has(sourceType)) throw new Error(`sourceType no soportado: ${sourceType}.`);
  if((sourceType === 'takeoff' || sourceType === 'survey') && !input.sourceRecordId){
    throw new Error('La cantidad cuantificada necesita sourceRecordId.');
  }
  const sourceRecordId = input.sourceRecordId ? String(input.sourceRecordId) : null;
  const sourceElementId = input.sourceElementId ? String(input.sourceElementId) : null;
  const origenElementoId = sourceElementId
    ? (sourceType === 'takeoff'
      ? `${sourceRecordId}:${sourceElementId}`
      : `${sourceType}:${sourceRecordId}:${sourceElementId}`)
    : (sourceRecordId ? `${sourceType}:${sourceRecordId}` : null);
  return {
    projectId, concept, unit, qty,
    sourceType, sourceRecordId, sourceElementId,
    planId: input.planId ? String(input.planId) : null,
    surveyId: input.surveyId ? String(input.surveyId) : null,
    confirmedAt: input.confirmedAt || new Date().toISOString(),
    confirmedBy: input.confirmedBy ? String(input.confirmedBy) : null,
    origenElementoId,
    origenCantidad: sourceType === 'takeoff' || sourceType === 'survey' ? 'Cuantificación confirmada' : sourceType === 'manual' ? 'Manual' : 'Importada',
    origenPlano: sourceType === 'takeoff'
      ? { sourceType, planoTakeoffId: input.planId || input.sourceRecordId, elementoId: sourceElementId, page: input.page ?? null, fileName: input.fileName || '' }
      : sourceType === 'survey'
        ? { sourceType, surveyId: input.surveyId || input.sourceRecordId, elementoId: sourceElementId }
        : null
  };
}

export function toCatalogConceptInput(input = {}){
  const entry = normalizeConfirmedQuantity(input);
  return {
    projectId: entry.projectId,
    clave: input.clave || entry.sourceElementId || entry.sourceRecordId || undefined,
    capitulo: input.capitulo || 'OTROS',
    concept: entry.concept,
    unit: entry.unit,
    qty: entry.qty,
    origenElementoId: entry.origenElementoId,
    origenPlano: entry.origenPlano,
    origenCantidad: entry.origenCantidad,
    sourceType: entry.sourceType,
    sourceRecordId: entry.sourceRecordId,
    sourceElementId: entry.sourceElementId,
    planId: entry.planId,
    surveyId: entry.surveyId,
    confirmedAt: entry.confirmedAt,
    confirmedBy: entry.confirmedBy,
    referencePU: 0
  };
}

export async function syncQuantificationToCatalog(entries, { request = apiPost, reason = 'Sincronización de cantidad confirmada' } = {}){
  if(!Array.isArray(entries) || !entries.length) throw new Error('No hay cantidades confirmadas para sincronizar.');
  const normalized = entries.map(toCatalogConceptInput);
  const projectIds = new Set(normalized.map(item => item.projectId));
  if(projectIds.size !== 1) throw new Error('Una sincronización solo puede pertenecer a un projectId.');
  const projectId = normalized[0].projectId;
  return request('/api/catalogo-conceptos', { action: 'create', projectId, conceptos: normalized, reason });
}

export function isManualOrImportedQuantity(entry = {}){
  return entry.sourceType === 'manual' || entry.sourceType === 'import';
}
