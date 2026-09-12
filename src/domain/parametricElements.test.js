import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARAMETRIC_ELEMENTS, PARAMETRIC_FAMILIES, listElementsByFamily, getParametricElement } from './parametricElements.js';

function close(actual, expected, epsilon = 1e-6){
  assert.ok(Math.abs(actual - expected) < epsilon, `esperado ~${expected}, recibido ${actual}`);
}

test('el registro expone exactamente los 3 elementos del primer corte, uno por familia', () => {
  const ids = Object.keys(PARAMETRIC_ELEMENTS).sort();
  assert.deepEqual(ids, ['columna', 'muro', 'zapata_aislada']);
  assert.equal(PARAMETRIC_ELEMENTS.zapata_aislada.family, PARAMETRIC_FAMILIES.CIMENTACION);
  assert.equal(PARAMETRIC_ELEMENTS.columna.family, PARAMETRIC_FAMILIES.ESTRUCTURA);
  assert.equal(PARAMETRIC_ELEMENTS.muro.family, PARAMETRIC_FAMILIES.ALBANILERIA);
});

test('listElementsByFamily/getParametricElement resuelven correctamente', () => {
  assert.equal(listElementsByFamily(PARAMETRIC_FAMILIES.CIMENTACION).length, 1);
  assert.equal(getParametricElement('muro').id, 'muro');
  assert.equal(getParametricElement('no_existe'), null);
});

test('zapata_aislada: volumen, peso de acero y area de cimbra calculados a mano (1.0x1.0x0.4m, modo sencillo)', () => {
  const result = PARAMETRIC_ELEMENTS.zapata_aislada.calculate({ largo: 1.0, ancho: 1.0, peralte: 0.4 }, {});
  close(result.cantidades.volumenConcreto, 0.4);
  close(result.cantidades.pesoAcero, 0.4 * 0.012 * 7850); // 37.68 kg
  close(result.cantidades.areaCimbraLateral, 1.6);
  const cimbraConsumo = result.consumos.find(c => c.clave === 'CIMBRA-COMUN');
  close(cimbraConsumo.cantidad, 1.6 / 4); // usosCimbra default = 4
  // en modo sencillo (sin overrides), TODOS los parametros tecnicos quedan marcados ASUMIDO
  assert.equal(result.estadoPorValor.pctAceroVolumen, 'ASUMIDO');
  assert.equal(result.estadoPorValor.usosCimbra, 'ASUMIDO');
});

test('zapata_aislada: un parametro overriden explicitamente en modo experto ya NO se marca ASUMIDO', () => {
  const result = PARAMETRIC_ELEMENTS.zapata_aislada.calculate({ largo: 1.0, ancho: 1.0, peralte: 0.4 }, { pctAceroVolumen: 1.5 });
  assert.equal(result.estadoPorValor.pctAceroVolumen, undefined);
  close(result.cantidades.pesoAcero, 0.4 * 0.015 * 7850);
});

test('columna: volumen, peso de acero longitudinal/estribos y area de cimbra calculados a mano (0.3x0.3x3.0m, modo sencillo)', () => {
  const result = PARAMETRIC_ELEMENTS.columna.calculate({ base: 0.3, peralte: 0.3, altura: 3.0 }, {});
  close(result.cantidades.volumenConcreto, 0.27);
  close(result.cantidades.areaCimbra, 3.6);
  close(result.cantidades.pesoLongitudinal, 4 * 3.0 * 0.994); // 11.928 kg
  assert.equal(result.cantidades.numEstribos, 16); // ceil(3/0.20)+1
  const perimetroEstribo = 2 * ((0.3 - 0.06) + (0.3 - 0.06));
  close(result.cantidades.pesoEstribos, 16 * (perimetroEstribo + 0.10) * 0.560);
});

test('muro: area neta, numero de piezas y volumen de mortero calculados a mano (4x2.5m con 1.5m2 de vanos, modo sencillo)', () => {
  const result = PARAMETRIC_ELEMENTS.muro.calculate({ largo: 4, altura: 2.5, areaVanos: 1.5 }, {});
  close(result.cantidades.areaBruta, 10);
  close(result.cantidades.areaNeta, 8.5);
  const moduloBlock = (0.39 + 0.015) * (0.19 + 0.015);
  const expectedPiezas = Math.ceil((8.5 / moduloBlock) * 1.05);
  assert.equal(result.cantidades.numPiezas, expectedPiezas);
  close(result.cantidades.volumenMorteroJunteo, 8.5 * 0.018);
  close(result.cantidades.areaAplanado, 17);
  close(result.cantidades.volumenMorteroAplanado, 17 * 0.015);
});

test('muro: areaNeta nunca es negativa aunque los vanos excedan el area bruta', () => {
  const result = PARAMETRIC_ELEMENTS.muro.calculate({ largo: 2, altura: 2, areaVanos: 10 }, {});
  assert.equal(result.cantidades.areaNeta, 0);
  assert.equal(result.cantidades.numPiezas, 0);
});

test('todos los consumos declarados por los 3 elementos tienen forma valida para el ensamblador (segun su tipo)', () => {
  const cases = [
    [PARAMETRIC_ELEMENTS.zapata_aislada, { largo: 1, ancho: 1, peralte: 0.4 }],
    [PARAMETRIC_ELEMENTS.columna, { base: 0.3, peralte: 0.3, altura: 3 }],
    [PARAMETRIC_ELEMENTS.muro, { largo: 4, altura: 2.5, areaVanos: 0 }]
  ];
  const VALID_TIPOS = ['auxiliar', 'material', 'labor_sistema', 'labor_cimbra'];
  cases.forEach(([element, inputs]) => {
    const result = element.calculate(inputs, {});
    result.consumos.forEach(c => {
      assert.ok(VALID_TIPOS.includes(c.tipo), `tipo desconocido: ${c.tipo}`);
      assert.ok(Number.isFinite(c.cantidad) && c.cantidad >= 0);
      if(c.tipo === 'auxiliar'){
        assert.ok(typeof c.clave === 'string' && c.clave.length > 0);
        assert.ok(typeof c.unidad === 'string' && c.unidad.length > 0);
      }
      if(c.tipo === 'material'){
        assert.ok(typeof c.desc === 'string' && c.desc.length > 0);
        assert.ok(typeof c.unidad === 'string' && c.unidad.length > 0);
      }
      if(c.tipo === 'labor_sistema') assert.ok(typeof c.sistemaId === 'string' && c.sistemaId.length > 0);
    });
  });
});
