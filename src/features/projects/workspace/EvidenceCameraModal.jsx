import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../i18n/I18nContext.jsx';
import { Icon } from '../../../components/ui/Icon.jsx';
import {
  getCameraStream,
  stopStreamTracks,
  capturePhotoBlobFromVideoElement
} from '../../../lib/cameraCapture.js';

export function EvidenceCameraModal({ isOpen, onClose, onCapture, onFallbackToFile }) {
  const { t: tr } = useI18n();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('idle'); // 'idle' | 'requesting' | 'ready' | 'error'
  const [errorReason, setErrorReason] = useState(null);
  const [facingMode, setFacingMode] = useState('environment'); // 'environment' | 'user'

  const startCamera = async (facing = facingMode) => {
    setStatus('requesting');
    setErrorReason(null);
    if (streamRef.current) {
      stopStreamTracks(streamRef.current);
      streamRef.current = null;
    }

    const res = await getCameraStream({ facingMode: facing, withAudio: false });
    if (!res.ok) {
      setStatus('error');
      setErrorReason(res.reason);
      return;
    }

    streamRef.current = res.stream;
    setStatus('ready');
  };

  useEffect(() => {
    if (!isOpen) {
      if (streamRef.current) {
        stopStreamTracks(streamRef.current);
        streamRef.current = null;
      }
      setStatus('idle');
      return;
    }

    startCamera();

    return () => {
      if (streamRef.current) {
        stopStreamTracks(streamRef.current);
        streamRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Asignar srcObject una vez que el elemento <video> existe en el DOM
  useEffect(() => {
    if (status === 'ready' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play?.().catch(() => {});
    }
  }, [status]);

  const handleCapture = async () => {
    if (!videoRef.current) return;
    try {
      const blob = await capturePhotoBlobFromVideoElement(videoRef.current, 0.92);
      if (blob) {
        onCapture?.(blob);
        onClose?.();
      }
    } catch (err) {
      console.error('[EvidenceCameraModal] Error al capturar foto:', err);
    }
  };

  const toggleFacingMode = () => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);
    startCamera(nextFacing);
  };

  if (!isOpen) return null;

  return (
    <div className="record-modal camera-modal-overlay" role="dialog" aria-modal="true">
      <div className="record-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="panel camera-modal-panel">
        <div className="camera-modal-head">
          <div className="camera-modal-title">
            <Icon name="camera" size={20} />
            <b>{tr('evidence.cameraTitle') || 'Tomar fotografía'}</b>
          </div>
          <button
            type="button"
            className="btn-close-modal"
            onClick={onClose}
            aria-label={tr('shell.closeDrawer') || 'Cerrar'}
          >
            ×
          </button>
        </div>

        <div className="camera-viewport-container">
          {status === 'requesting' && (
            <div className="camera-state-box">
              <div className="spinner" />
              <p>{tr('evidence.cameraRequesting') || 'Accediendo a la cámara...'}</p>
            </div>
          )}

          {status === 'error' && (
            <div className="camera-state-box camera-error-box">
              <Icon name="atencion" size={36} />
              <h4>{tr('evidence.cameraErrorTitle') || 'No se pudo activar la cámara'}</h4>
              <p className="muted">
                {errorReason === 'permiso_denegado'
                  ? (tr('evidence.cameraDenied') || 'Permiso denegado por el navegador o sistema.')
                  : errorReason === 'sin_camara'
                  ? (tr('evidence.cameraNotFound') || 'No se encontró ningún dispositivo de cámara conectado.')
                  : errorReason === 'camara_en_uso'
                  ? (tr('evidence.cameraInUse') || 'La cámara está siendo utilizada por otra aplicación.')
                  : (tr('evidence.cameraUnknown') || 'Ocurrió un error al intentar inicializar la cámara.')}
              </p>
              <div className="camera-error-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => startCamera()}
                >
                  {tr('evidence.cameraRetry') || 'Reintentar'}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    onClose?.();
                    onFallbackToFile?.();
                  }}
                >
                  {tr('evidence.cameraFallback') || 'Subir foto desde archivo'}
                </button>
              </div>
            </div>
          )}

          {status === 'ready' && (
            <div className="camera-stream-wrapper">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="camera-video-stream"
              />
              <div className="camera-overlay-controls">
                <button
                  type="button"
                  className="btn-camera-flip"
                  onClick={toggleFacingMode}
                  title="Cambiar cámara frontal/trasera"
                  aria-label="Cambiar cámara"
                >
                  <Icon name="refresh" size={18} />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="camera-modal-footer">
          <button
            type="button"
            className="btn-cancel-modal"
            onClick={onClose}
          >
            {tr('evidence.actionCancel') || 'Cancelar'}
          </button>
          <button
            type="button"
            className="btn-capture-shot"
            disabled={status !== 'ready'}
            onClick={handleCapture}
          >
            <span className="shutter-circle" />
            <span>{tr('evidence.takePhotoAction') || 'Capturar foto'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
