import { useI18n } from '../../i18n/I18nContext.jsx';
import { SURVEY_STATUS } from '../../domain/levantamientoSchema.js';
import { aggregateSurveyTotals } from '../../lib/levantamientoCalc.js';

const STATUS_CLASS = {
  [SURVEY_STATUS.DRAFT]: 'muted',
  [SURVEY_STATUS.PROCESSING]: 'warn',
  [SURVEY_STATUS.PROCESSED]: 'ok',
  [SURVEY_STATUS.WITH_OBSERVATIONS]: 'warn',
  [SURVEY_STATUS.ERROR]: 'danger'
};

const STATUS_I18N_KEY = {
  [SURVEY_STATUS.DRAFT]: 'statusDraft',
  [SURVEY_STATUS.PROCESSING]: 'statusProcessing',
  [SURVEY_STATUS.PROCESSED]: 'statusProcessed',
  [SURVEY_STATUS.WITH_OBSERVATIONS]: 'statusObservations',
  [SURVEY_STATUS.ERROR]: 'statusError'
};

const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function LevantamientoCard({ survey, onOpen, onRemove }){
  const { t: tr } = useI18n();
  const totals = aggregateSurveyTotals(survey);
  const statusLabel = tr(`levantamiento.${STATUS_I18N_KEY[survey.status] || 'statusDraft'}`);
  return <div className="survey-card">
    <span className={`survey-status ${STATUS_CLASS[survey.status] || 'muted'}`}>{statusLabel}</span>
    <h3>{survey.name || tr('levantamiento.unnamedSurvey')}</h3>
    {survey.description && <p className="muted">{survey.description}</p>}
    <div className="survey-stat-grid">
      <div><small>{tr('levantamiento.statFloorArea')}</small><b>{fmt(totals.floorArea)} m²</b></div>
      <div><small>{tr('levantamiento.statWalls')}</small><b>{fmt(totals.wallNetArea)} m²</b></div>
      <div><small>{tr('levantamiento.statCeilings')}</small><b>{fmt(totals.ceilingArea)} m²</b></div>
      <div><small>{tr('levantamiento.statDoors')}</small><b>{totals.doorsCount}</b></div>
      <div><small>{tr('levantamiento.statWindows')}</small><b>{totals.windowsCount}</b></div>
    </div>
    <div className="survey-actions">
      <button type="button" className="soft" onClick={onOpen}>{tr('levantamiento.actionOpen')}</button>
      <button type="button" className="soft" disabled title={tr('levantamiento.action3dHint')}>{tr('levantamiento.action3d')}</button>
      <button type="button" className="soft" disabled title={tr('levantamiento.actionQuantifyHint')}>{tr('levantamiento.actionQuantify')}</button>
      <button type="button" className="soft" disabled title={tr('levantamiento.actionConceptsHint')}>{tr('levantamiento.actionConcepts')}</button>
      <a onClick={onRemove} style={{ color: 'var(--danger)', cursor: 'pointer' }}>{tr('levantamiento.actionDelete')}</a>
    </div>
  </div>;
}
