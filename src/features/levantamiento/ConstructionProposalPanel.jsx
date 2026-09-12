/* Fase 3 (evolucion integral Levantamiento IA): "Crear propuesta de
   construccion con IA" -- vive dentro de SurveyDetail.jsx (pestana nueva
   'propuesta'), solo se monta cuando el Survey ya tiene evidencia real
   (foto o modelo 3D importado). Llama a POST /api/construction-proposal
   (server/api-lib/_route-construction-proposal.mjs) con las URLs de
   descarga YA resueltas por SurveyDetail (mismo mecanismo que la pestana
   Multimedia -- nunca se resuelve dos veces).

   "Generar APU desde esta propuesta" (regla 5 del brief): este panel NO
   crea ningun APU el mismo -- pide al servidor los conceptos derivados
   (deriveApuConceptsFromProposal, ya probado en constructionProposal.test.js)
   y los deja listos para pegar en el generador por lote de APU YA EXISTENTE
   (main.jsx, "Generar por lote" -- TEXTAREA de conceptos separados por
   linea). Puente deliberadamente simple: no duplica el pipeline de
   generacion de APU ni el gate de plan/precio que ese flujo ya aplica. */
import { useState } from 'react';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { generateConstructionProposal, deriveApuConceptsFromProposal } from '../../services/constructionProposalApi.js';
import { DATA_ORIGIN } from '../../domain/constructionProposal.js';

const ORIGIN_BADGE = {
  [DATA_ORIGIN.DETECTADO]: '✅', [DATA_ORIGIN.PROPORCIONADO]: '✅',
  [DATA_ORIGIN.INFERIDO]: '◐', [DATA_ORIGIN.ESTIMADO]: '△'
};

function DimensionRow({ label, field, tr }){
  if(field.valor == null) return null;
  return <div className="survey-quant-table" style={{ marginBottom: 2 }}>
    <span>{ORIGIN_BADGE[field.origen] || '△'}</span> {label}: <b>{field.valor}</b> <span className="muted" style={{ fontSize: '.72rem' }}>({tr(`levantamiento.proposalOrigin_${field.origen}`)})</span>
  </div>;
}

export function ConstructionProposalPanel({ imageUrls, hasEvidence, stylePreferences }){
  const { t: tr } = useI18n();
  const [userPrompt, setUserPrompt] = useState('');
  const [largo, setLargo] = useState('');
  const [ancho, setAncho] = useState('');
  const [altura, setAltura] = useState('');
  const [referenceBudget, setReferenceBudget] = useState('');
  const [state, setState] = useState({ status: 'idle', proposal: null, error: null });

  const generate = async () => {
    if(!userPrompt.trim()) return;
    setState({ status: 'loading', proposal: null, error: null });
    try{
      const knownDimensions = {
        largo: Number(largo) || undefined, ancho: Number(ancho) || undefined, altura: Number(altura) || undefined
      };
      const { proposal } = await generateConstructionProposal({
        imageUrls, userPrompt: userPrompt.trim(), knownDimensions, stylePreferences, referenceBudget: Number(referenceBudget) || 0
      });
      setState({ status: 'ready', proposal, error: null });
    }catch(err){
      setState({ status: 'error', proposal: null, error: err.message || tr('levantamiento.proposalErrorMsg') });
    }
  };

  const copyApuConcepts = async () => {
    const { concepts } = await deriveApuConceptsFromProposal(state.proposal).catch(err => {
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

  const proposal = state.proposal;

  return <div className="construction-proposal-panel">
    <div className="phonescan-disclaimer">{tr('levantamiento.proposalDisclaimer')}</div>

    <div className="nf wide">
      <label>{tr('levantamiento.proposalPromptLabel')}</label>
      <textarea rows={3} value={userPrompt} onChange={e => setUserPrompt(e.target.value)} placeholder={tr('levantamiento.proposalPromptPlaceholder')} />
    </div>
    <div className="field-grid">
      <div className="nf"><label>{tr('levantamiento.proposalKnownLengthLabel')}</label><input type="number" step="any" value={largo} onChange={e => setLargo(e.target.value)} placeholder="m" /></div>
      <div className="nf"><label>{tr('levantamiento.proposalKnownWidthLabel')}</label><input type="number" step="any" value={ancho} onChange={e => setAncho(e.target.value)} placeholder="m" /></div>
      <div className="nf"><label>{tr('levantamiento.proposalKnownHeightLabel')}</label><input type="number" step="any" value={altura} onChange={e => setAltura(e.target.value)} placeholder="m" /></div>
      <div className="nf"><label>{tr('levantamiento.proposalBudgetLabel')}</label><input type="number" step="any" value={referenceBudget} onChange={e => setReferenceBudget(e.target.value)} placeholder="MXN" /></div>
    </div>
    {!hasEvidence && <p className="muted" style={{ fontSize: '.78rem' }}>{tr('levantamiento.proposalNoImagesHint')}</p>}

    <div className="form-actions">
      <button onClick={generate} disabled={!userPrompt.trim() || state.status === 'loading'}>
        {state.status === 'loading' ? tr('levantamiento.proposalGeneratingMsg') : `✨ ${tr('levantamiento.proposalGenerateButton')}`}
      </button>
    </div>

    {state.status === 'error' && <p className="nf-error-msg">{state.error}</p>}

    {proposal && <div className="panel" style={{ marginTop: 12 }}>
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
        <button className="soft" onClick={copyApuConcepts}>{tr('levantamiento.proposalCopyConceptsButton')}</button>
      </div>
    </div>}
  </div>;
}
