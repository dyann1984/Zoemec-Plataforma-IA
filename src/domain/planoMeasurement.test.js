import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrateScale, polygonAreaPx, polylineLengthPx, measureElement } from './planoMeasurement.js';
import { ESCALA_FUENTES, PLANO_ELEMENT_STATES } from './planoReview.js';

test('calibrateScale: distancia real / distancia en pixeles', () => {
  assert.equal(calibrateScale(100, 5), 0.05);
});

test('calibrateScale: rechaza distancias no positivas (nunca asume una escala por defecto)', () => {
  assert.equal(calibrateScale(0, 5), null);
  assert.equal(calibrateScale(100, 0), null);
  assert.equal(calibrateScale(-10, 5), null);
  assert.equal(calibrateScale(100, -5), null);
});

test('polygonAreaPx: un cuadrado de 100x100 px mide 10000 px^2 (formula del shoelace)', () => {
  const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
  assert.equal(polygonAreaPx(square), 10000);
});

test('polygonAreaPx: menos de 3 vertices es 0, nunca NaN', () => {
  assert.equal(polygonAreaPx([[0, 0], [10, 10]]), 0);
  assert.equal(polygonAreaPx([]), 0);
});

test('polylineLengthPx: suma de segmentos', () => {
  const line = [[0, 0], [3, 4], [3, 10]]; // 5 + 6 = 11
  assert.equal(polylineLengthPx(line), 11);
});

test('measureElement (area): un cuadrado de 200x200 px con escala 0.03 m/px da 36 m^2 reales', () => {
  const square = [[0, 0], [200, 0], [200, 200], [0, 200]];
  const scale = calibrateScale(100, 3); // 100px = 3m -> 0.03 m/px
  const el = measureElement({ points: square, mode: 'area', scaleUnitsPerPixel: scale, unit: 'm', tipo: 'piso', descripcion: 'Colocacion de piso, Local 02' });
  assert.equal(el.cantidadPropuesta, 36); // 40000 px^2 * 0.03^2 = 36
  assert.equal(el.unidad, 'm²');
  assert.equal(el.fuenteEscala, ESCALA_FUENTES.REFERENCIA_USUARIO);
  assert.equal(el.estado, PLANO_ELEMENT_STATES.PROPUESTO_POR_IA);
});

test('measureElement (length): una polilinea con escala calibrada da longitud real', () => {
  const line = [[0, 0], [0, 100]]; // 100 px
  const scale = calibrateScale(50, 1); // 50px = 1m -> 0.02 m/px
  const el = measureElement({ points: line, mode: 'length', scaleUnitsPerPixel: scale, unit: 'm', tipo: 'muro' });
  assert.equal(el.cantidadPropuesta, 2); // 100px * 0.02 = 2m
  assert.equal(el.unidad, 'm');
});

test('measureElement: SIN escala calibrada, nunca produce una cantidad (regla critica: no inventar mediciones)', () => {
  const square = [[0, 0], [200, 0], [200, 200], [0, 200]];
  const el = measureElement({ points: square, mode: 'area', scaleUnitsPerPixel: null });
  assert.equal(el.cantidadPropuesta, null);
  assert.equal(el.fuenteEscala, ESCALA_FUENTES.NO_DETERMINADA);
  // enforceScaleRule (planoReview.js) debe forzar REQUIERE_REVISION, la
  // misma barrera dura que ya aplica a una deteccion de IA sin escala.
  assert.equal(el.estado, PLANO_ELEMENT_STATES.REQUIERE_REVISION);
});

test('measureElement: con escala calibrada pero un trazo degenerado (area 0), tampoco propone cantidad', () => {
  const el = measureElement({ points: [[0, 0], [10, 10]], mode: 'area', scaleUnitsPerPixel: 0.05 });
  assert.equal(el.cantidadPropuesta, null);
});
