/* Material & Price Intelligence 2.1 -- regla 1: input del usuario es
   autoritativo. TEST 4 obligatorio del spec: usuario captura "m", la IA
   propone "pza" -> se conserva "m" y se genera UNIT_WARNING. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAuthoritativeInput } from './unitAuthority.js';

test('TEST 4 -- usuario captura unidad "m", IA propone "pza": se conserva "m" y se genera UNIT_WARNING', () => {
  const { resolved, unitWarning, overriddenFields } = resolveAuthoritativeInput({
    userInput: { unit: 'm', qty: 12 },
    aiProposed: { concept: 'Columna de descarga', unit: 'pza', qty: 12 }
  });
  assert.equal(resolved.unit, 'm', 'la unidad del usuario debe ganar siempre');
  assert.ok(unitWarning, 'debe generarse un UNIT_WARNING cuando la IA propone una unidad distinta');
  assert.equal(unitWarning.capturedUnit, 'm');
  assert.equal(unitWarning.suggestedUnit, 'pza');
  assert.ok(unitWarning.reason.length > 0, 'el warning debe traer una razon legible');
  assert.ok(overriddenFields.includes('unit'), 'unit debe listarse como campo descartado de la IA');
});

test('unidad equivalente tras normalizar (m2 vs m²) no genera UNIT_WARNING falso', () => {
  const { unitWarning } = resolveAuthoritativeInput({
    userInput: { unit: 'm2' },
    aiProposed: { unit: 'm²' }
  });
  assert.equal(unitWarning, null);
});

test('concepto/cantidad/clave capturados por el usuario nunca se sobreescriben con la propuesta de la IA', () => {
  const { resolved, overriddenFields } = resolveAuthoritativeInput({
    userInput: { concept: 'Concepto real del usuario', qty: 64, clave: 'CLAVE-USR-1' },
    aiProposed: { concept: 'Concepto reinterpretado por la IA', unit: 'pza', qty: 999, clave: 'CLAVE-IA-9' }
  });
  assert.equal(resolved.concept, 'Concepto real del usuario');
  assert.equal(resolved.qty, 64);
  assert.equal(resolved.clave, 'CLAVE-USR-1');
  assert.ok(overriddenFields.includes('concept'));
  assert.ok(overriddenFields.includes('qty'));
  assert.ok(overriddenFields.includes('clave'));
});

test('campo NO capturado por el usuario: se usa la propuesta de la IA sin cambios (comportamiento actual preservado)', () => {
  const { resolved, unitWarning, overriddenFields } = resolveAuthoritativeInput({
    userInput: {},
    aiProposed: { concept: 'Concepto propuesto por IA', unit: 'pza', qty: 8 }
  });
  assert.equal(resolved.unit, 'pza');
  assert.equal(resolved.qty, 8);
  assert.equal(unitWarning, null);
  assert.deepEqual(overriddenFields, []);
});

test('unidad del usuario coincide con la de la IA: no hay warning ni override registrado', () => {
  const { unitWarning, overriddenFields } = resolveAuthoritativeInput({
    userInput: { unit: 'm' },
    aiProposed: { unit: 'm' }
  });
  assert.equal(unitWarning, null);
  assert.deepEqual(overriddenFields, []);
});
