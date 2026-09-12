import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeEmptyStylePreferences, normalizeStylePreferences, hasAnyStylePreference,
  STYLE_COLOR_OPTIONS, STYLE_MATERIAL_OPTIONS, ARCHITECTURAL_STYLE_OPTIONS
} from './evidenceStylePreferences.js';

test('makeEmptyStylePreferences: forma vacia, sin ninguna preferencia', () => {
  const prefs = makeEmptyStylePreferences();
  assert.deepEqual(prefs.colors, []);
  assert.equal(prefs.customColorHex, null);
  assert.deepEqual(prefs.materials, []);
  assert.equal(prefs.acabado, '');
  assert.equal(prefs.estilo, null);
  assert.equal(hasAnyStylePreference(prefs), false);
});

test('normalizeStylePreferences: acepta valores validos, descarta desconocidos y duplicados', () => {
  const prefs = normalizeStylePreferences({
    colors: ['Blanco', 'azul', 'azul', 'fucsia-inventado'],
    materials: ['concreto', 'CONCRETO', 'madera', 'unobtainium'],
    acabado: '  Pulido mate  ',
    estilo: 'moderno'
  });
  assert.deepEqual(prefs.colors, ['blanco', 'azul']);
  assert.deepEqual(prefs.materials, ['concreto', 'madera']);
  assert.equal(prefs.acabado, 'Pulido mate');
  assert.equal(prefs.estilo, 'moderno');
});

test('normalizeStylePreferences: estilo desconocido cae a null, nunca se inventa uno valido', () => {
  const prefs = normalizeStylePreferences({ estilo: 'estilo-que-no-existe' });
  assert.equal(prefs.estilo, null);
});

test('normalizeStylePreferences: customColorHex solo se acepta si es un hex real de 6 digitos', () => {
  assert.equal(normalizeStylePreferences({ customColorHex: '#ff00aa' }).customColorHex, '#ff00aa');
  assert.equal(normalizeStylePreferences({ customColorHex: 'no-es-un-hex' }).customColorHex, null);
  assert.equal(normalizeStylePreferences({ customColorHex: '#fff' }).customColorHex, null);
});

test('normalizeStylePreferences: entrada nula/invalida nunca lanza, regresa la forma vacia', () => {
  assert.deepEqual(normalizeStylePreferences(null), makeEmptyStylePreferences());
  assert.deepEqual(normalizeStylePreferences(undefined), makeEmptyStylePreferences());
  assert.deepEqual(normalizeStylePreferences('no es un objeto'), makeEmptyStylePreferences());
});

test('hasAnyStylePreference: distingue "nunca se abrio el panel" de "se abrio y no se eligio nada" solo si null vs objeto vacio', () => {
  assert.equal(hasAnyStylePreference(null), false);
  assert.equal(hasAnyStylePreference(makeEmptyStylePreferences()), false);
  assert.equal(hasAnyStylePreference(normalizeStylePreferences({ acabado: 'Aparente' })), true);
  assert.equal(hasAnyStylePreference(normalizeStylePreferences({ colors: ['negro'] })), true);
});

test('las listas de opciones estan congeladas y no vacias (contrato para la UI)', () => {
  assert.ok(Object.isFrozen(STYLE_COLOR_OPTIONS));
  assert.ok(Object.isFrozen(STYLE_MATERIAL_OPTIONS));
  assert.ok(Object.isFrozen(ARCHITECTURAL_STYLE_OPTIONS));
  assert.ok(STYLE_COLOR_OPTIONS.length > 0);
  assert.ok(STYLE_MATERIAL_OPTIONS.length > 0);
  assert.ok(ARCHITECTURAL_STYLE_OPTIONS.length > 0);
});
