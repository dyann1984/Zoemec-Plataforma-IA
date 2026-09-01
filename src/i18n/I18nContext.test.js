/* Prueba la logica pura de i18n (i18nStorage.js) aislada bajo node --test:
   persistencia de idioma, resolucion de rutas anidadas, fallback a
   espanol cuando falta una clave, y presencia real de las claves
   criticas ES/EN usadas en la landing/Shell. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readInitialLocale, getByPath, translate, STORAGE_KEY } from './i18nStorage.js';
import { translations } from './translations.js';

function withLocalStorage(stored, fn){
  const original = globalThis.localStorage;
  const store = new Map();
  if(stored !== undefined) store.set(STORAGE_KEY, stored);
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  try{ fn(); } finally{ globalThis.localStorage = original; }
}

test('sin idioma guardado -> "es" por defecto', () => {
  withLocalStorage(undefined, () => {
    assert.equal(readInitialLocale(), 'es');
  });
});

test('idioma guardado valido ("en") se respeta', () => {
  withLocalStorage('en', () => {
    assert.equal(readInitialLocale(), 'en');
  });
});

test('idioma guardado invalido (corrupto) cae a "es"', () => {
  withLocalStorage('fr', () => {
    assert.equal(readInitialLocale(), 'es');
  });
});

test('getByPath resuelve una ruta anidada real del diccionario', () => {
  assert.equal(getByPath(translations.es, 'hero.eyebrow'), 'Plataforma integral de ingeniería de costos');
});

test('getByPath regresa undefined para una ruta que no existe, sin tronar', () => {
  assert.equal(getByPath(translations.es, 'modulo.que.no.existe'), undefined);
});

test('translate() regresa el texto real en EN para una clave existente', () => {
  assert.equal(translate('en', 'nav.comenzarGratis'), 'Start free');
});

test('translate() cae a espanol cuando el locale ni siquiera existe en el diccionario', () => {
  // 'xx' no es un locale valido en translations{} -- ejercita la rama de
  // respaldo real (getByPath sobre un objeto undefined), no un caso
  // artificial de clave faltante.
  assert.equal(translate('xx', 'hero.eyebrow'), translations.es.hero.eyebrow);
});

test('translate() regresa la clave cruda solo si NINGUN idioma la tiene (ultimo recurso)', () => {
  assert.equal(translate('en', 'esto.no.existe.en.ningun.lado'), 'esto.no.existe.en.ningun.lado');
});

test('claves criticas de landing/Shell existen y no estan vacias en ES y EN', () => {
  const criticalKeys = [
    'nav.plataforma', 'nav.iniciarSesion', 'nav.comenzarGratis',
    'hero.eyebrow', 'hero.headlinePre', 'hero.headlineHighlight', 'hero.subtitle',
    'ctas.comenzarGratis', 'ctas.verPlataforma',
    'shell.logout', 'shell.hamburger', 'shell.closeDrawer',
    'shell.menu.inicio', 'shell.menu.apu', 'shell.menu.presupuestos',
    'toggle.themeLight', 'toggle.themeDark',
    'install.button',
    'modules.dashboard.title', 'modules.apu.title', 'modules.presupuestos.title',
    'modules.biblioteca.title', 'modules.takeoff.title',
  ];
  for(const key of criticalKeys){
    for(const locale of ['es', 'en']){
      const value = getByPath(translations[locale], key);
      assert.ok(typeof value === 'string' && value.trim().length > 0, `falta o esta vacia: ${locale}.${key}`);
    }
  }
});

test('ZOEMEC y ZOE nunca se traducen dentro de los strings del diccionario (deben permanecer igual)', () => {
  // No es una prueba de traduccion de la marca -- confirma que donde el
  // texto ES menciona "ZOEMEC"/"ZOE", el texto EN correspondiente los
  // conserva tal cual, sin traducir el nombre propio.
  const pairs = [
    ['hero.subtitle', 'ZOEMEC'],
    ['story.step2Titulo', 'ZOE'],
    ['preview.titulo', 'ZOEMEC'],
  ];
  for(const [key, brand] of pairs){
    const es = getByPath(translations.es, key);
    const en = getByPath(translations.en, key);
    assert.ok(es.includes(brand), `ES ${key} deberia mencionar ${brand}`);
    assert.ok(en.includes(brand), `EN ${key} deberia conservar ${brand} sin traducir`);
  }
});
