import { useState } from 'react';
import { SpaceCard } from './SpaceCard.jsx';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { SURVEY_SOURCE_TYPE, SURVEY_STATUS, makeEmptySurvey, makeEmptySpace } from '../../domain/levantamientoSchema.js';
import { recomputeSurvey } from '../../lib/levantamientoCalc.js';

export function ManualSurveyForm({ projectId, onCancel, onSave }){
  const { t: tr } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [spaces, setSpaces] = useState([makeEmptySpace({ name: tr('levantamiento.defaultSpaceName', { n: 1 }) })]);

  const addSpace = () => setSpaces(list => [...list, makeEmptySpace({ name: tr('levantamiento.defaultSpaceName', { n: list.length + 1 }) })]);
  const updateSpace = (id, next) => setSpaces(list => list.map(s => s.id === id ? next : s));
  const removeSpace = (id) => setSpaces(list => list.filter(s => s.id !== id));

  const save = () => {
    if(!name.trim()){
      alert(tr('levantamiento.nameRequiredMsg'));
      return;
    }
    const survey = makeEmptySurvey({ projectId, name: name.trim(), description: description.trim(), sourceType: SURVEY_SOURCE_TYPE.MANUAL });
    survey.spaces = spaces;
    survey.status = spaces.length ? SURVEY_STATUS.PROCESSED : SURVEY_STATUS.DRAFT;
    onSave(recomputeSurvey(survey));
  };

  return <div className="record-modal" role="dialog" aria-modal="true">
    <div className="record-backdrop" onClick={onCancel}></div>
    <div className="panel record-form survey-form">
      <div className="record-form-head"><div><span>{tr('levantamiento.manualFormKicker')}</span><h2>{tr('levantamiento.manualFormTitle')}</h2></div><button className="secondary" onClick={onCancel}>{tr('levantamiento.cancel')}</button></div>
      <div className="field-grid">
        <div className="nf wide"><label>{tr('levantamiento.nameLabel')}</label><input value={name} onChange={e => setName(e.target.value)} placeholder={tr('levantamiento.namePlaceholder')} /></div>
        <div className="nf wide"><label>{tr('levantamiento.descriptionLabel')}</label><input value={description} onChange={e => setDescription(e.target.value)} placeholder={tr('levantamiento.descriptionPlaceholder')} /></div>
      </div>

      <div className="survey-spaces-list">
        {spaces.map(space => <SpaceCard key={space.id} space={space} onUpdate={next => updateSpace(space.id, next)} onRemove={spaces.length > 1 ? () => removeSpace(space.id) : null} />)}
      </div>
      <button type="button" className="soft" onClick={addSpace}>{tr('levantamiento.addSpace')}</button>

      <div className="form-actions"><button className="secondary" onClick={onCancel}>{tr('levantamiento.cancel')}</button><button onClick={save}>{tr('levantamiento.save')}</button></div>
    </div>
  </div>;
}
