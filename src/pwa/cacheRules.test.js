/* Prueba la logica de enrutamiento del Service Worker (espejo de
   public/sw.js -- ver comentario en cacheRules.js sobre por que no es un
   import literal). La regla mas critica: /api/* JAMAS debe resultar en
   una estrategia de cache, bajo ninguna combinacion de argumentos. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSameOriginGet, isApiPath, isAssetPath, isImagePath, strategyFor } from './cacheRules.js';

test('isSameOriginGet: false para POST (nunca se cachea, aunque sea mismo origen)', () => {
  assert.equal(isSameOriginGet('POST', 'https://zoemecia.com/api/apus', 'https://zoemecia.com'), false);
});

test('isSameOriginGet: false para GET cross-origin (ej. Firebase Auth/Google) -- el SW nunca los toca', () => {
  assert.equal(isSameOriginGet('GET', 'https://identitytoolkit.googleapis.com/v1/accounts', 'https://zoemecia.com'), false);
});

test('isSameOriginGet: true para GET del mismo origen', () => {
  assert.equal(isSameOriginGet('GET', 'https://zoemecia.com/assets/index-abc123.js', 'https://zoemecia.com'), true);
});

test('isApiPath / isAssetPath / isImagePath clasifican las rutas correctamente', () => {
  assert.equal(isApiPath('/api/apus'), true);
  assert.equal(isApiPath('/assets/index.js'), false);
  assert.equal(isAssetPath('/assets/index-abc.js'), true);
  assert.equal(isAssetPath('/api/apus'), false);
  assert.equal(isImagePath('/images/hero/foo.webp'), true);
  assert.equal(isImagePath('/api/apus'), false);
});

test('strategyFor: /api/* SIEMPRE es network-only, sea o no navegacion (regla critica)', () => {
  assert.equal(strategyFor('/api/apus', false), 'network-only');
  assert.equal(strategyFor('/api/apus', true), 'network-only');
  assert.equal(strategyFor('/api/generate-apu', false), 'network-only');
});

test('strategyFor: una navegacion (HTML de la SPA) es network-first', () => {
  assert.equal(strategyFor('/', true), 'network-first');
  assert.equal(strategyFor('/index.html', true), 'network-first');
});

test('strategyFor: assets con hash de Vite son cache-first (inmutables por nombre)', () => {
  assert.equal(strategyFor('/assets/index-abc123.js', false), 'cache-first');
});

test('strategyFor: imagenes son stale-while-revalidate', () => {
  assert.equal(strategyFor('/images/hero/zoemec-hero-web.webp', false), 'stale-while-revalidate');
});

test('strategyFor: cualquier otra ruta pasa de largo (passthrough), no se intercepta', () => {
  assert.equal(strategyFor('/manifest.webmanifest', false), 'passthrough');
  assert.equal(strategyFor('/sw.js', false), 'passthrough');
});
