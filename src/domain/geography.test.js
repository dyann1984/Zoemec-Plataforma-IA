import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTRIES,
  MEXICO_CODE,
  OTHER_COUNTRY_CODE,
  listCountries,
  findCountry,
  listStatesForCountry,
  isStructuredCountry,
  formatLocationDisplay,
  buildLocationFingerprintKey,
  hasAnyLocation,
  buildProjectLocationSnapshot,
} from './geography.js';

test('listCountries expone exactamente las entradas de COUNTRIES', () => {
  assert.equal(listCountries(), COUNTRIES);
  assert.equal(COUNTRIES.length, 2);
});

test('Mexico trae exactamente 32 estados reales, sin duplicados', () => {
  const states = listStatesForCountry(MEXICO_CODE);
  assert.equal(states.length, 32);
  assert.equal(new Set(states).size, 32);
  assert.ok(states.includes('Nuevo León'));
  assert.ok(states.includes('Ciudad de México'));
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
    { country: 'mexico', state: 'nuevo leon', city: 'monterrey' }
  );
});

test('buildLocationFingerprintKey nunca lanza con datos ausentes', () => {
  assert.deepEqual(buildLocationFingerprintKey({}), { country: '', state: '', city: '' });
  assert.deepEqual(buildLocationFingerprintKey(), { country: '', state: '', city: '' });
});

test('hasAnyLocation detecta si hay algun dato de ubicacion util', () => {
  assert.equal(hasAnyLocation({ city: 'Monterrey' }), true);
  assert.equal(hasAnyLocation({ country: MEXICO_CODE }), true);
  assert.equal(hasAnyLocation({ country: '  ', state: '', city: null }), false);
  assert.equal(hasAnyLocation({}), false);
  assert.equal(hasAnyLocation(), false);
});

// Fase 2 (cierre de brecha regionalizacion individual/lote): buildProjectLocationSnapshot
// es la UNICA funcion que main.jsx llama en los tres flujos de generacion
// (individual, buildBatchAPUs, runQueueJob) para fijar ubicacionEstructurada/ubicacion
// -- estas pruebas fijan su contrato exacto.
test('buildProjectLocationSnapshot: proyecto con ubicacion estructurada completa', () => {
  const snapshot = buildProjectLocationSnapshot({
    locationCountry: MEXICO_CODE, locationState: 'Nuevo León', locationCity: 'Monterrey', ubicacion: 'texto legado ignorado'
  });
  assert.deepEqual(snapshot.ubicacionEstructurada, { country: MEXICO_CODE, state: 'Nuevo León', city: 'Monterrey' });
  assert.equal(snapshot.ubicacion, 'Monterrey, Nuevo León, México');
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
