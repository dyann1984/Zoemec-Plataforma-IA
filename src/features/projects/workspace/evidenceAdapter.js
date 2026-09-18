/**
 * Adaptador de lectura y normalización para la etapa Evidencia de ZOEMEC.
 * Reúne datos reales de:
 * 1. evidenceItems (fotos / videos subidos en Storage y registrados en Firestore)
 * 2. surveys (Levantamientos IA con scanMedia, modelos 3D y espacios)
 * 3. planos (Planos PDF / CAD del motor visual y takeoff)
 * 4. modelos 3D directos
 *
 * REGLAS ARQUITECTÓNICAS:
 * - NO copia registros entre colecciones.
 * - Deduplica estrictamente (si un survey ya contiene una foto/video de evidenceItems, no se muestra doble).
 * - Genera una estructura inmutable y normalizada ProjectEvidenceRecord para la presentación.
 */

export const EVIDENCE_SOURCE = Object.freeze({
  EVIDENCE_ITEM: 'evidence_item',
  SURVEY: 'survey',
  PLANO: 'plano',
  MODEL_3D: 'model_3d'
});

export const EVIDENCE_TYPE = Object.freeze({
  PHOTO: 'photo',
  VIDEO: 'video',
  PLANO: 'plano',
  MODEL_3D: 'model_3d',
  SURVEY: 'survey'
});

export const ANALYSIS_STATUS = Object.freeze({
  ANALYZED: 'analizado',
  IN_PROGRESS: 'en_proceso',
  PENDING: 'pendiente',
  REQUIRES_REVIEW: 'requiere_revision',
  ERROR: 'error'
});

/**
 * Normaliza cualquier evidencia en la representación de lectura ProjectEvidenceRecord.
 */
export function makeProjectEvidenceRecord({
  id,
  source,
  type,
  projectId,
  name,
  createdAt = Date.now(),
  preview = null,
  analysisStatus = ANALYSIS_STATUS.PENDING,
  sourceRecordId,
  sizeBytes = 0,
  mimeType = '',
  storagePath = '',
  metadata = {}
}) {
  return Object.freeze({
    id: String(id),
    source,
    type,
    projectId: projectId || null,
    name: name || 'Sin título',
    createdAt: Number(createdAt) || Date.now(),
    preview: preview || null,
    analysisStatus,
    sourceRecordId: sourceRecordId || id,
    sizeBytes: Number(sizeBytes) || 0,
    mimeType: mimeType || '',
    storagePath: storagePath || '',
    metadata: metadata || {}
  });
}

/**
 * Agrega y normaliza todas las evidencias del proyecto activo eliminando duplicados.
 *
 * @param {Object} params
 * @param {string} params.projectId ID del proyecto actual
 * @param {Array} params.evidenceItems Colección de evidenceItems
 * @param {Array} params.surveys Colección de levantamientos del proyecto
 * @param {Array} params.planos Colección de planos del proyecto
 * @returns {Array<ProjectEvidenceRecord>} Lista deduplicada ordenada cronológicamente (más recientes primero)
 */
export function buildProjectEvidenceList({
  projectId,
  evidenceItems = [],
  surveys = [],
  planos = []
}) {
  if (!projectId) return [];

  const records = [];
  const seenStoragePaths = new Set();
  const seenIds = new Set();

  // 1. Procesar Surveys (Levantamientos IA) del proyecto
  const projectSurveys = (surveys || []).filter(s => (s?.projectId ?? null) === projectId);

  for (const survey of projectSurveys) {
    const spacesCount = Array.isArray(survey.spaces) ? survey.spaces.length : 0;
    const mediaCount = Array.isArray(survey.scanMedia) ? survey.scanMedia.length : 0;
    const has3D = survey.sourceType === 'import_3d' || Boolean(survey.modelFile);

    // Registro principal del levantamiento
    records.push(makeProjectEvidenceRecord({
      id: `survey-${survey.id}`,
      source: EVIDENCE_SOURCE.SURVEY,
      type: has3D ? EVIDENCE_TYPE.MODEL_3D : EVIDENCE_TYPE.SURVEY,
      projectId,
      name: survey.name || `Levantamiento ${survey.id}`,
      createdAt: survey.createdAt || Date.now(),
      preview: survey.thumbnail || null,
      analysisStatus: spacesCount > 0 ? ANALYSIS_STATUS.ANALYZED : ANALYSIS_STATUS.PENDING,
      sourceRecordId: survey.id,
      sizeBytes: survey.modelFile?.size || 0,
      mimeType: has3D ? 'model/gltf-binary' : 'application/json',
      storagePath: survey.modelFile?.storagePath || '',
      metadata: {
        spacesCount,
        mediaCount,
        sourceType: survey.sourceType || 'manual',
        description: survey.description || ''
      }
    }));
    seenIds.add(survey.id);

    // Registrar los storagePaths de su scanMedia para evitar que aparezcan duplicados si también vienen en evidenceItems
    if (Array.isArray(survey.scanMedia)) {
      for (const m of survey.scanMedia) {
        if (m.storagePath) seenStoragePaths.add(m.storagePath);
        if (m.id) seenIds.add(m.id);
      }
    }
  }

  // 2. Procesar Planos vinculados al proyecto
  const projectPlanos = (planos || []).filter(p => (p?.projectId ?? null) === projectId);

  for (const plano of projectPlanos) {
    const elemCount = Array.isArray(plano.snapshot?.elementos) ? plano.snapshot.elementos.length : 0;
    records.push(makeProjectEvidenceRecord({
      id: `plano-${plano.id}`,
      source: EVIDENCE_SOURCE.PLANO,
      type: EVIDENCE_TYPE.PLANO,
      projectId,
      name: plano.fileName || plano.name || `Plano ${plano.id}`,
      createdAt: plano.createdAt || Date.now(),
      preview: plano.thumbnail || null,
      analysisStatus: elemCount > 0 ? ANALYSIS_STATUS.ANALYZED : ANALYSIS_STATUS.PENDING,
      sourceRecordId: plano.id,
      sizeBytes: plano.sizeBytes || 0,
      mimeType: plano.mimeType || 'application/pdf',
      storagePath: plano.storagePath || '',
      metadata: {
        numPages: plano.numPages || 1,
        elementCount: elemCount,
        scale: plano.snapshot?.escalaResuelta || null
      }
    }));
    seenIds.add(plano.id);
    if (plano.storagePath) seenStoragePaths.add(plano.storagePath);
  }

  // 3. Procesar EvidenceItems independientes (fotos / videos directos no absorbidos en surveys)
  const projectItems = (evidenceItems || []).filter(e => (e?.projectId ?? null) === projectId);

  for (const item of projectItems) {
    // Deduplicación estricta: omitir si ya fue registrado por un survey
    if (item.id && seenIds.has(item.id)) continue;
    if (item.storagePath && seenStoragePaths.has(item.storagePath)) continue;

    const isVideo = item.kind === 'video' || (item.mimeType || '').startsWith('video/');
    const is3D = item.kind === '3d' || (item.mimeType || '').includes('gltf') || (item.storagePath || '').endsWith('.glb') || (item.storagePath || '').endsWith('.gltf') || (item.storagePath || '').endsWith('.obj');
    const isPlano = item.kind === 'plano' || (item.mimeType || '').includes('pdf') || (item.storagePath || '').endsWith('.pdf');

    let resolvedType = EVIDENCE_TYPE.PHOTO;
    if (isVideo) resolvedType = EVIDENCE_TYPE.VIDEO;
    else if (is3D) resolvedType = EVIDENCE_TYPE.MODEL_3D;
    else if (isPlano) resolvedType = EVIDENCE_TYPE.PLANO;

    records.push(makeProjectEvidenceRecord({
      id: `ev-${item.id}`,
      source: EVIDENCE_SOURCE.EVIDENCE_ITEM,
      type: resolvedType,
      projectId,
      name: item.name || (isVideo ? `Video ${item.id.slice(0, 8)}` : `Foto ${item.id.slice(0, 8)}`),
      createdAt: item.createdAt || Date.now(),
      preview: item.previewUrl || item.downloadUrl || null,
      analysisStatus: item.analysisStatus || (item.status === 'uploaded' ? ANALYSIS_STATUS.PENDING : ANALYSIS_STATUS.IN_PROGRESS),
      sourceRecordId: item.id,
      sizeBytes: item.sizeBytes || 0,
      mimeType: item.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
      storagePath: item.storagePath || '',
      metadata: {
        durationSeconds: item.durationSeconds || null,
        status: item.status || 'uploaded',
        ownerUid: item.ownerUid || null
      }
    }));

    if (item.id) seenIds.add(item.id);
    if (item.storagePath) seenStoragePaths.add(item.storagePath);
  }

  // Ordenar por fecha de creación descendente (más recientes primero)
  return records.sort((a, b) => b.createdAt - a.createdAt);
}
