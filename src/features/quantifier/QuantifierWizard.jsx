/* Cuantificador Parametrico ZOEMEC (Fase B) -- asistente por pasos,
   determinista y basado en formulas (nunca IA), que convive con "Generar
   APU con IA" sin reemplazarlo (ver punto de entrada en src/main.jsx,
   funcion APU). Primer corte: un elemento representativo por familia
   (Zapata aislada/Columna/Muro) -- arquitectura extensible a los 14
   elementos restantes del pedido sin rediseno (ver
   src/domain/parametricElements.js#PARAMETRIC_ELEMENTS).

   Un solo archivo (orquestador + render de cada paso) en vez de un
   componente por paso: para 3 elementos y un primer corte, separar en 8
   archivos hoy seria construir de mas (ver instruccion explicita del
   usuario "no construir todo de golpe") -- se puede partir despues si el
   asistente crece de verdad. Lo que SI es compartido/reutilizable ya vive
   aparte (WizardShell.jsx, PARAMETRIC_ELEMENTS, auxiliaries.js,
   parametricApuAssembler.js). */
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { useDraftAutosave, clearDraftAutosave } from '../../hooks/useDraftAutosave.js';
import { AutosaveIndicator } from '../../components/ui/AutosaveIndicator.jsx';
import { WizardShell } from '../../components/ui/WizardShell.jsx';
import { ElementSketch } from './ElementSketch.jsx';
import { PARAMETRIC_FAMILIES, listElementsByFamily, getParametricElement } from '../../domain/parametricElements.js';
import { listAvailableAuxiliaries, resolveAuxiliaryCost } from '../../domain/auxiliaries.js';
import { assembleAPUFromParametricResult } from '../../domain/parametricApuAssembler.js';
import { listGlobalAuxiliaries, listOrgAuxiliaries } from '../../services/auxiliariesApi.js';
import { calcAPU } from '../../lib/apuCalc.js';

const STEP_KEYS = ['familia', 'elemento', 'datos', 'parametros', 'revision', 'resultado', 'generar', 'croquis'];
const FAMILY_LABEL_KEY = {
  [PARAMETRIC_FAMILIES.CIMENTACION]: 'quantFamilyCimentacion',
  [PARAMETRIC_FAMILIES.ESTRUCTURA]: 'quantFamilyEstructura',
  [PARAMETRIC_FAMILIES.ALBANILERIA]: 'quantFamilyAlbanileria'
};

function makeEmptyDraft(){
  return { step: 0, familia: null, elementoId: null, inputs: {}, params: {}, modo: 'sencillo' };
}

export function QuantifierWizard({ user, catalog, organizationId = null, activeProjectId, onApuGenerated, onCancel }){
  const { t: tr } = useI18n();
  const [draft, setDraft] = useDraftAutosave(user, 'quantifier', activeProjectId || 'new', makeEmptyDraft());
  const [auxiliaries, setAuxiliaries] = useState([]);

  useEffect(() => {
    let alive = true;
    Promise.all([listGlobalAuxiliaries(), listOrgAuxiliaries(organizationId)]).then(([global, org]) => {
      if(alive) setAuxiliaries(listAvailableAuxiliaries(global, org));
    });
    return () => { alive = false; };
  }, [organizationId]);

  const d = draft || makeEmptyDraft();
  const setD = (patch) => setDraft(prev => ({ ...(prev || makeEmptyDraft()), ...patch }));

  const elementDef = d.elementoId ? getParametricElement(d.elementoId) : null;
  const calcResult = useMemo(() => {
    if(!elementDef) return null;
    try{ return elementDef.calculate(d.inputs || {}, d.params || {}); }
    catch{ return null; }
  }, [elementDef, d.inputs, d.params]);

  const previewApu = useMemo(() => {
    if(!elementDef || !calcResult) return null;
    return assembleAPUFromParametricResult({ elementDef, inputs: d.inputs, params: d.params, calcResult, catalog, auxiliaries });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementDef, calcResult, catalog, auxiliaries]);

  const steps = STEP_KEYS.map(key => ({ key, label: tr(`levantamiento.quantStep_${key}`) }));
  const goTo = (i) => setD({ step: Math.max(0, Math.min(steps.length - 1, i)) });
  const back = () => goTo(d.step - 1);

  const inputsComplete = elementDef ? elementDef.inputs.every(inp => Number.isFinite(Number(d.inputs?.[inp.key])) && (inp.min === undefined || Number(d.inputs[inp.key]) >= inp.min)) : false;

  const handleCancel = () => {
    const hasWork = d.familia || d.elementoId;
    if(hasWork && !window.confirm(tr('levantamiento.unsavedChangesConfirmMsg'))) return;
    clearDraftAutosave(user, 'quantifier', activeProjectId || 'new');
    onCancel?.();
  };

  const handleGenerate = () => {
    if(!previewApu) return;
    onApuGenerated?.(previewApu);
    clearDraftAutosave(user, 'quantifier', activeProjectId || 'new');
  };

  return <div>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}><AutosaveIndicator /></div>
    <WizardShell steps={steps} activeIndex={d.step}>
      {d.step === 0 && <div className="visual-actions" style={{ flexWrap: 'wrap' }}>
        {Object.values(PARAMETRIC_FAMILIES).map(fam => (
          <button key={fam} type="button" className={d.familia === fam ? '' : 'soft'}
            onClick={() => setD({ familia: fam, elementoId: null, inputs: {}, params: {}, step: 1 })}>
            {tr(`levantamiento.${FAMILY_LABEL_KEY[fam]}`)}
          </button>
        ))}
      </div>}

      {d.step === 1 && <div className="visual-actions" style={{ flexWrap: 'wrap' }}>
        {listElementsByFamily(d.familia).map(el => (
          <button key={el.id} type="button" className={d.elementoId === el.id ? '' : 'soft'}
            onClick={() => setD({ elementoId: el.id, inputs: {}, params: {}, step: 2 })}>
            {el.label}
          </button>
        ))}
        {listElementsByFamily(d.familia).length === 0 && <p className="muted">{tr('levantamiento.quantNoElementsMsg')}</p>}
      </div>}

      {d.step === 2 && elementDef && <div className="field-grid">
        {elementDef.inputs.map(inp => (
          <div className="nf" key={inp.key}>
            <label>{inp.label}{inp.unit ? ` (${inp.unit})` : ''}</label>
            <input type="number" step="0.01" value={d.inputs?.[inp.key] ?? ''} placeholder={inp.default !== undefined ? String(inp.default) : ''}
              onChange={e => setD({ inputs: { ...d.inputs, [inp.key]: e.target.value === '' ? undefined : Number(e.target.value) } })} />
          </div>
        ))}
      </div>}

      {d.step === 3 && elementDef && <div>
        <div className="visual-actions" style={{ marginBottom: 12 }}>
          <button type="button" className={d.modo === 'sencillo' ? '' : 'soft'} onClick={() => setD({ modo: 'sencillo' })}>{tr('levantamiento.quantModeSimple')}</button>
          <button type="button" className={d.modo === 'experto' ? '' : 'soft'} onClick={() => setD({ modo: 'experto' })}>{tr('levantamiento.quantModeExpert')}</button>
        </div>
        <div className="field-grid">
          {elementDef.params.map(p => {
            const isEditable = d.modo === 'experto' || !p.expertOnly;
            const current = d.params?.[p.key] !== undefined ? d.params[p.key] : p.default;
            return <div className="nf" key={p.key}>
              <label>{p.label}{p.unit ? ` (${p.unit})` : ''}</label>
              {isEditable
                ? <input type={typeof p.default === 'number' ? 'number' : 'text'} step="0.01" value={current}
                    onChange={e => setD({ params: { ...d.params, [p.key]: typeof p.default === 'number' ? Number(e.target.value) : e.target.value } })} />
                : <span className="muted">{String(current)} <span className="quant-assumed-badge">{tr('levantamiento.quantAssumedBadge')}</span></span>}
            </div>;
          })}
        </div>
      </div>}

      {d.step === 4 && calcResult && <pre className="quant-summary">{JSON.stringify(calcResult.cantidades, null, 1)}</pre>}

      {d.step === 5 && previewApu && <div>
        {(() => { const calc = calcAPU(previewApu); return <div className="field-grid">
          <div><small>{tr('levantamiento.quantMaterialsCost')}</small><b>${calc.mat.toFixed(2)}</b></div>
          <div><small>{tr('levantamiento.quantLaborCost')}</small><b>${calc.mo.toFixed(2)}</b></div>
          <div><small>{tr('levantamiento.quantDirectCost')}</small><b>${calc.direct.toFixed(2)}</b></div>
        </div>; })()}
      </div>}

      {d.step === 6 && <div>
        <p className="muted">{tr('levantamiento.quantGenerateHint')}</p>
        <button onClick={handleGenerate} disabled={!previewApu}>{tr('levantamiento.quantGenerateBtn')}</button>
      </div>}

      {d.step === 7 && elementDef && <ElementSketch elementId={d.elementoId} inputs={d.inputs} params={d.params} />}
    </WizardShell>

    <div className="form-actions">
      <button className="secondary" onClick={handleCancel}>{tr('levantamiento.cancel')}</button>
      {d.step > 0 && <button className="soft" onClick={back}>{tr('levantamiento.quantBackBtn')}</button>}
      {d.step < steps.length - 1 && <button
        onClick={() => goTo(d.step + 1)}
        disabled={(d.step === 1 && !d.elementoId) || (d.step === 2 && !inputsComplete)}
      >{tr('levantamiento.quantNextBtn')}</button>}
    </div>
  </div>;
}
