import { useState } from 'react';
import { PageHead, EmptyState } from '../../components/ui/PageElements.jsx';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { LevantamientoCard } from './LevantamientoCard.jsx';
import { NewSurveyModal } from './NewSurveyModal.jsx';
import { SurveyDetail } from './SurveyDetail.jsx';
import { recomputeSurvey } from '../../lib/levantamientoCalc.js';
import { SURVEY_SOURCE_TYPE } from '../../domain/levantamientoSchema.js';

/* Modulo "Levantamiento IA".
   F4: los levantamientos viven en el SERVIDOR (/api/levantamientos, ver
   levantamientoCloud.js#useProjectSurveys): compartidos con los miembros de
   la empresa, versionados por revision y con migracion perezosa del bloque
   local anterior. `store` = { surveys, status, create, update, remove }. */
export function LevantamientoModule({ store, activeProjectId, onNeedProject, onSendToApu, currentUserEmail, organizationId = null }){
  const { t: tr } = useI18n();
  const list = store?.surveys || [];
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
     si el levantamiento recien creado SI tiene evidencia real, se abre
     DIRECTO en 'propuesta'. */
  const addSurvey = async (survey) => {
    try{
      const saved = await store.create(survey);
      setShowNew(false);
      setOpenId(saved.id);
      const hasEvidence = (survey.scanMedia || []).length > 0 || survey.sourceType === SURVEY_SOURCE_TYPE.IMPORT_3D;
      setOpenTab(hasEvidence ? 'propuesta' : 'datos');
    }catch(err){
      window.zoemecNotify?.(`No se pudo crear el levantamiento: ${err.message}`, 'error');
    }
  };
  const updateSurvey = (next) => store.update(recomputeSurvey(next));
  const removeSurvey = async (id) => {
    const target = list.find(s => s.id === id);
    if(!confirm(tr('levantamiento.deleteConfirmMsg', { name: target?.name || tr('levantamiento.deleteFallbackName') }))) return;
    try{ await store.remove(id); }catch(err){ window.zoemecNotify?.(err.message, 'error'); return; }
    if(openId === id) setOpenId(null);
  };

  const openSurveyAt = (id, tab) => { setOpenId(id); setOpenTab(tab); };

  const openSurvey = list.find(s => s.id === openId) || null;
  if(openSurvey){
    return <SurveyDetail survey={openSurvey} projectId={activeProjectId} initialTab={openTab} onBack={() => setOpenId(null)} onChange={updateSurvey} onSendToApu={onSendToApu} currentUserEmail={currentUserEmail} />;
  }

  const st = store?.status || {};
  return <section>
    <PageHead
      kicker={tr('levantamiento.kicker')}
      title={tr('levantamiento.title')}
      desc={tr('levantamiento.desc')}
      action={<button onClick={openNew}>{tr('levantamiento.newSurvey')}</button>}
    />
    {st.loading && <p className="muted">Cargando levantamientos del servidor…</p>}
    {st.error && <div className="panel" style={{ borderColor: 'var(--danger)' }}><p style={{ color: 'var(--danger)', margin: 0 }}>{st.error}</p></div>}
    {st.migrated > 0 && <p className="muted" style={{ fontSize: '.82rem' }}>{st.migrated} levantamiento(s) de este equipo se migraron al servidor (el respaldo local se conserva).</p>}
    {(st.migrationErrors || []).length > 0 && <div className="panel" style={{ borderColor: 'var(--danger)' }}>
      <p style={{ margin: 0 }}><b>No se pudieron migrar {st.migrationErrors.length} levantamiento(s) locales</b> (siguen intactos en este equipo):</p>
      <ul>{st.migrationErrors.map(e => <li key={e.id}>{e.name || e.id}: {e.error}</li>)}</ul>
    </div>}
    {list.length
      ? <div className="survey-grid">{list.map(s => <LevantamientoCard key={s.id} survey={s} onOpen={() => openSurveyAt(s.id, 'datos')} onOpen3d={() => openSurveyAt(s.id, 'vista3d')} onRemove={() => removeSurvey(s.id)} />)}</div>
      : !st.loading && <div className="panel"><EmptyState icon="bim" title={tr('levantamiento.emptyTitle')} text={tr('levantamiento.emptyText')} actionLabel={tr('levantamiento.emptyAction')} onAction={openNew} /></div>}
    {showNew && <NewSurveyModal projectId={activeProjectId} organizationId={organizationId} onClose={() => setShowNew(false)} onCreate={addSurvey} />}
  </section>;
}
