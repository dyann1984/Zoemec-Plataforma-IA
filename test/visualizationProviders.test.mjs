import test from 'node:test';
import assert from 'node:assert/strict';
import { TechnicalModelProvider, NullAIRenderProvider, AI_RENDER_PROVIDERS, getAIRenderProvider } from '../src/lib/visualizationProviders.js';

test('TechnicalModelProvider: delega en deriveGeometryFromApu, no duplica logica de geometria', async () => {
  const apu = { primaryActivity: 'piso', unit: 'm²', cantidadObra: 64, variables: {} };
  const result = await TechnicalModelProvider.generate(apu);
  assert.equal(result.ok, true);
  assert.equal(result.elements[0].type, 'floor');
});

test('TechnicalModelProvider: siempre disponible (no requiere credenciales externas)', () => {
  assert.equal(TechnicalModelProvider.available, true);
  assert.equal(TechnicalModelProvider.kind, 'MODELO_TECNICO');
});

test('NullAIRenderProvider: nunca se marca disponible, nunca finge un render', async () => {
  assert.equal(NullAIRenderProvider.available, false);
  const result = await NullAIRenderProvider.generate();
  assert.equal(result.available, false);
  assert.equal(result.reason, 'NO_PROVIDER_CONFIGURED');
  assert.equal(result.image, null);
});

test('AI_RENDER_PROVIDERS: vacio en esta fase (ningun proveedor real implementado todavia)', () => {
  assert.deepEqual(Object.keys(AI_RENDER_PROVIDERS), []);
});

test('getAIRenderProvider: sin proveedor registrado siempre cae a NullAIRenderProvider, nunca lanza', () => {
  assert.equal(getAIRenderProvider(), NullAIRenderProvider);
  assert.equal(getAIRenderProvider('cualquier-cosa-no-registrada'), NullAIRenderProvider);
});
