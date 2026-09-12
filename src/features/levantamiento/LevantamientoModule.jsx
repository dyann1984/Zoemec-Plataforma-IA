import { useState } from 'react';
import { PageHead, EmptyState } from '../../components/ui/PageElements.jsx';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { LevantamientoCard } from './LevantamientoCard.jsx';
import { NewSurveyModal } from './NewSurveyModal.jsx';
import { SurveyDetail } from './SurveyDetail.jsx';
import { recomputeSurvey } from '../../lib/levantamientoCalc.js';
import { SURVEY_SOURCE_TYPE } from '../../domain/levantamientoSchema.js';

/* Modulo "Levantamiento IA" (Fase 1). surveys/setSurveys ya llegan filtrados
   al proyecto activo (useProjectScoped en main.jsx, mismo patron que
   apus/budgets/catalog) -- este componente no filtra por proyecto, solo
   consume la vista ya aislada. */
export function LevantamientoModule({ surveys, setSurveys, activeProjectId, onNeedProject, onSendToApu, currentUserEmail, organizationId = null }){
  const { t: tr } = useI18n();
  const list = surveys || [];
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [openTab, setOpenTab] = useState('datos');

  const requireProject = () => {
    if(activeProjectId) return true;
    if(confirm(tr('levantamiento.needProjectMsg'))) onNeedProject?.();
    return false;
  };

  const openNew = () => { if(requireProject()) setShowNew(true); };

  /* P1 (regresion en produccion, "no aparece el flujo Que quieres construir"):
     antes, guardar evidencia (foto/video/3D) dejaba al usuario en la pestana
     'datos' de siempre -- la pestana 'propuesta' existia, pero nadie la
     encontraba sin buscarla. Ahora, si el levantamiento recien creado SI
     tiene evidencia real (mismo criterio que SurveyDetail#hasEvidence), se
     abre DIRECTO en 'propuesta' -- nunca se fuerza esa pestana en un
     levantamiento manual sin evidencia (ahi ni siquiera existe, dejaria la
     pantalla en blanco). */
  const addSurvey = (survey) => {
    setSurveys([survey, ...list]);
    setShowNew(false);
    setOpenId(survey.id);
    const hasEvidence = (survey.scanMedia || []).length > 0 || survey.sourceType === SURVEY_SOURCE_TYPE.IMPORT_3D;
    setOpenTab(hasEvidence ? 'propuesta' : 'datos');
  };
  const updateSurvey = (id, next) => setSurveys(list.map(s => s.id === id ? recomputeSurvey(next) : s));
  const removeSurvey = (id) => {
    const target = list.find(s => s.id === id);
    if(!confirm(tr('levantamiento.deleteConfirmMsg', { name: target?.name || tr('levantamiento.deleteFallbackName') }))) return;
    setSurveys(list.filter(s => s.id !== id));
    if(openId === id) setOpenId(null);
  };

  const openSurveyAt = (id, tab) => { setOpenId(id); setOpenTab(tab); };

  const openSurvey = list.find(s => s.id === openId) || null;
  if(openSurvey){
    return <SurveyDetail survey={openSurvey} initialTab={openTab} onBack={() => setOpenId(null)} onChange={next => updateSurvey(openSurvey.id, next)} onSendToApu={onSendToApu} currentUserEmail={currentUserEmail} />;
  }

  return <section>
    <PageHead
      kicker={tr('levantamiento.kicker')}
      title={tr('levantamiento.title')}
      desc={tr('levantamiento.desc')}
      action={<button onClick={openNew}>{tr('levantamiento.newSurvey')}</button>}
    />
    {list.length
      ? <div className="survey-grid">{list.map(s => <LevantamientoCard key={s.id} survey={s} onOpen={() => openSurveyAt(s.id, 'datos')} onOpen3d={() => openSurveyAt(s.id, 'vista3d')} onRemove={() => removeSurvey(s.id)} />)}</div>
      : <div className="panel"><EmptyState icon="bim" title={tr('levantamiento.emptyTitle')} text={tr('levantamiento.emptyText')} actionLabel={tr('levantamiento.emptyAction')} onAction={openNew} /></div>}
    {showNew && <NewSurveyModal projectId={activeProjectId} organizationId={organizationId} onClose={() => setShowNew(false)} onCreate={addSurvey} />}
  </section>;
}
