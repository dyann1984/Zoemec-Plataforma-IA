import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyAssetComponent, validateAssetComponent, computeWarrantyStatus, ASSET_COMPONENT_TYPE, WARRANTY_STATUS } from './assetComponentSchema.js';

test('makeEmptyAssetComponent es valido solo con tipo+nombre -- todo lo demas es opcional, nunca inventado', () => {
  const c = makeEmptyAssetComponent({ assetId: 'AST-1', tipo: ASSET_COMPONENT_TYPE.HVAC, nombre: 'Aire acondicionado central' });
  assert.equal(validateAssetComponent(c).valid, true);
  assert.equal(c.fabricante, null);
  assert.equal(c.garantiaVigenciaHasta, null);
});

test('garantiaVigenciaHasta se DERIVA de fechaInstalacion + garantiaMeses cuando no se declara explicita', () => {
  const c = makeEmptyAssetComponent({ assetId: 'AST-1', tipo: ASSET_COMPONENT_TYPE.BOMBAS, nombre: 'Bomba', fechaInstalacion: '2026-01-15T00:00:00.000Z', garantiaMeses: 12 });
  assert.equal(c.garantiaVigenciaHasta.slice(0, 10), '2027-01-15');
});

test('garantiaVigenciaHasta explicita nunca se sobreescribe con el calculo derivado', () => {
  const c = makeEmptyAssetComponent({ assetId: 'AST-1', tipo: ASSET_COMPONENT_TYPE.BOMBAS, nombre: 'Bomba', fechaInstalacion: '2026-01-15T00:00:00.000Z', garantiaMeses: 12, garantiaVigenciaHasta: '2030-06-01T00:00:00.000Z' });
  assert.equal(c.garantiaVigenciaHasta, '2030-06-01T00:00:00.000Z');
});

test('validateAssetComponent exige assetId, tipo valido y nombre', () => {
  const base = makeEmptyAssetComponent({ assetId: 'AST-1', tipo: ASSET_COMPONENT_TYPE.ESTRUCTURA, nombre: 'x' });
  assert.equal(validateAssetComponent({ ...base, assetId: null }).valid, false);
  assert.equal(validateAssetComponent({ ...base, tipo: 'INVENTADO' }).valid, false);
  assert.equal(validateAssetComponent({ ...base, nombre: null }).valid, false);
});

test('computeWarrantyStatus: sin garantiaVigenciaHasta -> SIN_DATOS', () => {
  assert.deepEqual(computeWarrantyStatus({}), { warrantyStatus: WARRANTY_STATUS.SIN_DATOS, diasRestantes: null });
});

test('computeWarrantyStatus: vigente, por vencer (<=60 dias) y vencida (dias negativos)', () => {
  const now = '2026-06-01T00:00:00.000Z';
  const vigente = computeWarrantyStatus({ garantiaVigenciaHasta: '2027-01-01T00:00:00.000Z' }, now);
  assert.equal(vigente.warrantyStatus, WARRANTY_STATUS.VIGENTE);

  const porVencer = computeWarrantyStatus({ garantiaVigenciaHasta: '2026-06-20T00:00:00.000Z' }, now);
  assert.equal(porVencer.warrantyStatus, WARRANTY_STATUS.POR_VENCER);
  assert.equal(porVencer.diasRestantes, 19);

  const vencida = computeWarrantyStatus({ garantiaVigenciaHasta: '2026-05-01T00:00:00.000Z' }, now);
  assert.equal(vencida.warrantyStatus, WARRANTY_STATUS.VENCIDA);
  assert.ok(vencida.diasRestantes < 0);
});
