import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANO_ELEMENT_STATES, ESCALA_FUENTES, isValidPlanoState, isValidEscalaFuente, enforceScaleRule, applyPlanoElementReview, toApuSeed } from './planoReview.js';

function baseElement(overrides = {}){
  return {
    tipo: 'muro', descripcion: 'Muro de block hueco 15cm', cantidadPropuesta: 126.4, unidad: 'm²',
    confianzaIA: 78, pagina: 2, evidencia: 'Cota de 12.64m visible en eje A-B', fuenteEscala: ESCALA_FUENTES.COTAS_TEXTO,
    observaciones: '', estado: PLANO_ELEMENT_STATES.PROPUESTO_POR_IA,
    ...overrides
  };
}

test('isValidPlanoState / isValidEscalaFuente solo aceptan los valores controlados', () => {
  assert.equal(isValidPlanoState('VALIDADO_POR_USUARIO'), true);
  assert.equal(isValidPlanoState('APROBADO'), false);
  assert.equal(isValidEscalaFuente('cotas_texto'), true);
  assert.equal(isValidEscalaFuente('estimado'), false);
});

test('enforceScaleRule: sin escala determinada, la cantidad se anula aunque el modelo la haya propuesto', () => {
  const el = baseElement({ fuenteEscala: ESCALA_FUENTES.NO_DETERMINADA, cantidadPropuesta: 126.4, estado: PLANO_ELEMENT_STATES.PROPUESTO_POR_IA });
  const fixed = enforceScaleRule(el);
  assert.equal(fixed.cantidadPropuesta, null);
  assert.equal(fixed.estado, PLANO_ELEMENT_STATES.REQUIERE_REVISION);
});

test('enforceScaleRule: con escala valida, la cantidad se conserva y el estado no se toca', () => {
  const el = baseElement();
  const same = enforceScaleRule(el);
  assert.equal(same.cantidadPropuesta, 126.4);
  assert.equal(same.estado, PLANO_ELEMENT_STATES.PROPUESTO_POR_IA);
});

test('applyPlanoElementReview: exige usuario para VALIDADO_POR_USUARIO y RECHAZADO', () => {
  assert.throws(() => applyPlanoElementReview(baseElement(), { state: 'VALIDADO_POR_USUARIO' }));
  assert.throws(() => applyPlanoElementReview(baseElement(), { state: 'RECHAZADO' }));
});

test('applyPlanoElementReview: no exige usuario para PROPUESTO_POR_IA/REQUIERE_REVISION', () => {
  assert.doesNotThrow(() => applyPlanoElementReview(baseElement(), { state: 'REQUIERE_REVISION' }));
});

test('applyPlanoElementReview: rechaza estados invalidos', () => {
  assert.throws(() => applyPlanoElementReview(baseElement(), { state: 'APROBADO', validatedBy: 'x' }));
});

test('applyPlanoElementReview: conserva el valor original de la IA junto a la correccion, nunca lo sobrescribe', () => {
  const el = baseElement();
  const reviewed = applyPlanoElementReview(el, { state: 'VALIDADO_POR_USUARIO', validatedBy: 'diana@zoemec.com', cantidadCorregida: 130 });
  assert.equal(reviewed.cantidadOriginalIA, 126.4);
  assert.equal(reviewed.cantidadCorregida, 130);
  assert.equal(reviewed.validatedBy, 'diana@zoemec.com');
  assert.ok(reviewed.validatedAt);
});

test('applyPlanoElementReview: motivo se conserva al rechazar', () => {
  const reviewed = applyPlanoElementReview(baseElement(), { state: 'RECHAZADO', validatedBy: 'diana@zoemec.com', motivo: 'No corresponde a este muro, es un elemento de otra lamina.' });
  assert.equal(reviewed.estado, 'RECHAZADO');
  assert.match(reviewed.motivo, /otra lamina/);
});

test('toApuSeed: PROPUESTO_POR_IA nunca entra al APU', () => {
  assert.equal(toApuSeed(baseElement({ estado: PLANO_ELEMENT_STATES.PROPUESTO_POR_IA })), null);
});

test('toApuSeed: REQUIERE_REVISION nunca entra al APU', () => {
  assert.equal(toApuSeed(baseElement({ estado: PLANO_ELEMENT_STATES.REQUIERE_REVISION, cantidadPropuesta: null })), null);
});

test('toApuSeed: RECHAZADO nunca entra al APU', () => {
  assert.equal(toApuSeed(baseElement({ estado: PLANO_ELEMENT_STATES.RECHAZADO })), null);
});

test('toApuSeed: VALIDADO_POR_USUARIO SI produce una semilla de concepto valida', () => {
  const el = baseElement({ estado: PLANO_ELEMENT_STATES.VALIDADO_POR_USUARIO, cantidadCorregida: 130, validatedBy: 'diana@zoemec.com', validatedAt: '2026-08-21T10:00:00Z' });
  const seed = toApuSeed(el);
  assert.equal(seed.concept, 'Muro de block hueco 15cm');
  assert.equal(seed.unit, 'm²');
  assert.equal(seed.qty, 130); // usa la cantidad CORREGIDA, no la original de la IA
  assert.equal(seed.referencePU, 0);
  assert.equal(seed.sourceMeta.fuenteEscala, 'cotas_texto');
  assert.equal(seed.sourceMeta.validatedBy, 'diana@zoemec.com');
});

test('toApuSeed: VALIDADO_POR_USUARIO sin cantidad utilizable (null, negativa o no finita) no produce semilla', () => {
  assert.equal(toApuSeed(baseElement({ estado: PLANO_ELEMENT_STATES.VALIDADO_POR_USUARIO, cantidadPropuesta: null, cantidadCorregida: null })), null);
  assert.equal(toApuSeed(baseElement({ estado: PLANO_ELEMENT_STATES.VALIDADO_POR_USUARIO, cantidadCorregida: -5 })), null);
  assert.equal(toApuSeed(baseElement({ estado: PLANO_ELEMENT_STATES.VALIDADO_POR_USUARIO, cantidadCorregida: NaN })), null);
});

test('toApuSeed: usa la cantidad propuesta por la IA cuando no hay correccion humana', () => {
  const el = baseElement({ estado: PLANO_ELEMENT_STATES.VALIDADO_POR_USUARIO, validatedBy: 'diana@zoemec.com' });
  const seed = toApuSeed(el);
  assert.equal(seed.qty, 126.4);
});
