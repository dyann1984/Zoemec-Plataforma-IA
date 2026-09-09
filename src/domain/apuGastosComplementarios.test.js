import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GASTO_CATEGORIA, GASTO_CATEGORIA_LABEL, GASTO_CATEGORIA_ORDER,
  GASTO_FRECUENCIA, GASTO_FRECUENCIA_LABEL, GASTO_FRECUENCIA_ORDER,
  GASTO_ESTADO, GASTO_ESTADO_LABEL,
  DUPLICADO_INDIRECTOS_TEXTO, shouldShowPosibleDuplicidad,
  makeEmptyGastoComplementarioRow, makeSuggestedGastoComplementarioRow,
  calcGastoComplementarioImporte, cuentaParaPrecio, summarizeGastosComplementarios
} from './apuGastosComplementarios.js';

test('GASTO_CATEGORIA_ORDER y GASTO_FRECUENCIA_ORDER cubren todas las claves de sus enums congelados', () => {
  assert.equal(Object.isFrozen(GASTO_CATEGORIA), true);
  assert.equal(Object.isFrozen(GASTO_FRECUENCIA), true);
  assert.equal(Object.isFrozen(GASTO_ESTADO), true);
  assert.deepEqual(GASTO_CATEGORIA_ORDER, Object.values(GASTO_CATEGORIA));
  assert.deepEqual(GASTO_FRECUENCIA_ORDER, Object.values(GASTO_FRECUENCIA));
  for (const cat of GASTO_CATEGORIA_ORDER) assert.ok(GASTO_CATEGORIA_LABEL[cat], `falta label para ${cat}`);
  for (const freq of GASTO_FRECUENCIA_ORDER) assert.ok(GASTO_FRECUENCIA_LABEL[freq], `falta label para ${freq}`);
  for (const estado of Object.values(GASTO_ESTADO)) assert.ok(GASTO_ESTADO_LABEL[estado], `falta label para ${estado}`);
});

test('makeEmptyGastoComplementarioRow: un renglon agregado a mano nace ACEPTADO (accion explicita "Agregar al APU")', () => {
  const row = makeEmptyGastoComplementarioRow();
  assert.equal(row.categoria, GASTO_CATEGORIA.OTROS);
  assert.equal(row.frecuencia, GASTO_FRECUENCIA.UNICO);
  assert.equal(row.estado, GASTO_ESTADO.ACEPTADO);
  assert.equal(row.incluidoEnIndirectos, false);
  assert.equal(calcGastoComplementarioImporte(row), 0);
});

test('makeSuggestedGastoComplementarioRow: una sugerencia del detector nace SUGERIDO y SIN monto (nunca se inventa cantidad/precio)', () => {
  const row = makeSuggestedGastoComplementarioRow({ categoria: GASTO_CATEGORIA.HOSPEDAJE, concepto: 'Hospedaje potencial detectado' });
  assert.equal(row.estado, GASTO_ESTADO.SUGERIDO);
  assert.equal(row.cantidad, 0);
  assert.equal(row.precioUnitario, 0);
  assert.equal(cuentaParaPrecio(row), false, 'una sugerencia nunca cuenta para el precio hasta ser aceptada');
});

test('calcGastoComplementarioImporte es cantidad x precioUnitario (formula minima determinista, regla 5)', () => {
  assert.equal(calcGastoComplementarioImporte({ cantidad: 6, precioUnitario: 150 }), 900);
  assert.equal(calcGastoComplementarioImporte({ cantidad: 4, precioUnitario: 240 }), 960);
  assert.equal(calcGastoComplementarioImporte({ cantidad: 2, precioUnitario: 850 }), 1700);
});

test('calcGastoComplementarioImporte sanea valores no numericos a 0 y nunca multiplica por frecuencia', () => {
  assert.equal(calcGastoComplementarioImporte({ cantidad: 'x', precioUnitario: 100 }), 0);
  assert.equal(calcGastoComplementarioImporte({}), 0);
  const conFrecuencia = calcGastoComplementarioImporte({ cantidad: 6, precioUnitario: 150, frecuencia: GASTO_FRECUENCIA.DIARIO });
  assert.equal(conFrecuencia, 900, 'la frecuencia es descriptiva, nunca multiplica el importe');
});

test('cuentaParaPrecio: solo ACEPTADO cuenta -- SUGERIDO/DESCARTADO/JUSTIFICADO nunca (regla 6)', () => {
  assert.equal(cuentaParaPrecio({ estado: GASTO_ESTADO.ACEPTADO }), true);
  assert.equal(cuentaParaPrecio({ estado: GASTO_ESTADO.SUGERIDO }), false);
  assert.equal(cuentaParaPrecio({ estado: GASTO_ESTADO.DESCARTADO }), false);
  assert.equal(cuentaParaPrecio({ estado: GASTO_ESTADO.JUSTIFICADO }), false);
});

test('cuentaParaPrecio: incluidoEnIndirectos:true excluye SIEMPRE, aunque el renglon este ACEPTADO (regla 4, evita doble contabilizacion)', () => {
  assert.equal(cuentaParaPrecio({ estado: GASTO_ESTADO.ACEPTADO, incluidoEnIndirectos: true }), false);
  assert.equal(cuentaParaPrecio({ estado: GASTO_ESTADO.ACEPTADO, incluidoEnIndirectos: false }), true);
});

test('cuentaParaPrecio: un renglon sin "estado" (compatibilidad) se trata como ACEPTADO', () => {
  assert.equal(cuentaParaPrecio({ cantidad: 1, precioUnitario: 100 }), true);
});

test('shouldShowPosibleDuplicidad: sugiere por categoria SOLO si el renglon no fijo el campo explicitamente; la decision explicita siempre manda (regla 4, "la IA nunca decide en silencio")', () => {
  assert.equal(shouldShowPosibleDuplicidad({ categoria: GASTO_CATEGORIA.VIGILANCIA }), true);
  assert.equal(shouldShowPosibleDuplicidad({ categoria: GASTO_CATEGORIA.SEGUROS_FIANZAS }), true);
  assert.equal(shouldShowPosibleDuplicidad({ categoria: GASTO_CATEGORIA.PERMISOS_LICENCIAS }), true);
  assert.equal(shouldShowPosibleDuplicidad({ categoria: GASTO_CATEGORIA.ALIMENTACION }), false);
  // El usuario puede sobreescribir el heuristico en cualquier direccion.
  assert.equal(shouldShowPosibleDuplicidad({ categoria: GASTO_CATEGORIA.VIGILANCIA, posibleDuplicidad: false }), false);
  assert.equal(shouldShowPosibleDuplicidad({ categoria: GASTO_CATEGORIA.ALIMENTACION, posibleDuplicidad: true }), true);
  assert.ok(DUPLICADO_INDIRECTOS_TEXTO.length > 0);
});

// Escenario QA exacto de la sesion (2026-09-07): comida 6 x $150 = $900,
// casetas 4 x $240 = $960, hospedaje 2 x $850 = $1,700 -> subtotal $3,560,
// sumando una sola vez.
test('QA: summarizeGastosComplementarios de comida/casetas/hospedaje (ACEPTADO) da totalIncluido = $3,560', () => {
  const gastos = [
    { concepto: 'Comida cuadrilla', categoria: GASTO_CATEGORIA.ALIMENTACION, cantidad: 6, precioUnitario: 150, frecuencia: GASTO_FRECUENCIA.DIARIO, justificacion: 'Alimentacion de 6 personas por jornada', fuente: 'Cotizacion local', estado: GASTO_ESTADO.ACEPTADO },
    { concepto: 'Casetas de peaje', categoria: GASTO_CATEGORIA.CASETAS, cantidad: 4, precioUnitario: 240, frecuencia: GASTO_FRECUENCIA.POR_VIAJE, justificacion: '4 viajes de traslado de material', fuente: 'Tarifario CAPUFE', estado: GASTO_ESTADO.ACEPTADO },
    { concepto: 'Hospedaje cuadrilla', categoria: GASTO_CATEGORIA.HOSPEDAJE, cantidad: 2, precioUnitario: 850, frecuencia: GASTO_FRECUENCIA.POR_TRABAJADOR, justificacion: '2 trabajadores foraneos', fuente: 'Cotizacion hotel', estado: GASTO_ESTADO.ACEPTADO }
  ];
  const summary = summarizeGastosComplementarios(gastos);
  assert.equal(summary.count, 3);
  assert.equal(summary.totalIncluido, 3560);
  assert.equal(summary.totalNoIncluido, 0);
  assert.equal(summary.byCategoria[GASTO_CATEGORIA.ALIMENTACION], 900);
  assert.equal(summary.byCategoria[GASTO_CATEGORIA.CASETAS], 960);
  assert.equal(summary.byCategoria[GASTO_CATEGORIA.HOSPEDAJE], 1700);
});

test('summarizeGastosComplementarios separa totalIncluido de totalNoIncluido (SUGERIDO/DESCARTADO/JUSTIFICADO/incluidoEnIndirectos) y no rompe con arreglo vacio/ausente', () => {
  const gastos = [
    { categoria: GASTO_CATEGORIA.VIATICOS, cantidad: 1, precioUnitario: 100, estado: GASTO_ESTADO.ACEPTADO },
    { categoria: GASTO_CATEGORIA.VIGILANCIA, cantidad: 1, precioUnitario: 500, estado: GASTO_ESTADO.ACEPTADO, incluidoEnIndirectos: true },
    { categoria: GASTO_CATEGORIA.HOSPEDAJE, cantidad: 1, precioUnitario: 300, estado: GASTO_ESTADO.SUGERIDO }
  ];
  const summary = summarizeGastosComplementarios(gastos);
  assert.equal(summary.totalIncluido, 100);
  assert.equal(summary.totalNoIncluido, 800);
  assert.deepEqual(summarizeGastosComplementarios([]), { count: 0, totalIncluido: 0, totalNoIncluido: 0, byCategoria: {}, byEstado: {} });
  assert.deepEqual(summarizeGastosComplementarios(undefined), { count: 0, totalIncluido: 0, totalNoIncluido: 0, byCategoria: {}, byEstado: {} });
});

test('summarizeGastosComplementarios agrupa categoria desconocida/ausente bajo OTROS y cuenta por estado', () => {
  const summary = summarizeGastosComplementarios([
    { categoria: 'NO_EXISTE', cantidad: 1, precioUnitario: 10, estado: GASTO_ESTADO.ACEPTADO },
    { categoria: GASTO_CATEGORIA.OTROS, cantidad: 1, precioUnitario: 5, estado: GASTO_ESTADO.SUGERIDO }
  ]);
  assert.equal(summary.byCategoria[GASTO_CATEGORIA.OTROS], 15);
  assert.equal(summary.byEstado[GASTO_ESTADO.ACEPTADO], 1);
  assert.equal(summary.byEstado[GASTO_ESTADO.SUGERIDO], 1);
});
