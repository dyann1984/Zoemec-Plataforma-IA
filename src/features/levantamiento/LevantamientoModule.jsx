import { useState } from 'react';
import { PageHead, EmptyState } from '../../components/ui/PageElements.jsx';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { LevantamientoCard } from './LevantamientoCard.jsx';
import { NewSurveyModal } from './NewSurveyModal.jsx';
import { SurveyDetail } from './SurveyDetail.jsx';
import { recomputeSurvey } from '../../lib/levantamientoCalc.js';

/* Modulo "Levantamiento IA" (Fase 1). surveys/setSurveys ya llegan filtrados
   al proyecto activo (useProjectScoped en main.jsx, mismo patron que
   apus/budgets/catalog) -- este componente no filtra por proyecto, solo
   consume la vista ya aislada. */
export function LevantamientoModule({ surveys, setSurveys, activeProjectId, onNeedProject }){
  const { t: tr } = useI18n();
  const list = surveys || [];
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState(null);

  const requireProject = () => {
    if(activeProjectId) return true;
    if(confirm(tr('levantamiento.needProjectMsg'))) onNeedProject?.();
    return false;
  };

  const openNew = () => { if(requireProject()) setShowNew(true); };

  const addSurvey = (survey) => {
    setSurveys([survey, ...list]);
    setShowNew(false);
    setOpenId(survey.id);
  };
  const updateSurvey = (id, next) => setSurveys(list.map(s => s.id === id ? recomputeSurvey(next) : s));
  const removeSurvey = (id) => {
    const target = list.find(s => s.id === id);
    if(!confirm(tr('levantamiento.deleteConfirmMsg', { name: target?.name || tr('levantamiento.deleteFallbackName') }))) return;
    setSurveys(list.filter(s => s.id !== id));
    if(openId === id) setOpenId(null);
  };

  const openSurvey = list.find(s => s.id === openId) || null;
  if(openSurvey){
    return <SurveyDetail survey={openSurvey} onBack={() => setOpenId(null)} onChange={next => updateSurvey(openSurvey.id, next)} />;
  }

  return <section>
    <PageHead
      kicker={tr('levantamiento.kicker')}
      title={tr('levantamiento.title')}
      desc={tr('levantamiento.desc')}
      action={<button onClick={openNew}>{tr('levantamiento.newSurvey')}</button>}
    />
    {list.length
      ? <div className="survey-grid">{list.map(s => <LevantamientoCard key={s.id} survey={s} onOpen={() => setOpenId(s.id)} onRemove={() => removeSurvey(s.id)} />)}</div>
      : <div className="panel"><EmptyState icon="bim" title={tr('levantamiento.emptyTitle')} text={tr('levantamiento.emptyText')} actionLabel={tr('levantamiento.emptyAction')} onAction={openNew} /></div>}
    {showNew && <NewSurveyModal projectId={activeProjectId} onClose={() => setShowNew(false)} onCreate={addSurvey} />}
  </section>;
}
