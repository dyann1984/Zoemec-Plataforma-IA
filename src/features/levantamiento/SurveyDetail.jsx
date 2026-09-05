import { useState } from 'react';
import { SpaceCard } from './SpaceCard.jsx';
import { SpaceFloorPlan2D } from './SpaceFloorPlan2D.jsx';
import { Survey3DViewer } from './Survey3DViewer.jsx';
import { buildPlanoElementFromConcept } from '../../domain/levantamientoTakeoffBridge.js';
import { PageHead } from '../../components/ui/PageElements.jsx';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { SURVEY_STATUS, makeEmptySpace } from '../../domain/levantamientoSchema.js';
import { aggregateSurveyTotals, recomputeSurvey } from '../../lib/levantamientoCalc.js';

const STATUS_I18N_KEY = {
  [SURVEY_STATUS.DRAFT]: 'statusDraft',
  [SURVEY_STATUS.PROCESSING]: 'statusProcessing',
  [SURVEY_STATUS.PROCESSED]: 'statusProcessed',
  [SURVEY_STATUS.WITH_OBSERVATIONS]: 'statusObservations',
  [SURVEY_STATUS.ERROR]: 'statusError'
};

const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TABS = ['datos', 'plano2d', 'vista3d', 'cuantificacion'];
const TAB_I18N_KEY = { datos: 'tabData', plano2d: 'tabPlan2d', vista3d: 'tabView3d', cuantificacion: 'tabQuantification' };

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
  const totals = aggregateSurveyTotals(survey);
  const statusLabel = tr(`levantamiento.${STATUS_I18N_KEY[survey.status] || 'statusDraft'}`);
  const activeSpace = survey.spaces.find(s => s.id === activeSpaceId) || survey.spaces[0] || null;

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
      {TABS.map(t => <button key={t} type="button" role="tab" aria-selected={activeTab === t} className={`survey-tab${activeTab === t ? ' active' : ''}`} onClick={() => setActiveTab(t)}>{tr(`levantamiento.${TAB_I18N_KEY[t]}`)}</button>)}
    </div>

    {activeTab === 'datos' && <div className="panel survey-form">
      <div className="field-grid">
        <div className="nf wide"><label>{tr('levantamiento.nameLabel')}</label><input value={survey.name} onChange={e => setField('name', e.target.value)} /></div>
        <div className="nf wide"><label>{tr('levantamiento.descriptionPlaceholderShort')}</label><input value={survey.description || ''} onChange={e => setField('description', e.target.value)} placeholder={tr('levantamiento.descriptionPlaceholder')} /></div>
      </div>

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
  </section>;
}
