import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestParametricElements, isParametricCompatible } from './parametricCompatibilityBridge.js';

test('sugiere zapata aislada para un concepto de Cimentacion con texto compatible', () => {
  const suggestions = suggestParametricElements({ concept: 'Zapata aislada de concreto armado', capitulo: 'CIMENTACION' });
  assert.ok(suggestions.some(s => s.elementId === 'zapata_aislada'));
});

test('nunca sugiere nada para un capitulo sin familia parametrica implementada', () => {
  const suggestions = suggestParametricElements({ concept: 'Zapata aislada de concreto armado', capitulo: 'ACABADOS' });
  assert.deepEqual(suggestions, []);
});

test('no sugiere un elemento de otra familia solo por solape de token entre capitulos', () => {
  // "muro" es un elemento de ALBANILERIA -- un concepto de Cimentacion que
  // mencione "muro" de pasada no debe sugerirlo porque el mapa acota por capitulo.
  const suggestions = suggestParametricElements({ concept: 'Muro de contencion junto a la zapata', capitulo: 'CIMENTACION' });
  assert.ok(!suggestions.some(s => s.elementId === 'muro'));
});

test('sin coincidencia real de texto retorna []', () => {
  const suggestions = suggestParametricElements({ concept: 'Suministro de arena de rio', capitulo: 'CIMENTACION' });
  assert.deepEqual(suggestions, []);
});

test('isParametricCompatible refleja si hay al menos una sugerencia', () => {
  assert.equal(isParametricCompatible({ concept: 'Zapata aislada', capitulo: 'CIMENTACION' }), true);
  assert.equal(isParametricCompatible({ concept: 'Zapata aislada', capitulo: 'ACABADOS' }), false);
});

test('concepto vacio o sin capitulo nunca lanza', () => {
  assert.deepEqual(suggestParametricElements({}), []);
  assert.deepEqual(suggestParametricElements(null), []);
});
