/* Bloque "Ubicación y referencia de costos" del APU (Contexto geográfico y
   económico): visible ARRIBA del generador/editor -- nunca queda oculto
   solo en backend (P1 original de este panel). Ahora además EDITABLE: el
   usuario puede confirmar/cambiar País, Estado/Provincia, Ciudad, Región/
   Zona, Moneda y Fecha base específicamente para este APU, heredado del
   proyecto por defecto (nunca un campo decorativo desconectado -- reutiliza
   la MISMA jerarquía de geography.js/LocationPicker.jsx que ya usa el
   formulario de proyecto, y el MISMO resumen de cobertura de precios que ya
   calcula apuRegionalContext.js, nunca un segundo sistema paralelo).

   Cambiar country/state/region/city/moneda de un APU que YA tiene recursos
   con precio buscado NUNCA reprecia en silencio -- se pregunta primero
   (regla explícita del brief). */
import { useState } from 'react';
import { LocationPicker } from '../../components/ui/LocationPicker.jsx';
import { listCurrencies, findCountry, stateLabel } from '../../domain/geography.js';
import { summarizeRegionalCoverage, describeReferenceSentence } from '../../domain/apuRegionalContext.js';
import {
  resolveInitialLocationDraft, locationDraftChanged, buildLocationPatchFromDraft, locationDraftHasAnyValue
} from '../../domain/apuLocationDraft.js';
import { useI18n } from '../../i18n/I18nContext.jsx';

function hasAnyPricedResource(apu){
  return ['materials', 'labor', 'equipment', 'consumables', 'seguridad'].some(kind => (apu?.[kind] || []).length > 0);
}

export function RegionalContextPanel({ apu, project = null, onChange, onFindPrices, onConfigureLocation }){
  const { t: tr } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [pendingPatch, setPendingPatch] = useState(null);

  const summary = summarizeRegionalCoverage(apu);
  const { location } = summary;
  const currencies = listCurrencies();

  function startEditing(){
    setDraft(resolveInitialLocationDraft({ project, existingApu: apu }));
    setPendingPatch(null);
    setEditing(true);
  }

  function cancelEditing(){
    setEditing(false);
    setDraft(null);
    setPendingPatch(null);
  }

  function resetToProject(){
    setDraft(resolveInitialLocationDraft({ project, existingApu: null }));
  }

  function applyPatch(patch, { thenFindPrices = false } = {}){
    if(!onChange) return;
    onChange({ ...apu, ...patch });
    setEditing(false);
    setDraft(null);
    setPendingPatch(null);
    if(thenFindPrices) onFindPrices?.();
  }

  function handleSave(){
    if(!draft) return;
    const patch = buildLocationPatchFromDraft(draft);
    const previousDraft = {
      country: apu?.ubicacionEstructurada?.country || '', state: apu?.ubicacionEstructurada?.state || '',
      region: apu?.ubicacionEstructurada?.region || '', city: apu?.ubicacionEstructurada?.city || '',
      moneda: apu?.moneda || 'MXN'
    };
    const changed = locationDraftChanged(previousDraft, draft);
    if(changed && hasAnyPricedResource(apu)){
      setPendingPatch(patch);
      return;
    }
    applyPatch(patch);
  }

  return <section className="pro-regional-context panel">
    <div className="pro-regional-context-head">
      <h3 className="pro-section-title pro-section-title-first">{tr('apuLocationBlock.title')}</h3>
      {onChange && !editing && !pendingPatch && (
        <button type="button" className="soft" onClick={startEditing}>
          {summary.hasLocation ? tr('apuLocationBlock.editLocation') : tr('apuLocationBlock.configureLocation')}
        </button>
      )}
    </div>

    {!editing && !pendingPatch && (
      <>
        {!summary.hasLocation
          ? <div className="survey-opening-warning">
              <p>{tr('apuLocationBlock.noLocationWarning')}</p>
              {onConfigureLocation && <button type="button" className="soft" onClick={onConfigureLocation}>{tr('apuLocationBlock.useProjectDefault')}</button>}
            </div>
          : <>
              <div className="pro-header-grid">
                <div><small>{tr('apuLocationBlock.country')}</small><b>{location.country ? (findCountry(location.country)?.name || location.country) : tr('apuLocationBlock.noValue')}</b></div>
                <div><small>{tr('apuLocationBlock.state')}</small><b>{location.state ? (stateLabel(location.country, location.state) || location.state) : tr('apuLocationBlock.noValue')}</b></div>
                <div><small>{tr('apuLocationBlock.city')}</small><b>{location.city || tr('apuLocationBlock.noValue')}</b></div>
                <div><small>{tr('apuLocationBlock.region')}</small><b>{location.region || tr('apuLocationBlock.noValue')}</b></div>
                <div><small>{tr('apuLocationBlock.currency')}</small><b>{apu?.moneda || 'MXN'}</b></div>
                <div><small>{tr('apuLocationBlock.baseDate')}</small><b>{apu?.fechaBase || tr('apuLocationBlock.noValue')}</b></div>
              </div>
              {summary.primaryLevel && <p className="muted pro-regional-reference-line">{describeReferenceSentence(summary)}</p>}
            </>}
        {summary.hasLocation && summary.rowsWithData === 0 && <p className="muted" style={{ fontSize: '.78rem', marginTop: 8 }}>
          {tr('apuLocationBlock.noResourcesSearched')}
        </p>}
        {summary.hasLocation && summary.rowsWithData > 0 && summary.rowsWithData < summary.totalRows && <p className="muted" style={{ fontSize: '.78rem', marginTop: 8 }}>
          {tr('apuLocationBlock.partialResourcesSearched', { count: summary.rowsWithData, total: summary.totalRows })}
        </p>}
      </>
    )}

    {editing && draft && (
      <div className="pro-regional-edit-form">
        <div className="pro-header-grid">
          <LocationPicker
            country={draft.country} state={draft.state} region={draft.region} city={draft.city}
            showRegion
            onChange={next => setDraft({ ...draft, ...next })}
          />
          <div className="nf">
            <label>{tr('apuLocationBlock.currency')}</label>
            <select value={draft.moneda} onChange={e => setDraft({ ...draft, moneda: e.target.value })}>
              {currencies.map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
            </select>
          </div>
          <div className="nf">
            <label>{tr('apuLocationBlock.baseDate')}</label>
            <input value={draft.fechaBase} onChange={e => setDraft({ ...draft, fechaBase: e.target.value })} placeholder={tr('apuLocationBlock.baseDatePlaceholder')} />
          </div>
        </div>
        {draft.inheritedFromProject && <p className="muted" style={{ fontSize: '.78rem' }}>{tr('apuLocationBlock.inheritedHint')}</p>}
        <div className="cost-stage-actions" style={{ marginTop: 10 }}>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={!locationDraftHasAnyValue(draft)}>{tr('apuLocationBlock.save')}</button>
          <button type="button" className="soft" onClick={resetToProject}>{tr('apuLocationBlock.resetFromProject')}</button>
          <button type="button" className="soft" onClick={cancelEditing}>{tr('apuLocationBlock.cancel')}</button>
        </div>
      </div>
    )}

    {pendingPatch && (
      <div className="stage-placeholder-notice status-atencion">
        <p><b>{tr('apuLocationBlock.changedWarningTitle')}</b> {tr('apuLocationBlock.changedWarningBody')}</p>
        <div className="cost-stage-actions" style={{ marginTop: 8 }}>
          <button type="button" className="btn-primary" onClick={() => applyPatch(pendingPatch, { thenFindPrices: true })}>
            {tr('apuLocationBlock.updateAndResearch')}
          </button>
          <button type="button" className="soft" onClick={() => applyPatch(pendingPatch)}>
            {tr('apuLocationBlock.onlyUpdateLabel')}
          </button>
          <button type="button" className="soft" onClick={() => setPendingPatch(null)}>{tr('apuLocationBlock.cancel')}</button>
        </div>
      </div>
    )}
  </section>;
}
