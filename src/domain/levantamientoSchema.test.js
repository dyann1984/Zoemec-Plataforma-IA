import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SURVEY_SOURCE_TYPE, SURVEY_STATUS, ELEMENT_TYPE,
  makeEmptySurvey, makeEmptySpace, makeEmptyElement,
  validateSurvey, filterSurveysByProject
} from './levantamientoSchema.js';

test('makeEmptySurvey genera un id con prefijo LEV- y estado inicial borrador', () => {
  const survey = makeEmptySurvey({ projectId: 'PRO-ABC', name: 'Levantamiento Local Ecatepec' });
  assert.match(survey.id, /^LEV-/);
  assert.equal(survey.projectId, 'PRO-ABC');
  assert.equal(survey.status, SURVEY_STATUS.DRAFT);
  assert.equal(survey.sourceType, SURVEY_SOURCE_TYPE.MANUAL);
  assert.deepEqual(survey.spaces, []);
});

test('makeEmptySpace genera un id con prefijo SPC- y geometria en cero hasta recalcular', () => {
  const space = makeEmptySpace({ name: 'Local comercial', length: 8, width: 8, height: 3 });
  assert.match(space.id, /^SPC-/);
  assert.equal(space.length, 8);
  assert.equal(space.floorArea, 0);
  assert.deepEqual(space.elements, []);
});

test('makeEmptyElement genera un id con prefijo ELM- y sanea cantidad negativa/no numerica a 1', () => {
  const el = makeEmptyElement({ type: ELEMENT_TYPE.DOOR, width: 0.9, height: 2.1, quantity: 'x' });
  assert.match(el.id, /^ELM-/);
  assert.equal(el.type, ELEMENT_TYPE.DOOR);
  assert.equal(el.quantity, 1);
});

test('ELEMENT_TYPE usa el mismo vocabulario en espanol que TIPOS_ELEMENTO de planoReview.js', () => {
  assert.equal(ELEMENT_TYPE.DOOR, 'puerta');
  assert.equal(ELEMENT_TYPE.WINDOW, 'ventana');
  assert.equal(ELEMENT_TYPE.WALL, 'muro');
  assert.equal(ELEMENT_TYPE.FLOOR, 'piso');
  assert.equal(ELEMENT_TYPE.CEILING, 'plafon');
});

test('validateSurvey exige nombre y proyecto', () => {
  const survey = makeEmptySurvey({ projectId: null, name: '' });
  const result = validateSurvey(survey);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 2);
});

test('validateSurvey acepta un levantamiento bien formado', () => {
  const survey = makeEmptySurvey({ projectId: 'PRO-ABC', name: 'Levantamiento Local Ecatepec' });
  const result = validateSurvey(survey);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('filterSurveysByProject regresa solo los levantamientos del proyecto activo (relacion levantamiento-proyecto)', () => {
  const list = [
    makeEmptySurvey({ projectId: 'PRO-A', name: 'Levantamiento A' }),
    makeEmptySurvey({ projectId: 'PRO-B', name: 'Levantamiento B' }),
    makeEmptySurvey({ projectId: 'PRO-A', name: 'Levantamiento A2' })
  ];
  const scoped = filterSurveysByProject(list, 'PRO-A');
  assert.equal(scoped.length, 2);
  assert.ok(scoped.every(s => s.projectId === 'PRO-A'));
});

test('filterSurveysByProject regresa vacio cuando no hay proyecto activo (projectId null)', () => {
  const list = [makeEmptySurvey({ projectId: 'PRO-A', name: 'Levantamiento A' })];
  assert.deepEqual(filterSurveysByProject(list, null), []);
});
