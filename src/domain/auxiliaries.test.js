import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeAuxiliaryDefinition, validateAuxiliaryDefinition, listAvailableAuxiliaries,
  resolveAuxiliaryCost, buildBaseAuxiliaries, restoreBaseAuxiliaries, AUXILIARY_ORIGIN
} from './auxiliaries.js';
import { APU_DATA_STATE } from './apuSchema.js';

test('makeAuxiliaryDefinition arma un auxiliar con forma valida y normaliza unidades de la composicion', () => {
  const aux = makeAuxiliaryDefinition({
    clave: 'TEST-1', nombre: 'Prueba', unidad: 'm3', categoria: 'concreto',
    composicion: [['Cemento', 7, 'saco', 0, 3]]
  });
  assert.equal(aux.unidad, 'm³');
  assert.equal(aux.composicion[0].unidad, 'saco');
  assert.equal(aux.origen, AUXILIARY_ORIGIN.USUARIO);
  assert.equal(validateAuxiliaryDefinition(aux).valid, true);
});

test('validateAuxiliaryDefinition rechaza un auxiliar sin composicion', () => {
  const result = validateAuxiliaryDefinition({ clave: 'X', nombre: 'X', unidad: 'm³', categoria: 'x', composicion: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('composicion_vacia'));
});

test('validateAuxiliaryDefinition rechaza un renglon con cantidad invalida sin lanzar', () => {
  const result = validateAuxiliaryDefinition({
    clave: 'X', nombre: 'X', unidad: 'm³', categoria: 'x',
    composicion: [{ desc: 'Cemento', cantidadPorUnidad: 0, unidad: 'saco', precioUnitario: 0, desperdicioPct: 0 }]
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('cantidad_invalida')));
});

test('validateAuxiliaryDefinition rechaza un renglon de composicion que sea un arreglo (Firestore no soporta arreglos anidados -- debe ser objeto)', () => {
  const result = validateAuxiliaryDefinition({
    clave: 'X', nombre: 'X', unidad: 'm³', categoria: 'x',
    composicion: [['Cemento', 7, 'saco', 0, 3]]
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('renglon_0_invalido'));
});

test('listAvailableAuxiliaries: una copia privada de la organizacion sombrea a la global de la misma clave', () => {
  const global = [{ clave: 'CONC-200', nombre: 'Global', activo: true }];
  const org = [{ clave: 'CONC-200', nombre: 'Personalizado por la empresa', activo: true }];
  const result = listAvailableAuxiliaries(global, org);
  assert.equal(result.length, 1);
  assert.equal(result[0].nombre, 'Personalizado por la empresa');
});

test('listAvailableAuxiliaries: filtra auxiliares inactivos', () => {
  const result = listAvailableAuxiliaries([{ clave: 'A', activo: false }], []);
  assert.equal(result.length, 0);
});

test('resolveAuxiliaryCost: ingrediente CON match de catalogo usa el precio real y hereda estado BIBLIOTECA/VERIFICADO', () => {
  const aux = makeAuxiliaryDefinition({
    clave: 'T', nombre: 'T', unidad: 'm³', categoria: 'concreto',
    composicion: [['Cemento gris CPC 30R', 7, 'saco', 0, 0]]
  });
  const catalog = [{ desc: 'Cemento gris CPC 30R', unidad: 'saco', precio: 250, estado: 'VERIFICADO' }];
  const result = resolveAuxiliaryCost(aux, catalog);
  assert.equal(result.desglose[0].precioUnitario, 250);
  assert.equal(result.desglose[0].fuente.estado, APU_DATA_STATE.VERIFICADO);
  assert.equal(result.costoPorUnidad, 7 * 250);
  assert.equal(result.estado, APU_DATA_STATE.VERIFICADO);
});

test('resolveAuxiliaryCost: ingrediente SIN match y sin precio propio nunca inventa un precio -- queda en 0 y REQUIERE_VALIDACION', () => {
  const aux = makeAuxiliaryDefinition({
    clave: 'T', nombre: 'T', unidad: 'm³', categoria: 'concreto',
    composicion: [['Material inexistente', 1, 'pza', 0, 0]]
  });
  const result = resolveAuxiliaryCost(aux, []);
  assert.equal(result.desglose[0].precioUnitario, 0);
  assert.equal(result.desglose[0].fuente.estado, APU_DATA_STATE.REQUIERE_VALIDACION);
  assert.equal(result.estado, APU_DATA_STATE.REQUIERE_VALIDACION);
});

test('resolveAuxiliaryCost: el estado global es el PEOR entre todos los ingredientes, nunca un promedio que esconda uno sin resolver', () => {
  const aux = makeAuxiliaryDefinition({
    clave: 'T', nombre: 'T', unidad: 'm³', categoria: 'concreto',
    composicion: [
      ['Cemento gris CPC 30R', 7, 'saco', 0, 0],
      ['Material inexistente', 1, 'pza', 0, 0]
    ]
  });
  const catalog = [{ desc: 'Cemento gris CPC 30R', unidad: 'saco', precio: 250, estado: 'VERIFICADO' }];
  const result = resolveAuxiliaryCost(aux, catalog);
  assert.equal(result.estado, APU_DATA_STATE.REQUIERE_VALIDACION);
});

test('resolveAuxiliaryCost: expone cantidadBase (sin desperdicio) y desperdicioPct por separado -- quien arme un renglon de APU real debe poder aplicar el desperdicio UNA sola vez, no dos', () => {
  const aux = makeAuxiliaryDefinition({
    clave: 'T', nombre: 'T', unidad: 'm³', categoria: 'concreto',
    composicion: [['Cemento gris CPC 30R', 7, 'saco', 0, 10]]
  });
  const result = resolveAuxiliaryCost(aux, []);
  assert.equal(result.desglose[0].cantidadBase, 7);
  assert.equal(result.desglose[0].desperdicioPct, 10);
  close3(result.desglose[0].cantidad, 7.7);
});
function close3(actual, expected){ assert.ok(Math.abs(actual - expected) < 1e-9); }

test('buildBaseAuxiliaries: expone los auxiliares base (concreto, mortero, cimbra, concreto pobre para plantilla)', () => {
  const base = buildBaseAuxiliaries();
  const claves = base.map(a => a.clave).sort();
  assert.deepEqual(claves, ['CIMBRA-COMUN', 'CONC-100', 'CONC-200', 'MORT-1-4']);
  base.forEach(a => assert.equal(validateAuxiliaryDefinition(a).valid, true));
});

test('CONC-100 (plantilla) es una dosificacion REAL distinta de CONC-200, nunca una reutilizacion disfrazada', () => {
  const base = buildBaseAuxiliaries();
  const conc100 = base.find(a => a.clave === 'CONC-100');
  const conc200 = base.find(a => a.clave === 'CONC-200');
  const cementoDe = (aux) => aux.composicion.find(c => c.desc.toLowerCase().includes('cemento')).cantidadPorUnidad;
  assert.ok(cementoDe(conc100) < cementoDe(conc200), 'la plantilla debe llevar menos cemento por m³ que el concreto estructural');
});

test('restoreBaseAuxiliaries: nunca sobreescribe un auxiliar existente con la misma clave, aunque su contenido sea distinto al de fabrica', () => {
  const customized = { clave: 'CONC-200', nombre: 'Concreto personalizado por la empresa X', composicion: [] };
  const result = restoreBaseAuxiliaries([customized]);
  const conc200 = result.find(a => a.clave === 'CONC-200');
  assert.equal(conc200.nombre, 'Concreto personalizado por la empresa X');
});

test('restoreBaseAuxiliaries: agrega los auxiliares base que falten sin tocar los que ya existen', () => {
  const result = restoreBaseAuxiliaries([]);
  assert.equal(result.length, buildBaseAuxiliaries().length);
});
