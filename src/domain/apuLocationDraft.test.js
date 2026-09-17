import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveInitialLocationDraft, locationDraftChanged, buildLocationPatchFromDraft, locationDraftHasAnyValue
} from './apuLocationDraft.js';

const PROJECT = { locationCountry: 'MX', locationState: 'Estado de México', locationRegion: 'Zona Metropolitana', locationCity: 'Tecámac', moneda: 'MXN' };

test('resolveInitialLocationDraft: APU nuevo hereda del proyecto activo (herencia)', () => {
  const draft = resolveInitialLocationDraft({ project: PROJECT, existingApu: null });
  assert.equal(draft.country, 'MX');
  assert.equal(draft.state, 'Estado de México');
  assert.equal(draft.region, 'Zona Metropolitana');
  assert.equal(draft.city, 'Tecámac');
  assert.equal(draft.moneda, 'MXN');
  assert.equal(draft.inheritedFromProject, true);
  assert.ok(draft.fechaBase, 'fechaBase siempre trae un valor por defecto, nunca vacio');
});

test('resolveInitialLocationDraft: sin proyecto activo, el borrador queda vacio pero nunca lanza', () => {
  const draft = resolveInitialLocationDraft({ project: null, existingApu: null });
  assert.equal(draft.country, '');
  assert.equal(draft.state, '');
  assert.equal(draft.region, '');
  assert.equal(draft.city, '');
  assert.equal(draft.moneda, 'MXN');
  assert.equal(draft.inheritedFromProject, true);
});

test('resolveInitialLocationDraft: un APU recien creado (makeEmptyAPUv2, YA trae moneda/fechaBase por defecto pero SIN ubicacion propia) igual hereda del proyecto -- regresion real: la sola presencia de moneda/fechaBase nunca debe contarse como "ya tiene ubicacion propia"', () => {
  const freshApu = { ubicacionEstructurada: { country: null, state: null, region: null, city: null }, moneda: 'MXN', fechaBase: '17/9/2026' };
  const draft = resolveInitialLocationDraft({ project: PROJECT, existingApu: freshApu });
  assert.equal(draft.country, 'MX');
  assert.equal(draft.city, 'Tecámac');
  assert.equal(draft.inheritedFromProject, true);
});

test('resolveInitialLocationDraft: editando un APU ya generado parte de SU propio snapshot, nunca del proyecto (aunque el proyecto sea distinto)', () => {
  const existingApu = {
    ubicacionEstructurada: { country: 'MX', state: 'Jalisco', region: null, city: 'Guadalajara' },
    moneda: 'USD', fechaBase: '01/01/2025'
  };
  const draft = resolveInitialLocationDraft({ project: PROJECT, existingApu });
  assert.equal(draft.city, 'Guadalajara', 'debe conservar la ciudad del APU, no la del proyecto (Tecámac)');
  assert.equal(draft.state, 'Jalisco');
  assert.equal(draft.moneda, 'USD');
  assert.equal(draft.fechaBase, '01/01/2025');
  assert.equal(draft.inheritedFromProject, false);
});

test('locationDraftChanged: detecta cambio en cualquier campo sensible a precio (country/state/region/city/moneda)', () => {
  const base = { country: 'MX', state: 'Jalisco', region: '', city: 'Guadalajara', moneda: 'MXN', fechaBase: 'x' };
  assert.equal(locationDraftChanged(base, { ...base }), false, 'sin cambios no debe disparar el aviso');
  assert.equal(locationDraftChanged(base, { ...base, city: 'Zapopan' }), true);
  assert.equal(locationDraftChanged(base, { ...base, state: 'Nuevo León' }), true);
  assert.equal(locationDraftChanged(base, { ...base, region: 'Zona Metropolitana' }), true);
  assert.equal(locationDraftChanged(base, { ...base, country: 'OTRO' }), true);
  assert.equal(locationDraftChanged(base, { ...base, moneda: 'USD' }), true);
});

test('locationDraftChanged: cambiar SOLO fechaBase nunca dispara el aviso de recalculo (no identifica una geografia distinta)', () => {
  const base = { country: 'MX', state: 'Jalisco', region: '', city: 'Guadalajara', moneda: 'MXN', fechaBase: '01/01/2025' };
  assert.equal(locationDraftChanged(base, { ...base, fechaBase: '01/09/2026' }), false);
});

test('locationDraftChanged: sin borrador previo (APU nunca tuvo ubicacion), nunca dispara el aviso', () => {
  assert.equal(locationDraftChanged(null, { country: 'MX' }), false);
});

test('buildLocationPatchFromDraft: arma ubicacionEstructurada + ubicacion de texto libre + moneda + fechaBase, con region intercalada', () => {
  const patch = buildLocationPatchFromDraft({
    country: 'MX', state: 'Estado de México', region: 'Zona Metropolitana', city: 'Tecámac', moneda: 'MXN', fechaBase: '17/09/2026'
  });
  assert.deepEqual(patch.ubicacionEstructurada, { country: 'MX', state: 'Estado de México', region: 'Zona Metropolitana', city: 'Tecámac' });
  assert.equal(patch.ubicacion, 'Tecámac, Zona Metropolitana, Estado de México, México');
  assert.equal(patch.moneda, 'MXN');
  assert.equal(patch.fechaBase, '17/09/2026');
});

test('buildLocationPatchFromDraft: borrador vacio nunca lanza, cae a defaults seguros', () => {
  const patch = buildLocationPatchFromDraft({});
  assert.deepEqual(patch.ubicacionEstructurada, { country: null, state: null, region: null, city: null });
  assert.equal(patch.ubicacion, '');
  assert.equal(patch.moneda, 'MXN');
  assert.ok(patch.fechaBase);
});

test('locationDraftHasAnyValue: true si algun campo geografico tiene valor', () => {
  assert.equal(locationDraftHasAnyValue({}), false);
  assert.equal(locationDraftHasAnyValue({ country: '' }), false);
  assert.equal(locationDraftHasAnyValue({ city: 'Tecámac' }), true);
  assert.equal(locationDraftHasAnyValue({ region: 'Zona Metropolitana' }), true);
});
