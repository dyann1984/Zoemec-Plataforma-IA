import { useEffect, useState } from 'react';
import { getDownloadURL, ref } from 'firebase/storage';
import { SpaceCard } from './SpaceCard.jsx';
import { SpaceFloorPlan2D } from './SpaceFloorPlan2D.jsx';
import { Survey3DViewer } from './Survey3DViewer.jsx';
import { buildPlanoElementFromConcept } from '../../domain/levantamientoTakeoffBridge.js';
import { PageHead } from '../../components/ui/PageElements.jsx';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { SURVEY_STATUS, SURVEY_SOURCE_TYPE, makeEmptySpace } from '../../domain/levantamientoSchema.js';
import { SCAN_MEDIA_KIND } from '../../domain/levantamientoMedia.js';
import { aggregateSurveyTotals, recomputeSurvey } from '../../lib/levantamientoCalc.js';
import { storage } from '../../firebase.js';
import { ConstructionProposalPanel } from './ConstructionProposalPanel.jsx';

const STATUS_I18N_KEY = {
  [SURVEY_STATUS.DRAFT]: 'statusDraft',
  [SURVEY_STATUS.PROCESSING]: 'statusProcessing',
  [SURVEY_STATUS.PROCESSED]: 'statusProcessed',
  [SURVEY_STATUS.WITH_OBSERVATIONS]: 'statusObservations',
  [SURVEY_STATUS.ERROR]: 'statusError'
};

const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatBytes(bytes){
  if(!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(seconds){
  if(!Number.isFinite(seconds)) return '';
  const s = Math.max(0, Math.round(seconds));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

const BASE_TABS = ['datos', 'plano2d', 'vista3d', 'cuantificacion'];
const TAB_I18N_KEY = { datos: 'tabData', plano2d: 'tabPlan2d', vista3d: 'tabView3d', cuantificacion: 'tabQuantification', multimedia: 'phoneScanTabMultimedia', propuesta: 'tabProposal' };

/* Vista "Abrir" de un levantamiento ya guardado: permite editar nombre,
   espacios, puertas y ventanas, y persiste con onChange (que en
   LevantamientoModule llama setSurveys). Reutiliza SpaceCard, la misma
   tarjeta usada al crear el levantamiento en ManualSurveyForm.

   Fase 1.5: agrega pestanas Plano 2D / Vista 3D / Cuantificacion junto a la
   pestana original ("Datos", contenido identico al de Fase 1, cero cambio
   de comportamiento ahi). Plano 2D y Vista 3D leen del mismo `survey` que ya
   se recalcula en `persist()`, asi que se actualizan solos al editar una
   medida en la pestana Datos -- no hace falta logica adicional. */
export function SurveyDetail({ survey, onBack, onChange, onSendToApu, currentUserEmail, initialTab = 'datos' }){
  const { t: tr } = useI18n();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [activeSpaceId, setActiveSpaceId] = useState(survey.spaces[0]?.id || null);
  const [mediaUrls, setMediaUrls] = useState({});
  const totals = aggregateSurveyTotals(survey);
  const statusLabel = tr(`levantamiento.${STATUS_I18N_KEY[survey.status] || 'statusDraft'}`);
  const activeSpace = survey.spaces.find(s => s.id === activeSpaceId) || survey.spaces[0] || null;
  const scanMedia = survey.scanMedia || [];
  // Fase 3 (Propuesta con IA): la pestana solo aparece si hay evidencia real
  // que analizar -- foto/video capturados, o un modelo 3D importado. Un
  // Survey manual sin ninguna de las dos no tiene nada que mandarle a la IA.
  const hasEvidence = scanMedia.length > 0 || survey.sourceType === SURVEY_SOURCE_TYPE.IMPORT_3D;
  const tabs = [...BASE_TABS, ...(scanMedia.length ? ['multimedia'] : []), ...(hasEvidence ? ['propuesta'] : [])];

  /* La downloadURL nunca se persiste (ver hallazgo del limite de 950KB de
     saveCloud en el plan de Fase 2B) -- se resuelve al vuelo solo cuando el
     usuario abre la pestana Multimedia o Propuesta (esta ultima las manda a
     la IA con vision), una vez por item. Si el objeto ya no existe en
     Storage (borrado externamente), queda sin URL y la tarjeta/panel lo
     indica en vez de romper el resto de la pestana. */
  useEffect(() => {
    if(activeTab !== 'multimedia' && activeTab !== 'propuesta') return;
    scanMedia.forEach(item => {
      if(mediaUrls[item.id] !== undefined) return;
      getDownloadURL(ref(storage, item.storagePath))
        .then(url => setMediaUrls(prev => ({ ...prev, [item.id]: url })))
        .catch(() => setMediaUrls(prev => ({ ...prev, [item.id]: null })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, survey.id]);

  const photoImageUrls = scanMedia
    .filter(item => item.kind === SCAN_MEDIA_KIND.PHOTO)
    .map(item => mediaUrls[item.id])
    .filter(Boolean);

  const persist = (next) => onChange(recomputeSurvey({ ...next, status: next.spaces.length ? SURVEY_STATUS.PROCESSED : SURVEY_STATUS.DRAFT, updatedAt: Date.now() }));

  const setField = (field, value) => persist({ ...survey, [field]: value });
  const addSpace = () => persist({ ...survey, spaces: [...survey.spaces, makeEmptySpace({ name: tr('levantamiento.defaultSpaceName', { n: survey.spaces.length + 1 }) })] });
  const updateSpace = (id, next) => persist({ ...survey, spaces: survey.spaces.map(s => s.id === id ? next : s) });
  const removeSpace = (id) => persist({ ...survey, spaces: survey.spaces.filter(s => s.id !== id) });

  /* Cuantificacion (Fase 1.5, seccion 6): totales de TODO el levantamiento
     (mismos que ya muestra el resumen de arriba), cada uno con su tipo real
     de planoReview.js (TIPOS_ELEMENTO) listo para el gate de Takeoff --
     buildPlanoElementFromConcept no calcula nada nuevo, solo empaqueta lo
     que aggregateSurveyTotals ya calculo. */
  const quantRows = [
    { key: 'floor', tipo: 'piso', descripcion: tr('levantamiento.quantConceptFloor'), cantidad: totals.floorArea, unidad: 'm2' },
    { key: 'wallNet', tipo: 'muro', descripcion: tr('levantamiento.quantConceptWallNet'), cantidad: totals.wallNetArea, unidad: 'm2' },
    { key: 'doors', tipo: 'puerta', descripcion: tr('levantamiento.doorsLabel'), cantidad: totals.doorsCount, unidad: 'pza' },
    { key: 'windows', tipo: 'ventana', descripcion: tr('levantamiento.windowsLabel'), cantidad: totals.windowsCount, unidad: 'pza' }
  ];

  const sendToTakeoff = (row) => {
    const seed = buildPlanoElementFromConcept({
      tipo: row.tipo, descripcion: row.descripcion, cantidad: row.cantidad, unidad: row.unidad,
      survey, space: null, validatedBy: currentUserEmail
    });
    if(!seed){ window.zoemecNotify?.(tr('takeoff.notValidatedMsg'), 'error'); return; }
    try{ localStorage.setItem('zoemec-pending-plano-seed', JSON.stringify(seed)); }catch{ /* almacenamiento no disponible */ }
    window.zoemecNotify?.(tr('takeoff.readyForApuMsg', { concept: seed.concept, qty: seed.qty, unit: seed.unit }), 'info');
    onSendToApu?.();
  };

  return <section>
    <PageHead kicker={tr('levantamiento.kicker')} title={survey.name || tr('levantamiento.unnamedSurvey')} desc={tr('levantamiento.statusLine', { status: statusLabel })} action={<button className="secondary" onClick={onBack}>{tr('levantamiento.back')}</button>} />

    <div className="survey-stat-grid survey-stat-grid-summary">
      <div><small>{tr('levantamiento.statFloorArea')}</small><b>{fmt(totals.floorArea)} m²</b></div>
      <div><small>{tr('levantamiento.wallNetLabel')}</small><b>{fmt(totals.wallNetArea)} m²</b></div>
      <div><small>{tr('levantamiento.statCeilings')}</small><b>{fmt(totals.ceilingArea)} m²</b></div>
      <div><small>{tr('levantamiento.statDoors')}</small><b>{totals.doorsCount}</b></div>
      <div><small>{tr('levantamiento.statWindows')}</small><b>{totals.windowsCount}</b></div>
      <div><small>{tr('levantamiento.statSpaces')}</small><b>{totals.spacesCount}</b></div>
    </div>

    <div className="survey-tabs" role="tablist">
      {tabs.map(t => <button key={t} type="button" role="tab" aria-selected={activeTab === t} className={`survey-tab${activeTab === t ? ' active' : ''}`} onClick={() => setActiveTab(t)}>{tr(`levantamiento.${TAB_I18N_KEY[t]}`)}</button>)}
    </div>

    {activeTab === 'datos' && <div className="panel survey-form">
      <div className="field-grid">
        <div className="nf wide"><label>{tr('levantamiento.nameLabel')}</label><input value={survey.name} onChange={e => setField('name', e.target.value)} /></div>
        <div className="nf wide"><label>{tr('levantamiento.descriptionPlaceholderShort')}</label><input value={survey.description || ''} onChange={e => setField('description', e.target.value)} placeholder={tr('levantamiento.descriptionPlaceholder')} /></div>
      </div>

      {survey.importMeta && <>
      <h3>{tr('levantamiento.import3dSavedMetaTitle')}</h3>
      <div className="import3d-meta-grid">
        <div><small>{tr('levantamiento.import3dMetaFileNameLabel')}</small><b>{survey.importMeta.fileName}</b></div>
        <div><small>{tr('levantamiento.import3dMetaFormatLabel')}</small><b>{String(survey.importMeta.sourceFormat || '').toUpperCase()}</b></div>
        <div><small>{tr('levantamiento.import3dMetaSizeLabel')}</small><b>{formatBytes(survey.importMeta.fileSizeBytes)}</b></div>
        <div><small>{tr('levantamiento.import3dMetaUnitsLabel')}</small><b>m</b></div>
        <div><small>{tr('levantamiento.import3dMetaScaleLabel')}</small><b>{(Number(survey.importMeta.scaleFactor) || 1).toFixed(2)}×</b></div>
        {Number.isFinite(survey.importMeta.meshCount) && <div><small>{tr('levantamiento.import3dMetaMeshCountLabel')}</small><b>{survey.importMeta.meshCount}</b></div>}
        {Number.isFinite(survey.importMeta.triangleCount) && <div><small>{tr('levantamiento.import3dMetaTriangleCountLabel')}</small><b>{survey.importMeta.triangleCount}</b></div>}
      </div>
      </>}

      <div className="survey-spaces-list">
        {survey.spaces.map(space => <SpaceCard key={space.id} space={space} onUpdate={next => updateSpace(space.id, next)} onRemove={survey.spaces.length > 1 ? () => removeSpace(space.id) : null} />)}
      </div>
      <button type="button" className="soft" onClick={addSpace}>{tr('levantamiento.addSpace')}</button>
    </div>}

    {(activeTab === 'plano2d' || activeTab === 'vista3d') && <div className="panel">
      {survey.spaces.length > 1 && <div className="nf" style={{ marginBottom: 10 }}>
        <label>{tr('levantamiento.selectSpaceLabel')}</label>
        <select value={activeSpace?.id || ''} onChange={e => setActiveSpaceId(e.target.value)}>
          {survey.spaces.map(s => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
        </select>
      </div>}
      {activeTab === 'vista3d' && survey.sourceType === SURVEY_SOURCE_TYPE.IMPORT_3D &&
        <p className="muted" style={{ fontSize: '.82rem', marginBottom: 10 }}>{tr('levantamiento.import3dDerivedViewNotice')}</p>}
      {!activeSpace
        ? <p className="muted">{tr('levantamiento.plan2dNeedsDimsMsg')}</p>
        : activeTab === 'plano2d'
          ? <SpaceFloorPlan2D space={activeSpace} />
          : <Survey3DViewer space={activeSpace} onSelectElement={() => {}} />}
    </div>}

    {activeTab === 'cuantificacion' && <div className="panel survey-quant">
      {!survey.spaces.length
        ? <p className="muted">{tr('levantamiento.quantNoSpacesMsg')}</p>
        : <table className="survey-quant-table">
          <tbody>
            {quantRows.map(row => <tr key={row.key}>
              <td>{row.descripcion}</td>
              <td>{fmt(row.cantidad)} {row.unidad === 'm2' ? 'm²' : row.unidad}</td>
              <td><button type="button" className="soft" onClick={() => sendToTakeoff(row)} disabled={!(Number(row.cantidad) > 0)}>{tr('levantamiento.sendToTakeoff')}</button></td>
            </tr>)}
          </tbody>
        </table>}
    </div>}

    {activeTab === 'multimedia' && <div className="panel">
      <div className="phonescan-disclaimer">{tr('levantamiento.phoneScanDisclaimer')}</div>
      {!scanMedia.length
        ? <p className="muted">{tr('levantamiento.phoneScanNoMediaMsg')}</p>
        : <div className="phonescan-thumb-grid">
          {scanMedia.map(item => {
            const url = mediaUrls[item.id];
            return <div key={item.id} className="phonescan-thumb">
              {url === undefined
                ? <div className="phonescan-thumb-progress" style={{ position: 'static', aspectRatio: '1/1' }}>{tr('levantamiento.phoneScanUploadingMsg')}</div>
                : url === null
                  ? <div className="phonescan-thumb-progress" style={{ position: 'static', aspectRatio: '1/1' }}>{tr('levantamiento.phoneScanUploadErrorMsg')}</div>
                  : item.kind === SCAN_MEDIA_KIND.VIDEO
                    ? <video className="phonescan-thumb-media" src={url} controls />
                    : <img className="phonescan-thumb-media" src={url} alt="" />}
              <div className="phonescan-thumb-meta">
                <span>{item.kind === SCAN_MEDIA_KIND.VIDEO ? formatDuration(item.durationSeconds) : tr('levantamiento.phoneScanKindPhotoLabel')}</span>
                <span>{formatBytes(item.sizeBytes)}</span>
              </div>
            </div>;
          })}
        </div>}
    </div>}

    {activeTab === 'propuesta' && <div className="panel">
      <ConstructionProposalPanel imageUrls={photoImageUrls} hasEvidence={photoImageUrls.length > 0} stylePreferences={survey.stylePreferences || null} />
    </div>}
  </section>;
}
