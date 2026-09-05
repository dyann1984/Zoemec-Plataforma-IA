import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveGeometryFromSpace } from './levantamientoGeometry3d.js';
import { ELEMENT_TYPE, makeEmptySpace, makeEmptyElement } from './levantamientoSchema.js';

const close = (actual, expected, epsilon = 1e-6) => Math.abs(actual - expected) < epsilon;

test('deriveGeometryFromSpace regresa ok:false y no inventa geometria si falta largo/ancho/alto', () => {
  const result = deriveGeometryFromSpace(makeEmptySpace({ name: 'Vacio' }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.sort(), ['height', 'length', 'width']);
});

test('deriveGeometryFromSpace conserva las dimensiones 8x8x3 del espacio en piso/plafon y en la suma de los segmentos de cada muro', () => {
  const space = makeEmptySpace({ name: 'Local comercial', length: 8, width: 8, height: 3 });
  const result = deriveGeometryFromSpace(space);
  assert.equal(result.ok, true);
  const floor = result.elements.find(e => e.type === 'floor');
  const ceiling = result.elements.find(e => e.type === 'ceiling');
  assert.ok(close(floor.dimensions.width, 8));
  assert.ok(close(floor.dimensions.depth, 8));
  assert.ok(close(ceiling.position.y, 3));

  ['M-01', 'M-02', 'M-03', 'M-04'].forEach(wallId => {
    const segs = result.elements.filter(e => e.type === 'wall' && e.wallId === wallId);
    const totalWidth = segs.reduce((acc, s) => acc + s.dimensions.width, 0);
    assert.ok(close(totalWidth, 8), `${wallId} deberia sumar 8m entre sus segmentos`);
    segs.forEach(s => assert.ok(s.dimensions.height <= 3 + 1e-9));
  });
});

test('deriveGeometryFromSpace genera un hueco real (sin CSG) para una puerta: el muro que la contiene queda partido en segmentos, mas la hoja de puerta como elemento aparte', () => {
  const door = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1, wallId: 'M-01', offset: 3 });
  const space = { ...makeEmptySpace({ name: 'Local comercial', length: 8, width: 8, height: 3 }), elements: [door] };
  const result = deriveGeometryFromSpace(space);

  const wallM01Segments = result.elements.filter(e => e.type === 'wall' && e.wallId === 'M-01');
  assert.equal(wallM01Segments.length, 3, 'izquierdo + dintel + derecho');

  const doorEl = result.elements.find(e => e.type === 'door');
  assert.ok(doorEl);
  assert.equal(doorEl.wallId, 'M-01');
  assert.ok(close(doorEl.dimensions.width, 0.9));
  assert.ok(close(doorEl.position.y, 2.1 / 2), 'la puerta se apoya en el piso (sillHeight=0)');
  assert.equal(doorEl.label, 'P-01');
});

test('deriveGeometryFromSpace posiciona una ventana respetando su sillHeight', () => {
  const win = makeEmptyElement({ type: ELEMENT_TYPE.WINDOW, width: 2, height: 1.2, wallId: 'M-03', offset: 2, sillHeight: 1 });
  const space = { ...makeEmptySpace({ name: 'Local comercial', length: 8, width: 8, height: 3 }), elements: [win] };
  const result = deriveGeometryFromSpace(space);
  const winEl = result.elements.find(e => e.type === 'window');
  assert.ok(close(winEl.position.y, 1 + 1.2 / 2));
  assert.equal(winEl.label, 'V-01');
});

test('deriveGeometryFromSpace propaga las advertencias de aberturas (ej. sin muro asignado) para que la UI las muestre', () => {
  const legacyDoor = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1 });
  delete legacyDoor.wallId;
  const space = { ...makeEmptySpace({ length: 8, width: 8, height: 3 }), elements: [legacyDoor] };
  const result = deriveGeometryFromSpace(space);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.includes('sin_muro_asignado'));
});

test('deriveGeometryFromSpace es determinista y no muta el space recibido', () => {
  const door = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1 });
  const space = { ...makeEmptySpace({ length: 8, width: 8, height: 3 }), elements: [door] };
  const before = JSON.stringify(space);
  const a = deriveGeometryFromSpace(space);
  const b = deriveGeometryFromSpace(space);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(space), before);
});
