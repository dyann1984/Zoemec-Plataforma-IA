import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZapataAisladaSketch, buildColumnaSketch, buildMuroSketch, buildElementSketch } from './parametricSketch.js';
import { PARAMETRIC_ELEMENTS } from './parametricElements.js';

function assertValidView(view){
  assert.ok(view.width > 0 && view.height > 0, 'width/height deben ser positivos');
  assert.ok(Array.isArray(view.elements) && view.elements.length > 0);
  view.elements.forEach(el => {
    assert.ok(['rect', 'line', 'text', 'circle'].includes(el.type), `tipo desconocido: ${el.type}`);
    if(el.type === 'rect'){ assert.ok(Number.isFinite(el.x) && Number.isFinite(el.y) && el.w > 0 && el.h > 0); }
    if(el.type === 'circle'){ assert.ok(Number.isFinite(el.cx) && Number.isFinite(el.cy) && el.r > 0); }
    if(el.type === 'line'){ assert.ok([el.x1, el.y1, el.x2, el.y2].every(Number.isFinite)); }
    if(el.type === 'text'){ assert.ok(typeof el.text === 'string' && el.text.length > 0); }
  });
}

test('buildZapataAisladaSketch: regresa Planta + Sección validas con dimensiones reales incluidas como texto', () => {
  const views = buildZapataAisladaSketch({ largo: 1.2, ancho: 1.2, peralte: 0.4 });
  assert.equal(views.length, 2);
  assert.deepEqual(views.map(v => v.id), ['planta', 'seccion']);
  views.forEach(assertValidView);
  const planta = views[0];
  assert.ok(planta.elements.some(el => el.type === 'text' && el.text === '1.20 m'));
});

test('buildZapataAisladaSketch: sin dimensiones (inputs incompletos) regresa arreglo vacio, nunca dibuja con datos inventados', () => {
  assert.deepEqual(buildZapataAisladaSketch({ largo: 1.2 }), []);
  assert.deepEqual(buildZapataAisladaSketch({}), []);
});

test('buildColumnaSketch: regresa Elevación + Sección transversal validas, con tantas varillas/estribos como indican los parametros', () => {
  const views = buildColumnaSketch({ base: 0.3, peralte: 0.3, altura: 3 }, { numVarillasLongitudinales: 4, separacionEstribos: 0.2 });
  assert.equal(views.length, 2);
  assert.deepEqual(views.map(v => v.id), ['elevacion', 'seccion-t']);
  views.forEach(assertValidView);
  const elevacion = views[0];
  const varillas = elevacion.elements.filter(el => el.type === 'line' && el.x1 === el.x2); // lineas verticales = varillas longitudinales
  assert.equal(varillas.length, 4);
});

test('buildColumnaSketch: sin dimensiones regresa arreglo vacio', () => {
  assert.deepEqual(buildColumnaSketch({}, {}), []);
});

test('buildMuroSketch: regresa Elevación esquematica con hiladas de block segun altoBlock/espesorJunta', () => {
  const views = buildMuroSketch({ largo: 4, altura: 2.5, areaVanos: 0 }, { altoBlock: 0.19, espesorJunta: 0.015 });
  assert.equal(views.length, 1);
  assertValidView(views[0]);
  const hiladasEsperadas = Math.round(2.5 / (0.19 + 0.015));
  const lineasHilada = views[0].elements.filter(el => el.type === 'line');
  assert.equal(lineasHilada.length, hiladasEsperadas - 1); // N hiladas = N-1 lineas divisorias
});

test('buildMuroSketch: cuando hay vanos, agrega una NOTA de texto con el area -- nunca dibuja una abertura en una posicion que no se capturo', () => {
  const views = buildMuroSketch({ largo: 4, altura: 2.5, areaVanos: 1.5 }, {});
  const nota = views[0].elements.find(el => el.type === 'text' && el.text.includes('vanos'));
  assert.ok(nota, 'debe existir una nota de texto sobre los vanos');
  assert.ok(nota.text.includes('1.50'));
  assert.ok(nota.text.toLowerCase().includes('no capturada'), 'debe ser honesto sobre no conocer la posicion real');
});

test('buildMuroSketch: sin vanos, no agrega ninguna nota sobre aberturas', () => {
  const views = buildMuroSketch({ largo: 4, altura: 2.5, areaVanos: 0 }, {});
  assert.ok(!views[0].elements.some(el => el.type === 'text' && el.text.includes('vanos')));
});

test('buildElementSketch: nunca puede desincronizarse de los defaults reales de PARAMETRIC_ELEMENTS -- llamar en modo sencillo (params={}) resuelve los MISMOS valores que calculate() usaria', () => {
  const inputs = { base: 0.3, peralte: 0.3, altura: 3 };
  const viaWizardSencillo = buildElementSketch('columna', inputs, {});
  const defaultsReales = Object.fromEntries(PARAMETRIC_ELEMENTS.columna.params.map(p => [p.key, p.default]));
  const viaBuilderDirectoConDefaultsReales = buildColumnaSketch(inputs, defaultsReales);
  assert.deepEqual(viaWizardSencillo, viaBuilderDirectoConDefaultsReales);
});

test('buildElementSketch: despacha al constructor correcto segun elementId, y regresa vacio para un id desconocido (nunca lanza)', () => {
  assert.equal(buildElementSketch('zapata_aislada', { largo: 1, ancho: 1, peralte: 0.4 }, {}).length, 2);
  assert.equal(buildElementSketch('columna', { base: 0.3, peralte: 0.3, altura: 3 }, {}).length, 2);
  assert.equal(buildElementSketch('muro', { largo: 4, altura: 2.5, areaVanos: 0 }, {}).length, 1);
  assert.deepEqual(buildElementSketch('elemento_inexistente', {}, {}), []);
});
