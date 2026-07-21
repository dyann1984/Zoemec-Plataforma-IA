import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonObject } from './_openaiApuCore.mjs';

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
