import { listCountries, listStatesForCountry, isStructuredCountry, adminDivisionLabel, findState } from '../../domain/geography.js';
import { useI18n } from '../../i18n/I18nContext.jsx';

/* Selector Pais -> Estado/Provincia -> Region/Zona -> Ciudad (Fase 2: APU
   regionalizados por ubicacion; Region/Zona agregada en Contexto geografico
   del APU). Controlado, sin estado propio: el llamador (formulario de
   proyecto en main.jsx, o el bloque "Ubicacion y referencia de costos" del
   APU) es la unica fuente de verdad, mismo patron que el resto de los
   campos ".nf" del formulario. Mexico trae estados reales en un <select>
   con code canonico INEGI como value (ej. 'MEX' para Estado de México,
   nunca el nombre "México" -- ambiguo con el pais, ver geography.js);
   cualquier otro pais ("Otro país") captura el estado como texto libre.
   Region/Zona y Ciudad SIEMPRE son texto libre (no hay base de datos de
   zonas/ciudades en esta fase).

   `state` que llega de afuera puede ser el code nuevo O un nombre legado
   guardado antes de este fix -- se resuelve a su code via findState()
   para que el <select> lo muestre seleccionado correctamente en ambos
   casos, sin migrar el dato guardado.

   `showRegion` es opcional (default false) para no cambiar el formulario de
   proyecto existente, que nunca lo pidio -- solo el bloque de ubicacion del
   APU lo activa. */
export function LocationPicker({ country = '', state = '', region = '', city = '', onChange, showRegion = false }){
  const { t: tr, locale } = useI18n();
  const countries = listCountries();
  const states = listStatesForCountry(country);
  const structured = isStructuredCountry(country);
  const stateFieldLabel = adminDivisionLabel(country, locale) || tr('locationPicker.stateGeneric');
  const resolvedStateCode = structured ? (findState(country, state)?.code || '') : state;

  const setCountry = (nextCountry) => {
    // Cambiar de pais invalida estado/ciudad/region elegidos anteriormente
    // (un estado de Mexico, o una ciudad/zona capturada para OTRO pais, no
    // tienen sentido si el pais ahora es distinto) -- limpieza explicita,
    // nunca datos incompatibles arrastrados en silencio a la nueva
    // seleccion (hallazgo de la ronda de QA regional).
    onChange?.({ country: nextCountry, state: '', region: '', city: '' });
  };

  return <>
    <div className="nf">
      <label>{tr('locationPicker.country')}</label>
      <select value={country} onChange={e => setCountry(e.target.value)}>
        <option value="">{tr('locationPicker.selectCountry')}</option>
        {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
      </select>
    </div>
    <div className="nf">
      <label>{stateFieldLabel}</label>
      {structured
        ? <select value={resolvedStateCode} onChange={e => onChange?.({ country, state: e.target.value, region, city })}>
            <option value="">{tr('locationPicker.selectState')}</option>
            {states.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        : <input value={state} onChange={e => onChange?.({ country, state: e.target.value, region, city })} placeholder={stateFieldLabel} disabled={!country} />}
    </div>
    <div className="nf">
      <label>{tr('locationPicker.city')}</label>
      <input value={city} onChange={e => onChange?.({ country, state, region, city: e.target.value })} placeholder={tr('locationPicker.cityPlaceholder')} />
    </div>
    {showRegion && <div className="nf">
      <label>{tr('locationPicker.region')} <span className="muted">{tr('locationPicker.optional')}</span></label>
      <input value={region} onChange={e => onChange?.({ country, state, region: e.target.value, city })} placeholder={tr('locationPicker.regionPlaceholder')} />
    </div>}
  </>;
}
