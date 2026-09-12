/* Wizard de importacion de levantamiento 3D (Fase 2A). Mismo cascaron que
   ManualSurveyForm.jsx (.record-modal > .record-backdrop + .panel.record-form,
   .record-form-head, .form-actions), mismos props {projectId,onCancel,onSave}
   -- onSave es exactamente el onCreate que ya recibe NewSurveyModal, asi que
   no hace falta tocar LevantamientoModule.jsx para nada de esto.

   Flujo (seccion "Flujo esperado" del pedido de Fase 2A):
   Subir archivo -> cargar modelo -> visualizar -> definir/verificar escala ->
   identificar geometria -> revisar -> guardar levantamiento. Cuantificar y
   Takeoff ya funcionan automaticamente en cuanto el survey guardado tiene un
   Space real -- no hay nada que hacer aqui para eso (ver SurveyDetail.jsx,
   sin cambios).

   v1 deriva SOLO el volumen rectangular del modelo importado (bounding box);
   el usuario agrega puertas/ventanas a mano en el paso "revisar" con
   SpaceCard.jsx, el MISMO componente que ya usa la captura manual -- ver
   src/domain/levantamientoImportConversion.js para la justificacion de por
   que v1 no intenta "detectar" aberturas automaticamente. */
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { SpaceCard } from './SpaceCard.jsx';
import { Model3DPreview } from './Model3DPreview.jsx';
import { SURVEY_SOURCE_TYPE, SURVEY_STATUS, makeEmptySurvey } from '../../domain/levantamientoSchema.js';
import { recomputeSurvey } from '../../lib/levantamientoCalc.js';
import { validateImportFile, MAX_IMPORT_FILE_SIZE_BYTES } from '../../domain/levantamientoImporters.js';
import { computeUniformScaleFactor, deriveSpaceFromImportedModel, buildSurveyImportMeta } from '../../domain/levantamientoImportConversion.js';
import { hasAnyStylePreference } from '../../domain/evidenceStylePreferences.js';
import { EvidenceStylePanel } from './EvidenceStylePanel.jsx';
import { auth } from '../../firebase.js';
import { useDraftAutosave, clearDraftAutosave } from '../../hooks/useDraftAutosave.js';
import { AutosaveIndicator } from '../../components/ui/AutosaveIndicator.jsx';

const STEP = Object.freeze({ UPLOAD: 'upload', LOADING: 'loading', SCALE: 'scale', REVIEW: 'review' });

function formatBytes(bytes){
  if(!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function Import3DSurveyForm({ projectId, onCancel, onSave }){
  const { t: tr } = useI18n();
  const [step, setStep] = useState(STEP.UPLOAD);
  const [dragActive, setDragActive] = useState(false);
  const [fileErrors, setFileErrors] = useState([]);
  const [fileMeta, setFileMeta] = useState(null); // {name,size,format}
  const [loadResult, setLoadResult] = useState(null); // {object3D,boundingBox,meshCount,triangleCount}
  const [loadError, setLoadError] = useState(null);
  const [scaleMode, setScaleMode] = useState('meters'); // 'meters' | 'known'
  const [knownLength, setKnownLength] = useState('');
  const [scaleError, setScaleError] = useState(null);
  const [confirmedScaleFactor, setConfirmedScaleFactor] = useState(1);
  const [space, setSpace] = useState(null);
  // P0 (correccion de regresion, "cargar evidencia -> cambiar pestana ->
  // volver"): igual criterio que PhoneScanSurveyForm.jsx -- clave FIJA
  // 'pending' (este wizard tambien se desmonta por completo si el usuario
  // cambia de modulo). Valor limitado a proposito: el archivo 3D en si
  // (File, ya cargado como Object3D) NO es serializable, asi que si el
  // wizard se desmonta en STEP.SCALE/REVIEW, el usuario de todas formas
  // tiene que volver a subir el archivo -- lo unico que vale la pena
  // recordar es nombre/descripcion/estilo para cuando llegue de nuevo a
  // Revisar, no el archivo ni el Space derivado.
  const user = auth.currentUser ? { uid: auth.currentUser.uid } : null;
  const [pendingDraft, setPendingDraft] = useDraftAutosave(user, 'import3d', 'pending', { name: '', description: '', stylePreferences: null });
  const name = pendingDraft?.name || '';
  const setName = (value) => setPendingDraft(prev => ({ ...(prev || {}), name: value }));
  const stylePreferences = pendingDraft?.stylePreferences || null; // Fase 2, ver PhoneScanSurveyForm.jsx
  const setStylePreferences = (value) => setPendingDraft(prev => ({ ...(prev || {}), stylePreferences: value }));
  const description = pendingDraft?.description || '';
  const setDescription = (value) => setPendingDraft(prev => ({ ...(prev || {}), description: value }));
  const [nameError, setNameError] = useState(false);
  const loadedObjectRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => () => {
    // Si el usuario cancela a medio camino, libera la memoria del modelo
    // cargado -- nunca deja un THREE.Object3D vivo sin duenio.
    if(loadedObjectRef.current){
      import('../../lib/levantamientoModelLoader.js').then(m => m.disposeLoadedModel(loadedObjectRef.current));
    }
  }, []);

  const resetToUpload = () => {
    setStep(STEP.UPLOAD);
    setFileErrors([]);
    setFileMeta(null);
    setLoadResult(null);
    setLoadError(null);
    setScaleMode('meters');
    setKnownLength('');
    setScaleError(null);
    setSpace(null);
    if(loadedObjectRef.current){
      import('../../lib/levantamientoModelLoader.js').then(m => m.disposeLoadedModel(loadedObjectRef.current));
      loadedObjectRef.current = null;
    }
  };

  const handleFile = async (file) => {
    if(!file) return;
    const validation = validateImportFile(file);
    if(!validation.valid){
      setFileErrors(validation.errors);
      setFileMeta(null);
      return;
    }
    setFileErrors([]);
    setFileMeta({ name: file.name, size: file.size, format: validation.format });
    setStep(STEP.LOADING);
    const { loadModel3D } = await import('../../lib/levantamientoModelLoader.js');
    const result = await loadModel3D(file, validation.format.id);
    if(!result.ok){
      // Mensaje SIEMPRE traducido y generico para el usuario (nunca el error
      // crudo del parser -- "Unexpected token..." no es un error claro de UI,
      // ver QA de Fase 2A). result.message se conserva solo en consola para
      // diagnostico de quien desarrolla, nunca se muestra tal cual.
      console.warn('[Import3DSurveyForm] loadModel3D fallo:', result.reason, result.message);
      setLoadError(true);
      setStep(STEP.UPLOAD);
      return;
    }
    loadedObjectRef.current = result.object3D;
    setLoadResult(result);
    setScaleMode(validation.format.id === 'obj' ? 'known' : 'meters');
    setStep(STEP.SCALE);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    handleFile(e.dataTransfer?.files?.[0]);
  };

  const confirmScale = () => {
    let factor = 1;
    if(scaleMode === 'known'){
      const measuredLength = loadResult.boundingBox.size.x;
      const result = computeUniformScaleFactor({ measuredLength, knownLength: Number(knownLength) });
      if(!result.ok){
        setScaleError(tr('levantamiento.import3dScaleInvalidMsg'));
        return;
      }
      factor = result.factor;
    }
    setScaleError(null);
    setConfirmedScaleFactor(factor);
    const derived = deriveSpaceFromImportedModel({
      boundingBoxSize: loadResult.boundingBox.size,
      scaleFactor: factor,
      name: tr('levantamiento.defaultSpaceName', { n: 1 })
    });
    setSpace(derived);
    setStep(STEP.REVIEW);
  };

  const save = () => {
    if(!name.trim()){
      setNameError(true);
      return;
    }
    const importMeta = buildSurveyImportMeta({
      sourceFormat: fileMeta.format.id,
      fileName: fileMeta.name,
      fileSizeBytes: fileMeta.size,
      meshCount: loadResult.meshCount,
      triangleCount: loadResult.triangleCount,
      scaleFactor: confirmedScaleFactor
    });
    const survey = makeEmptySurvey({
      projectId, name: name.trim(), description: description.trim(),
      sourceType: SURVEY_SOURCE_TYPE.IMPORT_3D, importMeta,
      stylePreferences: hasAnyStylePreference(stylePreferences) ? stylePreferences : null
    });
    survey.spaces = [space];
    survey.status = SURVEY_STATUS.PROCESSED;
    // El Object3D ya cumplio su proposito (derivar el Space) -- no se
    // persiste ni se vuelve a necesitar, se libera antes de guardar.
    if(loadedObjectRef.current){
      import('../../lib/levantamientoModelLoader.js').then(m => m.disposeLoadedModel(loadedObjectRef.current));
      loadedObjectRef.current = null;
    }
    clearDraftAutosave(user, 'import3d', 'pending');
    onSave(recomputeSurvey(survey));
  };

  /* "Hay cambios sin guardar. ¿Quieres salir?" (P0) -- solo pregunta si de
     verdad hay algo que perder (un archivo ya cargado, o texto capturado);
     salir desde STEP.UPLOAD sin haber tocado nada no amerita confirmar. */
  const handleCancel = () => {
    const hasWork = step !== STEP.UPLOAD || name.trim() || description.trim() || hasAnyStylePreference(stylePreferences);
    if(hasWork && !window.confirm(tr('levantamiento.unsavedChangesConfirmMsg'))) return;
    onCancel();
  };

  return <div className="record-modal" role="dialog" aria-modal="true">
    <div className="record-backdrop" onClick={handleCancel}></div>
    <div className="panel record-form survey-form">
      <div className="record-form-head">
        <div><span>{tr('levantamiento.import3dWizardKicker')}</span><h2>{tr('levantamiento.import3dWizardTitle')}</h2></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <AutosaveIndicator />
          <button className="secondary" onClick={handleCancel}>{tr('levantamiento.cancel')}</button>
        </div>
      </div>

      {step === STEP.UPLOAD && <>
        {loadError && <p className="survey-opening-warning">{tr('levantamiento.import3dLoadErrorMsg')}</p>}
        <div
          className={'import3d-dropzone' + (dragActive ? ' dragover' : '') + (fileErrors.length ? ' error' : '')}
          onDragOver={e => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <b>{tr('levantamiento.import3dDropzoneLabel')}</b>
          <span>{tr('levantamiento.import3dDropzoneHint')}</span>
          <button type="button" className="soft" onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}>{tr('levantamiento.import3dBrowseButton')}</button>
          <input ref={fileInputRef} type="file" accept=".glb,.gltf,.obj" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files?.[0])} />
        </div>
        {fileErrors.includes('formato_no_reconocido') && <p className="nf-error-msg">{tr('levantamiento.import3dInvalidFormatMsg', { formats: 'GLB, GLTF, OBJ' })}</p>}
        {fileErrors.includes('excede_tamano_maximo') && <p className="nf-error-msg">{tr('levantamiento.import3dFileTooLargeMsg', { maxSize: formatBytes(MAX_IMPORT_FILE_SIZE_BYTES) })}</p>}
        {fileErrors.length > 0 && !fileErrors.includes('formato_no_reconocido') && !fileErrors.includes('excede_tamano_maximo') &&
          <p className="nf-error-msg">{tr('levantamiento.import3dLoadErrorMsg')}</p>}
      </>}

      {step === STEP.LOADING && <div className="import3d-progress">
        <span className="import3d-spinner" aria-hidden="true"></span>
        <p>{tr('levantamiento.import3dLoadingMsg')}</p>
      </div>}

      {step === STEP.SCALE && loadResult && <>
        <h3>{tr('levantamiento.import3dPreviewTitle')}</h3>
        <Model3DPreview object3D={loadResult.object3D} boundingBox={loadResult.boundingBox} diagnostics={loadResult.diagnostics}
          onBoundingBoxChange={nextBox => setLoadResult(prev => ({ ...prev, boundingBox: nextBox }))} />
        <div className="import3d-meta-grid">
          <div><small>{tr('levantamiento.import3dBoundingBoxLabel')}</small><b>{loadResult.boundingBox.size.x.toFixed(2)} × {loadResult.boundingBox.size.z.toFixed(2)} × {loadResult.boundingBox.size.y.toFixed(2)} m</b></div>
          <div><small>{tr('levantamiento.import3dMetaMeshCountLabel')}</small><b>{loadResult.meshCount}</b></div>
          <div><small>{tr('levantamiento.import3dMetaTriangleCountLabel')}</small><b>{loadResult.triangleCount}</b></div>
        </div>
        <div className="survey-element-row">
          <label><input type="radio" checked={scaleMode === 'meters'} onChange={() => setScaleMode('meters')} /> {tr('levantamiento.import3dScaleAlreadyMetersLabel')}</label>
          <label><input type="radio" checked={scaleMode === 'known'} onChange={() => setScaleMode('known')} /> {tr('levantamiento.import3dScaleKnownLabel')}</label>
        </div>
        {scaleMode === 'known' && <div className="field-grid">
          <div className="nf"><label>{tr('levantamiento.import3dScaleMeasuredLengthLabel')}</label><input value={`${loadResult.boundingBox.size.x.toFixed(3)} m`} disabled /></div>
          <div className="nf">
            <label>{tr('levantamiento.import3dScaleKnownLabel')}</label>
            <input type="number" step="any" value={knownLength} onChange={e => setKnownLength(e.target.value)} placeholder={tr('levantamiento.import3dScaleKnownLengthPlaceholder')} />
          </div>
        </div>}
        {scaleError && <p className="nf-error-msg">{scaleError}</p>}
        <div className="form-actions">
          <button className="secondary" onClick={resetToUpload}>{tr('levantamiento.cancel')}</button>
          <button onClick={confirmScale}>{tr('levantamiento.import3dContinueButton')}</button>
        </div>
      </>}

      {step === STEP.REVIEW && space && <>
        <h3>{tr('levantamiento.import3dReviewTitle')}</h3>
        <p className="muted" style={{ fontSize: '.82rem' }}>{tr('levantamiento.import3dReviewHint')}</p>
        <div className="field-grid">
          <div className={'nf wide' + (nameError ? ' has-error' : '')}>
            <label>{tr('levantamiento.nameLabel')}</label>
            <input value={name} onChange={e => { setName(e.target.value); setNameError(false); }} placeholder={tr('levantamiento.namePlaceholder')} />
            {nameError && <span className="nf-error-msg">{tr('levantamiento.nameRequiredMsg')}</span>}
          </div>
          <div className="nf wide"><label>{tr('levantamiento.descriptionLabel')}</label><input value={description} onChange={e => setDescription(e.target.value)} placeholder={tr('levantamiento.descriptionPlaceholder')} /></div>
        </div>
        <div className="import3d-meta-grid">
          <div><small>{tr('levantamiento.import3dMetaFormatLabel')}</small><b>{fileMeta.format.label}</b></div>
          <div><small>{tr('levantamiento.import3dMetaFileNameLabel')}</small><b>{fileMeta.name}</b></div>
          <div><small>{tr('levantamiento.import3dMetaSizeLabel')}</small><b>{formatBytes(fileMeta.size)}</b></div>
        </div>
        <SpaceCard space={space} onUpdate={setSpace} onRemove={null} />
        <EvidenceStylePanel value={stylePreferences} onChange={setStylePreferences} />
        <div className="form-actions">
          <button className="secondary" onClick={handleCancel}>{tr('levantamiento.cancel')}</button>
          <button onClick={save}>{tr('levantamiento.save')}</button>
        </div>
      </>}
    </div>
  </div>;
}
