import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GASTO_CATEGORIA, GASTO_CATEGORIA_LABEL, GASTO_CATEGORIA_ORDER,
  GASTO_FRECUENCIA, GASTO_FRECUENCIA_LABEL, GASTO_FRECUENCIA_ORDER,
  DUPLICADO_INDIRECTOS_TEXTO, isPosibleDuplicadoIndirectos,
  makeEmptyGastoComplementarioRow, calcGastoComplementarioImporte,
  isGastoIncluido, summarizeGastosComplementarios
} from './apuGastosComplementarios.js';

test('GASTO_CATEGORIA_ORDER y GASTO_FRECUENCIA_ORDER cubren todas las claves de sus enums congelados', () => {
  assert.equal(Object.isFrozen(GASTO_CATEGORIA), true);
  assert.equal(Object.isFrozen(GASTO_FRECUENCIA), true);
  assert.deepEqual(GASTO_CATEGORIA_ORDER, Object.values(GASTO_CATEGORIA));
  assert.deepEqual(GASTO_FRECUENCIA_ORDER, Object.values(GASTO_FRECUENCIA));
  for (const cat of GASTO_CATEGORIA_ORDER) assert.ok(GASTO_CATEGORIA_LABEL[cat], `falta label para ${cat}`);
  for (const freq of GASTO_FRECUENCIA_ORDER) assert.ok(GASTO_FRECUENCIA_LABEL[freq], `falta label para ${freq}`);
});

test('makeEmptyGastoComplementarioRow da un renglon vacio con incluido:true por defecto', () => {
  const row = makeEmptyGastoComplementarioRow();
  assert.equal(row.categoria, GASTO_CATEGORIA.OTROS);
  assert.equal(row.frecuencia, GASTO_FRECUENCIA.UNICO);
  assert.equal(row.incluido, true);
  assert.equal(calcGastoComplementarioImporte(row), 0);
});

test('calcGastoComplementarioImporte es cantidad x precioUnitario', () => {
  assert.equal(calcGastoComplementarioImporte({ cantidad: 6, precioUnitario: 150 }), 900);
  assert.equal(calcGastoComplementarioImporte({ cantidad: 4, precioUnitario: 240 }), 960);
  assert.equal(calcGastoComplementarioImporte({ cantidad: 2, precioUnitario: 850 }), 1700);
});

test('calcGastoComplementarioImporte sanea valores no numericos a 0', () => {
  assert.equal(calcGastoComplementarioImporte({ cantidad: 'x', precioUnitario: 100 }), 0);
  assert.equal(calcGastoComplementarioImporte({}), 0);
});

test('isGastoIncluido es true por defecto y false solo si incluido===false explicitamente', () => {
  assert.equal(isGastoIncluido({}), true);
  assert.equal(isGastoIncluido({ incluido: true }), true);
  assert.equal(isGastoIncluido({ incluido: false }), false);
});

test('isPosibleDuplicadoIndirectos marca solo vigilancia/seguros-fianzas/permisos-licencias', () => {
  assert.equal(isPosibleDuplicadoIndirectos({ categoria: GASTO_CATEGORIA.VIGILANCIA }), true);
  assert.equal(isPosibleDuplicadoIndirectos({ categoria: GASTO_CATEGORIA.SEGUROS_FIANZAS }), true);
  assert.equal(isPosibleDuplicadoIndirectos({ categoria: GASTO_CATEGORIA.PERMISOS_LICENCIAS }), true);
  assert.equal(isPosibleDuplicadoIndirectos({ categoria: GASTO_CATEGORIA.ALIMENTACION }), false);
  assert.equal(isPosibleDuplicadoIndirectos({}), false);
  assert.ok(DUPLICADO_INDIRECTOS_TEXTO.length > 0);
});

// Escenario QA exacto de la sesion (2026-09-07): comida 6 x $150 = $900,
// casetas 4 x $240 = $960, hospedaje 2 x $850 = $1,700 -> subtotal $3,560,
// sumando una sola vez.
test('QA: summarizeGastosComplementarios de comida/casetas/hospedaje da totalIncluido = $3,560', () => {
  const gastos = [
    { concepto: 'Comida cuadrilla', categoria: GASTO_CATEGORIA.ALIMENTACION, cantidad: 6, precioUnitario: 150, frecuencia: GASTO_FRECUENCIA.DIARIO, justificacion: 'Alimentacion de 6 personas por jornada', fuente: 'Cotizacion local', incluido: true },
    { concepto: 'Casetas de peaje', categoria: GASTO_CATEGORIA.CASETAS, cantidad: 4, precioUnitario: 240, frecuencia: GASTO_FRECUENCIA.POR_VIAJE, justificacion: '4 viajes de traslado de material', fuente: 'Tarifario CAPUFE', incluido: true },
    { concepto: 'Hospedaje cuadrilla', categoria: GASTO_CATEGORIA.HOSPEDAJE, cantidad: 2, precioUnitario: 850, frecuencia: GASTO_FRECUENCIA.POR_TRABAJADOR, justificacion: '2 trabajadores foraneos', fuente: 'Cotizacion hotel', incluido: true }
  ];
  const summary = summarizeGastosComplementarios(gastos);
  assert.equal(summary.count, 3);
  assert.equal(summary.totalIncluido, 3560);
  assert.equal(summary.totalExcluido, 0);
  assert.equal(summary.byCategoria[GASTO_CATEGORIA.ALIMENTACION], 900);
  assert.equal(summary.byCategoria[GASTO_CATEGORIA.CASETAS], 960);
  assert.equal(summary.byCategoria[GASTO_CATEGORIA.HOSPEDAJE], 1700);
});

test('summarizeGastosComplementarios separa totalIncluido de totalExcluido y no rompe con arreglo vacio/ausente', () => {
  const gastos = [
    { categoria: GASTO_CATEGORIA.VIATICOS, cantidad: 1, precioUnitario: 100, incluido: true },
    { categoria: GASTO_CATEGORIA.VIGILANCIA, cantidad: 1, precioUnitario: 500, incluido: false }
  ];
  const summary = summarizeGastosComplementarios(gastos);
  assert.equal(summary.totalIncluido, 100);
  assert.equal(summary.totalExcluido, 500);
  assert.deepEqual(summarizeGastosComplementarios([]), { count: 0, totalIncluido: 0, totalExcluido: 0, byCategoria: {} });
  assert.deepEqual(summarizeGastosComplementarios(undefined), { count: 0, totalIncluido: 0, totalExcluido: 0, byCategoria: {} });
});

test('summarizeGastosComplementarios agrupa categoria desconocida/ausente bajo OTROS', () => {
  const summary = summarizeGastosComplementarios([{ categoria: 'NO_EXISTE', cantidad: 1, precioUnitario: 10 }]);
  assert.equal(summary.byCategoria[GASTO_CATEGORIA.OTROS], 10);
});
