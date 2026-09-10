import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFindingMessage, resolveSeverityLabel } from './findingMessages.js';

const DICT = {
  'findings.AUD_PRICE_ZERO': 'El precio unitario resultante es cero o negativo.',
  'findings.negative_quantity': 'Cantidad negativa en renglón {indexDisplay} de {kind}: se trata como 0.',
  'findings.non_finite_value': 'Valor no numérico en renglón {indexDisplay} de {kind}.',
  'findings.non_finite_value_field': 'Valor no numérico en "{field}" del renglón {indexDisplay} de {kind}.',
  'findings.severity.CRITICAL': 'CRÍTICO',
};
function fakeT(key, params){
  const template = DICT[key];
  if(!template) return key;
  return template.replace(/\{(\w+)\}/g, (m, k) => (params && params[k] !== undefined ? params[k] : m));
}

test('resolveFindingMessage resolves the base template with params', () => {
  const finding = { code: 'negative_quantity', message: 'fallback', params: { kind: 'materials', indexDisplay: 2 } };
  assert.equal(resolveFindingMessage(fakeT, finding), 'Cantidad negativa en renglón 2 de materials: se trata como 0.');
});

test('resolveFindingMessage falls back to finding.message when t is not a function', () => {
  const finding = { code: 'negative_quantity', message: 'texto original', params: {} };
  assert.equal(resolveFindingMessage(undefined, finding), 'texto original');
});

test('resolveFindingMessage falls back to finding.message when the code has no translation at all', () => {
  const finding = { code: 'no_existe_en_ningun_idioma', message: 'texto original en espanol', params: {} };
  assert.equal(resolveFindingMessage(fakeT, finding), 'texto original en espanol');
});

test('resolveFindingMessage never returns the raw translation key', () => {
  const finding = { code: 'codigo_inventado', message: 'algo', params: {} };
  const result = resolveFindingMessage(fakeT, finding);
  assert.notEqual(result, 'findings.codigo_inventado');
});

test('resolveFindingMessage prefers the _field variant when the finding carries a field param', () => {
  const finding = { code: 'non_finite_value', message: 'fallback', params: { kind: 'labor', indexDisplay: 1, field: 'salarioBase' } };
  assert.equal(resolveFindingMessage(fakeT, finding), 'Valor no numérico en "salarioBase" del renglón 1 de labor.');
});

test('resolveFindingMessage uses the base variant when there is no field param', () => {
  const finding = { code: 'non_finite_value', message: 'fallback', params: { kind: 'labor', indexDisplay: 1 } };
  assert.equal(resolveFindingMessage(fakeT, finding), 'Valor no numérico en renglón 1 de labor.');
});

test('resolveSeverityLabel resolves a known severity', () => {
  assert.equal(resolveSeverityLabel(fakeT, 'CRITICAL'), 'CRÍTICO');
});

test('resolveSeverityLabel falls back to the raw severity when unknown or t missing', () => {
  assert.equal(resolveSeverityLabel(fakeT, 'UNKNOWN_SEVERITY'), 'UNKNOWN_SEVERITY');
  assert.equal(resolveSeverityLabel(undefined, 'CRITICAL'), 'CRITICAL');
  assert.equal(resolveSeverityLabel(fakeT, ''), '');
});
