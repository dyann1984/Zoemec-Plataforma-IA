import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTRIES,
  CURRENCIES,
  MEXICO_CODE,
  OTHER_COUNTRY_CODE,
  listCountries,
  listCurrencies,
  findCountry,
  listStatesForCountry,
  isStructuredCountry,
  adminDivisionLabel,
  findState,
  stateLabel,
  formatLocationDisplay,
  buildLocationFingerprintKey,
  hasAnyLocation,
  buildProjectLocationSnapshot,
} from './geography.js';

test('listCountries expone exactamente las entradas de COUNTRIES', () => {
  assert.equal(listCountries(), COUNTRIES);
  assert.equal(COUNTRIES.length, 2);
});

test('Mexico trae exactamente 32 estados reales ({code,name}), sin duplicados, codes canonicos INEGI estables', () => {
  const states = listStatesForCountry(MEXICO_CODE);
  assert.equal(states.length, 32);
  assert.equal(new Set(states.map(s => s.code)).size, 32);
  assert.equal(new Set(states.map(s => s.name)).size, 32);
  assert.ok(states.some(s => s.code === 'NLE' && s.name === 'Nuevo León'));
  assert.ok(states.some(s => s.code === 'CMX' && s.name === 'Ciudad de México'));
  // El estado coloquialmente llamado "México" NUNCA se llama igual que el
  // pais (name: 'México') -- causa raiz real del hallazgo "Tecámac, Zona
  // Metropolitana, México, México".
  assert.ok(states.some(s => s.code === 'MEX' && s.name === 'Estado de México'));
  assert.ok(!states.some(s => s.name === 'México'), 'ningun estado debe mostrarse con el mismo nombre que el pais');
});

test('findState: resuelve el code canonico nuevo y el nombre legado ambiguo "México" al MISMO estado', () => {
  assert.deepEqual(findState(MEXICO_CODE, 'MEX'), { code: 'MEX', name: 'Estado de México' });
  assert.deepEqual(findState(MEXICO_CODE, 'México'), { code: 'MEX', name: 'Estado de México' });
  assert.deepEqual(findState(MEXICO_CODE, 'Nuevo León'), { code: 'NLE', name: 'Nuevo León' });
  assert.deepEqual(findState(MEXICO_CODE, 'NLE'), { code: 'NLE', name: 'Nuevo León' });
});

test('findState: pais sin estados estructurados (texto libre) regresa el valor tal cual en code y name', () => {
  assert.deepEqual(findState(OTHER_COUNTRY_CODE, 'Texas'), { code: 'Texas', name: 'Texas' });
  assert.equal(findState(MEXICO_CODE, ''), null);
  assert.equal(findState(MEXICO_CODE, null), null);
});

test('stateLabel: siempre devuelve la etiqueta completa, nunca un code crudo ni el nombre ambiguo', () => {
  assert.equal(stateLabel(MEXICO_CODE, 'MEX'), 'Estado de México');
  assert.equal(stateLabel(MEXICO_CODE, 'México'), 'Estado de México');
  assert.equal(stateLabel(MEXICO_CODE, 'CMX'), 'Ciudad de México');
});

test('Otro pais no trae estados estructurados (texto libre)', () => {
  assert.equal(listStatesForCountry(OTHER_COUNTRY_CODE), null);
  assert.equal(isStructuredCountry(OTHER_COUNTRY_CODE), false);
});

test('isStructuredCountry es true solo para Mexico', () => {
  assert.equal(isStructuredCountry(MEXICO_CODE), true);
  assert.equal(isStructuredCountry('ZZ'), false);
});

test('findCountry devuelve null para un codigo desconocido', () => {
  assert.equal(findCountry('ZZ'), null);
  assert.equal(findCountry(MEXICO_CODE).name, 'México');
});

test('formatLocationDisplay arma "Ciudad, Estado, Pais" completo', () => {
  assert.equal(
    formatLocationDisplay({ country: MEXICO_CODE, state: 'Nuevo León', city: 'Monterrey' }),
    'Monterrey, Nuevo León, México'
  );
});

test('formatLocationDisplay omite partes ausentes sin comas huerfanas', () => {
  assert.equal(formatLocationDisplay({ country: MEXICO_CODE }), 'México');
  assert.equal(formatLocationDisplay({ state: 'Jalisco', city: 'Guadalajara' }), 'Guadalajara, Jalisco');
  assert.equal(formatLocationDisplay({}), '');
  assert.equal(formatLocationDisplay(), '');
});

test('formatLocationDisplay usa el nombre del pais "Otro" tal cual si no coincide con COUNTRIES', () => {
  assert.equal(formatLocationDisplay({ country: 'Perú', city: 'Lima' }), 'Lima, Perú');
});

test('buildLocationFingerprintKey normaliza minusculas y acentos', () => {
  assert.deepEqual(
    buildLocationFingerprintKey({ country: 'México', state: 'Nuevo León', city: 'Monterrey' }),
    { country: 'mexico', state: 'nuevo leon', city: 'monterrey', region: '' }
  );
});

test('buildLocationFingerprintKey incluye region cuando se declara, y resuelve el estado a su CODE canonico (no al nombre)', () => {
  assert.deepEqual(
    buildLocationFingerprintKey({ country: 'MX', state: 'Estado de México', city: 'Tecámac', region: 'Zona Metropolitana' }),
    { country: 'mx', state: 'mex', city: 'tecamac', region: 'zona metropolitana' }
  );
});

test('buildLocationFingerprintKey: el nombre legado ambiguo "México" y el code nuevo "MEX" producen la MISMA clave (nunca fragmentan el cache de precios)', () => {
  const porNombreLegado = buildLocationFingerprintKey({ country: 'MX', state: 'México', city: 'Tecámac' });
  const porCode = buildLocationFingerprintKey({ country: 'MX', state: 'MEX', city: 'Tecámac' });
  assert.deepEqual(porNombreLegado, porCode);
});

test('buildLocationFingerprintKey nunca lanza con datos ausentes', () => {
  assert.deepEqual(buildLocationFingerprintKey({}), { country: '', state: '', city: '', region: '' });
  assert.deepEqual(buildLocationFingerprintKey(), { country: '', state: '', city: '', region: '' });
});

test('hasAnyLocation detecta si hay algun dato de ubicacion util', () => {
  assert.equal(hasAnyLocation({ city: 'Monterrey' }), true);
  assert.equal(hasAnyLocation({ country: MEXICO_CODE }), true);
  assert.equal(hasAnyLocation({ region: 'Zona Metropolitana' }), true);
  assert.equal(hasAnyLocation({ country: '  ', state: '', city: null }), false);
  assert.equal(hasAnyLocation({}), false);
  assert.equal(hasAnyLocation(), false);
});

test('adminDivisionLabel: Mexico usa "Estado", pais desconocido cae al generico (nunca hardcodeado a un solo pais)', () => {
  assert.equal(adminDivisionLabel(MEXICO_CODE), 'Estado');
  assert.equal(adminDivisionLabel(OTHER_COUNTRY_CODE), 'Estado / Provincia / Departamento');
  assert.equal(adminDivisionLabel('PE'), 'Estado / Provincia / Departamento');
  assert.equal(adminDivisionLabel(undefined), 'Estado / Provincia / Departamento');
});

test('adminDivisionLabel: locale "en" traduce el mismo criterio (Mexico -> "State", generico -> "State / Province / Department")', () => {
  assert.equal(adminDivisionLabel(MEXICO_CODE, 'en'), 'State');
  assert.equal(adminDivisionLabel(OTHER_COUNTRY_CODE, 'en'), 'State / Province / Department');
  assert.equal(adminDivisionLabel(undefined, 'en'), 'State / Province / Department');
});

test('listCurrencies expone exactamente las entradas de CURRENCIES, incluye MXN y USD', () => {
  assert.equal(listCurrencies(), CURRENCIES);
  const codes = CURRENCIES.map(c => c.code);
  assert.ok(codes.includes('MXN'));
  assert.ok(codes.includes('USD'));
});

test('formatLocationDisplay intercala la region entre ciudad y estado', () => {
  assert.equal(
    formatLocationDisplay({ country: MEXICO_CODE, state: 'Estado de México', region: 'Zona Metropolitana', city: 'Tecámac' }),
    'Tecámac, Zona Metropolitana, Estado de México, México'
  );
});

test('CAUSA RAIZ real: formatLocationDisplay con el CODE canonico "MEX" (forma nueva, la que guarda el <select>) produce el texto inequivoco "Estado de México, México", nunca el estado y el pais como el MISMO texto suelto "México"', () => {
  const display = formatLocationDisplay({ country: MEXICO_CODE, state: 'MEX', region: 'Zona Metropolitana', city: 'Tecámac' });
  assert.equal(display, 'Tecámac, Zona Metropolitana, Estado de México, México');
  const parts = display.split(', ');
  assert.equal(parts.filter(p => p === 'México').length, 1, 'el texto "México" suelto debe aparecer UNA sola vez (el pais) -- nunca tambien como el estado');
});

test('CAUSA RAIZ real: el nombre legado ambiguo "México" guardado antes de este fix TAMBIEN produce el texto correcto (dato viejo nunca queda roto)', () => {
  const display = formatLocationDisplay({ country: MEXICO_CODE, state: 'México', region: 'Zona Metropolitana', city: 'Tecámac' });
  assert.equal(display, 'Tecámac, Zona Metropolitana, Estado de México, México');
});

test('formatLocationDisplay sin region se comporta exactamente igual que antes (compatibilidad)', () => {
  assert.equal(
    formatLocationDisplay({ country: MEXICO_CODE, state: 'Nuevo León', city: 'Monterrey' }),
    'Monterrey, Nuevo León, México'
  );
});

// Fase 2 (cierre de brecha regionalizacion individual/lote): buildProjectLocationSnapshot
// es la UNICA funcion que main.jsx llama en los tres flujos de generacion
// (individual, buildBatchAPUs, runQueueJob) para fijar ubicacionEstructurada/ubicacion
// -- estas pruebas fijan su contrato exacto.
test('buildProjectLocationSnapshot: proyecto con ubicacion estructurada completa', () => {
  const snapshot = buildProjectLocationSnapshot({
    locationCountry: MEXICO_CODE, locationState: 'Nuevo León', locationCity: 'Monterrey', ubicacion: 'texto legado ignorado'
  });
  // Sin `locationRegion` declarado, la clave `region` NUNCA se agrega
  // (nunca queda en null) -- preserva la forma exacta que ya consumian
  // callers server-side existentes (regla 10, ver test e2e
  // catalogoPresupuestoPipeline).
  assert.deepEqual(snapshot.ubicacionEstructurada, { country: MEXICO_CODE, state: 'Nuevo León', city: 'Monterrey' });
  assert.equal(snapshot.ubicacion, 'Monterrey, Nuevo León, México');
});

test('buildProjectLocationSnapshot: hereda tambien la region/zona del proyecto cuando existe', () => {
  const snapshot = buildProjectLocationSnapshot({
    locationCountry: MEXICO_CODE, locationState: 'Estado de México', locationRegion: 'Zona Metropolitana', locationCity: 'Tecámac'
  });
  assert.deepEqual(snapshot.ubicacionEstructurada, { country: MEXICO_CODE, state: 'Estado de México', city: 'Tecámac', region: 'Zona Metropolitana' });
  assert.equal(snapshot.ubicacion, 'Tecámac, Zona Metropolitana, Estado de México, México');
});

test('buildProjectLocationSnapshot: proyecto legacy sin campos estructurados cae al texto libre `ubicacion` (regla 10)', () => {
  const snapshot = buildProjectLocationSnapshot({ ubicacion: 'Torreón, Coahuila (texto libre antiguo)' });
  assert.deepEqual(snapshot.ubicacionEstructurada, { country: null, state: null, city: null });
  assert.equal(snapshot.ubicacion, 'Torreón, Coahuila (texto libre antiguo)');
});

test('buildProjectLocationSnapshot: proyecto null/undefined (sin proyecto activo) nunca lanza, queda todo vacio', () => {
  assert.deepEqual(buildProjectLocationSnapshot(null), { ubicacion: '', ubicacionEstructurada: { country: null, state: null, city: null } });
  assert.deepEqual(buildProjectLocationSnapshot(undefined), { ubicacion: '', ubicacionEstructurada: { country: null, state: null, city: null } });
  assert.deepEqual(buildProjectLocationSnapshot({}), { ubicacion: '', ubicacionEstructurada: { country: null, state: null, city: null } });
});

test('buildProjectLocationSnapshot: pais "Otro" con estado libre', () => {
  const snapshot = buildProjectLocationSnapshot({ locationCountry: OTHER_COUNTRY_CODE, locationState: 'Texas', locationCity: 'Houston' });
  assert.deepEqual(snapshot.ubicacionEstructurada, { country: OTHER_COUNTRY_CODE, state: 'Texas', city: 'Houston' });
  assert.equal(snapshot.ubicacion, 'Houston, Texas, Otro país');
});

test('buildProjectLocationSnapshot: parcial (solo pais) sigue armando ubicacionEstructurada y texto legibles', () => {
  const snapshot = buildProjectLocationSnapshot({ locationCountry: MEXICO_CODE });
  assert.deepEqual(snapshot.ubicacionEstructurada, { country: MEXICO_CODE, state: null, city: null });
  assert.equal(snapshot.ubicacion, 'México');
});
