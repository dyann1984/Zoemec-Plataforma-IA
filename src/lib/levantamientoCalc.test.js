import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeElementArea, computeSpaceGeometry, recomputeSpace, recomputeSurvey, aggregateSurveyTotals
} from './levantamientoCalc.js';
import { ELEMENT_TYPE, makeEmptySpace, makeEmptyElement, makeEmptySurvey } from '../domain/levantamientoSchema.js';

const close = (actual, expected, epsilon = 1e-6) => Math.abs(actual - expected) < epsilon;

test('computeSpaceGeometry calcula area de piso como largo x ancho', () => {
  const space = makeEmptySpace({ name: 'Local comercial', length: 8, width: 8, height: 3 });
  const g = computeSpaceGeometry(space);
  assert.ok(close(g.floorArea, 64));
});

test('computeSpaceGeometry calcula el plafon igual al area de piso (techo plano)', () => {
  const space = makeEmptySpace({ length: 8, width: 8, height: 3 });
  const g = computeSpaceGeometry(space);
  assert.ok(close(g.ceilingArea, 64));
});

test('computeSpaceGeometry calcula el perimetro como 2 x (largo + ancho)', () => {
  const space = makeEmptySpace({ length: 8, width: 8, height: 3 });
  const g = computeSpaceGeometry(space);
  assert.ok(close(g.perimeter, 32));
});

test('computeSpaceGeometry calcula muros brutos como perimetro x alto', () => {
  const space = makeEmptySpace({ length: 8, width: 8, height: 3 });
  const g = computeSpaceGeometry(space);
  assert.ok(close(g.wallGrossArea, 96));
});

test('computeSpaceGeometry calcula el volumen como largo x ancho x alto', () => {
  const space = makeEmptySpace({ length: 8, width: 8, height: 3 });
  const g = computeSpaceGeometry(space);
  assert.ok(close(g.volume, 192));
});

test('computeElementArea de una puerta es ancho x alto x cantidad', () => {
  const door = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1, quantity: 1 });
  assert.ok(close(computeElementArea(door), 1.89));
});

test('computeElementArea de una ventana es ancho x alto x cantidad', () => {
  const win = makeEmptyElement({ type: ELEMENT_TYPE.WINDOW, width: 2, height: 1.2, quantity: 1 });
  assert.ok(close(computeElementArea(win), 2.4));
});

test('computeSpaceGeometry descuenta puertas del area bruta de muros', () => {
  const door = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1 });
  const space = { ...makeEmptySpace({ length: 8, width: 8, height: 3 }), elements: [door] };
  const g = computeSpaceGeometry(space);
  assert.ok(close(g.doorsArea, 1.89));
  assert.ok(close(g.wallNetArea, 96 - 1.89));
});

test('computeSpaceGeometry descuenta ventanas del area bruta de muros', () => {
  const win = makeEmptyElement({ type: ELEMENT_TYPE.WINDOW, width: 2, height: 1.2 });
  const space = { ...makeEmptySpace({ length: 8, width: 8, height: 3 }), elements: [win] };
  const g = computeSpaceGeometry(space);
  assert.ok(close(g.windowsArea, 2.4));
  assert.ok(close(g.wallNetArea, 96 - 2.4));
});

test('computeSpaceGeometry calcula el area neta de muros descontando puertas y ventanas juntas (caso "Local comercial" de la Definicion de Terminado)', () => {
  const door = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1 });
  const win = makeEmptyElement({ type: ELEMENT_TYPE.WINDOW, width: 2, height: 1.2 });
  const space = { ...makeEmptySpace({ name: 'Local comercial', length: 8, width: 8, height: 3 }), elements: [door, win] };
  const g = computeSpaceGeometry(space);
  assert.ok(close(g.floorArea, 64));
  assert.ok(close(g.ceilingArea, 64));
  assert.ok(close(g.perimeter, 32));
  assert.ok(close(g.wallGrossArea, 96));
  assert.ok(close(g.wallNetArea, 91.71));
});

test('computeSpaceGeometry nunca regresa area neta negativa (aberturas mayores al muro bruto)', () => {
  const door = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 5, height: 5 });
  const space = { ...makeEmptySpace({ length: 2, width: 2, height: 2 }), elements: [door] };
  const g = computeSpaceGeometry(space);
  assert.equal(g.wallNetArea, 0);
});

test('recomputeSpace recalcula geometria y area de elementos sin mutar el original', () => {
  const door = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1 });
  const space = { ...makeEmptySpace({ length: 8, width: 8, height: 3 }), elements: [door] };
  const recomputed = recomputeSpace(space);
  assert.notEqual(recomputed, space);
  assert.ok(close(recomputed.floorArea, 64));
  assert.ok(close(recomputed.elements[0].area, 1.89));
  assert.equal(space.floorArea, 0);
});

test('recomputeSurvey recalcula todos los espacios de un levantamiento', () => {
  const survey = makeEmptySurvey({ projectId: 'PRO-1', name: 'Levantamiento Local Ecatepec' });
  survey.spaces = [makeEmptySpace({ length: 8, width: 8, height: 3 }), makeEmptySpace({ length: 4, width: 4, height: 3 })];
  const recomputed = recomputeSurvey(survey);
  assert.ok(close(recomputed.spaces[0].floorArea, 64));
  assert.ok(close(recomputed.spaces[1].floorArea, 16));
});

test('aggregateSurveyTotals suma area de piso, muros y conteo de puertas/ventanas de todos los espacios', () => {
  const door = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1 });
  const win = makeEmptyElement({ type: ELEMENT_TYPE.WINDOW, width: 2, height: 1.2 });
  const survey = makeEmptySurvey({ projectId: 'PRO-1', name: 'Levantamiento Local Ecatepec' });
  survey.spaces = [
    { ...makeEmptySpace({ length: 8, width: 8, height: 3 }), elements: [door, win] },
    { ...makeEmptySpace({ length: 4, width: 4, height: 3 }), elements: [door] }
  ];
  const totals = aggregateSurveyTotals(survey);
  assert.ok(close(totals.floorArea, 80));
  assert.equal(totals.doorsCount, 2);
  assert.equal(totals.windowsCount, 1);
  assert.equal(totals.spacesCount, 2);
});
