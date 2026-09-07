/* Wizard de captura con camara para Levantamiento IA (Fase 2B, "Escanear
   con celular"). Mismo cascaron que ManualSurveyForm.jsx/Import3DSurveyForm.jsx
   (.record-modal > .record-backdrop + .panel.record-form, .record-form-head,
   .form-actions), mismos props {projectId,onCancel,onSave}.

   Flujo (seccion "Flujo esperado" del pedido de Fase 2B):
   Grabar recorrido / Tomar fotos / Subir video -> Revisar -> Guardar.

   Decision de arquitectura clave (ver plan de Fase 2B): cada foto/video se
   sube a Storage EN CUANTO se termina de capturar (segundo plano, con su
   propio progreso), no todo junto al final -- por eso el levantamiento
   recibe su id real (surveyIdRef) desde que se monta este componente, antes
   de que exista ningun documento en Firestore. "Guardar" solo finaliza
   nombre/descripcion; los archivos ya estan en Storage para entonces.

   v1 es deliberadamente honesto sobre su alcance: NO genera geometria ni
   medidas (ver phoneScanDisclaimer, mostrado de forma permanente) -- el
   survey se guarda con spaces:[] y status:DRAFT, igual criterio que
   ManualSurveyForm/SurveyDetail usan para "sin espacios todavia". */
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { auth } from '../../firebase.js';
import { uid } from '../../utils/id.js';
import { SURVEY_SOURCE_TYPE, SURVEY_STATUS, makeEmptySurvey } from '../../domain/levantamientoSchema.js';
import { recomputeSurvey } from '../../lib/levantamientoCalc.js';
import {
  SCAN_MEDIA_KIND, MAX_SCAN_DURATION_SECONDS, MAX_SCAN_VIDEO_BYTES, MAX_SCAN_PHOTO_BYTES,
  MAX_SCAN_ITEMS, validateScanMediaFile, buildScanMediaItem
} from '../../domain/levantamientoMedia.js';

const STEP = Object.freeze({ CAPTURE: 'captura', REVIEW: 'revisar' });

function formatBytes(bytes){
  if(!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(seconds){
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

function extForMimeType(mimeType, kind){
  if(kind === SCAN_MEDIA_KIND.PHOTO) return 'jpg';
  if((mimeType || '').includes('mp4')) return 'mp4';
  return 'webm';
}

export function PhoneScanSurveyForm({ projectId, onCancel, onSave }){
  const { t: tr } = useI18n();
  const surveyIdRef = useRef('LEV-' + uid());
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const recordingElapsedRef = useRef(0);
  const removedIdsRef = useRef(new Set());
  const fileInputRef = useRef(null);

  const [step, setStep] = useState(STEP.CAPTURE);
  const [cameraStatus, setCameraStatus] = useState('requesting'); // 'requesting' | 'ready' | 'error'
  const [cameraError, setCameraError] = useState(null);
  const [recorderSupported, setRecorderSupported] = useState(true);
  const [recordingState, setRecordingState] = useState('idle'); // 'idle' | 'recording' | 'paused'
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [captureError, setCaptureError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [items, setItems] = useState([]); // {localId,kind,blob,previewUrl,sizeBytes,durationSeconds,mimeType,status,progress,storagePath,errorReason}
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { getCameraStream, isMediaRecorderSupported } = await import('../../lib/cameraCapture.js');
      setRecorderSupported(isMediaRecorderSupported());
      const result = await getCameraStream();
      if(cancelled) return;
      if(!result.ok){ setCameraError(result.reason); setCameraStatus('error'); return; }
      streamRef.current = result.stream;
      if(videoRef.current) videoRef.current.srcObject = result.stream;
      setCameraStatus('ready');
    })();
    return () => {
      cancelled = true;
      if(recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if(streamRef.current){
        import('../../lib/cameraCapture.js').then(m => m.stopStreamTracks(streamRef.current));
      }
    };
  }, []);

  /* El <video> de vista previa se desmonta al pasar a "revisar" (esa etapa
     no lo renderiza) y se vuelve a montar al regresar a "captura" -- un
     <video> nuevo no trae consigo el srcObject anterior, hay que
     reasignarlo cada vez que el paso de captura vuelve a montarse. */
  useEffect(() => {
    if(step === STEP.CAPTURE && videoRef.current && streamRef.current){
      videoRef.current.srcObject = streamRef.current;
    }
  }, [step]);

  const uploadItem = async (localId, blob, kind, mimeType, durationSeconds) => {
    const currentUid = auth.currentUser?.uid;
    if(!currentUid){
      setItems(list => list.map(it => it.localId === localId ? { ...it, status: 'error', errorReason: 'no_autenticado' } : it));
      return;
    }
    const { uploadScanMedia } = await import('../../lib/levantamientoMediaUpload.js');
    const fileName = `${kind}-${localId}.${extForMimeType(mimeType, kind)}`;
    const result = await uploadScanMedia({
      blob, uid: currentUid, surveyId: surveyIdRef.current, kind, mimeType, fileName,
      onProgress: progress => setItems(list => list.map(it => it.localId === localId ? { ...it, progress } : it))
    });
    if(removedIdsRef.current.has(localId)){
      removedIdsRef.current.delete(localId);
      if(result.ok){
        const { deleteScanMedia } = await import('../../lib/levantamientoMediaUpload.js');
        deleteScanMedia(result.storagePath);
      }
      return;
    }
    if(result.ok){
      setItems(list => list.map(it => it.localId === localId ? { ...it, status: 'uploaded', storagePath: result.storagePath, sizeBytes: result.sizeBytes } : it));
    } else {
      setItems(list => list.map(it => it.localId === localId ? { ...it, status: 'error', errorReason: result.reason } : it));
    }
  };

  const handleFinishedCapture = ({ kind, blob, durationSeconds = null, mimeType }) => {
    const validation = validateScanMediaFile({ kind, sizeBytes: blob.size, durationSeconds, currentCount: items.length });
    if(!validation.valid){
      if(validation.errors.includes('excede_maximo_items')) setCaptureError(tr('levantamiento.phoneScanMaxItemsMsg', { maxItems: MAX_SCAN_ITEMS }));
      else if(validation.errors.includes('excede_duracion_maxima')) setCaptureError(tr('levantamiento.phoneScanMaxDurationMsg', { maxDuration: formatDuration(MAX_SCAN_DURATION_SECONDS) }));
      else setCaptureError(tr('levantamiento.phoneScanFileTooLargeMsg', { maxSize: formatBytes(kind === SCAN_MEDIA_KIND.VIDEO ? MAX_SCAN_VIDEO_BYTES : MAX_SCAN_PHOTO_BYTES) }));
      return;
    }
    setCaptureError(null);
    const localId = uid();
    const previewUrl = URL.createObjectURL(blob);
    setItems(list => [...list, { localId, kind, blob, previewUrl, sizeBytes: blob.size, durationSeconds, mimeType, status: 'uploading', progress: 0, storagePath: null, errorReason: null }]);
    uploadItem(localId, blob, kind, mimeType, durationSeconds);
  };

  const startRecording = async () => {
    const { pickSupportedVideoMimeType } = await import('../../lib/cameraCapture.js');
    const mimeType = pickSupportedVideoMimeType();
    if(!mimeType || !streamRef.current) return;
    recordedChunksRef.current = [];
    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorder.ondataavailable = e => { if(e.data && e.data.size > 0) recordedChunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      handleFinishedCapture({ kind: SCAN_MEDIA_KIND.VIDEO, blob, durationSeconds: recordingElapsedRef.current, mimeType });
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    setRecordingState('recording');
    recordingElapsedRef.current = 0;
    setRecordingElapsed(0);
    recordingTimerRef.current = setInterval(() => {
      recordingElapsedRef.current += 1;
      setRecordingElapsed(recordingElapsedRef.current);
      if(recordingElapsedRef.current >= MAX_SCAN_DURATION_SECONDS) stopRecording();
    }, 1000);
  };

  const pauseRecording = () => {
    mediaRecorderRef.current?.pause();
    setRecordingState('paused');
    if(recordingTimerRef.current) clearInterval(recordingTimerRef.current);
  };

  const resumeRecording = () => {
    mediaRecorderRef.current?.resume();
    setRecordingState('recording');
    recordingTimerRef.current = setInterval(() => {
      recordingElapsedRef.current += 1;
      setRecordingElapsed(recordingElapsedRef.current);
      if(recordingElapsedRef.current >= MAX_SCAN_DURATION_SECONDS) stopRecording();
    }, 1000);
  };

  const stopRecording = () => {
    if(recordingTimerRef.current){ clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    mediaRecorderRef.current?.stop();
    setRecordingState('idle');
  };

  const takePhoto = async () => {
    const { capturePhotoBlobFromVideoElement } = await import('../../lib/cameraCapture.js');
    try {
      const blob = await capturePhotoBlobFromVideoElement(videoRef.current);
      handleFinishedCapture({ kind: SCAN_MEDIA_KIND.PHOTO, blob, mimeType: 'image/jpeg' });
    } catch { /* camara sin frame disponible todavia -- se ignora, el usuario puede reintentar */ }
  };

  const handleExistingVideoFile = async (file) => {
    if(!file) return;
    const { readVideoDurationSeconds } = await import('../../lib/cameraCapture.js');
    const durationSeconds = await readVideoDurationSeconds(file);
    handleFinishedCapture({ kind: SCAN_MEDIA_KIND.VIDEO, blob: file, durationSeconds, mimeType: file.type || 'video/mp4' });
  };

  const removeItem = (localId) => {
    const item = items.find(it => it.localId === localId);
    if(!item) return;
    URL.revokeObjectURL(item.previewUrl);
    setItems(list => list.filter(it => it.localId !== localId));
    if(item.status === 'uploaded'){
      import('../../lib/levantamientoMediaUpload.js').then(m => m.deleteScanMedia(item.storagePath));
    } else if(item.status === 'uploading'){
      removedIdsRef.current.add(localId);
    }
  };

  const retryItem = (localId) => {
    const item = items.find(it => it.localId === localId);
    if(!item) return;
    setItems(list => list.map(it => it.localId === localId ? { ...it, status: 'uploading', progress: 0, errorReason: null } : it));
    uploadItem(localId, item.blob, item.kind, item.mimeType, item.durationSeconds);
  };

  const handleCancel = () => {
    items.forEach(item => {
      if(item.status === 'uploaded'){
        import('../../lib/levantamientoMediaUpload.js').then(m => m.deleteScanMedia(item.storagePath));
      } else if(item.status === 'uploading'){
        removedIdsRef.current.add(item.localId);
      }
    });
    onCancel();
  };

  const hasPendingUploads = items.some(it => it.status === 'uploading');
  const hasUnresolvedErrors = items.some(it => it.status === 'error');

  const save = () => {
    if(!name.trim()){ setNameError(true); return; }
    const scanMedia = items.filter(it => it.status === 'uploaded').map(it => buildScanMediaItem({
      kind: it.kind, storagePath: it.storagePath, mimeType: it.mimeType, sizeBytes: it.sizeBytes, durationSeconds: it.durationSeconds
    }));
    const survey = makeEmptySurvey({
      id: surveyIdRef.current, projectId, name: name.trim(), description: description.trim(),
      sourceType: SURVEY_SOURCE_TYPE.MOBILE_SCAN, scanMedia
    });
    survey.status = SURVEY_STATUS.DRAFT;
    onSave(recomputeSurvey(survey));
  };

  const cameraErrorMsgKey = {
    permiso_denegado: 'phoneScanPermissionDeniedMsg',
    sin_camara: 'phoneScanNoCameraMsg',
    camara_en_uso: 'phoneScanCameraBusyMsg',
    no_soportado: 'phoneScanNotSupportedMsg',
    error_desconocido: 'phoneScanNotSupportedMsg'
  }[cameraError];

  const cameraLive = cameraStatus === 'ready';
  const canRecord = cameraLive && recorderSupported;

  const renderThumb = (item) => <div key={item.localId} className={'phonescan-thumb' + (item.status === 'error' ? ' phonescan-thumb-error' : '')}>
    {item.kind === SCAN_MEDIA_KIND.VIDEO
      ? <video className="phonescan-thumb-media" src={item.previewUrl} muted playsInline />
      : <img className="phonescan-thumb-media" src={item.previewUrl} alt="" />}
    {item.status === 'uploading' && <div className="phonescan-thumb-progress">
      <span>{tr('levantamiento.phoneScanUploadingMsg')}</span>
      <span>{Math.round((item.progress || 0) * 100)}%</span>
    </div>}
    <div className="phonescan-thumb-meta">
      <span>{item.kind === SCAN_MEDIA_KIND.VIDEO ? formatDuration(item.durationSeconds) : tr('levantamiento.phoneScanKindPhotoLabel')}</span>
      <span>{formatBytes(item.sizeBytes)}</span>
    </div>
    {item.status === 'error' && <p className="nf-error-msg" style={{ padding: '0 8px' }}>{tr('levantamiento.phoneScanUploadErrorMsg')}</p>}
    <div className="phonescan-thumb-actions">
      {item.status === 'error' && <button type="button" className="soft" onClick={() => retryItem(item.localId)}>{tr('levantamiento.phoneScanRetryButton')}</button>}
      <button type="button" className="soft" onClick={() => removeItem(item.localId)}>{tr('levantamiento.phoneScanDeleteButton')}</button>
    </div>
  </div>;

  return <div className="record-modal" role="dialog" aria-modal="true">
    <div className="record-backdrop" onClick={handleCancel}></div>
    <div className="panel record-form survey-form">
      <div className="record-form-head">
        <div><span>{tr('levantamiento.phoneScanWizardKicker')}</span><h2>{tr('levantamiento.phoneScanWizardTitle')}</h2></div>
        <button className="secondary" onClick={handleCancel}>{tr('levantamiento.cancel')}</button>
      </div>

      {step === STEP.CAPTURE && <>
        <div className="phonescan-camera-preview">
          {cameraLive
            ? <video ref={videoRef} muted playsInline autoPlay />
            : <div className="phonescan-camera-placeholder">
                {cameraStatus === 'requesting' ? tr('levantamiento.phoneScanRequestingCameraMsg') : (cameraErrorMsgKey ? tr(`levantamiento.${cameraErrorMsgKey}`) : '')}
              </div>}
        </div>

        {cameraLive && <div className="phonescan-controls">
          {canRecord && recordingState === 'idle' && <button type="button" onClick={startRecording}>{tr('levantamiento.phoneScanRecordButton')}</button>}
          {canRecord && recordingState === 'recording' && <>
            <button type="button" className="soft" onClick={pauseRecording}>{tr('levantamiento.phoneScanPauseButton')}</button>
            <button type="button" className="secondary" onClick={stopRecording}>{tr('levantamiento.phoneScanStopButton')} ({formatDuration(recordingElapsed)})</button>
          </>}
          {canRecord && recordingState === 'paused' && <>
            <button type="button" onClick={resumeRecording}>{tr('levantamiento.phoneScanResumeButton')}</button>
            <button type="button" className="secondary" onClick={stopRecording}>{tr('levantamiento.phoneScanStopButton')} ({formatDuration(recordingElapsed)})</button>
          </>}
          {recordingState === 'idle' && <button type="button" className="soft" onClick={takePhoto}>{tr('levantamiento.phoneScanTakePhotoButton')}</button>}
        </div>}

        <div
          className={'phonescan-dropzone' + (dragActive ? ' dragover' : '')}
          onDragOver={e => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={e => { e.preventDefault(); setDragActive(false); handleExistingVideoFile(e.dataTransfer?.files?.[0]); }}
          onClick={() => fileInputRef.current?.click()}
        >
          <b>{tr('levantamiento.phoneScanUploadVideoButton')}</b>
          <span>{tr('levantamiento.phoneScanDropzoneHint')}</span>
          <input ref={fileInputRef} type="file" accept="video/*" style={{ display: 'none' }}
            onChange={e => handleExistingVideoFile(e.target.files?.[0])} />
        </div>

        {captureError && <p className="nf-error-msg">{captureError}</p>}

        {items.length > 0 && <div className="phonescan-thumb-grid">{items.map(renderThumb)}</div>}

        <div className="form-actions">
          <button className="secondary" onClick={handleCancel}>{tr('levantamiento.cancel')}</button>
          <button onClick={() => setStep(STEP.REVIEW)} disabled={items.length === 0 || recordingState !== 'idle'}>{tr('levantamiento.phoneScanReviewButton')}</button>
        </div>
      </>}

      {step === STEP.REVIEW && <>
        <h3>{tr('levantamiento.phoneScanReviewTitle')}</h3>
        <p className="muted" style={{ fontSize: '.82rem' }}>{tr('levantamiento.phoneScanReviewHint')}</p>
        <div className="phonescan-disclaimer">{tr('levantamiento.phoneScanDisclaimer')}</div>
        <div className="field-grid">
          <div className={'nf wide' + (nameError ? ' has-error' : '')}>
            <label>{tr('levantamiento.nameLabel')}</label>
            <input value={name} onChange={e => { setName(e.target.value); setNameError(false); }} placeholder={tr('levantamiento.namePlaceholder')} />
            {nameError && <span className="nf-error-msg">{tr('levantamiento.nameRequiredMsg')}</span>}
          </div>
          <div className="nf wide"><label>{tr('levantamiento.descriptionLabel')}</label><input value={description} onChange={e => setDescription(e.target.value)} placeholder={tr('levantamiento.descriptionPlaceholder')} /></div>
        </div>
        <div className="phonescan-thumb-grid">{items.map(renderThumb)}</div>
        <div className="form-actions">
          <button className="secondary" onClick={() => setStep(STEP.CAPTURE)}>{tr('levantamiento.cancel')}</button>
          <button onClick={save} disabled={hasPendingUploads || hasUnresolvedErrors}>{tr('levantamiento.save')}</button>
        </div>
      </>}
    </div>
  </div>;
}
