import test from 'node:test';
import assert from 'node:assert/strict';
import { NullSemanticProvider, SEMANTIC_PROVIDERS, getSemanticProvider } from '../src/lib/semanticProvider.js';

test('NullSemanticProvider: nunca disponible, nunca finge un match (sin API externa por defecto)', () => {
  assert.equal(NullSemanticProvider.available, false);
  assert.equal(NullSemanticProvider.match(), null);
});

test('SEMANTIC_PROVIDERS: vacio en esta fase (arquitectura lista, ningun proveedor real implementado)', () => {
  assert.deepEqual(Object.keys(SEMANTIC_PROVIDERS), []);
});

test('getSemanticProvider: sin proveedor registrado siempre cae a NullSemanticProvider', () => {
  assert.equal(getSemanticProvider(), NullSemanticProvider);
  assert.equal(getSemanticProvider('embeddings-futuro'), NullSemanticProvider);
});
