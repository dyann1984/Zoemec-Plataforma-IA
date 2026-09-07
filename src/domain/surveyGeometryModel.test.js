import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpaceWalls, resolveOpening, buildWallSegments, buildSpaceGeometryModel, OPENING_WARNING
} from './surveyGeometryModel.js';
import { ELEMENT_TYPE, makeEmptySpace, makeEmptyElement } from './levantamientoSchema.js';

const close = (actual, expected, epsilon = 1e-6) => Math.abs(actual - expected) < epsilon;

test('buildSpaceWalls genera exactamente los 4 muros M-01..M-04 para un espacio 8x8x3, cada uno con longitud/altura/orientacion', () => {
  const walls = buildSpaceWalls(makeEmptySpace({ length: 8, width: 8, height: 3 }));
  assert.equal(walls.length, 4);
  assert.deepEqual(walls.map(w => w.id), ['M-01', 'M-02', 'M-03', 'M-04']);
  walls.forEach(w => assert.ok(close(w.height, 3)));
  assert.ok(close(walls[0].length, 8));
  assert.ok(close(walls[1].length, 8));
  assert.equal(typeof walls[0].angle, 'number');
});

test('buildSpaceWalls produce coordenadas inicial/final correctas y un perimetro cerrado (largo 8, ancho 6)', () => {
  const walls = buildSpaceWalls(makeEmptySpace({ length: 8, width: 6, height: 3 }));
  assert.deepEqual(walls[0].from, { x: 0, y: 0 });
  assert.deepEqual(walls[0].to, { x: 8, y: 0 });
  assert.deepEqual(walls[1].from, { x: 8, y: 0 });
  assert.deepEqual(walls[1].to, { x: 8, y: 6 });
  assert.deepEqual(walls[2].from, { x: 8, y: 6 });
  assert.deepEqual(walls[2].to, { x: 0, y: 6 });
  assert.deepEqual(walls[3].from, { x: 0, y: 6 });
  assert.deepEqual(walls[3].to, { x: 0, y: 0 });
  for(let i = 0; i < walls.length; i++) assert.deepEqual(walls[i].to, walls[(i + 1) % 4].from);
});

test('resolveOpening asigna una puerta a M-01 con el offset explicito exacto (caso valido)', () => {
  const walls = buildSpaceWalls(makeEmptySpace({ length: 8, width: 8, height: 3 }));
  const door = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1, wallId: 'M-01', offset: 1 });
  const placement = resolveOpening(door, walls, 0);
  assert.equal(placement.wallId, 'M-01');
  assert.ok(close(placement.offset, 1));
  assert.deepEqual(placement.warnings, []);
});

test('resolveOpening conserva sillHeight de una ventana y lo regresa sin alterar', () => {
  const walls = buildSpaceWalls(makeEmptySpace({ length: 8, width: 8, height: 3 }));
  const win = makeEmptyElement({ type: ELEMENT_TYPE.WINDOW, width: 2, height: 1.2, wallId: 'M-03', offset: 2, sillHeight: 1 });
  const placement = resolveOpening(win, walls, 0);
  assert.ok(close(placement.sillHeight, 1));
  assert.deepEqual(placement.warnings, []);
});

test('resolveOpening rechaza (marca warning) una abertura mas ancha que su propio muro', () => {
  const walls = buildSpaceWalls(makeEmptySpace({ length: 3, width: 8, height: 3 }));
  const hugeDoor = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 5, height: 2.1, wallId: 'M-01', offset: 0 });
  const placement = resolveOpening(hugeDoor, walls, 0);
  assert.ok(placement.warnings.includes(OPENING_WARNING.EXCEEDS_WALL));
});

test('resolveOpening rechaza (marca warning) un offset explicito que se sale del muro, y lo recorta para poder dibujar algo', () => {
  const walls = buildSpaceWalls(makeEmptySpace({ length: 3, width: 8, height: 3 }));
  const door = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1, wallId: 'M-01', offset: 10 });
  const placement = resolveOpening(door, walls, 0);
  assert.ok(placement.warnings.includes(OPENING_WARNING.OFFSET_OUT_OF_BOUNDS));
  assert.ok(close(placement.offset, 3 - 0.9));
});

test('resolveOpening marca sin_muro_asignado y compatibiliza un levantamiento guardado antes de Fase 1.5 (elemento sin wallId)', () => {
  const walls = buildSpaceWalls(makeEmptySpace({ length: 8, width: 8, height: 3 }));
  const legacyDoor = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1 });
  delete legacyDoor.wallId;
  const p0 = resolveOpening(legacyDoor, walls, 0);
  const p1 = resolveOpening(legacyDoor, walls, 1);
  assert.ok(p0.warnings.includes(OPENING_WARNING.NO_WALL_ASSIGNED));
  assert.equal(p0.wallId, 'M-01');
  assert.equal(p1.wallId, 'M-02');
  assert.ok(close(p0.offset, (8 - 0.9) / 2));
});

test('buildWallSegments teje el muro alrededor del hueco de una puerta sin CSG (dintel arriba, sin pretil porque sillHeight=0)', () => {
  const wall = { id: 'M-01', length: 8, height: 3 };
  const opening = { wallId: 'M-01', offset: 3, width: 0.9, height: 2.1, sillHeight: 0 };
  const segments = buildWallSegments(wall, [opening]);
  // Segmento izquierdo (0..3, piso a techo), dintel sobre la puerta (3..3.9, de 2.1 a 3), segmento derecho (3.9..8, piso a techo)
  assert.equal(segments.length, 3);
  assert.ok(close(segments[0].x0, 0)); assert.ok(close(segments[0].x1, 3)); assert.ok(close(segments[0].yTop, 3));
  assert.ok(close(segments[1].x0, 3)); assert.ok(close(segments[1].x1, 3.9)); assert.ok(close(segments[1].yBase, 2.1));
  assert.ok(close(segments[2].x0, 3.9)); assert.ok(close(segments[2].x1, 8));
});

test('buildWallSegments agrega un segmento de pretil bajo una ventana (sillHeight > 0)', () => {
  const wall = { id: 'M-03', length: 8, height: 3 };
  const opening = { wallId: 'M-03', offset: 2, width: 2, height: 1.2, sillHeight: 1 };
  const segments = buildWallSegments(wall, [opening]);
  // izquierdo, dintel (2.2..3), pretil (0..1), derecho = 4 segmentos
  assert.equal(segments.length, 4);
  const sill = segments.find(s => close(s.yBase, 0) && close(s.yTop, 1));
  assert.ok(sill, 'debe existir un segmento de pretil de 0 a 1m');
});

test('buildSpaceGeometryModel: el area neta de muros sigue siendo 91.71 m2 despues de incorporar posiciones (caso "Local comercial" 8x8x3 + puerta 0.90x2.10 + ventana 2.00x1.20)', () => {
  const door = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1, wallId: 'M-01', offset: 1 });
  const win = makeEmptyElement({ type: ELEMENT_TYPE.WINDOW, width: 2, height: 1.2, wallId: 'M-03', offset: 2, sillHeight: 1 });
  const space = { ...makeEmptySpace({ name: 'Local comercial', length: 8, width: 8, height: 3 }), elements: [door, win] };
  const model = buildSpaceGeometryModel(space);
  assert.ok(close(model.geometry.wallNetArea, 91.71));
  assert.equal(model.walls.length, 4);
  assert.equal(model.openings.length, 2);
});

test('buildSpaceGeometryModel marca OPENINGS_OVERLAP cuando dos aberturas del mismo muro se cruzan, y no rompe la geometria (sin segmentos negativos)', () => {
  // Ejemplo real de QA: puerta M-01 offset=2 width=1.2 (ocupa 2.0-3.2) y
  // ventana M-01 offset=2.5 width=2.0 (ocupa 2.5-4.5) -- se cruzan en 2.5-3.2.
  const door = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 1.2, height: 2.1, wallId: 'M-01', offset: 2 });
  const win = makeEmptyElement({ type: ELEMENT_TYPE.WINDOW, width: 2, height: 1.2, wallId: 'M-01', offset: 2.5, sillHeight: 0.9 });
  const space = { ...makeEmptySpace({ length: 8, width: 8, height: 3 }), elements: [door, win] };
  const model = buildSpaceGeometryModel(space);

  const doorPlacement = model.openings.find(o => o.id === door.id);
  const winPlacement = model.openings.find(o => o.id === win.id);
  assert.ok(doorPlacement.warnings.includes(OPENING_WARNING.OPENINGS_OVERLAP));
  assert.ok(winPlacement.warnings.includes(OPENING_WARNING.OPENINGS_OVERLAP));

  const wallM01 = model.walls.find(w => w.id === 'M-01');
  wallM01.segments.forEach(seg => {
    assert.ok(seg.x1 >= seg.x0, `segmento invalido: x0=${seg.x0} x1=${seg.x1}`);
    assert.ok(seg.yTop >= seg.yBase, `segmento invalido en vertical: yBase=${seg.yBase} yTop=${seg.yTop}`);
  });
  // Nunca dos segmentos de piso a techo que se traslapen entre si (muro duplicado).
  const fullHeight = wallM01.segments.filter(s => close(s.yBase, 0) && close(s.yTop, 3)).sort((a, b) => a.x0 - b.x0);
  for(let i = 1; i < fullHeight.length; i++) assert.ok(fullHeight[i].x0 >= fullHeight[i - 1].x1);
});

test('buildSpaceGeometryModel NO marca OPENINGS_OVERLAP para aberturas del mismo muro que no se cruzan', () => {
  const door = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1, wallId: 'M-01', offset: 1 });
  const win = makeEmptyElement({ type: ELEMENT_TYPE.WINDOW, width: 2, height: 1.2, wallId: 'M-01', offset: 4, sillHeight: 0.9 });
  const space = { ...makeEmptySpace({ length: 8, width: 8, height: 3 }), elements: [door, win] };
  const model = buildSpaceGeometryModel(space);
  model.openings.forEach(o => assert.ok(!o.warnings.includes(OPENING_WARNING.OPENINGS_OVERLAP)));
});

test('buildSpaceGeometryModel NO marca OPENINGS_OVERLAP entre aberturas en muros distintos aunque compartan offset/width', () => {
  const door = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1, wallId: 'M-01', offset: 2 });
  const win = makeEmptyElement({ type: ELEMENT_TYPE.WINDOW, width: 2, height: 1.2, wallId: 'M-03', offset: 2, sillHeight: 0.9 });
  const space = { ...makeEmptySpace({ length: 8, width: 8, height: 3 }), elements: [door, win] };
  const model = buildSpaceGeometryModel(space);
  model.openings.forEach(o => assert.ok(!o.warnings.includes(OPENING_WARNING.OPENINGS_OVERLAP)));
});

test('buildSpaceGeometryModel es determinista y no muta el space recibido', () => {
  const door = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1 });
  const space = { ...makeEmptySpace({ length: 8, width: 8, height: 3 }), elements: [door] };
  const before = JSON.stringify(space);
  const a = buildSpaceGeometryModel(space);
  const b = buildSpaceGeometryModel(space);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(space), before);
});
