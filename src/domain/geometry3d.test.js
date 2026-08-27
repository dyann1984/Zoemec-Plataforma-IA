import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveGeometryFromApu, applyManualDimensions } from './geometry3d.js';

test('deriveGeometryFromApu: sin cantidadObra es REQUIERE_VALIDACION, nunca fabrica geometria', () => {
  const result = deriveGeometryFromApu({ primaryActivity: 'piso', unit: 'm²', cantidadObra: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'REQUIERE_VALIDACION');
  assert.ok(result.missing.includes('cantidadObra'));
});

test('deriveGeometryFromApu: unidad no soportada (no m²) es REQUIERE_VALIDACION', () => {
  const result = deriveGeometryFromApu({ primaryActivity: 'piso', unit: 'jor', cantidadObra: 10 });
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('unidad_no_soportada'));
});

test('deriveGeometryFromApu: disciplina sin modelo 3D soportado es REQUIERE_VALIDACION explicito, no una caja generica', () => {
  const result = deriveGeometryFromApu({ primaryActivity: 'acero', unit: 'm²', cantidadObra: 10 });
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('disciplina_no_soportada_para_3d'));
});

test('deriveGeometryFromApu (piso): footprint cuadrado de igual area, espesor null si el concepto no lo declara (nunca un valor inventado)', () => {
  const result = deriveGeometryFromApu({ primaryActivity: 'piso', unit: 'm²', cantidadObra: 64, variables: {} });
  assert.equal(result.ok, true);
  const el = result.elements[0];
  assert.equal(el.type, 'floor');
  assert.equal(el.dimensions.width, 8);
  assert.equal(el.dimensions.depth, 8);
  assert.equal(el.dimensions.thickness, null);
  assert.deepEqual(el.missingDimensions, ['thickness']);
  assert.equal(result.requiresManualInput, true);
});

test('deriveGeometryFromApu (piso): con espesor real en variables, no queda pendiente ninguna dimension', () => {
  const result = deriveGeometryFromApu({ primaryActivity: 'piso', unit: 'm²', cantidadObra: 64, variables: { thickness: 5, thicknessUnit: 'cm' } });
  const el = result.elements[0];
  assert.equal(el.dimensions.thickness, 0.05);
  assert.deepEqual(el.missingDimensions, []);
  assert.equal(result.requiresManualInput, false);
});

test('deriveGeometryFromApu (plafon): footprint cuadrado de igual area, espesor pendiente si el concepto no lo declara (caso minimo pedido por el usuario: piso/muro/plafon/info insuficiente)', () => {
  const result = deriveGeometryFromApu({ primaryActivity: 'plafon_suspendido', unit: 'm²', cantidadObra: 38, variables: {} });
  assert.equal(result.ok, true);
  const el = result.elements[0];
  assert.equal(el.type, 'ceiling');
  assert.ok(el.dimensions.width > 0 && el.dimensions.depth > 0);
  assert.deepEqual(el.missingDimensions, ['thickness']);
});

test('deriveGeometryFromApu (muro/block): area real del APU, altura y espesor pendientes si el concepto no los declara', () => {
  const result = deriveGeometryFromApu({ primaryActivity: 'block', unit: 'm²', cantidadObra: 30, variables: {} });
  const el = result.elements[0];
  assert.equal(el.type, 'wall');
  assert.equal(el.dimensions.area, 30);
  assert.equal(el.dimensions.width, null);
  assert.equal(el.dimensions.height, null);
  assert.deepEqual(el.missingDimensions.sort(), ['height', 'thickness']);
});

test('deriveGeometryFromApu (muro/block): con altura real, deriva el ancho matematicamente (area/altura)', () => {
  const result = deriveGeometryFromApu({ primaryActivity: 'block', unit: 'm²', cantidadObra: 30, variables: { height: 3, heightUnit: 'm' } });
  const el = result.elements[0];
  assert.equal(el.dimensions.height, 3);
  assert.equal(el.dimensions.width, 10);
});

test('applyManualDimensions: completa una dimension pendiente y recalcula el ancho de un muro', () => {
  const base = deriveGeometryFromApu({ primaryActivity: 'block', unit: 'm²', cantidadObra: 30, variables: {} }).elements[0];
  const updated = applyManualDimensions(base, { height: 2.5, thickness: 0.15 });
  assert.equal(updated.dimensions.height, 2.5);
  assert.equal(updated.dimensions.thickness, 0.15);
  assert.equal(updated.dimensions.width, 12); // 30 / 2.5
  assert.deepEqual(updated.missingDimensions, []);
});

test('applyManualDimensions: ignora valores invalidos (0, negativos, no numericos) en vez de corromper la geometria', () => {
  const base = deriveGeometryFromApu({ primaryActivity: 'piso', unit: 'm²', cantidadObra: 20, variables: {} }).elements[0];
  const updated = applyManualDimensions(base, { thickness: -1 });
  assert.equal(updated.dimensions.thickness, null);
  assert.deepEqual(updated.missingDimensions, ['thickness']);
});
