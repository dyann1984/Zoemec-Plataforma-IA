import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cmToM, mToCm, m3ToL, lToM3, kgToTon, tonToKg, rebarLinearWeightKgPerM, STEEL_DENSITY_KG_PER_M3 } from './unitConversion.js';

test('cmToM / mToCm son inversas exactas', () => {
  assert.equal(cmToM(250), 2.5);
  assert.equal(mToCm(2.5), 250);
});

test('m3ToL / lToM3 son inversas exactas', () => {
  assert.equal(m3ToL(0.18), 180);
  assert.equal(lToM3(180), 0.18);
});

test('kgToTon / tonToKg son inversas exactas', () => {
  assert.equal(kgToTon(1000), 1);
  assert.equal(tonToKg(1), 1000);
});

test('rebarLinearWeightKgPerM regresa el peso lineal estandar para numeros conocidos', () => {
  assert.equal(rebarLinearWeightKgPerM(4), 0.994);
  assert.equal(rebarLinearWeightKgPerM(6), 2.235);
});

test('rebarLinearWeightKgPerM regresa null para un numero de varilla desconocido, nunca inventa un valor', () => {
  assert.equal(rebarLinearWeightKgPerM(99), null);
});

test('STEEL_DENSITY_KG_PER_M3 es la constante fisica estandar', () => {
  assert.equal(STEEL_DENSITY_KG_PER_M3, 7850);
});
