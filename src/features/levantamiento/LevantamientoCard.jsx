import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { SURVEY_STATUS } from '../../domain/levantamientoSchema.js';
import { computeSurveyQuantities, spaceHasCad, spacePlanoId, GEOMETRY_MODE } from '../../domain/levantamientoCadLink.js';
import { loadPlano } from '../planos/cadPlanoCloud.js';

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

/* F4-QA: la tarjeta usa la MISMA regla que el detalle (computeSurveyQuantities):
   un espacio con plano CAD toma sus cantidades del plano persistido, nunca de
   la captura inicial. Mientras carga, no muestra la cifra de captura. */
function useSurveyCadModels(survey){
  const [models, setModels] = useState({});
  const linksKey = JSON.stringify(survey.cadLinks || {});
  useEffect(() => {
    let alive = true;
    const linked = (survey.spaces || []).filter(s => spaceHasCad(survey, s.id));
    if(!linked.length){ setModels({}); return undefined; }
    Promise.all(linked.map(async s => [s.id, (await loadPlano(spacePlanoId(survey, s.id)))?.snapshot?.cadModel || null]))
      .then(pairs => { if(alive) setModels(Object.fromEntries(pairs.filter(([, m]) => m))); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survey.id, linksKey, survey.updatedAt]);
  return models;
}

export function LevantamientoCard({ survey, onOpen, onOpen3d, onRemove }){
  const { t: tr } = useI18n();
  const quantities = computeSurveyQuantities(survey, useSurveyCadModels(survey));
  const totals = quantities.totals;
  const loading = quantities.pendingSpaces.length > 0;
  const val = (n, unit) => (loading ? '…' : `${fmt(n)}${unit}`);
  const statusLabel = tr(`levantamiento.${STATUS_I18N_KEY[survey.status] || 'statusDraft'}`);
  return <div className="survey-card">
    <span className={`survey-status ${STATUS_CLASS[survey.status] || 'muted'}`}>{statusLabel}</span>
    <h3>{survey.name || tr('levantamiento.unnamedSurvey')}</h3>
    {survey.description && <p className="muted">{survey.description}</p>}
    <div className="survey-stat-grid">
      <div><small>{tr('levantamiento.statFloorArea')}</small><b>{val(totals.floorArea, ' m²')}</b></div>
      <div><small>{tr('levantamiento.statWalls')}</small><b>{val(totals.wallNetArea, ' m²')}</b></div>
      <div><small>{tr('levantamiento.statCeilings')}</small><b>{val(totals.ceilingArea, ' m²')}</b></div>
      <div><small>{tr('levantamiento.statDoors')}</small><b>{loading ? '…' : totals.doorsCount}</b></div>
      <div><small>{tr('levantamiento.statWindows')}</small><b>{loading ? '…' : totals.windowsCount}</b></div>
    </div>
    <p className="muted" style={{ fontSize: '.76rem', margin: '4px 0 0' }}>
      {quantities.mode === GEOMETRY_MODE.CAD_AUTHORITATIVE ? 'Cantidades desde plano CAD'
        : quantities.mode === GEOMETRY_MODE.MIXTO ? 'Cantidades desde plano CAD y captura manual'
        : 'Cantidad desde captura manual'}
    </p>
    <div className="survey-actions">
      <button type="button" className="soft" onClick={onOpen}>{tr('levantamiento.actionOpen')}</button>
      <button type="button" className="soft" onClick={onOpen3d} title={tr('levantamiento.action3dHint')}>{tr('levantamiento.action3d')}</button>
      <button type="button" className="soft" disabled title={tr('levantamiento.actionQuantifyHint')}>{tr('levantamiento.actionQuantify')}</button>
      <button type="button" className="soft" disabled title={tr('levantamiento.actionConceptsHint')}>{tr('levantamiento.actionConcepts')}</button>
      <a onClick={onRemove} style={{ color: 'var(--danger)', cursor: 'pointer' }}>{tr('levantamiento.actionDelete')}</a>
    </div>
  </div>;
}
