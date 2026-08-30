/* Material & Price Intelligence 2.1 -- regla 2: origen de material.
   TEST 5-8 obligatorios del spec: EXPLICIT / INFERRED_REQUIRED / OPTIONAL /
   UNRESOLVED. Todas las pruebas son deterministas (sin IA, sin red). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMaterialOrigin, MATERIAL_ORIGIN, materialOriginLabel } from './materialOrigin.js';

const CONCEPT = 'Suministro e instalacion de columna de descarga de tuberia de acero al carbon cedula 40 de 6 pulgadas, incluye valvula check, coples, reduccion, bridas cuando corresponda, empaques, tornilleria y materiales de montaje.';

test('TEST 5 -- material escrito literalmente en el concepto -> EXPLICIT', () => {
  const origin = classifyMaterialOrigin({ description: 'Valvula check de acero de 6 pulgadas, clase 150', concept: CONCEPT });
  assert.equal(origin, MATERIAL_ORIGIN.EXPLICIT);
});

test('TEST 6 -- material tecnicamente necesario pero no mencionado en el concepto -> INFERRED_REQUIRED', () => {
  const origin = classifyMaterialOrigin({
    description: 'Electrodo de soldadura E-7018 para union de tuberia',
    concept: CONCEPT, technicallyRequired: true
  });
  assert.equal(origin, MATERIAL_ORIGIN.INFERRED_REQUIRED);
});

test('TEST 7 -- material dependiente de especificacion/proyecto -> OPTIONAL', () => {
  const origin = classifyMaterialOrigin({
    description: 'Recubrimiento anticorrosivo especial segun especificacion del cliente',
    concept: CONCEPT, optional: true
  });
  assert.equal(origin, MATERIAL_ORIGIN.OPTIONAL);
});

test('TEST 8 -- material imposible de identificar con la informacion disponible -> UNRESOLVED', () => {
  const origin = classifyMaterialOrigin({ description: 'Componente sin especificar', concept: CONCEPT });
  assert.equal(origin, MATERIAL_ORIGIN.UNRESOLVED);
});

test('la IA puede proponer origen valido y se respeta si no contradice el texto', () => {
  const origin = classifyMaterialOrigin({
    description: 'Cinta de teflon para roscas', concept: CONCEPT,
    aiProposedOrigin: MATERIAL_ORIGIN.INFERRED_REQUIRED, technicallyRequired: true
  });
  assert.equal(origin, MATERIAL_ORIGIN.INFERRED_REQUIRED);
});

test('la IA nunca puede declarar EXPLICIT sobre un material que el texto no respalda: se degrada', () => {
  const origin = classifyMaterialOrigin({
    description: 'Sensor de presion inteligente IoT', concept: CONCEPT,
    aiProposedOrigin: MATERIAL_ORIGIN.EXPLICIT, technicallyRequired: false
  });
  assert.notEqual(origin, MATERIAL_ORIGIN.EXPLICIT, 'EXPLICIT falso nunca se acepta solo porque la IA lo declaro');
  assert.equal(origin, MATERIAL_ORIGIN.UNRESOLVED);
});

test('OPTIONAL nunca se auto-promueve a obligatorio: la etiqueta visible lo deja claro', () => {
  const label = materialOriginLabel(MATERIAL_ORIGIN.OPTIONAL);
  assert.match(label, /depende/i);
});

test('INFERRED_REQUIRED nunca se muestra como especificado explicitamente', () => {
  const label = materialOriginLabel(MATERIAL_ORIGIN.INFERRED_REQUIRED);
  assert.match(label, /inferido/i);
  assert.doesNotMatch(label, /especificado en el concepto/i);
});
