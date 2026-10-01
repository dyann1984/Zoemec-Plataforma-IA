import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptySpace, makeEmptyElement, ELEMENT_TYPE } from './levantamientoSchema.js';
import { computeWallMetrics, updateWall, findElement } from './cadModel.js';
import { surveyToCadModel, surveyPlanoKey } from './surveyToCadModel.js';

/* Caso obligatorio del brief §39: muro 4.85 x 2.70 x 0.12 con ventana
   1.50 x 1.20 -> bruta 13.095, huecos 1.80, neta 11.295. */
function makeBriefSpace(){
  const space = makeEmptySpace({ name: 'Recamara', length: 4.85, width: 3.00, height: 2.70 });
  space.id = 'SPC-brief';
  const win = makeEmptyElement({
    type: ELEMENT_TYPE.WINDOW, width: 1.50, height: 1.20, quantity: 1,
    wallId: 'M-01', offset: 1.5, sillHeight: 0.9
  });
  win.id = 'ELM-win-1';
  space.elements = [win];
  return space;
}

test('surveyToCadModel: deriva 4 muros con IDs canonicos M-01..M-04 y espesor 0.12', () => {
  const { model, wallIdMap } = surveyToCadModel(makeBriefSpace(), { wallThickness: 0.12 });
  assert.equal(model.walls.length, 4);
  assert.deepEqual(model.walls.map(w => w.id), ['M-01', 'M-02', 'M-03', 'M-04']);
  assert.equal(wallIdMap['M-01'], 'M-01');
  model.walls.forEach(w => assert.equal(w.thickness, 0.12));
});

test('surveyToCadModel: cuantificacion del muro M-01 con ventana 1.50x1.20 = 13.095/1.80/11.295', () => {
  const { model } = surveyToCadModel(makeBriefSpace(), { wallThickness: 0.12 });
  const m = computeWallMetrics(model, 'M-01');
  assert.equal(m.length, 4.85);
  assert.equal(m.height, 2.7);
  assert.equal(m.thickness, 0.12);
  assert.equal(m.grossArea, 13.095);
  assert.equal(m.openingsArea, 1.8);
  assert.equal(m.netArea, 11.295);
});

test('surveyToCadModel: al cambiar longitud del muro a 5.30 -> bruta 14.31, neta 12.51, sin perder la ventana', () => {
  const { model } = surveyToCadModel(makeBriefSpace(), { wallThickness: 0.12 });
  const before = computeWallMetrics(model, 'M-01');
  assert.equal(before.netArea, 11.295);
  assert.equal(model.openings.length, 1);
  const winId = model.openings[0].id;

  const next = updateWall(model, 'M-01', { length: 5.30 });
  const after = computeWallMetrics(next, 'M-01');
  assert.equal(after.length, 5.3);
  assert.equal(after.grossArea, 14.31);
  assert.equal(after.openingsArea, 1.8); // hueco intacto
  assert.equal(after.netArea, 12.51);
  assert.equal(next.openings.length, 1);
  assert.equal(next.openings[0].id, winId);      // MISMO id
  assert.equal(next.openings[0].wallId, 'M-01'); // sigue en el mismo muro
});

test('surveyToCadModel: IDs (walls/opening/space) persisten estables tras editar geometria', () => {
  const { model, spaceId, openingIdMap } = surveyToCadModel(makeBriefSpace(), { wallThickness: 0.12 });
  const wallIdBefore = model.walls[0].id;
  const openingIdBefore = model.openings[0].id;
  const openingSourceRef = model.openings[0].sourceElementId; // ELM-win-1

  const edited = updateWall(model, 'M-01', { length: 6.0, thickness: 0.15 });
  assert.equal(edited.walls[0].id, wallIdBefore, 'wall id debe ser estable');
  assert.equal(edited.openings[0].id, openingIdBefore, 'opening id debe ser estable');
  assert.equal(edited.openings[0].sourceElementId, openingSourceRef, 'source element id debe conservarse');
  assert.equal(findElement(edited, spaceId)?.element?.name, 'Recamara');
  assert.equal(openingIdMap['ELM-win-1'], openingIdBefore, 'openingIdMap debe apuntar al mismo hueco');
});

test('surveyToCadModel: sourceElementId de cada muro apunta al space.id (trazabilidad hacia Levantamiento)', () => {
  const { model } = surveyToCadModel(makeBriefSpace(), { wallThickness: 0.12 });
  model.walls.forEach(w => assert.equal(w.sourceElementId, 'SPC-brief'));
});

test('surveyToCadModel: espacio (polígono) y cotas se generan (4 cotas por espacio rectangular)', () => {
  const { model } = surveyToCadModel(makeBriefSpace(), { wallThickness: 0.12 });
  assert.equal(model.spaces.length, 1);
  assert.equal(model.spaces[0].points.length, 4);
  assert.equal(model.dimensions.length, 4);
  // Todas ligadas a un muro (ref.kind === 'wall'): se actualizan solas
  model.dimensions.forEach(d => assert.equal(d.ref?.kind, 'wall'));
});

test('surveyToCadModel: 2 ventanas (quantity=2) crean 2 aberturas separadas, no duplican id logico', () => {
  const space = makeEmptySpace({ length: 6.0, width: 4.0, height: 2.7 });
  space.id = 'SPC-2vent';
  const win = makeEmptyElement({
    type: ELEMENT_TYPE.WINDOW, width: 1.20, height: 1.10, quantity: 2,
    wallId: 'M-01', offset: 0.5, sillHeight: 0.9
  });
  space.elements = [win];
  const { model } = surveyToCadModel(space);
  assert.equal(model.openings.length, 2);
  // Ambas comparten sourceElementId (mismo ELM del Levantamiento) pero
  // tienen ids del CAD distintos.
  assert.equal(model.openings[0].sourceElementId, model.openings[1].sourceElementId);
  assert.notEqual(model.openings[0].id, model.openings[1].id);
});

test('surveyToCadModel: opening sin wallId queda en unplaced, no rompe la derivacion', () => {
  const space = makeEmptySpace({ length: 5.0, width: 4.0, height: 2.7 });
  const win = makeEmptyElement({ type: ELEMENT_TYPE.WINDOW, width: 1.2, height: 1.2 });
  space.elements = [win];
  const { model, unplaced } = surveyToCadModel(space);
  assert.equal(model.walls.length, 4);
  assert.equal(model.openings.length, 0);
  assert.equal(unplaced.length, 1);
  assert.equal(unplaced[0].reason, 'sin_muro_asignado');
});

test('surveyToCadModel: opening mas ancho que el muro queda en unplaced', () => {
  const space = makeEmptySpace({ length: 2.0, width: 2.0, height: 2.7 });
  const win = makeEmptyElement({ type: ELEMENT_TYPE.WINDOW, width: 3.0, height: 1.2, wallId: 'M-01' });
  space.elements = [win];
  const { unplaced } = surveyToCadModel(space);
  assert.equal(unplaced.length, 1);
  assert.equal(unplaced[0].reason, 'excede_longitud_del_muro');
});

test('surveyToCadModel: rechaza space sin dimensiones utiles', () => {
  const space = makeEmptySpace({ length: 0, width: 5, height: 2.7 });
  assert.throws(() => surveyToCadModel(space), /largo, ancho y alto/);
});

test('surveyPlanoKey: deterministico para el mismo (surveyId, spaceId)', () => {
  assert.equal(surveyPlanoKey('LEV-abc', 'SPC-1'), 'survey:LEV-abc:SPC-1');
  assert.equal(surveyPlanoKey('LEV-abc', 'SPC-1'), surveyPlanoKey('LEV-abc', 'SPC-1'));
  assert.notEqual(surveyPlanoKey('LEV-abc', 'SPC-1'), surveyPlanoKey('LEV-abc', 'SPC-2'));
  assert.throws(() => surveyPlanoKey(null, 'SPC-1'));
  assert.throws(() => surveyPlanoKey('LEV-abc', null));
});

test('surveyToCadModel: cadModel se serializa a JSON plano y deserializa igual (persistencia round-trip)', () => {
  const { model } = surveyToCadModel(makeBriefSpace(), { wallThickness: 0.12 });
  const roundTrip = JSON.parse(JSON.stringify(model));
  const m = computeWallMetrics(roundTrip, 'M-01');
  assert.equal(m.netArea, 11.295);
  // Muros y aberturas mantienen todos los campos criticos.
  assert.equal(roundTrip.walls.length, 4);
  assert.equal(roundTrip.openings.length, 1);
  assert.equal(roundTrip.openings[0].wallId, 'M-01');
});
