import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { Icon } from '../../../components/ui/Icon.jsx';
import { auth } from '../../../firebase.js';
import { EvidenceCameraModal } from './EvidenceCameraModal.jsx';
import { EvidenceGallery } from './EvidenceGallery.jsx';
import { buildProjectEvidenceList } from './evidenceAdapter.js';
import { uploadEvidenceWithCompensation } from './evidenceUploadService.js';
import {
  fetchEvidenceItemsForProject,
  deleteEvidenceItem
} from '../../../services/evidenceItemsApi.js';
import { deleteScanMedia } from '../../../lib/levantamientoMediaUpload.js';
import {
  validateScanMediaFile,
  SCAN_MEDIA_KIND
} from '../../../domain/levantamientoMedia.js';
import { validateImportFile } from '../../../domain/levantamientoImporters.js';
import { loadModel3D } from '../../../lib/levantamientoModelLoader.js';

export function EvidenceStage({
  project,
  surveys = [],
  initialEvidenceItems = null,
  onNavigateToLevantamiento,
  onNavigateToPlano,
  onEvidenceUpdated
}) {
  const { t: tr } = useI18n();
  const projectId = project?.id;
  const userUid = auth.currentUser?.uid || 'guest';

  // Colección de evidenceItems persistida y normalizada (únicamente desde fuentes canónicas)
  const [evidenceItems, setEvidenceItems] = useState(initialEvidenceItems || []);
  const [planos, setPlanos] = useState([]);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // { fileName, progress, status }
  const [statusMessage, setStatusMessage] = useState(null); // { type: 'success' | 'error' | 'info', text }

  // Referencias a inputs de archivos ocultos
  const photoInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const planoInputRef = useRef(null);
  const model3dInputRef = useRef(null);

  // 1. Cargar evidencias exclusivamente desde la fuente de verdad persistida (Firestore)
  useEffect(() => {
    if (!projectId) return;

    let isMounted = true;
    fetchEvidenceItemsForProject(projectId, userUid).then(remoteItems => {
      if (!isMounted) return;
      if (Array.isArray(remoteItems) && (remoteItems.length > 0 || !initialEvidenceItems)) {
        setEvidenceItems(remoteItems);
      }
    }).catch(err => {
      console.error('[EvidenceStage] Error al consultar evidenceItems:', err);
    });

    return () => {
      isMounted = false;
    };
  }, [projectId, userUid, initialEvidenceItems]);

  // 2. Notificar al Workspace cuando las evidencias cambien para recalcular el stepper
  useEffect(() => {
    onEvidenceUpdated?.({ evidenceItems, planos });
  }, [evidenceItems, planos, onEvidenceUpdated]);

  const showNotification = (text, type = 'success') => {
    setStatusMessage({ text, type });
    setTimeout(() => {
      setStatusMessage(null);
    }, 4500);
  };

  // -------------------------------------------------------------
  // MANEJADOR 1: FOTO / IMAGEN (Archivo o Captura de cámara)
  // -------------------------------------------------------------
  const handleSavePhotoBlob = async (blob, fileName = null) => {
    if (!blob || !projectId) return;
    const name = fileName || `Foto_${new Date().toISOString().slice(0, 10)}_${Date.now().toString().slice(-4)}.jpg`;

    // Validación de límites
    const validation = validateScanMediaFile({
      kind: SCAN_MEDIA_KIND.PHOTO,
      sizeBytes: blob.size,
      currentCount: evidenceItems.length
    });

    if (!validation.valid) {
      showNotification('El archivo excede el límite permitido para imágenes (máx 10 MB).', 'error');
      return;
    }

    setUploadProgress({ fileName: name, progress: 0.2, status: 'uploading' });

    const uploadRes = await uploadEvidenceWithCompensation({
      file: blob,
      kind: 'photo',
      projectId,
      userUid,
      metadata: { name }
    });

    setUploadProgress(null);

    if (uploadRes.ok) {
      setEvidenceItems(prev => [uploadRes.evidenceItem, ...prev]);
      showNotification('Fotografía guardada correctamente en el proyecto.');
    } else {
      if (uploadRes.cleanupAttempted) {
        showNotification(
          'Fallo al registrar metadata en Firestore. Se canceló la subida y se limpió el archivo de Storage.',
          'error'
        );
      } else {
        showNotification(uploadRes.message || 'Error al guardar la fotografía.', 'error');
      }
    }
  };

  const handlePhotoFilesSelected = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    for (const file of files) {
      await handleSavePhotoBlob(file, file.name);
    }
    e.target.value = '';
  };

  // -------------------------------------------------------------
  // MANEJADOR 2: VIDEO
  // -------------------------------------------------------------
  const handleVideoFilesSelected = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const file = files[0];

    const validation = validateScanMediaFile({
      kind: SCAN_MEDIA_KIND.VIDEO,
      sizeBytes: file.size,
      currentCount: evidenceItems.length
    });

    if (!validation.valid) {
      showNotification('El video excede el límite permitido (máx 200 MB).', 'error');
      e.target.value = '';
      return;
    }

    setUploadProgress({ fileName: file.name, progress: 0.2, status: 'uploading' });

    const uploadRes = await uploadEvidenceWithCompensation({
      file,
      kind: 'video',
      projectId,
      userUid,
      metadata: {}
    });

    setUploadProgress(null);
    e.target.value = '';

    if (uploadRes.ok) {
      setEvidenceItems(prev => [uploadRes.evidenceItem, ...prev]);
      showNotification(`Video "${file.name}" guardado correctamente.`);
    } else {
      if (uploadRes.cleanupAttempted) {
        showNotification(
          'Fallo al registrar metadata en Firestore. Se canceló la subida y se limpió el archivo de Storage.',
          'error'
        );
      } else {
        showNotification(uploadRes.message || 'Error al guardar el video.', 'error');
      }
    }
  };

  // -------------------------------------------------------------
  // MANEJADOR 3: PLANO (PDF / Imagen de plano)
  // -------------------------------------------------------------
  const handlePlanoFilesSelected = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const file = files[0];

    if (file.size > 50 * 1024 * 1024) {
      showNotification('El plano excede el límite de 50 MB.', 'error');
      e.target.value = '';
      return;
    }

    setUploadProgress({ fileName: file.name, progress: 0.2, status: 'uploading' });

    const uploadRes = await uploadEvidenceWithCompensation({
      file,
      kind: 'plano',
      projectId,
      userUid,
      metadata: {
        isPdf: file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      }
    });

    setUploadProgress(null);
    e.target.value = '';

    if (uploadRes.ok) {
      setEvidenceItems(prev => [uploadRes.evidenceItem, ...prev]);
      showNotification(`Plano "${file.name}" guardado y vinculado al proyecto.`);
    } else {
      if (uploadRes.cleanupAttempted) {
        showNotification(
          'Fallo al registrar metadata en Firestore. Se canceló la subida y se limpió el archivo de Storage.',
          'error'
        );
      } else {
        showNotification(uploadRes.message || 'Error al guardar el plano.', 'error');
      }
    }
  };

  // -------------------------------------------------------------
  // MANEJADOR 4: MODELO 3D (GLB / GLTF / OBJ)
  // -------------------------------------------------------------
  const handleModel3dSelected = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const file = files[0];

    const validation = validateImportFile(file);
    if (!validation.valid) {
      showNotification('Formato 3D no compatible o archivo mayor a 50 MB.', 'error');
      e.target.value = '';
      return;
    }

    setUploadProgress({ fileName: file.name, progress: 0.3, status: 'procesando' });

    try {
      const loadRes = await loadModel3D(file, validation.format.id, {
        onProgress: ev => {
          if (ev?.lengthComputable) {
            setUploadProgress({ fileName: file.name, progress: ev.loaded / ev.total, status: 'cargando' });
          }
        }
      });

      if (!loadRes.ok) {
        showNotification(loadRes.message || 'Error al procesar el archivo 3D.', 'error');
        setUploadProgress(null);
        e.target.value = '';
        return;
      }

      setUploadProgress({ fileName: file.name, progress: 0.6, status: 'subiendo' });

      const uploadRes = await uploadEvidenceWithCompensation({
        file,
        kind: '3d',
        projectId,
        userUid,
        metadata: {
          meshCount: loadRes.meshCount,
          triangleCount: loadRes.triangleCount,
          boundingBox: loadRes.boundingBox
        }
      });

      if (uploadRes.ok) {
        // Enlazar temporalmente el THREE.Object3D cargado en memoria para visualización inmediata en visor 3D
        if (loadRes.object3D) {
          uploadRes.evidenceItem.metadata = {
            ...uploadRes.evidenceItem.metadata,
            rawObject3D: loadRes.object3D
          };
        }
        setEvidenceItems(prev => [uploadRes.evidenceItem, ...prev]);
        showNotification(`Modelo 3D "${file.name}" cargado correctamente.`);
      } else {
        if (uploadRes.cleanupAttempted) {
          showNotification(
            'Fallo al registrar metadata en Firestore. Se canceló la subida y se limpió el archivo de Storage.',
            'error'
          );
        } else {
          showNotification(uploadRes.message || 'Error al guardar el modelo 3D.', 'error');
        }
      }
    } catch {
      showNotification('Ocurrió un fallo al decodificar la geometría 3D.', 'error');
    } finally {
      setUploadProgress(null);
      e.target.value = '';
    }
  };

  // -------------------------------------------------------------
  // ELIMINACIÓN DE REGISTRO
  // -------------------------------------------------------------
  const handleDeleteRecord = async (record) => {
    if (!confirm(`¿Deseas eliminar "${record.name}" del proyecto?`)) return;

    if (record.source === 'evidence_item') {
      await deleteEvidenceItem(record.sourceRecordId);
      if (record.storagePath && !record.storagePath.startsWith('local-')) {
        deleteScanMedia(record.storagePath);
      }
      setEvidenceItems(prev => prev.filter(i => i.id !== record.sourceRecordId));
      showNotification('Evidencia eliminada.');
    } else if (record.source === 'plano') {
      setPlanos(prev => prev.filter(p => p.id !== record.sourceRecordId));
      showNotification('Plano desvinculado.');
    } else if (record.source === 'survey') {
      showNotification('Los levantamientos se gestionan directamente desde el módulo Levantamiento IA.', 'info');
    }
  };

  // Lista normalizada y deduplicada exclusivamente desde fuentes autoritativas
  const unifiedEvidenceList = buildProjectEvidenceList({
    projectId,
    evidenceItems,
    surveys,
    planos
  });

  return (
    <div className="project-evidence-stage">
      {/* Barra de estado / notificaciones */}
      {statusMessage && (
        <div className={`evidence-toast-alert alert-${statusMessage.type}`}>
          <Icon name={statusMessage.type === 'error' ? 'atencion' : 'check'} size={16} />
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Barra de progreso de subida */}
      {uploadProgress && (
        <div className="evidence-upload-banner">
          <div className="upload-banner-info">
            <span className="spinner" />
            <span>Subiendo <b>{uploadProgress.fileName}</b>...</span>
            <span className="progress-percent">{Math.round(uploadProgress.progress * 100)}%</span>
          </div>
          <div className="upload-progress-bar">
            <div className="upload-progress-fill" style={{ width: `${Math.round(uploadProgress.progress * 100)}%` }} />
          </div>
        </div>
      )}

      {/* Encabezado y Barra de Acciones Principales */}
      <div className="evidence-action-card">
        <div className="evidence-action-header">
          <div className="evidence-header-texts">
            <h3>{tr('evidence.sectionTitle') || 'Evidencia del proyecto'}</h3>
            <p className="muted">
              {tr('evidence.sectionSubtitle') || 'Registra fotografías, videos de recorrido, planos arquitectónicos y modelos 3D asociados a esta obra.'}
            </p>
          </div>

          <button
            type="button"
            className="btn-ai-analyze"
            onClick={onNavigateToLevantamiento}
            title="Abrir asistente de Levantamiento IA con este proyecto activo"
          >
            <Icon name="sparkles" size={17} />
            <span>{tr('evidence.actionAiSurvey') || 'Analizar con Levantamiento IA'}</span>
          </button>
        </div>

        {/* Botones de acción directa */}
        <div className="evidence-quick-actions">
          <button
            type="button"
            className="btn-evidence-tool btn-camera"
            onClick={() => setIsCameraOpen(true)}
          >
            <Icon name="camera" size={18} />
            <span>{tr('evidence.toolCamera') || 'Tomar foto'}</span>
          </button>

          <button
            type="button"
            className="btn-evidence-tool"
            onClick={() => photoInputRef.current?.click()}
          >
            <Icon name="upload" size={18} />
            <span>{tr('evidence.toolPhoto') || 'Subir foto'}</span>
          </button>

          <button
            type="button"
            className="btn-evidence-tool"
            onClick={() => videoInputRef.current?.click()}
          >
            <Icon name="play" size={18} />
            <span>{tr('evidence.toolVideo') || 'Subir video'}</span>
          </button>

          <button
            type="button"
            className="btn-evidence-tool"
            onClick={() => planoInputRef.current?.click()}
          >
            <Icon name="plano" size={18} />
            <span>{tr('evidence.toolPlano') || 'Subir plano'}</span>
          </button>

          <button
            type="button"
            className="btn-evidence-tool"
            onClick={() => model3dInputRef.current?.click()}
          >
            <Icon name="bim" size={18} />
            <span>{tr('evidence.tool3D') || 'Subir modelo 3D'}</span>
          </button>
        </div>

        {/* Inputs ocultos de archivo */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*,.jpg,.jpeg,.png,.webp"
          multiple
          style={{ display: 'none' }}
          onChange={handlePhotoFilesSelected}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*,.mp4,.webm"
          style={{ display: 'none' }}
          onChange={handleVideoFilesSelected}
        />
        <input
          ref={planoInputRef}
          type="file"
          accept="application/pdf,image/*"
          style={{ display: 'none' }}
          onChange={handlePlanoFilesSelected}
        />
        <input
          ref={model3dInputRef}
          type="file"
          accept=".glb,.gltf,.obj"
          style={{ display: 'none' }}
          onChange={handleModel3dSelected}
        />
      </div>

      {/* Galería unificada y normalizada de evidencias */}
      <EvidenceGallery
        records={unifiedEvidenceList}
        onDeleteRecord={handleDeleteRecord}
        onNavigateToPlano={onNavigateToPlano}
        onNavigateToLevantamiento={onNavigateToLevantamiento}
      />

      {/* Modal interactivo de cámara */}
      <EvidenceCameraModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={blob => handleSavePhotoBlob(blob)}
        onFallbackToFile={() => photoInputRef.current?.click()}
      />
    </div>
  );
}
