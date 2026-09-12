/* P0 (cierre real de la regresion "el archivo existe en Storage pero
   desaparece visualmente"): metadata de CADA foto/video capturado en
   Levantamiento IA, persistida en Firestore INDEPENDIENTEMENTE de si el
   usuario llega a terminar el wizard y hacer "Guardar" -- antes, la unica
   fuente de verdad era Survey.scanMedia, que solo se escribia al guardar
   el levantamiento completo; si el usuario subia una foto y abandonaba el
   wizard a medias (cambio de modulo, cerro el navegador), el archivo
   quedaba huerfano en Storage sin ningun registro en ningun lado.

   Modulo puro, sin Firebase/React -- solo forma de datos y normalizacion
   determinista. La escritura/lectura real vive en
   src/services/evidenceItemsApi.js. NUNCA guarda el blob/File -- solo
   metadata + storagePath (la URL de descarga se resuelve al vuelo, igual
   que ya hacia SurveyDetail.jsx#multimedia, nunca se persiste una URL
   firmada de larga duracion). */

export const EVIDENCE_KIND = Object.freeze({ PHOTO: 'photo', VIDEO: 'video' });
export const EVIDENCE_STATUS = Object.freeze({ UPLOADING: 'uploading', UPLOADED: 'uploaded', ERROR: 'error' });

/* id: mismo localId/fileId que ya usa PhoneScanSurveyForm.jsx para este
   item -- nunca se genera un id nuevo aqui, para que crear/actualizar el
   MISMO documento (uploading -> uploaded) sea un simple setDoc con merge,
   nunca dos documentos distintos para un mismo archivo. */
export function makeEvidenceItem({
  id, surveyId, projectId = null, organizationId = null, ownerUid,
  kind, storagePath, mimeType = '', sizeBytes = 0, durationSeconds = null,
  status = EVIDENCE_STATUS.UPLOADING, createdAt = Date.now()
}){
  return {
    id, surveyId, projectId, organizationId, ownerUid, uploadedBy: ownerUid,
    kind: kind === EVIDENCE_KIND.VIDEO ? EVIDENCE_KIND.VIDEO : EVIDENCE_KIND.PHOTO,
    storagePath: storagePath || '',
    mimeType: mimeType || '',
    sizeBytes: Number.isFinite(Number(sizeBytes)) ? Number(sizeBytes) : 0,
    durationSeconds: kind === EVIDENCE_KIND.VIDEO && Number.isFinite(Number(durationSeconds)) ? Number(durationSeconds) : null,
    status: Object.values(EVIDENCE_STATUS).includes(status) ? status : EVIDENCE_STATUS.UPLOADING,
    createdAt,
    updatedAt: Date.now()
  };
}

/* Normaliza un documento crudo leido de Firestore -- nunca lanza, nunca
   asume un campo ausente como un valor "seguro" inventado (ej. sizeBytes
   ausente queda en 0, nunca en un numero de relleno distinto). */
export function normalizeEvidenceItem(raw){
  if(!raw || typeof raw !== 'object' || !raw.id || !raw.storagePath) return null;
  return {
    id: String(raw.id),
    surveyId: raw.surveyId || null,
    projectId: raw.projectId || null,
    organizationId: raw.organizationId || null,
    ownerUid: raw.ownerUid || null,
    uploadedBy: raw.uploadedBy || raw.ownerUid || null,
    kind: raw.kind === EVIDENCE_KIND.VIDEO ? EVIDENCE_KIND.VIDEO : EVIDENCE_KIND.PHOTO,
    storagePath: String(raw.storagePath),
    mimeType: raw.mimeType || '',
    sizeBytes: Number(raw.sizeBytes) || 0,
    durationSeconds: raw.durationSeconds != null ? Number(raw.durationSeconds) : null,
    status: Object.values(EVIDENCE_STATUS).includes(raw.status) ? raw.status : EVIDENCE_STATUS.UPLOADED,
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0
  };
}

/* Reconstruccion de galeria (regla explicita del brief: "Firestore metadata
   -> Storage URL -> reconstruccion de galeria"): ordena por createdAt
   (mas antiguo primero, mismo orden en que se capturaron) y descarta
   cualquier documento que no haya podido normalizarse -- nunca revienta la
   pantalla completa por un documento corrupto/parcial aislado. */
export function buildGalleryFromEvidenceItems(rawItems){
  return (Array.isArray(rawItems) ? rawItems : [])
    .map(normalizeEvidenceItem)
    .filter(Boolean)
    .sort((a, b) => a.createdAt - b.createdAt);
}
