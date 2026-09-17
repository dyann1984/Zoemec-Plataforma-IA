import { listCountries, listStatesForCountry, isStructuredCountry, adminDivisionLabel } from '../../domain/geography.js';
import { useI18n } from '../../i18n/I18nContext.jsx';

/* Selector Pais -> Estado/Provincia -> Region/Zona -> Ciudad (Fase 2: APU
   regionalizados por ubicacion; Region/Zona agregada en Contexto geografico
   del APU). Controlado, sin estado propio: el llamador (formulario de
   proyecto en main.jsx, o el bloque "Ubicacion y referencia de costos" del
   APU) es la unica fuente de verdad, mismo patron que el resto de los
   campos ".nf" del formulario. Mexico trae estados reales en un <select>;
   cualquier otro pais ("Otro país") captura el estado como texto libre --
   ver src/domain/geography.js para el porque. Region/Zona y Ciudad SIEMPRE
   son texto libre (no hay base de datos de zonas/ciudades en esta fase).

   `showRegion` es opcional (default false) para no cambiar el formulario de
   proyecto existente, que nunca lo pidio -- solo el bloque de ubicacion del
   APU lo activa. */
export function LocationPicker({ country = '', state = '', region = '', city = '', onChange, showRegion = false }){
  const { t: tr, locale } = useI18n();
  const countries = listCountries();
  const states = listStatesForCountry(country);
  const structured = isStructuredCountry(country);
  const stateLabel = adminDivisionLabel(country, locale) || tr('locationPicker.stateGeneric');

  const setCountry = (nextCountry) => {
    // Cambiar de pais invalida el estado elegido anteriormente (un estado de
    // Mexico no tiene sentido si el pais ahora es otro) -- region/ciudad se
    // conservan, son independientes de la estructura pais/estado.
    onChange?.({ country: nextCountry, state: '', region, city });
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
      <label>{stateLabel}</label>
      {structured
        ? <select value={state} onChange={e => onChange?.({ country, state: e.target.value, region, city })}>
            <option value="">{tr('locationPicker.selectState')}</option>
            {states.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        : <input value={state} onChange={e => onChange?.({ country, state: e.target.value, region, city })} placeholder={stateLabel} disabled={!country} />}
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
