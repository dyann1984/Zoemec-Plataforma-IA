/* Prueba readInitialTheme() aislada, mockeando localStorage/window bajo
   node --test (sin navegador). Cubre: persistencia, y default 'light'
   deliberado cuando no hay preferencia guardada -- prefers-color-scheme
   del sistema ya NO se sigue en la primera visita (cambio pedido
   explicitamente: "modo claro por defecto"), asi que los mocks de
   prefersDark en las pruebas de abajo confirman que se ignora, no que se
   respeta. */
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

test('sin preferencia guardada, IGNORA prefers-color-scheme:dark del sistema y usa light', () => {
  withGlobals({ prefersDark: true }, () => {
    assert.equal(readInitialTheme(), 'light');
  });
});

test('sin preferencia guardada y prefers-color-scheme:light -> light (mismo resultado, el sistema no se consulta)', () => {
  withGlobals({ prefersDark: false }, () => {
    assert.equal(readInitialTheme(), 'light');
  });
});

test('valor guardado invalido (corrupto) se ignora y cae a light, sin consultar el sistema', () => {
  withGlobals({ stored: 'sepia', prefersDark: true }, () => {
    assert.equal(readInitialTheme(), 'light');
  });
});
