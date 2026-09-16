import { uploadScanMedia, deleteScanMedia } from '../../../lib/levantamientoMediaUpload.js';
import { recordEvidenceItem } from '../../../services/evidenceItemsApi.js';

/**
 * Orquesta la subida de un archivo de evidencia con semántica de compensación tipo Saga.
 *
 * @param {Object} params
 * @param {File|Blob} params.file - Archivo a subir
 * @param {string} params.kind - Clasificador ('photo' | 'video' | '3d' | 'plano')
 * @param {string} params.projectId - Identificador de la obra activa
 * @param {string} params.userUid - Identificador del usuario autenticado
 * @param {Object} [params.metadata] - Metadatos adicionales (dimensiones, mallas, duración)
 * @param {Function} [params.uploadFn] - Inyección de función de subida a Storage (para testeo)
 * @param {Function} [params.recordMetadataFn] - Inyección de función de guardado en Firestore (para testeo)
 * @param {Function} [params.deleteStorageFn] - Inyección de función de eliminación en Storage (para testeo)
 * @param {number} [params.maxRetries] - Intentos de reintento de Firestore ante fallos transitorios
 * @returns {Promise<Object>} Resultado { ok, stage, storagePath, evidenceItem, cleanupSuccess, isOrphan, message, error }
 */
export async function uploadEvidenceWithCompensation({
  file,
  kind,
  projectId,
  userUid,
  metadata = {},
  uploadFn = uploadScanMedia,
  recordMetadataFn = recordEvidenceItem,
  deleteStorageFn = deleteScanMedia,
  maxRetries = 2
}) {
  if (!file) {
    return {
      ok: false,
      stage: 'validation',
      reason: 'missing_file',
      message: 'No se proporcionó ningún archivo para subir.'
    };
  }

  if (!projectId) {
    return {
      ok: false,
      stage: 'validation',
      reason: 'missing_project_id',
      message: 'No hay un proyecto activo seleccionado.'
    };
  }

  // 1. Subida a Firebase Storage
  let uploadResult;
  try {
    uploadResult = await uploadFn(file, {
      userUid: userUid || 'guest',
      projectId,
      kind
    });
  } catch (storageErr) {
    return {
      ok: false,
      stage: 'storage_upload',
      reason: 'storage_exception',
      message: 'Fallo inesperado al conectar con el servicio de almacenamiento.',
      error: storageErr?.message || String(storageErr),
      storagePath: null,
      evidenceItem: null
    };
  }

  if (!uploadResult || !uploadResult.ok) {
    return {
      ok: false,
      stage: 'storage_upload',
      reason: uploadResult?.reason || 'storage_upload_failed',
      message: uploadResult?.message || 'Error al subir el archivo al almacenamiento.',
      storagePath: null,
      evidenceItem: null
    };
  }

  const { fileId, storagePath, downloadUrl, fileName, mimeType, sizeBytes } = uploadResult;

  const itemToRecord = {
    id: fileId,
    projectId,
    ownerUid: userUid || 'guest',
    name: fileName || file.name || 'evidencia',
    kind,
    storagePath,
    previewUrl: downloadUrl || null,
    mimeType: mimeType || file.type || 'application/octet-stream',
    sizeBytes: sizeBytes ?? (file.size || 0),
    status: 'uploaded',
    createdAt: Date.now(),
    metadata: metadata || {}
  };

  // 2. Guardado en Firestore con reintentos controlados
  let firestoreSuccess = false;
  let lastFirestoreError = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const res = await recordMetadataFn(itemToRecord, { throwOnError: true });
      if (res === null) {
        throw new Error('No se pudo guardar la metadata en Firestore.');
      }
      firestoreSuccess = true;
      break;
    } catch (err) {
      lastFirestoreError = err;
      if (attempt <= maxRetries) {
        // Breve pausa exponencial antes de reintentar
        await new Promise(r => setTimeout(r, 60 * attempt));
      }
    }
  }

  // 3. Compensación: si Firestore falló definitivamente tras los reintentos
  if (!firestoreSuccess) {
    console.error(
      `[evidenceUploadService] Firestore falló para ${storagePath}. Iniciando operación compensatoria de eliminación en Storage...`,
      lastFirestoreError
    );

    let cleanupSuccess = false;
    let cleanupError = null;

    try {
      const delRes = await deleteStorageFn(storagePath);
      // deleteScanMedia retorna { ok: true } o boolean true al tener éxito
      cleanupSuccess = delRes !== false && (!delRes || delRes.ok !== false);
    } catch (delErr) {
      cleanupError = delErr;
      cleanupSuccess = false;
    }

    if (!cleanupSuccess) {
      // Registrar diagnóstico explícito del archivo huérfano sin crear base paralela
      console.error(
        `[EvidenceOrphanDiagnostic] CRITICAL: Falló la limpieza compensatoria en Storage para el archivo huérfano: "${storagePath}". Requiere revisión de mantenimiento.`,
        cleanupError
      );
    }

    return {
      ok: false,
      stage: 'firestore_metadata',
      reason: 'firestore_metadata_failed',
      message: 'No se pudo registrar la metadata de la evidencia en la base de datos.',
      storagePath,
      cleanupAttempted: true,
      cleanupSuccess,
      isOrphan: !cleanupSuccess,
      error: lastFirestoreError?.message || String(lastFirestoreError),
      evidenceItem: null
    };
  }

  // 4. Éxito de ambas fases
  return {
    ok: true,
    stage: 'completed',
    storagePath,
    evidenceItem: itemToRecord
  };
}
