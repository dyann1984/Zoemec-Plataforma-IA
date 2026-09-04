/* Costos de Campo y Ajustes Reales + Presupuestado vs Real + Normativa
   (Parte C/D/E del requerimiento de produccion 2026-09-03). Pruebas del
   dominio puro -- sin exportadores, sin UI. Regla central verificada aqui:
   un registro de Costos de Campo NUNCA altera calcAPUv2/apu.calculated
   (ver src/domain/apuCostosCampo.js), exactamente como pidio el usuario. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COSTO_CAMPO_CATEGORIA, COSTO_CAMPO_CATEGORIA_ORDER,
  makeEmptyCostoCampoRow, calcCostoCampoImporte, isCostoCampoImputable,
  summarizeCostosCampo, calcPresupuestadoVsReal
} from '../src/domain/apuCostosCampo.js';
import {
  ESTADO_REVISION, ESTADO_REVISION_LABEL, NORMATIVA_DISCLAIMER, NORMATIVA_VACIA_TEXTO, makeEmptyNormativaRow
} from '../src/domain/apuNormativa.js';

function row(overrides = {}){ return { ...makeEmptyCostoCampoRow(), ...overrides }; }

test('makeEmptyCostoCampoRow: nace con categoria por defecto valida y sin importe', () => {
  const r = makeEmptyCostoCampoRow();
  assert.ok(COSTO_CAMPO_CATEGORIA_ORDER.includes(r.categoria));
  assert.equal(calcCostoCampoImporte(r), 0);
});

test('calcCostoCampoImporte: cantidad x costoUnitario, nunca capturado a mano', () => {
  assert.equal(calcCostoCampoImporte(row({ cantidad: 5, costoUnitario: 120 })), 600);
  assert.equal(calcCostoCampoImporte(row({ cantidad: '3', costoUnitario: '50' })), 150);
  assert.equal(calcCostoCampoImporte(row({ cantidad: null, costoUnitario: 100 })), 0);
});

test('isCostoCampoImputable: solo D (No imputable) es no imputable; las otras 4 categorias si', () => {
  COSTO_CAMPO_CATEGORIA_ORDER.forEach(cat => {
    const imputable = isCostoCampoImputable(row({ categoria: cat }));
    assert.equal(imputable, cat !== COSTO_CAMPO_CATEGORIA.NO_IMPUTABLE, `categoria ${cat}`);
  });
});

test('summarizeCostosCampo: suma por categoria correctamente, categoria desconocida cae a NO_IMPUTABLE', () => {
  const rows = [
    row({ categoria: COSTO_CAMPO_CATEGORIA.COSTO_DIRECTO, cantidad: 1, costoUnitario: 100 }),
    row({ categoria: COSTO_CAMPO_CATEGORIA.COSTO_DIRECTO, cantidad: 2, costoUnitario: 50 }),
    row({ categoria: COSTO_CAMPO_CATEGORIA.INDIRECTO_OBRA, cantidad: 1, costoUnitario: 200 }),
    row({ categoria: 'ALGO_INVENTADO', cantidad: 1, costoUnitario: 30 })
  ];
  const s = summarizeCostosCampo(rows);
  assert.equal(s.count, 4);
  assert.equal(s.totalRegistrado, 100 + 100 + 200 + 30);
  assert.equal(s.byCategoria[COSTO_CAMPO_CATEGORIA.COSTO_DIRECTO], 200);
  assert.equal(s.byCategoria[COSTO_CAMPO_CATEGORIA.INDIRECTO_OBRA], 200);
  assert.equal(s.byCategoria[COSTO_CAMPO_CATEGORIA.NO_IMPUTABLE], 30, 'categoria no reconocida se trata como no imputable, nunca se pierde silenciosamente');
});

test('summarizeCostosCampo: arreglo vacio/ausente nunca truena', () => {
  assert.equal(summarizeCostosCampo([]).count, 0);
  assert.equal(summarizeCostosCampo(undefined).count, 0);
  assert.equal(summarizeCostosCampo(null).totalRegistrado, 0);
});

test('calcPresupuestadoVsReal: sin apu.calculated regresa null, nunca inventa un presupuestado de $0', () => {
  assert.equal(calcPresupuestadoVsReal({}), null);
  assert.equal(calcPresupuestadoVsReal({ cantidadObra: 10 }), null);
});

test('calcPresupuestadoVsReal: sin registros de costos de campo, hasRegistros=false (la UI/exportador debe ocultar la seccion)', () => {
  const apu = { cantidadObra: 10, calculated: { pu: 100, direct: 80, importeTotal: 1000 }, costosCampo: [] };
  const pvr = calcPresupuestadoVsReal(apu);
  assert.equal(pvr.hasRegistros, false);
  assert.equal(pvr.presupuestado, 1000);
});

/* Bug real confirmado en QA de produccion (2026-09-03): con la bitacora de
   Costos de Campo VACIA, "Costo real total" comparaba solo costo directo
   contra el precio COMPLETO (que ya incluye indirectos/financiamiento/
   utilidad/cargos), mostrando una "desviacion" falsa de -20%+ sin haber
   registrado un solo peso. Esta prueba fija ese comportamiento: con 0
   registros, la desviacion SIEMPRE debe ser 0, sin importar que tan grande
   sea el overhead (indirectos/financiamiento/utilidad/cargos) del APU. */
// direct+indirect+finance+utility+cargos = 329.56 = pu, por construccion --
// asi la identidad "presupuestado = suma exacta de sus componentes" es
// verificable sin arrastrar el redondeo de una captura de pantalla real.
const PU_COMPONENTS = { direct: 264.07, indirect: 39.61, finance: 4.06, utility: 20.68, cargos: 1.14 };
const PU_TOTAL = Object.values(PU_COMPONENTS).reduce((a, b) => a + b, 0);

test('calcPresupuestadoVsReal: con 0 registros, la desviacion es SIEMPRE 0 -- nunca una desviacion falsa por comparar bases distintas (direct vs precio completo)', () => {
  const calculated = { ...PU_COMPONENTS, pu: PU_TOTAL, importeTotal: PU_TOTAL * 200 };
  const apu = { cantidadObra: 200, calculated, costosCampo: [] };
  const pvr = calcPresupuestadoVsReal(apu);
  assert.equal(pvr.hasRegistros, false);
  assert.equal(pvr.desviacionMonto, 0, 'sin ningun registro real, el costo real total debe reconstruir EXACTO el presupuestado');
  assert.equal(pvr.desviacionPct, 0);
});

test('calcPresupuestadoVsReal: con overhead real (indirectos/financiamiento/utilidad/cargos), la desviacion refleja UNICAMENTE lo registrado en Costos de Campo, nunca el overhead original', () => {
  const calculated = { ...PU_COMPONENTS, pu: PU_TOTAL, importeTotal: PU_TOTAL * 200 };
  const apu = { cantidadObra: 200, calculated, costosCampo: [row({ categoria: COSTO_CAMPO_CATEGORIA.INDIRECTO_OBRA, cantidad: 5, costoUnitario: 200 })] };
  const pvr = calcPresupuestadoVsReal(apu);
  assert.equal(pvr.hasRegistros, true);
  assert.equal(pvr.desviacionMonto, 1000, 'la desviacion debe ser EXACTAMENTE el $1,000 registrado, nunca contaminada por el overhead original del APU');
  assert.ok(Math.abs(pvr.desviacionPct - (1000 / (PU_TOTAL * 200) * 100)) < 1e-9);
});

test('calcPresupuestadoVsReal: mapeo exacto de las 5 categorias -- A suma a costo directo real, B/C/E quedan aparte, D se excluye del total', () => {
  // cantidadObra=1 para que "por unidad" y "total" coincidan y el calculo sea facil de verificar a mano.
  const apu = {
    cantidadObra: 1,
    calculated: { pu: 18420, direct: 16000, importeTotal: 18420 },
    costosCampo: [
      row({ categoria: COSTO_CAMPO_CATEGORIA.COSTO_DIRECTO, cantidad: 1, costoUnitario: 760 }),   // -> costo directo real
      row({ categoria: COSTO_CAMPO_CATEGORIA.INDIRECTO_OBRA, cantidad: 1, costoUnitario: 500 }),  // -> indirectos
      row({ categoria: COSTO_CAMPO_CATEGORIA.EXTRAORDINARIO, cantidad: 1, costoUnitario: 730 }),  // -> extraordinarios
      row({ categoria: COSTO_CAMPO_CATEGORIA.NO_IMPUTABLE, cantidad: 1, costoUnitario: 9999 }),   // NUNCA debe entrar al total
      row({ categoria: COSTO_CAMPO_CATEGORIA.AJUSTE_MANUAL, cantidad: 1, costoUnitario: -100 })   // ajuste negativo valido
    ]
  };
  const pvr = calcPresupuestadoVsReal(apu);
  assert.equal(pvr.hasRegistros, true);
  assert.equal(pvr.presupuestado, 18420);
  assert.equal(pvr.costoDirectoReal, 16000 + 760);
  assert.equal(pvr.indirectos, 500);
  assert.equal(pvr.extraordinarios, 730);
  assert.equal(pvr.ajustes, -100);
  assert.equal(pvr.noImputable, 9999);
  const expectedTotal = (16000 + 760) + 500 + 730 - 100;
  assert.equal(pvr.costoRealTotal, expectedTotal, 'D (no imputable) jamas debe sumar al costo real total');
  assert.equal(pvr.desviacionMonto, expectedTotal - 18420);
  assert.ok(Math.abs(pvr.desviacionPct - ((expectedTotal - 18420) / 18420 * 100)) < 1e-9);
  assert.equal(pvr.impactoPU, expectedTotal - 18420); // cantidadObra=1 -> impacto por unidad = desviacion total
});

test('calcPresupuestadoVsReal: NUNCA modifica ni lee de vuelta apu.calculated -- es de solo lectura sobre el APU ya calculado', () => {
  const calculated = { pu: 100, direct: 80, importeTotal: 1000 };
  const apu = { cantidadObra: 10, calculated, costosCampo: [row({ categoria: COSTO_CAMPO_CATEGORIA.COSTO_DIRECTO, cantidad: 1, costoUnitario: 50 })] };
  const before = JSON.stringify(calculated);
  calcPresupuestadoVsReal(apu);
  assert.equal(JSON.stringify(apu.calculated), before, 'calcPresupuestadoVsReal nunca debe mutar calculated (nunca se inyecta como costo directo del APU)');
});

// ---- Normativa y Cumplimiento (Parte E) ----

test('makeEmptyNormativaRow: nace PENDIENTE de revision y con todos los "requiere*" en false (nunca se asume un requisito)', () => {
  const n = makeEmptyNormativaRow();
  assert.equal(n.estadoRevision, ESTADO_REVISION.PENDIENTE);
  ['requiereMaterial','requiereEPP','requiereProcedimiento','requierePrueba','requiereDocumentacion'].forEach(f => assert.equal(n[f], false));
});

test('ESTADO_REVISION_LABEL: cubre los 4 estados y ninguno usa lenguaje de "cumplimiento legal" afirmativo', () => {
  Object.values(ESTADO_REVISION).forEach(estado => assert.ok(ESTADO_REVISION_LABEL[estado]));
  Object.values(ESTADO_REVISION_LABEL).forEach(label => {
    assert.ok(!/cumple|aprobado legalmente|garantizado/i.test(label));
  });
});

test('NORMATIVA_DISCLAIMER/NORMATIVA_VACIA_TEXTO: usan lenguaje seguro ("potencialmente aplicable"/"validacion profesional"), nunca afirman cumplimiento', () => {
  assert.match(NORMATIVA_DISCLAIMER, /potencialmente aplicable/i);
  assert.match(NORMATIVA_DISCLAIMER, /validaci[oó]n profesional/i);
  assert.match(NORMATIVA_VACIA_TEXTO, /pendiente de revisi[oó]n/i);
});
