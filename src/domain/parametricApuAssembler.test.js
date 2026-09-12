import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleAPUFromParametricResult } from './parametricApuAssembler.js';
import { PARAMETRIC_ELEMENTS } from './parametricElements.js';
import { buildBaseAuxiliaries } from './auxiliaries.js';
import { calcAPU } from '../lib/apuCalc.js';

const FAKE_CATALOG = [
  { desc: 'Cemento gris CPC 30R', unidad: 'saco', precio: 245, estado: 'VERIFICADO', tipo: 'material' },
  { desc: 'Arena de río', unidad: 'm³', precio: 470, tipo: 'material' },
  { desc: 'Grava 3/4"', unidad: 'm³', precio: 510, tipo: 'material' }
];

test('assembleAPUFromParametricResult (zapata_aislada): produce un APU con la MISMA forma que uno generado por IA', () => {
  const elementDef = PARAMETRIC_ELEMENTS.zapata_aislada;
  const inputs = { largo: 1.2, ancho: 1.2, peralte: 0.4 };
  const calcResult = elementDef.calculate(inputs, {});
  const apu = assembleAPUFromParametricResult({
    elementDef, inputs, params: {}, calcResult, catalog: FAKE_CATALOG, auxiliaries: buildBaseAuxiliaries()
  });

  // Forma identica a makeAPUFromConcept/standardAPUForConcept
  assert.ok(Array.isArray(apu.materials) && apu.materials.length > 0);
  assert.ok(Array.isArray(apu.labor) && apu.labor.length > 0);
  assert.ok(Array.isArray(apu.equipment));
  apu.materials.forEach(row => assert.equal(row.length, 5));
  apu.labor.forEach(row => assert.equal(row.length, 5));
  apu.equipment.forEach(row => assert.equal(row.length, 4));
  assert.equal(typeof apu.herramienta, 'number');
  assert.equal(typeof apu.indCampo, 'number');
  assert.equal(typeof apu.iva, 'number');
  assert.ok(Array.isArray(apu.aiNotes) && apu.aiNotes.length > 0);

  // Trazabilidad de origen -- aditivo, nunca leido por el resto del motor
  assert.equal(apu.aiGenerated, false);
  assert.equal(apu.parametricGenerated, true);
  assert.equal(apu.parametricSource.elementId, 'zapata_aislada');
  assert.equal(apu.family, elementDef.family);

  // El precio de catalogo real (245) se uso para el cemento, no un precio
  // inventado -- confirma que resolveAuxiliaryCost/findCatalogMatches si
  // se ejecutaron de verdad dentro del ensamblador.
  const cemento = apu.materials.find(r => r[0].toLowerCase().includes('cemento'));
  assert.equal(cemento[3], 245);

  // El motor de calculo v1 real (el que usa la UI/exportacion hoy) corre
  // sobre el resultado sin lanzar, y produce un costo directo positivo.
  const calc = calcAPU(apu);
  assert.ok(calc.direct > 0);
  assert.ok(calc.mat > 0);
  assert.ok(calc.mo > 0);
});

test('assembleAPUFromParametricResult (columna): tambien produce forma valida y corre en calcAPU sin lanzar', () => {
  const elementDef = PARAMETRIC_ELEMENTS.columna;
  const inputs = { base: 0.3, peralte: 0.3, altura: 3 };
  const calcResult = elementDef.calculate(inputs, {});
  const apu = assembleAPUFromParametricResult({
    elementDef, inputs, params: {}, calcResult, catalog: FAKE_CATALOG, auxiliaries: buildBaseAuxiliaries()
  });
  const calc = calcAPU(apu);
  assert.ok(calc.direct > 0);
  // 2 renglones de acero (longitudinal + estribos), cada uno resuelto como
  // material aparte -- nunca colapsados en un solo renglon generico.
  const acero = apu.materials.filter(r => r[0].toLowerCase().includes('varilla'));
  assert.equal(acero.length, 2);
});

test('assembleAPUFromParametricResult (muro): tambien produce forma valida y corre en calcAPU sin lanzar', () => {
  const elementDef = PARAMETRIC_ELEMENTS.muro;
  const inputs = { largo: 4, altura: 2.5, areaVanos: 1.5 };
  const calcResult = elementDef.calculate(inputs, {});
  const apu = assembleAPUFromParametricResult({
    elementDef, inputs, params: {}, calcResult, catalog: FAKE_CATALOG, auxiliaries: buildBaseAuxiliaries()
  });
  const calc = calcAPU(apu);
  assert.ok(calc.direct > 0);
  const block = apu.materials.find(r => r[0].toLowerCase().includes('block'));
  assert.ok(block && block[1] > 0);
});

test('assembleAPUFromParametricResult: un auxiliar referenciado que NO existe en la lista disponible nunca se inventa -- queda REQUIERE_VALIDACION explicito', () => {
  const elementDef = PARAMETRIC_ELEMENTS.zapata_aislada;
  const inputs = { largo: 1, ancho: 1, peralte: 0.4 };
  const calcResult = elementDef.calculate(inputs, {});
  const apu = assembleAPUFromParametricResult({
    elementDef, inputs, params: {}, calcResult, catalog: [], auxiliaries: [] // sin auxiliares disponibles
  });
  const missing = apu.materials.find(r => r[0].includes('no encontrado'));
  assert.ok(missing);
  assert.equal(missing[3], 0); // nunca un precio inventado
});
