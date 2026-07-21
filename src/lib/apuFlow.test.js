import test from 'node:test';
import assert from 'node:assert/strict';
import { processApuConcept, buildZoeResponse, createDemoContext, validateApu, canExportApu } from './apuFlow.js';

test('procesa concepto con coincidencia exacta', async () => {
  const result = await processApuConcept({
    concept: 'Muro de block 15 cm',
    library: [{ concept: 'Muro de block 15 cm', unit: 'm²', price: 825, source: 'biblioteca' }]
  });
  assert.equal(result.source, 'exact_library');
  assert.ok(result.data.price > 0);
  assert.equal(result.data.materials.length > 0, true);
});

test('procesa concepto con coincidencia similar', async () => {
  const result = await processApuConcept({
    concept: 'Muro de tabique rojo',
    library: [{ concept: 'Muro de block 15 cm', unit: 'm²', price: 825, source: 'biblioteca' }]
  });
  assert.equal(result.source, 'similar_library');
  assert.ok(result.data.price > 0);
});

test('genera propuesta determinista cuando no hay coincidencia', async () => {
  const result = await processApuConcept({
    concept: 'Concepto nuevo',
    library: [],
    openai: async () => { throw new Error('offline'); }
  });
  assert.equal(result.source, 'deterministic_template');
  assert.equal(result.data.isProposal, true);
});

test('detecta precio cero como alerta crítica', async () => {
  const result = await processApuConcept({
    concept: 'Pintura de prueba',
    library: [{ concept: 'Pintura de prueba', unit: 'm²', price: 0, source: 'biblioteca' }]
  });
  const alert = result.alerts.find(item => item.code === 'price_zero');
  assert.ok(alert);
  assert.equal(alert.level, 'critical');
});

test('detecta maquinaria obligatoria ausente', async () => {
  const result = await processApuConcept({
    concept: 'Bomba sumergible',
    library: [{ concept: 'Bomba sumergible', unit: 'pza', price: 12000, source: 'biblioteca' }]
  });
  const alert = result.alerts.find(item => item.code === 'machinery_missing');
  assert.ok(alert);
});

test('detecta conceptos duplicados', async () => {
  const result = validateApu({
    concept: 'Muro de block 15 cm',
    items: [
      { id: '1', clave: 'A', concept: 'Muro de block 15 cm', unit: 'm²' },
      { id: '2', clave: 'B', concept: 'Muro de block 15 cm', unit: 'm²' }
    ]
  });
  const alert = result.alerts.find(item => item.code === 'duplicate_concept');
  assert.ok(alert);
});

test('ZOE revisa un APU y devuelve accion concreta', async () => {
  const response = buildZoeResponse({
    intent: 'review',
    context: {
      activeApu: { concept: 'Muro de block 15 cm', confidence: 88 },
      alerts: [{ code: 'price_zero', level: 'warning', message: 'Precio cero' }]
    }
  });
  assert.match(response.message, /revisar/i);
  assert.ok(response.actions.includes('validateApu'));
});

test('ZOE explica precio con fuente y evidencia', async () => {
  const response = buildZoeResponse({
    intent: 'explain_price',
    context: {
      activeApu: { concept: 'Muro de block 15 cm', price: 825, source: 'exact_library', evidence: { file: 'catalogo.xlsx', sheet: 'Hoja1', row: 5 } }
    }
  });
  assert.match(response.message, /825/i);
  assert.ok(response.actions.includes('explainPrice'));
});

test('ZOE exporta cuando no hay alerta crítica', async () => {
  const response = buildZoeResponse({
    intent: 'export_pdf',
    context: { activeApu: { concept: 'Muro de block 15 cm' }, alerts: [] }
  });
  assert.ok(response.actions.includes('exportPdf'));
});

test('bloquea exportacion cuando hay alerta crítica', () => {
  const result = canExportApu({ alerts: [{ level: 'critical', code: 'price_zero' }] });
  assert.equal(result, false);
});

test('crea contexto demo con etiqueta demostrativa', () => {
  const demo = createDemoContext();
  assert.match(demo.projectLabel, /demostrativo/i);
  assert.ok(demo.activity.length > 0);
});
