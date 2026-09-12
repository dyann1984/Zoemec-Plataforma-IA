import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectUpAxis, detectGeometryAtypical, diagnoseModel3D, ORIENTATION_STATUS, GEOMETRY_STATUS, MATERIALS_STATUS, NORMALS_STATUS, SCALE_STATUS } from './model3dDiagnostics.js';

// Caso real que motivo este modulo (casa_toledo_desde_plano.glb, valores
// redondeados del archivo real diagnosticado): 2 mallas que en los DATOS
// se apilan en Z (Planta_Baja Z:[-0.12,2.8], Planta_Alta Z:[2.88,5.8], casi
// sin hueco) y comparten casi toda la huella en Y, pero el archivo esta
// empaquetado como glTF (Y-up por especificacion) sin haber convertido los
// ejes -- por eso Three.js lo interpreta con Y como vertical, no Z.
const CASA_TOLEDO_GROUPS = [
  { name: 'Planta_Baja', min: [0, -8.774, -0.12], max: [4.464, 0, 2.8] },
  { name: 'Planta_Alta', min: [5.464, -8.773, 2.88], max: [10.036, 0, 5.8] }
];

test('detectUpAxis: detecta Z como vertical real en el caso casa_toledo (2 pisos apilados en Z, huella compartida en Y)', () => {
  const result = detectUpAxis(CASA_TOLEDO_GROUPS);
  assert.equal(result.axis, 'z');
  assert.equal(result.confidence, 'alta');
});

test('detectUpAxis: un modelo normal Y-up (2 pisos apilados en Y) se detecta como valido, nunca se corrige de mas', () => {
  const groups = [
    { name: 'PlantaBaja', min: [0, 0, 0], max: [5, 2.8, 4] },
    { name: 'PlantaAlta', min: [0, 2.85, 0], max: [5, 5.7, 4] }
  ];
  const result = detectUpAxis(groups);
  assert.equal(result.axis, 'y');
  assert.equal(result.confidence, 'alta');
});

test('detectUpAxis: una unica malla con proporciones tipo "caja alta" (Y claramente la mas chica y plausible) se acepta como valida', () => {
  const groups = [{ name: 'unico', min: [0, 0, 0], max: [8, 3, 6] }];
  const result = detectUpAxis(groups);
  assert.equal(result.axis, 'y');
});

test('detectUpAxis: sin evidencia clara (una unica malla cubica), nunca declara confianza alta en un eje distinto de Y', () => {
  const groups = [{ name: 'unico', min: [0, 0, 0], max: [5, 5, 5] }];
  const result = detectUpAxis(groups);
  assert.equal(result.confidence, 'baja');
});

test('detectUpAxis: sin mallas, cae al valor por defecto (Y, confianza baja) en vez de lanzar', () => {
  const result = detectUpAxis([]);
  assert.equal(result.axis, 'y');
  assert.equal(result.confidence, 'baja');
});

test('detectGeometryAtypical: el caso casa_toledo (huella en X sin traslape entre pisos) se marca atipico', () => {
  const result = detectGeometryAtypical(CASA_TOLEDO_GROUPS, 'z');
  assert.equal(result.atypical, true);
  assert.equal(result.reason, 'huella_sin_traslape');
});

test('detectGeometryAtypical: pisos correctamente alineados (misma huella X/Y, solo cambia Z) nunca se marca atipico', () => {
  const groups = [
    { name: 'PlantaBaja', min: [0, 0, 0], max: [5, 4, 2.8] },
    { name: 'PlantaAlta', min: [0, 0, 2.85], max: [5, 4, 5.7] }
  ];
  const result = detectGeometryAtypical(groups, 'z');
  assert.equal(result.atypical, false);
});

test('detectGeometryAtypical: una unica malla nunca se marca atipica (nada que comparar)', () => {
  const result = detectGeometryAtypical([{ name: 'unico', min: [0, 0, 0], max: [5, 5, 5] }], 'y');
  assert.equal(result.atypical, false);
});

test('diagnoseModel3D: caso casa_toledo completo -- orientacion corregida (Z detectado), geometria atipica, sin materiales, normales corregidas', () => {
  const result = diagnoseModel3D({ formatId: 'glb', groups: CASA_TOLEDO_GROUPS, hasRealMaterials: false, anyNormalsWereMissing: true });
  assert.equal(result.orientation.status, ORIENTATION_STATUS.CORRECTED);
  assert.equal(result.orientation.detectedAxis, 'z');
  assert.equal(result.rotationCorrection, 'z');
  assert.equal(result.geometry.status, GEOMETRY_STATUS.ATYPICAL);
  assert.equal(result.materials.status, MATERIALS_STATUS.MISSING);
  assert.equal(result.normals.status, NORMALS_STATUS.CORRECTED);
  assert.equal(result.scale.status, SCALE_STATUS.CONFIRMED);
});

test('diagnoseModel3D: OBJ nunca declara escala confirmada (el formato no trae unidades)', () => {
  const result = diagnoseModel3D({ formatId: 'obj', groups: [{ name: 'unico', min: [0, 0, 0], max: [5, 3, 4] }], hasRealMaterials: false, anyNormalsWereMissing: false });
  assert.equal(result.scale.status, SCALE_STATUS.UNKNOWN);
});

test('diagnoseModel3D: modelo sano (Y-up, huella compartida, con materiales reales, normales originales) reporta todo valido/sin corregir', () => {
  const groups = [
    { name: 'PlantaBaja', min: [0, 0, 0], max: [5, 2.8, 4] },
    { name: 'PlantaAlta', min: [0, 2.85, 0], max: [5, 5.7, 4] }
  ];
  const result = diagnoseModel3D({ formatId: 'glb', groups, hasRealMaterials: true, anyNormalsWereMissing: false });
  assert.equal(result.orientation.status, ORIENTATION_STATUS.VALID);
  assert.equal(result.rotationCorrection, null);
  assert.equal(result.geometry.status, GEOMETRY_STATUS.VALID);
  assert.equal(result.materials.status, MATERIALS_STATUS.VALID);
  assert.equal(result.normals.status, NORMALS_STATUS.VALID);
});
