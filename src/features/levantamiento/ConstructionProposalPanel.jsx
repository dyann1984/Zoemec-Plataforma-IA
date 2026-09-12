/* Fase 3 (evolucion integral Levantamiento IA): "Crear propuesta de
   construccion con IA" -- vive dentro de SurveyDetail.jsx (pestana nueva
   'propuesta'), solo se monta cuando el Survey ya tiene evidencia real
   (foto o modelo 3D importado). Llama a POST /api/construction-proposal
   (server/api-lib/_route-construction-proposal.mjs) con las URLs de
   descarga YA resueltas por SurveyDetail (mismo mecanismo que la pestana
   Multimedia -- nunca se resuelve dos veces).

   P0 (correccion de regresion, "el trabajo se pierde al cambiar de pestana"):
   TODO el estado de este panel (formulario Y resultado) vive en
   useDraftAutosave, con clave = surveyId -- sobrevive cambiar de pestana/
   modulo, refresh, y cerrar/reabrir, exactamente igual que el resto de la
   app con useCloudState. "Si ya existe [una propuesta]: mostrar el
   resultado guardado" (pedido explicito del brief) es HECHO por esto
   mismo, no una logica aparte: el resultado ES parte del borrador.

   "Generar APU desde esta propuesta" (regla 5 del brief): este panel NO
   crea ningun APU el mismo -- pide al servidor los conceptos derivados
   (deriveApuConceptsFromProposal, ya probado en constructionProposal.test.js)
   y los deja listos para pegar en el generador por lote de APU YA EXISTENTE
   (main.jsx, "Generar por lote" -- TEXTAREA de conceptos separados por
   linea). Puente deliberadamente simple: no duplica el pipeline de
   generacion de APU ni el gate de plan/precio que ese flujo ya aplica. */
import { useI18n } from '../../i18n/I18nContext.jsx';
import { auth } from '../../firebase.js';
import { useDraftAutosave, clearDraftAutosave } from '../../hooks/useDraftAutosave.js';
import { AutosaveIndicator } from '../../components/ui/AutosaveIndicator.jsx';
import { generateConstructionProposal, deriveApuConceptsFromProposal } from '../../services/constructionProposalApi.js';
import { DATA_ORIGIN } from '../../domain/constructionProposal.js';

const ORIGIN_BADGE = {
  [DATA_ORIGIN.DETECTADO]: '✅', [DATA_ORIGIN.PROPORCIONADO]: '✅',
  [DATA_ORIGIN.INFERIDO]: '◐', [DATA_ORIGIN.ESTIMADO]: '△'
};

function makeEmptyDraft(){
  return {
    userPrompt: '', largo: '', ancho: '', altura: '', niveles: '', necesidadesEspeciales: '', referenceBudget: '',
    status: 'idle', proposal: null, error: null
  };
}

function DimensionRow({ label, field, tr }){
  if(field.valor == null) return null;
  return <div className="survey-quant-table" style={{ marginBottom: 2 }}>
    <span>{ORIGIN_BADGE[field.origen] || '△'}</span> {label}: <b>{field.valor}</b> <span className="muted" style={{ fontSize: '.72rem' }}>({tr(`levantamiento.proposalOrigin_${field.origen}`)})</span>
  </div>;
}

export function ConstructionProposalPanel({ surveyId, imageUrls, hasEvidence, stylePreferences }){
  const { t: tr } = useI18n();
  const user = auth.currentUser ? { uid: auth.currentUser.uid } : null;
  const [draft, setDraft] = useDraftAutosave(user, 'proposal', surveyId, makeEmptyDraft());
  const d = draft || makeEmptyDraft();
  const patch = (fields) => setDraft(prev => ({ ...(prev || makeEmptyDraft()), ...fields }));

  const generate = async () => {
    if(!d.userPrompt.trim()) return;
    patch({ status: 'loading', proposal: null, error: null });
    try{
      const knownDimensions = {
        largo: Number(d.largo) || undefined, ancho: Number(d.ancho) || undefined, altura: Number(d.altura) || undefined
      };
      const { proposal } = await generateConstructionProposal({
        imageUrls, userPrompt: d.userPrompt.trim(), knownDimensions, stylePreferences,
        referenceBudget: Number(d.referenceBudget) || 0, levels: Number(d.niveles) || 0, specialNeeds: d.necesidadesEspeciales
      });
      patch({ status: 'ready', proposal, error: null });
    }catch(err){
      patch({ status: 'error', proposal: null, error: err.message || tr('levantamiento.proposalErrorMsg') });
    }
  };

  const copyApuConcepts = async () => {
    const { concepts } = await deriveApuConceptsFromProposal(d.proposal).catch(err => {
      window.zoemecNotify?.(err.message || tr('levantamiento.proposalErrorMsg'), 'error');
      return { concepts: [] };
    });
    if(!concepts.length){
      window.zoemecNotify?.(tr('levantamiento.proposalNoConceptsMsg'), 'info');
      return;
    }
    const text = concepts.map(c => c.concept).join('\n');
    try{ await navigator.clipboard.writeText(text); }catch{ /* portapapeles no disponible -- el usuario puede seleccionar el texto mostrado */ }
    window.zoemecNotify?.(tr('levantamiento.proposalConceptsCopiedMsg', { count: concepts.length }), 'info');
  };

  // "Nueva propuesta" (regla explicita: si ya existe, mostrar el resultado
  // guardado -- pero el usuario debe poder pedir otra sin perder la anterior
  // por accidente, ver clearDraftAutosave). Vuelve al formulario vacio;
  // el borrador anterior queda descartado a proposito (una propuesta vieja
  // ya resuelta no debe quedar mezclada con el intento nuevo).
  const startOver = () => { clearDraftAutosave(user, 'proposal', surveyId); setDraft(makeEmptyDraft()); };

  const proposal = d.proposal;

  // "Si ya existe: mostrar el resultado guardado" -- el CTA de captura solo
  // se muestra si TODAVIA no hay ninguna propuesta generada.
  if(proposal){
    return <div className="construction-proposal-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="phonescan-disclaimer" style={{ flex: 1 }}>{tr('levantamiento.proposalDisclaimer')}</div>
        <AutosaveIndicator />
      </div>
      <div className="panel" style={{ marginTop: 12 }}>
        <h4>{tr('levantamiento.proposalResultTitle')}</h4>
        {proposal.requiresProfessionalValidation && <div className="survey-opening-warning">{tr('levantamiento.proposalRequiresValidationMsg')}</div>}
        <p>{proposal.descripcion}</p>

        <b style={{ fontSize: '.82rem' }}>{tr('levantamiento.proposalDimensionsTitle')}</b>
        <DimensionRow label={tr('levantamiento.proposalDimLength')} field={proposal.dimensiones.largo} tr={tr} />
        <DimensionRow label={tr('levantamiento.proposalDimWidth')} field={proposal.dimensiones.ancho} tr={tr} />
        <DimensionRow label={tr('levantamiento.proposalDimHeight')} field={proposal.dimensiones.altura} tr={tr} />
        <DimensionRow label={tr('levantamiento.proposalDimArea')} field={proposal.dimensiones.superficie} tr={tr} />
        <DimensionRow label={tr('levantamiento.proposalDimVolume')} field={proposal.dimensiones.volumen} tr={tr} />

        {Object.entries(proposal.sistemaConstructivo).filter(([, items]) => items.length > 0).map(([key, items]) => (
          <div key={key} style={{ marginTop: 8 }}>
            <b style={{ fontSize: '.82rem' }}>{tr(`levantamiento.proposalSystem_${key}`)}</b>
            <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{items.map((item, i) => <li key={i} style={{ fontSize: '.82rem' }}>{item}</li>)}</ul>
          </div>
        ))}

        {proposal.notes.length > 0 && <>
          <b style={{ fontSize: '.82rem' }}>{tr('levantamiento.proposalNotesTitle')}</b>
          <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{proposal.notes.map((n, i) => <li key={i} className="muted" style={{ fontSize: '.78rem' }}>{n}</li>)}</ul>
        </>}

        <div className="form-actions">
          <button className="soft" onClick={startOver}>{tr('levantamiento.proposalStartOverButton')}</button>
          <button className="soft" onClick={copyApuConcepts}>{tr('levantamiento.proposalCopyConceptsButton')}</button>
        </div>
      </div>
    </div>;
  }

  // CTA destacado (pedido explicito del brief, punto P1): este es el
  // PRIMER contenido que el usuario ve en la pestana cuando todavia no
  // genero ninguna propuesta -- nunca queda enterrado ni ambiguo.
  return <div className="construction-proposal-panel">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div className="phonescan-disclaimer" style={{ flex: 1 }}>{tr('levantamiento.proposalDisclaimer')}</div>
      <AutosaveIndicator />
    </div>

    <div className="panel proposal-cta" style={{ textAlign: 'center', padding: '20px 16px', marginBottom: 12 }}>
      <h3 style={{ margin: '0 0 4px' }}>✨ {tr('levantamiento.proposalGenerateButton')}</h3>
      <p className="muted" style={{ marginTop: 0 }}>{tr('levantamiento.proposalCtaHint')}</p>
    </div>

    <div className="nf wide">
      <label>{tr('levantamiento.proposalPromptLabel')}</label>
      <textarea rows={3} value={d.userPrompt} onChange={e => patch({ userPrompt: e.target.value })} placeholder={tr('levantamiento.proposalPromptPlaceholder')} />
    </div>
    <div className="field-grid">
      <div className="nf"><label>{tr('levantamiento.proposalKnownLengthLabel')}</label><input type="number" step="any" value={d.largo} onChange={e => patch({ largo: e.target.value })} placeholder="m" /></div>
      <div className="nf"><label>{tr('levantamiento.proposalKnownWidthLabel')}</label><input type="number" step="any" value={d.ancho} onChange={e => patch({ ancho: e.target.value })} placeholder="m" /></div>
      <div className="nf"><label>{tr('levantamiento.proposalKnownHeightLabel')}</label><input type="number" step="any" value={d.altura} onChange={e => patch({ altura: e.target.value })} placeholder="m" /></div>
      <div className="nf"><label>{tr('levantamiento.proposalLevelsLabel')}</label><input type="number" step="1" min="1" value={d.niveles} onChange={e => patch({ niveles: e.target.value })} placeholder="1" /></div>
      <div className="nf"><label>{tr('levantamiento.proposalBudgetLabel')}</label><input type="number" step="any" value={d.referenceBudget} onChange={e => patch({ referenceBudget: e.target.value })} placeholder="MXN" /></div>
    </div>
    <div className="nf wide">
      <label>{tr('levantamiento.proposalSpecialNeedsLabel')}</label>
      <textarea rows={2} value={d.necesidadesEspeciales} onChange={e => patch({ necesidadesEspeciales: e.target.value })} placeholder={tr('levantamiento.proposalSpecialNeedsPlaceholder')} />
    </div>
    {!hasEvidence && <p className="muted" style={{ fontSize: '.78rem' }}>{tr('levantamiento.proposalNoImagesHint')}</p>}

    <div className="form-actions">
      <button onClick={generate} disabled={!d.userPrompt.trim() || d.status === 'loading'}>
        {d.status === 'loading' ? tr('levantamiento.proposalGeneratingMsg') : `✨ ${tr('levantamiento.proposalGenerateButton')}`}
      </button>
    </div>

    {d.status === 'error' && <p className="nf-error-msg">{d.error}</p>}
  </div>;
}
