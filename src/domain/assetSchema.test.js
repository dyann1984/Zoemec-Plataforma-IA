import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyAsset, validateAsset, ASSET_STATUS } from './assetSchema.js';

test('makeEmptyAsset arranca ACTIVO y referencia el proyecto/DNA, nunca copia datos del proyecto', () => {
  const asset = makeEmptyAsset({ projectId: 'PRO-1', nombre: 'Torre QA', ubicacion: 'Monterrey', constructionDnaVersion: 'V2' });
  assert.equal(asset.status, ASSET_STATUS.ACTIVO);
  assert.equal(asset.projectId, 'PRO-1');
  assert.equal(asset.constructionDnaVersion, 'V2');
});

test('validateAsset exige projectId y nombre', () => {
  const asset = makeEmptyAsset({ projectId: 'PRO-1', nombre: 'Torre QA' });
  assert.equal(validateAsset(asset).valid, true);
  assert.equal(validateAsset({ ...asset, projectId: null }).valid, false);
  assert.equal(validateAsset({ ...asset, nombre: null }).valid, false);
});
