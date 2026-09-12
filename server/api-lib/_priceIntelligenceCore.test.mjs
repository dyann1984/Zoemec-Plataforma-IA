/* Fase 2 (APU regionalizados por ubicacion): deriveRegionalConfidence es la
   unica parte de _priceIntelligenceCore.mjs que es pura y determinista (el
   resto llama a la API real de OpenAI) -- se testea en aislamiento, sin red,
   siguiendo el mismo criterio del resto del archivo: nunca inventa
   confianza regional sobre referencias que ni siquiera calificaron
   tecnicamente (ALTO/aceptadas). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveRegionalConfidence, REGIONAL_COVERAGE } from './_priceIntelligenceCore.mjs';

test('sin referencias aceptadas -> confianza regional null, nunca inventada', () => {
  assert.deepEqual(deriveRegionalConfidence([]), { regionalConfidence: null, regionalFallbackLevel: null });
});

test('al menos una referencia aceptada de nivel ciudad -> ALTA, aunque haya otras de menor nivel', () => {
  const aceptadas = [
    { nivelCobertura: 'nacional' },
    { nivelCobertura: 'ciudad' },
    { nivelCobertura: 'estado' }
  ];
  assert.deepEqual(deriveRegionalConfidence(aceptadas), { regionalConfidence: 'ALTA', regionalFallbackLevel: 'ciudad' });
});

test('ninguna de nivel ciudad pero al menos una de nivel estado -> MEDIA', () => {
  const aceptadas = [{ nivelCobertura: 'nacional' }, { nivelCobertura: 'estado' }];
  assert.deepEqual(deriveRegionalConfidence(aceptadas), { regionalConfidence: 'MEDIA', regionalFallbackLevel: 'estado' });
});

test('solo referencias nacionales -> BAJA (aviso honesto de informacion regional limitada)', () => {
  const aceptadas = [{ nivelCobertura: 'nacional' }, { nivelCobertura: 'nacional' }];
  assert.deepEqual(deriveRegionalConfidence(aceptadas), { regionalConfidence: 'BAJA', regionalFallbackLevel: 'nacional' });
});

test('solo referencias no_especificado -> BAJA/nacional, mismo criterio que nacional (nunca se asume ciudad/estado sin evidencia)', () => {
  const aceptadas = [{ nivelCobertura: 'no_especificado' }];
  assert.deepEqual(deriveRegionalConfidence(aceptadas), { regionalConfidence: 'BAJA', regionalFallbackLevel: 'nacional' });
});

test('REGIONAL_COVERAGE expone exactamente los 4 niveles esperados', () => {
  assert.deepEqual([...REGIONAL_COVERAGE], ['ciudad', 'estado', 'nacional', 'no_especificado']);
});
