import { listCountries, listStatesForCountry, isStructuredCountry } from '../../domain/geography.js';

/* Selector Pais -> Estado/Provincia -> Ciudad (Fase 2: APU regionalizados
   por ubicacion). Controlado, sin estado propio: el llamador (formulario de
   proyecto en main.jsx) es la unica fuente de verdad, mismo patron que el
   resto de los campos ".nf" del formulario. Mexico trae estados reales en
   un <select>; cualquier otro pais ("Otro país") captura el estado como
   texto libre -- ver src/domain/geography.js para el porque. Ciudad SIEMPRE
   es texto libre (no hay base de datos de ciudades en esta fase). */
export function LocationPicker({ country = '', state = '', city = '', onChange }){
  const countries = listCountries();
  const states = listStatesForCountry(country);
  const structured = isStructuredCountry(country);

  const setCountry = (nextCountry) => {
    // Cambiar de pais invalida el estado elegido anteriormente (un estado de
    // Mexico no tiene sentido si el pais ahora es otro) -- ciudad se
    // conserva, es independiente de la estructura pais/estado.
    onChange?.({ country: nextCountry, state: '', city });
  };

  return <>
    <div className="nf">
      <label>País</label>
      <select value={country} onChange={e => setCountry(e.target.value)}>
        <option value="">Selecciona un país</option>
        {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
      </select>
    </div>
    <div className="nf">
      <label>Estado / Provincia</label>
      {structured
        ? <select value={state} onChange={e => onChange?.({ country, state: e.target.value, city })}>
            <option value="">Selecciona un estado</option>
            {states.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        : <input value={state} onChange={e => onChange?.({ country, state: e.target.value, city })} placeholder="Estado o provincia" disabled={!country} />}
    </div>
    <div className="nf">
      <label>Ciudad</label>
      <input value={city} onChange={e => onChange?.({ country, state, city: e.target.value })} placeholder="Ciudad" />
    </div>
  </>;
}
