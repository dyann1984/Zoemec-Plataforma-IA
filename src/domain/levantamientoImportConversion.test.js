import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeUniformScaleFactor, deriveSpaceFromImportedModel, buildSurveyImportMeta
} from './levantamientoImportConversion.js';

const close = (actual, expected, epsilon = 1e-9) => Math.abs(actual - expected) < epsilon;

test('computeUniformScaleFactor calcula factor = medida real / medida leida (caso valido)', () => {
  const result = computeUniformScaleFactor({ measuredLength: 250, knownLength: 2.5 });
  assert.equal(result.ok, true);
  assert.ok(close(result.factor, 0.01), `factor esperado 0.01, obtuvo ${result.factor}`);
});

test('computeUniformScaleFactor factor 1 cuando la medida leida ya coincide con la real', () => {
  const result = computeUniformScaleFactor({ measuredLength: 4, knownLength: 4 });
  assert.equal(result.ok, true);
  assert.ok(close(result.factor, 1));
});

test('computeUniformScaleFactor rechaza medida leida cero/negativa/no numerica', () => {
  assert.equal(computeUniformScaleFactor({ measuredLength: 0, knownLength: 3 }).ok, false);
  assert.equal(computeUniformScaleFactor({ measuredLength: -1, knownLength: 3 }).ok, false);
  assert.equal(computeUniformScaleFactor({ measuredLength: NaN, knownLength: 3 }).ok, false);
  assert.equal(computeUniformScaleFactor({ knownLength: 3 }).ok, false);
});

test('computeUniformScaleFactor rechaza medida real cero/negativa/no numerica', () => {
  assert.equal(computeUniformScaleFactor({ measuredLength: 5, knownLength: 0 }).ok, false);
  assert.equal(computeUniformScaleFactor({ measuredLength: 5, knownLength: -2 }).ok, false);
  assert.equal(computeUniformScaleFactor({ measuredLength: 5, knownLength: NaN }).ok, false);
  assert.equal(computeUniformScaleFactor({ measuredLength: 5 }).ok, false);
});

test('deriveSpaceFromImportedModel mapea bounding box (x->largo,z->ancho,y->alto) con factor 1 (caso GLB/GLTF ya en metros)', () => {
  const space = deriveSpaceFromImportedModel({ boundingBoxSize: { x: 8, y: 3, z: 6 }, scaleFactor: 1, name: 'Importado' });
  assert.equal(space.name, 'Importado');
  assert.ok(close(space.length, 8));
  assert.ok(close(space.width, 6));
  assert.ok(close(space.height, 3));
  assert.deepEqual(space.elements, []);
  assert.ok(space.id.startsWith('SPC-'));
});

test('deriveSpaceFromImportedModel aplica un factor de escala distinto de 1 (caso OBJ con medida conocida)', () => {
  // Modelo leido en centimetros (factor 0.01 -> metros).
  const space = deriveSpaceFromImportedModel({ boundingBoxSize: { x: 800, y: 300, z: 600 }, scaleFactor: 0.01 });
  assert.ok(close(space.length, 8));
  assert.ok(close(space.width, 6));
  assert.ok(close(space.height, 3));
});

test('deriveSpaceFromImportedModel nunca produce dimensiones negativas ni NaN (bounding box degenerado)', () => {
  const space = deriveSpaceFromImportedModel({ boundingBoxSize: { x: -5, y: NaN, z: 0 }, scaleFactor: 1 });
  assert.ok(space.length >= 0 && Number.isFinite(space.length));
  assert.ok(space.width >= 0 && Number.isFinite(space.width));
  assert.ok(space.height >= 0 && Number.isFinite(space.height));
});

test('deriveSpaceFromImportedModel cae a factor 1 si scaleFactor es invalido (cero/negativo) en vez de romper el Space', () => {
  const space = deriveSpaceFromImportedModel({ boundingBoxSize: { x: 4, y: 2, z: 3 }, scaleFactor: 0 });
  assert.ok(close(space.length, 4));
  assert.ok(close(space.width, 3));
  assert.ok(close(space.height, 2));
});

test('buildSurveyImportMeta produce un objeto plano y JSON-safe con los valores recibidos', () => {
  const meta = buildSurveyImportMeta({
    sourceFormat: 'glb', fileName: 'sala.glb', fileSizeBytes: 12345,
    meshCount: 7, triangleCount: 15000, scaleFactor: 1, importedAt: 1700000000000
  });
  assert.deepEqual(meta, {
    sourceFormat: 'glb', fileName: 'sala.glb', fileSizeBytes: 12345,
    meshCount: 7, triangleCount: 15000, scaleFactor: 1, importedAt: 1700000000000
  });
  assert.doesNotThrow(() => JSON.stringify(meta));
});

test('buildSurveyImportMeta sanea valores faltantes/invalidos a defaults seguros', () => {
  const meta = buildSurveyImportMeta({});
  assert.equal(meta.sourceFormat, null);
  assert.equal(meta.fileName, '');
  assert.equal(meta.fileSizeBytes, 0);
  assert.equal(meta.meshCount, 0);
  assert.equal(meta.triangleCount, 0);
  assert.equal(meta.scaleFactor, 1);
  assert.ok(Number.isFinite(meta.importedAt));
  assert.doesNotThrow(() => JSON.stringify(meta));
});
