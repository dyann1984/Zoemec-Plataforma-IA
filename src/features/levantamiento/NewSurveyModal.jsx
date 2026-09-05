import { useState } from 'react';
import { ManualSurveyForm } from './ManualSurveyForm.jsx';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { SURVEY_IMPORT_FORMATS } from '../../domain/levantamientoImporters.js';

export function NewSurveyModal({ projectId, onClose, onCreate }){
  const { t: tr } = useI18n();
  const [mode, setMode] = useState(null); // null (elegir metodo) | 'manual'

  if(mode === 'manual'){
    return <ManualSurveyForm projectId={projectId} onCancel={() => setMode(null)} onSave={onCreate} />;
  }

  const importFormatsLabel = SURVEY_IMPORT_FORMATS.map(f => f.label).join(', ');

  return <div className="record-modal" role="dialog" aria-modal="true">
    <div className="record-backdrop" onClick={onClose}></div>
    <div className="panel record-form">
      <div className="record-form-head"><div><span>{tr('levantamiento.newModalKicker')}</span><h2>{tr('levantamiento.newModalTitle')}</h2></div><button className="secondary" onClick={onClose}>{tr('levantamiento.cancel')}</button></div>
      <div className="survey-source-options">
        <button type="button" className="survey-source-option" onClick={() => setMode('manual')}>
          <b>{tr('levantamiento.manualOptionTitle')}</b>
          <span>{tr('levantamiento.manualOptionDesc')}</span>
        </button>
        <div className="survey-source-option disabled" aria-disabled="true">
          <b>{tr('levantamiento.import3dOptionTitle')}</b>
          <span>{tr('levantamiento.import3dOptionDesc', { formats: importFormatsLabel })}</span>
          <em className="badge-soon">{tr('levantamiento.comingSoon')}</em>
        </div>
        <div className="survey-source-option disabled" aria-disabled="true">
          <b>{tr('levantamiento.mobileScanOptionTitle')}</b>
          <span>{tr('levantamiento.mobileScanOptionDesc')}</span>
          <em className="badge-soon">{tr('levantamiento.comingSoon')}</em>
        </div>
      </div>
    </div>
  </div>;
}
