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

test('makeEmptySurvey sin importMeta lo deja en null (regresion del flujo manual, Fase 2A)', () => {
  const survey = makeEmptySurvey({ projectId: 'PRO-ABC', name: 'Levantamiento manual' });
  assert.equal(survey.importMeta, null);
});

test('makeEmptySurvey conserva importMeta intacto para un levantamiento importado (Fase 2A)', () => {
  const importMeta = { sourceFormat: 'glb', fileName: 'sala.glb', fileSizeBytes: 12345, meshCount: 3, triangleCount: 8000, scaleFactor: 1, importedAt: 1700000000000 };
  const survey = makeEmptySurvey({ projectId: 'PRO-ABC', name: 'Levantamiento importado', sourceType: SURVEY_SOURCE_TYPE.IMPORT_3D, importMeta });
  assert.equal(survey.sourceType, SURVEY_SOURCE_TYPE.IMPORT_3D);
  assert.deepEqual(survey.importMeta, importMeta);
});

test('makeEmptySurvey sin scanMedia lo deja en arreglo vacio (regresion del flujo manual/import3d, Fase 2B)', () => {
  const survey = makeEmptySurvey({ projectId: 'PRO-ABC', name: 'Levantamiento manual' });
  assert.deepEqual(survey.scanMedia, []);
});

test('makeEmptySurvey conserva scanMedia intacto para un levantamiento escaneado con celular (Fase 2B)', () => {
  const scanMedia = [{ id: 'MED-1', kind: 'video', storagePath: 'levantamiento-media/u1/LEV-X/video/f1/clip.mp4', mimeType: 'video/mp4', sizeBytes: 5000, durationSeconds: 30, hasAudio: false, capturedAt: 1700000000000 }];
  const survey = makeEmptySurvey({ projectId: 'PRO-ABC', name: 'Levantamiento escaneado', sourceType: SURVEY_SOURCE_TYPE.MOBILE_SCAN, scanMedia });
  assert.equal(survey.sourceType, SURVEY_SOURCE_TYPE.MOBILE_SCAN);
  assert.deepEqual(survey.scanMedia, scanMedia);
});

test('makeEmptySurvey acepta un id pre-generado (necesario para Phone Scan: sube media a Storage antes de guardar el survey)', () => {
  const survey = makeEmptySurvey({ id: 'LEV-PREGEN', projectId: 'PRO-ABC', name: 'Levantamiento escaneado' });
  assert.equal(survey.id, 'LEV-PREGEN');
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
