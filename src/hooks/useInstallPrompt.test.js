/* Prueba las funciones de deteccion puras de useInstallPrompt.js
   (detectIOSSafari/detectStandalone) mockeando navigator/window bajo
   node --test. NO prueba el hook useInstallPrompt() en si (usa
   useState/useEffect de React; este proyecto no tiene renderHook/jsdom
   configurado -- ver reporte, marcado como NOT VERIFIED via test). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectIOSSafari, detectStandalone } from './useInstallPrompt.js';

// Node 21+ define globalThis.navigator como getter de solo lectura (para
// la API fetch) -- una asignacion directa truena con TypeError. Hay que
// redefinir la propiedad para poder mockearla en el test.
function withNavigator(nav, fn){
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  try{ fn(); }
  finally{
    if(original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
}
function withWindow(win, fn){
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });
  try{ fn(); }
  finally{
    if(original) Object.defineProperty(globalThis, 'window', original);
    else delete globalThis.window;
  }
}

test('detectIOSSafari: true para iPhone con Safari real', () => {
  withNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 }, () => {
    assert.equal(detectIOSSafari(), true);
  });
});

test('detectIOSSafari: false para Chrome en iOS (CriOS) -- no es Safari real aunque diga "Safari" en el UA', () => {
  withNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/119.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 }, () => {
    assert.equal(detectIOSSafari(), false);
  });
});

test('detectIOSSafari: false para Android Chrome', () => {
  withNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Mobile Safari/537.36', platform: 'Linux armv8l', maxTouchPoints: 5 }, () => {
    assert.equal(detectIOSSafari(), false);
  });
});

test('detectIOSSafari: false para desktop (Windows/Chrome)', () => {
  withNavigator({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36', platform: 'Win32', maxTouchPoints: 0 }, () => {
    assert.equal(detectIOSSafari(), false);
  });
});

test('detectStandalone: true si matchMedia(display-mode: standalone) coincide', () => {
  withWindow({ matchMedia: () => ({ matches: true }), navigator: {} }, () => {
    assert.equal(detectStandalone(), true);
  });
});

test('detectStandalone: true si navigator.standalone (bandera legada de iOS)', () => {
  withWindow({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } }, () => {
    assert.equal(detectStandalone(), true);
  });
});

test('detectStandalone: false en una pestana normal de navegador', () => {
  withWindow({ matchMedia: () => ({ matches: false }), navigator: {} }, () => {
    assert.equal(detectStandalone(), false);
  });
});
