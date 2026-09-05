import { SpaceCard } from './SpaceCard.jsx';
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

/* Vista "Abrir" de un levantamiento ya guardado: permite editar nombre,
   espacios, puertas y ventanas, y persiste con onChange (que en
   LevantamientoModule llama setSurveys). Reutiliza SpaceCard, la misma
   tarjeta usada al crear el levantamiento en ManualSurveyForm. */
export function SurveyDetail({ survey, onBack, onChange }){
  const { t: tr } = useI18n();
  const totals = aggregateSurveyTotals(survey);
  const statusLabel = tr(`levantamiento.${STATUS_I18N_KEY[survey.status] || 'statusDraft'}`);

  const persist = (next) => onChange(recomputeSurvey({ ...next, status: next.spaces.length ? SURVEY_STATUS.PROCESSED : SURVEY_STATUS.DRAFT, updatedAt: Date.now() }));

  const setField = (field, value) => persist({ ...survey, [field]: value });
  const addSpace = () => persist({ ...survey, spaces: [...survey.spaces, makeEmptySpace({ name: tr('levantamiento.defaultSpaceName', { n: survey.spaces.length + 1 }) })] });
  const updateSpace = (id, next) => persist({ ...survey, spaces: survey.spaces.map(s => s.id === id ? next : s) });
  const removeSpace = (id) => persist({ ...survey, spaces: survey.spaces.filter(s => s.id !== id) });

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

    <div className="panel survey-form">
      <div className="field-grid">
        <div className="nf wide"><label>{tr('levantamiento.nameLabel')}</label><input value={survey.name} onChange={e => setField('name', e.target.value)} /></div>
        <div className="nf wide"><label>{tr('levantamiento.descriptionPlaceholderShort')}</label><input value={survey.description || ''} onChange={e => setField('description', e.target.value)} placeholder={tr('levantamiento.descriptionPlaceholder')} /></div>
      </div>

      <div className="survey-spaces-list">
        {survey.spaces.map(space => <SpaceCard key={space.id} space={space} onUpdate={next => updateSpace(space.id, next)} onRemove={survey.spaces.length > 1 ? () => removeSpace(space.id) : null} />)}
      </div>
      <button type="button" className="soft" onClick={addSpace}>{tr('levantamiento.addSpace')}</button>
    </div>
  </section>;
}
