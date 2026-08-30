/* Material & Price Intelligence 2.1 -- regla 7: normalizacion determinista.
   TEST 11-13 obligatorios del spec, mas los ejemplos explicitos de la
   seccion 7 (cemento 50kg, adhesivo 20kg, rollo 100m, caja 1.44m2, 1m3->1000L)
   y las protecciones contra 0/NaN/Infinity/unidades incompatibles/factor
   negativo/presentacion invalida. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePresentationPrice } from './priceNormalization.js';

test('TEST 11 -- tubo $600 / 6 m -> $100/m', () => {
  const result = normalizePresentationPrice({ presentationPrice: 600, presentationQty: 6, presentationUnit: 'm', targetUnit: 'm' });
  assert.equal(result.normalizationRequired, false);
  assert.equal(result.pricePerUnit, 100);
});

test('TEST 12 -- caja $720 / 1.44 m2 -> $500/m2', () => {
  const result = normalizePresentationPrice({ presentationPrice: 720, presentationQty: 1.44, presentationUnit: 'm2', targetUnit: 'm2' });
  assert.equal(result.normalizationRequired, false);
  assert.equal(result.pricePerUnit, 500);
});

test('TEST 13 -- conversion imposible (unidades incompatibles) -> NORMALIZATION_REQUIRED, nunca se inventa', () => {
  const result = normalizePresentationPrice({ presentationPrice: 300, presentationQty: 20, presentationUnit: 'kg', targetUnit: 'm' });
  assert.equal(result.normalizationRequired, true);
  assert.match(result.reason, /incompatibles/i);
});

test('cemento: saco de 50 kg -> precio/kg', () => {
  const result = normalizePresentationPrice({ presentationPrice: 250, presentationQty: 50, presentationUnit: 'kg', targetUnit: 'kg' });
  assert.equal(result.normalizationRequired, false);
  assert.equal(result.pricePerUnit, 5);
});

test('adhesivo: cubeta de 20 kg -> precio/kg', () => {
  const result = normalizePresentationPrice({ presentationPrice: 900, presentationQty: 20, presentationUnit: 'kg', targetUnit: 'kg' });
  assert.equal(result.normalizationRequired, false);
  assert.equal(result.pricePerUnit, 45);
});

test('rollo de 100 m -> precio/m', () => {
  const result = normalizePresentationPrice({ presentationPrice: 1500, presentationQty: 100, presentationUnit: 'm', targetUnit: 'm' });
  assert.equal(result.normalizationRequired, false);
  assert.equal(result.pricePerUnit, 15);
});

test('1 m3 equivale a 1000 litros cuando corresponde (volumen)', () => {
  const result = normalizePresentationPrice({ presentationPrice: 2000, presentationQty: 1, presentationUnit: 'm3', targetUnit: 'l' });
  assert.equal(result.normalizationRequired, false);
  // 1 m3 = 1000 L -> $2000 / 1000 L = $2/L
  assert.equal(result.pricePerUnit, 2);
  assert.equal(result.presentationQtyInTargetUnit, 1000);
});

test('proteccion: precio $0 en la presentacion -> NORMALIZATION_REQUIRED, nunca $0/unidad', () => {
  const result = normalizePresentationPrice({ presentationPrice: 0, presentationQty: 6, presentationUnit: 'm', targetUnit: 'm' });
  assert.equal(result.normalizationRequired, true);
});

test('proteccion: cantidad de presentacion en 0 -> NORMALIZATION_REQUIRED (division por 0 nunca ocurre)', () => {
  const result = normalizePresentationPrice({ presentationPrice: 500, presentationQty: 0, presentationUnit: 'm', targetUnit: 'm' });
  assert.equal(result.normalizationRequired, true);
});

test('proteccion: NaN en precio o cantidad -> NORMALIZATION_REQUIRED', () => {
  assert.equal(normalizePresentationPrice({ presentationPrice: NaN, presentationQty: 6, presentationUnit: 'm', targetUnit: 'm' }).normalizationRequired, true);
  assert.equal(normalizePresentationPrice({ presentationPrice: 600, presentationQty: NaN, presentationUnit: 'm', targetUnit: 'm' }).normalizationRequired, true);
});

test('proteccion: Infinity nunca se acepta como precio o cantidad valida', () => {
  assert.equal(normalizePresentationPrice({ presentationPrice: Infinity, presentationQty: 6, presentationUnit: 'm', targetUnit: 'm' }).normalizationRequired, true);
  assert.equal(normalizePresentationPrice({ presentationPrice: 600, presentationQty: Infinity, presentationUnit: 'm', targetUnit: 'm' }).normalizationRequired, true);
});

test('proteccion: cantidad negativa -> NORMALIZATION_REQUIRED (nunca un factor negativo)', () => {
  const result = normalizePresentationPrice({ presentationPrice: 600, presentationQty: -6, presentationUnit: 'm', targetUnit: 'm' });
  assert.equal(result.normalizationRequired, true);
});

test('proteccion: unidad no reconocida -> NORMALIZATION_REQUIRED en vez de asumir una conversion 1:1', () => {
  const result = normalizePresentationPrice({ presentationPrice: 600, presentationQty: 6, presentationUnit: 'unidad-rara-xyz', targetUnit: 'm' });
  assert.equal(result.normalizationRequired, true);
});

test('conversion entre unidades de la misma dimension con distinta escala (cm -> m)', () => {
  // presentacion: barra de 600 cm a $6000 -> por metro: 600cm = 6m -> $1000/m
  const result = normalizePresentationPrice({ presentationPrice: 6000, presentationQty: 600, presentationUnit: 'cm', targetUnit: 'm' });
  assert.equal(result.normalizationRequired, false);
  assert.equal(result.pricePerUnit, 1000);
});
