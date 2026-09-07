import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANNED_FUTURE_FORMATS, MAX_IMPORT_FILE_SIZE_BYTES,
  getImportFormatByFileName, validateImportFile, isImportFormatAvailable
} from './levantamientoImporters.js';

test('getImportFormatByFileName reconoce .glb/.gltf/.obj sin importar mayusculas', () => {
  assert.equal(getImportFormatByFileName('modelo.glb').id, 'glb');
  assert.equal(getImportFormatByFileName('MODELO.GLB').id, 'glb');
  assert.equal(getImportFormatByFileName('escena.gltf').id, 'gltf');
  assert.equal(getImportFormatByFileName('cuarto.OBJ').id, 'obj');
});

test('getImportFormatByFileName regresa null para una extension desconocida', () => {
  assert.equal(getImportFormatByFileName('plano.pdf'), null);
  assert.equal(getImportFormatByFileName('sin_extension'), null);
  assert.equal(getImportFormatByFileName(''), null);
});

test('validateImportFile acepta un archivo con formato y tamano validos', () => {
  const result = validateImportFile({ name: 'sala.glb', size: 10 * 1024 * 1024 });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.format.id, 'glb');
});

test('validateImportFile rechaza una extension no reconocida', () => {
  const result = validateImportFile({ name: 'plano.dwg', size: 1000 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('formato_no_reconocido'));
  assert.equal(result.format, null);
});

test('validateImportFile rechaza un archivo que excede MAX_IMPORT_FILE_SIZE_BYTES', () => {
  const result = validateImportFile({ name: 'modelo.glb', size: MAX_IMPORT_FILE_SIZE_BYTES + 1 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('excede_tamano_maximo'));
  assert.equal(result.format.id, 'glb');
});

test('validateImportFile acepta exactamente MAX_IMPORT_FILE_SIZE_BYTES (limite inclusivo)', () => {
  const result = validateImportFile({ name: 'modelo.glb', size: MAX_IMPORT_FILE_SIZE_BYTES });
  assert.equal(result.valid, true);
});

test('validateImportFile rechaza tamano invalido (cero, negativo, no numerico)', () => {
  assert.equal(validateImportFile({ name: 'modelo.glb', size: 0 }).valid, false);
  assert.equal(validateImportFile({ name: 'modelo.glb', size: -5 }).valid, false);
  assert.equal(validateImportFile({ name: 'modelo.glb', size: NaN }).valid, false);
  assert.equal(validateImportFile({ name: 'modelo.glb' }).valid, false);
});

test('validateImportFile nunca depende de format.status -- esa es responsabilidad de isImportFormatAvailable, un check separado', () => {
  // El archivo en si (extension+tamano) es una pregunta distinta de si la
  // FEATURE ya esta activada -- no importa si SURVEY_IMPORT_FORMATS trae
  // status:'planned' o 'available' en un momento dado del proyecto, un
  // .glb bien formado siempre debe validarse como archivo correcto.
  const result = validateImportFile({ name: 'modelo.glb', size: 1000 });
  assert.equal(result.valid, true);
  assert.equal(typeof isImportFormatAvailable('glb'), 'boolean');
});

test('ningun id de PLANNED_FUTURE_FORMATS es aceptado por validateImportFile (fuera de alcance de Fase 2A)', () => {
  PLANNED_FUTURE_FORMATS.forEach(future => {
    const fakeName = `archivo.${future.id}`;
    const result = validateImportFile({ name: fakeName, size: 1000 });
    assert.equal(result.valid, false, `${future.id} no deberia validarse como formato soportado`);
  });
});
