/* Prueba readInitialTheme() aislada, mockeando localStorage/window bajo
   node --test (sin navegador). Cubre: persistencia, fallback a
   prefers-color-scheme del sistema, y default 'light' cuando no hay
   ninguno de los dos disponible. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readInitialTheme, STORAGE_KEY } from './themeStorage.js';

function withGlobals({ stored, prefersDark } = {}, fn){
  const originalLocalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  const store = new Map();
  if(stored !== undefined) store.set(STORAGE_KEY, stored);
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  if(prefersDark !== undefined){
    globalThis.window = { matchMedia: () => ({ matches: prefersDark }) };
  } else {
    globalThis.window = undefined;
  }
  try{ fn(); }
  finally{
    globalThis.localStorage = originalLocalStorage;
    globalThis.window = originalWindow;
  }
}

test('sin preferencia guardada y sin prefers-color-scheme disponible -> light por defecto', () => {
  withGlobals({}, () => {
    assert.equal(readInitialTheme(), 'light');
  });
});

test('preferencia guardada explicita ("dark") tiene prioridad sobre todo lo demas', () => {
  withGlobals({ stored: 'dark', prefersDark: false }, () => {
    assert.equal(readInitialTheme(), 'dark');
  });
});

test('preferencia guardada explicita ("light") se respeta aunque el sistema prefiera oscuro', () => {
  withGlobals({ stored: 'light', prefersDark: true }, () => {
    assert.equal(readInitialTheme(), 'light');
  });
});

test('sin preferencia guardada, cae a prefers-color-scheme:dark del sistema', () => {
  withGlobals({ prefersDark: true }, () => {
    assert.equal(readInitialTheme(), 'dark');
  });
});

test('sin preferencia guardada y prefers-color-scheme:light -> light', () => {
  withGlobals({ prefersDark: false }, () => {
    assert.equal(readInitialTheme(), 'light');
  });
});

test('valor guardado invalido (corrupto) se ignora y cae al siguiente nivel', () => {
  withGlobals({ stored: 'sepia', prefersDark: true }, () => {
    assert.equal(readInitialTheme(), 'dark');
  });
});
