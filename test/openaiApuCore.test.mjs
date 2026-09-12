import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonObject, sanitizeAPU } from '../server/api-lib/_openaiApuCore.mjs';

test('extrae JSON de texto con bloque fenced code', () => {
  const raw = 'Aquí está la respuesta:\n```json\n{ "concept": "Muro de block 15 cm", "unit": "m²", "materials": [] }\n```';
  const parsed = extractJsonObject(raw);
  assert.deepEqual(parsed, { concept: 'Muro de block 15 cm', unit: 'm²', materials: [] });
});

test('extrae JSON de texto que contiene comentarios y texto adicional', () => {
  const raw = 'Respuesta del modelo:\n{ "concept": "Pintura vinílica", "unit": "m²", "labor": [] }\nGracias.';
  const parsed = extractJsonObject(raw);
  assert.deepEqual(parsed, { concept: 'Pintura vinílica', unit: 'm²', labor: [] });
});

/* Fase 0 (Inteligencia de Costos, hallazgo #24 -- "la IA no debe inventar el
   precio"): sanitizeAPU debe distinguir un renglon con coincidencia real de
   catalogo ("catalogo") de uno que el modelo estimo sin evidencia
   ("estimado_ia"), y NUNCA confiar "catalogo" por default -- ver
   normalizePriceOrigin en _openaiApuCore.mjs. */
test('sanitizeAPU marca priceOrigin=catalogo solo cuando el modelo lo declaro explicitamente', () => {
  const raw = {
    concept: 'Muro de block hueco 15 cm',
    unit: 'm2',
    materials: [['Block hueco 15x20x40', 12.5, 'pza', 18.7, 3], ['Mortero cemento-arena', 0.03, 'm3', 2800, 0]],
    materialsSource: ['catalogo', 'estimado_ia'],
    labor: [['Albañil', 0.08, 'jor', 650, 1]],
    laborSource: ['catalogo'],
    equipment: [['Revolvedora', 0.01, 'hr', 45]]
    // equipmentSource ausente a proposito -- debe caer a estimado_ia, nunca a catalogo.
  };
  const apu = sanitizeAPU(raw, raw.concept);
  assert.deepEqual(apu.priceOrigin.materials, ['catalogo', 'estimado_ia']);
  assert.deepEqual(apu.priceOrigin.labor, ['catalogo']);
  assert.deepEqual(apu.priceOrigin.equipment, ['estimado_ia']);
});

test('sanitizeAPU nunca asume "catalogo" para un valor invalido/desconocido en *Source', () => {
  const raw = {
    concept: 'Impermeabilizante acrilico en losa',
    unit: 'm2',
    materials: [['Impermeabilizante acrilico', 0.4, 'kg', 55, 0]],
    materialsSource: ['CATALOGO_REAL_CONFIRMADO'] // valor no reconocido -- debe caer al default seguro.
  };
  const apu = sanitizeAPU(raw, raw.concept);
  assert.deepEqual(apu.priceOrigin.materials, ['estimado_ia']);
});
