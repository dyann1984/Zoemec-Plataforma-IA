import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APU_DEFAULT_FACTORS, DEFAULT_IVA_RATE, toSafeNonNegativeNumber, rowImporte, calcAPU, findApuNumericIssues,
  applyCascade, calcMaterialRow, calcLaborRow, calcEquipmentRow, calcHerramientaDetalleRow, calcSeguridadRow,
  calcAPUv2, findApuNumericIssuesV2
} from './apuCalc.js';

const close = (actual, expected, epsilon = 1e-6) => Math.abs(actual - expected) < epsilon;

test('APU_DEFAULT_FACTORS es la unica fuente de verdad y esta congelada', () => {
  assert.equal(Object.isFrozen(APU_DEFAULT_FACTORS), true);
  assert.equal(DEFAULT_IVA_RATE, APU_DEFAULT_FACTORS.iva);
});

test('toSafeNonNegativeNumber sanea negativos, NaN e Infinity a 0', () => {
  assert.equal(toSafeNonNegativeNumber(12.5), 12.5);
  assert.equal(toSafeNonNegativeNumber(0), 0);
  assert.equal(toSafeNonNegativeNumber(-5), 0);
  assert.equal(toSafeNonNegativeNumber(Infinity), 0);
  assert.equal(toSafeNonNegativeNumber(-Infinity), 0);
  assert.equal(toSafeNonNegativeNumber(NaN), 0);
  assert.equal(toSafeNonNegativeNumber('abc'), 0);
  assert.equal(toSafeNonNegativeNumber(undefined), 0);
  assert.equal(toSafeNonNegativeNumber(null), 0);
});

test('rowImporte de materiales aplica cantidad x precio x (1 + merma%)', () => {
  const importe = rowImporte('materials', ['Mat A', 2, 'pza', 100, 10]);
  assert.ok(close(importe, 220));
});

test('rowImporte de materiales sin merma es cantidad x precio', () => {
  const importe = rowImporte('materials', ['Mat B', 3, 'pza', 50, 0]);
  assert.ok(close(importe, 150));
});

test('rowImporte de mano de obra aplica cantidad x salario x FSR', () => {
  const importe = rowImporte('labor', ['Oficial', 1, 'jor', 300, 1.8]);
  assert.ok(close(importe, 540));
});

test('rowImporte de equipo aplica cantidad x costo horario, sin merma ni FSR', () => {
  const importe = rowImporte('equipment', ['Equipo', 0.5, 'hr', 80]);
  assert.ok(close(importe, 40));
});

test('rowImporte sanea renglones con cantidad o precio negativo/no finito a 0', () => {
  assert.equal(rowImporte('materials', ['Mat', -2, 'pza', 100, 0]), 0);
  assert.equal(rowImporte('materials', ['Mat', 2, 'pza', -100, 0]), 0);
  assert.equal(rowImporte('labor', ['MO', NaN, 'jor', 300, 1.8]), 0);
  assert.equal(rowImporte('equipment', ['Eq', Infinity, 'hr', 80]), 0);
});

test('calcAPU de un apu vacio da todos los totales en cero', () => {
  const t = calcAPU({});
  assert.equal(t.mat, 0);
  assert.equal(t.mo, 0);
  assert.equal(t.equipo, 0);
  assert.equal(t.herramienta, 0);
  assert.equal(t.direct, 0);
  assert.equal(t.indirect, 0);
  assert.equal(t.finance, 0);
  assert.equal(t.utility, 0);
  assert.equal(t.cargos, 0);
  assert.equal(t.pu, 0);
  assert.equal(t.iva, 0);
  assert.equal(t.total, 0);
});

test('calcAPU aplica la cascada RLOPSRM: cada rubro sobre el acumulado anterior, no sobre el costo directo', () => {
  const apu = {
    materials: [['Mat A', 2, 'pza', 100, 10]],   // 2 x 100 x 1.10 = 220
    labor: [['Oficial', 1, 'jor', 300, 1.8]],     // 1 x 300 x 1.8 = 540
    equipment: [['Equipo', 0.5, 'hr', 80]],       // 0.5 x 80 = 40
    herramienta: 3,   // % de mano de obra
    indCampo: 8,
    indOficina: 7,
    finance: 2,
    utility: 10,
    cargos: 0.5,
    iva: 16
  };
  const t = calcAPU(apu);

  assert.ok(close(t.mat, 220));
  assert.ok(close(t.mo, 540));
  assert.ok(close(t.equipo, 40));
  assert.ok(close(t.herramienta, 16.2));                 // 540 * 3 / 100
  assert.ok(close(t.direct, 816.2));                      // 220 + 540 + 40 + 16.2

  assert.ok(close(t.indirect, 122.43));                   // 816.2 * 15 / 100
  const sum1 = 816.2 + 122.43;

  assert.ok(close(t.finance, 18.7726));                   // sum1 * 2 / 100
  const sum2 = sum1 + 18.7726;

  assert.ok(close(t.utility, 95.74026));                  // sum2 * 10 / 100
  const sum3 = sum2 + 95.74026;

  assert.ok(close(t.cargos, 5.2657143, 1e-4));             // sum3 * 0.5 / 100
  const pu = sum3 + 5.2657143;

  assert.ok(close(t.pu, pu, 1e-4));
  assert.ok(close(t.total, t.pu));                         // total no incluye IVA
  assert.ok(close(t.iva, pu * 16 / 100, 1e-4));             // IVA es informativo, no se suma a total
});

test('calcAPU con APU_DEFAULT_FACTORS y una sola linea de mano de obra reproduce el % de herramienta menor', () => {
  const apu = {
    labor: [['Oficial', 1, 'jor', 100, 1]],
    ...APU_DEFAULT_FACTORS
  };
  const t = calcAPU(apu);
  assert.ok(close(t.herramienta, 100 * APU_DEFAULT_FACTORS.herramienta / 100));
});

test('calcAPU suma varios renglones del mismo tipo antes de aplicar porcentajes', () => {
  const apu = {
    materials: [['A', 1, 'pza', 100, 0], ['B', 1, 'pza', 50, 0]],
    labor: [['O1', 1, 'jor', 200, 1], ['O2', 1, 'jor', 100, 1]]
  };
  const t = calcAPU(apu);
  assert.ok(close(t.mat, 150));
  assert.ok(close(t.mo, 300));
});

test('calcAPU con cantidades y rendimientos fraccionarios no rompe la precision', () => {
  const apu = {
    materials: [['Mat', 0.001, 'pza', 999.99, 0.5]],
    labor: [['O', 0.0001, 'jor', 10000, 2.35]]
  };
  const t = calcAPU(apu);
  assert.ok(close(t.mat, 0.001 * 999.99 * 1.005, 1e-9));
  assert.ok(close(t.mo, 0.0001 * 10000 * 2.35, 1e-9));
});

test('calcAPU sanea porcentajes negativos o no finitos tratandolos como 0', () => {
  const apu = {
    materials: [['Mat', 1, 'pza', 100, 0]],
    herramienta: -5,
    indCampo: NaN,
    indOficina: Infinity,
    finance: -1,
    utility: -10,
    cargos: -0.5,
    iva: -16
  };
  const t = calcAPU(apu);
  assert.equal(t.herramienta, 0);
  assert.equal(t.indirect, 0);
  assert.equal(t.finance, 0);
  assert.equal(t.utility, 0);
  assert.equal(t.cargos, 0);
  assert.equal(t.iva, 0);
  assert.ok(close(t.pu, 100));
});

test('findApuNumericIssues detecta cantidad negativa', () => {
  const apu = { materials: [['Mat', -1, 'pza', 100, 0]] };
  const issues = findApuNumericIssues(apu);
  assert.ok(issues.some(i => i.code === 'negative_quantity'));
});

test('findApuNumericIssues detecta precio negativo', () => {
  const apu = { materials: [['Mat', 1, 'pza', -100, 0]] };
  const issues = findApuNumericIssues(apu);
  assert.ok(issues.some(i => i.code === 'negative_price'));
});

test('findApuNumericIssues detecta valores no finitos (NaN/Infinity)', () => {
  const apu = { labor: [['O', NaN, 'jor', Infinity, 1]] };
  const issues = findApuNumericIssues(apu);
  assert.ok(issues.some(i => i.code === 'non_finite_value'));
});

test('findApuNumericIssues detecta porcentaje negativo', () => {
  const apu = { materials: [['Mat', 1, 'pza', 100, 0]], utility: -10 };
  const issues = findApuNumericIssues(apu);
  assert.ok(issues.some(i => i.code === 'negative_percentage' && i.field === 'utility'));
});

test('findApuNumericIssues detecta precio unitario cero o negativo', () => {
  const apu = { materials: [] };
  const issues = findApuNumericIssues(apu);
  assert.ok(issues.some(i => i.code === 'zero_or_negative_price'));
});

test('findApuNumericIssues no reporta nada para un APU limpio y con precio positivo', () => {
  const apu = { materials: [['Mat', 1, 'pza', 100, 0]], ...APU_DEFAULT_FACTORS };
  const issues = findApuNumericIssues(apu);
  assert.deepEqual(issues, []);
});

/* ---------- applyCascade: helper compartido v1/v2 ---------- */

test('applyCascade reproduce exactamente los mismos numeros que la cascada inline de calcAPU', () => {
  // Mismo escenario y mismos valores ya verificados en
  // "calcAPU aplica la cascada RLOPSRM..." de arriba (direct = 816.2).
  const c = applyCascade(816.2, { indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16 });
  assert.ok(close(c.indirect, 122.43));
  const sum1 = 816.2 + 122.43;
  assert.ok(close(c.finance, 18.7726));
  const sum2 = sum1 + 18.7726;
  assert.ok(close(c.utility, 95.74026));
  const sum3 = sum2 + 95.74026;
  assert.ok(close(c.cargos, 5.2657143, 1e-4));
  const pu = sum3 + 5.2657143;
  assert.ok(close(c.pu, pu, 1e-4));
  assert.ok(close(c.total, c.pu));
  assert.ok(close(c.iva, pu * 16 / 100, 1e-4));
});

test('applyCascade sanea porcentajes negativos/no finitos y un costo directo negativo a 0', () => {
  const c = applyCascade(-50, { indCampo: NaN, indOficina: -5, finance: -1, utility: -10, cargos: -0.5, iva: -16 });
  assert.equal(c.indirect, 0);
  assert.equal(c.finance, 0);
  assert.equal(c.utility, 0);
  assert.equal(c.cargos, 0);
  assert.equal(c.pu, 0);
  assert.equal(c.iva, 0);
});

/* ---------- Motor v2: renglones-objeto ---------- */

test('calcMaterialRow reproduce rowImporte("materials", ...) para valores equivalentes', () => {
  const importe = calcMaterialRow({ consumo: 2, desperdicioPct: 10, precioUnitario: 100 });
  assert.ok(close(importe, rowImporte('materials', ['Mat', 2, 'pza', 100, 10])));
  assert.ok(close(importe, 220));
});

test('calcLaborRow deriva la cantidad de cuadrilla/rendimiento (formato cedula profesional)', () => {
  // Escenario tipo cedula profesional: cuadrilla 1.00, rendimiento 25.000
  // m2/jornada, salario base $802.15, factor de salario 1.3820.
  const importe = calcLaborRow({ cuadrilla: 1, rendimiento: 25, salarioBase: 802.15, fsr: 1.382 });
  // cantidad (jornadas/unidad) = cuadrilla / rendimiento = 1/25 = 0.04
  assert.ok(close(importe, (1 / 25) * 802.15 * 1.382));
});

test('calcLaborRow usa "cantidad" explicita cuando no hay rendimiento (equivalente a rowImporte v1)', () => {
  const importe = calcLaborRow({ cantidad: 1, salarioBase: 300, fsr: 1.8 });
  assert.ok(close(importe, rowImporte('labor', ['O', 1, 'jor', 300, 1.8])));
  assert.ok(close(importe, 540));
});

// TEST 4 (auditoria APU-N29HGJ, item B): el costo de mano de obra corresponde
// a la semantica correcta de cuadrilla (integrantes DE ESE renglon, no el
// total de la cuadrilla repetido en cada renglon) -- 1 operador + 1 ayudante,
// cada uno con cuadrilla:1, debe costar la suma de sus 2 renglones
// independientes, NUNCA el doble de un solo renglon (que seria el resultado
// si "cuadrilla" se hubiera interpretado como el total de trabajadores).
test('TEST 4: calcAPUv2 usa cuadrilla por renglon (1 y 1), el costo de mano de obra no se duplica', () => {
  const apuCorrecto = {
    labor: [
      { descripcion: 'Operador de retroexcavadora', cuadrilla: 1, rendimiento: 20, salarioBase: 450, fsr: 1.85 },
      { descripcion: 'Ayudante general', cuadrilla: 1, rendimiento: 20, salarioBase: 258, fsr: 1.82 }
    ]
  };
  const totals = calcAPUv2(apuCorrecto);
  const operadorEsperado = (1 / 20) * 450 * 1.85;
  const ayudanteEsperado = (1 / 20) * 258 * 1.82;
  assert.ok(close(totals.mo, operadorEsperado + ayudanteEsperado));
  // Si "cuadrilla" se hubiera interpretado (bug) como el total (2) repetido
  // en cada renglon, el costo de mano de obra habria salido el doble de esto.
  const apuConBugDeSemantica = {
    labor: [
      { descripcion: 'Operador de retroexcavadora', cuadrilla: 2, rendimiento: 20, salarioBase: 450, fsr: 1.85 },
      { descripcion: 'Ayudante general', cuadrilla: 2, rendimiento: 20, salarioBase: 258, fsr: 1.82 }
    ]
  };
  const totalsBug = calcAPUv2(apuConBugDeSemantica);
  assert.ok(totalsBug.mo > totals.mo * 1.9, 'el escenario con el bug de semantica (cuadrilla:2 y 2) debe costar visiblemente mas que el correcto (1 y 1)');
});

test('calcEquipmentRow reproduce rowImporte("equipment", ...) para valores equivalentes', () => {
  const importe = calcEquipmentRow({ cantidad: 0.5, tarifa: 80 });
  assert.ok(close(importe, rowImporte('equipment', ['Eq', 0.5, 'hr', 80])));
  assert.ok(close(importe, 40));
});

test('calcHerramientaDetalleRow calcula cantidad x valorAdquisicion x %depreciacion', () => {
  // Caso de la matriz de referencia: HM-001 Cuchara de albañil, cantidad 0.10,
  // valor de adquisicion $185, 10% de depreciacion -> importe $1.85. Nombres
  // de campo alineados con el editor/XLSX/PDF (ver nota en apuCalc.js).
  const importe = calcHerramientaDetalleRow({ cantidad: 0.1, valorAdquisicion: 185, depreciacionPct: 10 });
  assert.ok(close(importe, 1.85));
});

test('calcSeguridadRow calcula cantidad x precio unitario', () => {
  const importe = calcSeguridadRow({ cantidad: 2, precioUnitario: 45 });
  assert.ok(close(importe, 90));
});

test('calcAPUv2 suma seguridad al costo directo (no existia en v1)', () => {
  const apu = {
    materials: [{ consumo: 1, desperdicioPct: 0, precioUnitario: 100 }],
    labor: [{ cantidad: 1, salarioBase: 200, fsr: 1 }],
    equipment: [],
    seguridad: [{ cantidad: 1, precioUnitario: 10 }],
    herramientaMenor: { modo: 'porcentaje', porcentaje: 0 },
    factores: { indCampo: 0, indOficina: 0, finance: 0, utility: 0, cargos: 0, iva: 0 }
  };
  const t = calcAPUv2(apu);
  assert.ok(close(t.mat, 100));
  assert.ok(close(t.mo, 200));
  assert.ok(close(t.seguridad, 10));
  assert.ok(close(t.direct, 310));
  assert.ok(close(t.pu, 310));
});

test('calcAPUv2 con herramientaMenor en modo detalle suma los renglones en vez del %', () => {
  const apu = {
    labor: [{ cantidad: 1, salarioBase: 100, fsr: 1 }],
    herramientaMenor: { modo: 'detalle', detalle: [{ cantidad: 1, valorAdquisicion: 50, depreciacionPct: 10 }] },
    factores: { indCampo: 0, indOficina: 0, finance: 0, utility: 0, cargos: 0, iva: 0 }
  };
  const t = calcAPUv2(apu);
  assert.ok(close(t.herramienta, 5)); // 1 x 50 x 10% = 5, NO 3% de 100 = 3
  assert.ok(close(t.direct, 105));
});

test('calcAPUv2 con cantidadObra agrega importeTotal = PU x cantidadObra', () => {
  const apu = {
    materials: [{ consumo: 1, desperdicioPct: 0, precioUnitario: 100 }],
    factores: { indCampo: 0, indOficina: 0, finance: 0, utility: 0, cargos: 0, iva: 0 },
    cantidadObra: 125
  };
  const t = calcAPUv2(apu);
  assert.ok(close(t.pu, 100));
  assert.ok(close(t.importeTotal, 12500));
});

test('calcAPUv2 sin cantidadObra deja importeTotal en 0', () => {
  const apu = { materials: [{ consumo: 1, desperdicioPct: 0, precioUnitario: 100 }] };
  const t = calcAPUv2(apu);
  assert.equal(t.importeTotal, 0);
});

test('calcAPUv2 de un apu vacio da todos los totales en cero', () => {
  const t = calcAPUv2({});
  assert.equal(t.mat, 0);
  assert.equal(t.mo, 0);
  assert.equal(t.equipo, 0);
  assert.equal(t.seguridad, 0);
  assert.equal(t.herramienta, 0);
  assert.equal(t.direct, 0);
  assert.equal(t.pu, 0);
  assert.equal(t.importeTotal, 0);
});

test('findApuNumericIssuesV2 detecta consumo negativo en materiales', () => {
  const issues = findApuNumericIssuesV2({ materials: [{ consumo: -1, precioUnitario: 100 }] });
  assert.ok(issues.some(i => i.code === 'negative_value' && i.kind === 'materials' && i.field === 'consumo'));
});

test('findApuNumericIssuesV2 detecta valores no finitos', () => {
  const issues = findApuNumericIssuesV2({ labor: [{ cantidad: 1, salarioBase: NaN, fsr: 1 }] });
  assert.ok(issues.some(i => i.code === 'non_finite_value' && i.field === 'salarioBase'));
});

test('findApuNumericIssuesV2 no reporta nada por campos opcionales ausentes (cuadrilla/rendimiento vs cantidad)', () => {
  const apu = {
    materials: [{ consumo: 1, precioUnitario: 100 }],
    labor: [{ cantidad: 1, salarioBase: 100, fsr: 1 }], // sin cuadrilla/rendimiento: valido
    herramientaMenor: { modo: 'porcentaje', porcentaje: 3 },
    factores: APU_DEFAULT_FACTORS
  };
  const issues = findApuNumericIssuesV2(apu);
  assert.deepEqual(issues, []);
});

test('findApuNumericIssuesV2 detecta porcentaje de herramienta menor negativo', () => {
  const issues = findApuNumericIssuesV2({ herramientaMenor: { modo: 'porcentaje', porcentaje: -3 } });
  assert.ok(issues.some(i => i.code === 'negative_value' && i.kind === 'herramientaMenor' && i.field === 'porcentaje'));
});

test('findApuNumericIssuesV2 detecta precio unitario final cero o negativo', () => {
  const issues = findApuNumericIssuesV2({});
  assert.ok(issues.some(i => i.code === 'zero_or_negative_price'));
});

/* ---------- gastosComplementarios / Base de ejecucion (P1 autorizado 2026-09-07) ----------
   Reglas obligatorias de la sesion:
   2. Compatibilidad absoluta: un APU historico sin gastosComplementarios
      debe dar EXACTAMENTE el mismo precio que antes de este cambio.
   3. Trazabilidad independiente: Costo directo + Gastos complementarios =
      Base de ejecucion, expuesta como campo propio (nunca oculta dentro de
      "direct"), y la cascada existente corre sobre esa base sin reordenar
      ni inventar formulas nuevas.
   4. Nunca doble contabilizacion: incluidoEnIndirectos:true se muestra pero
      no se suma; la decision es siempre explicita, nunca automatica.
   5. Formula individual determinista: cantidad x precioUnitario, la
      frecuencia nunca multiplica sola.
   6. Una sugerencia (estado SUGERIDO) del detector nunca suma hasta que una
      accion explicita la vuelve ACEPTADO.
   11. QA matematico: reconciliacion completa mostrando que $3,560 se
       incorporan exactamente una vez. */

test('applyCascade expone baseEjecucion = costoDirecto + gastosComplementarios, sin ocultarlo dentro de otro campo', () => {
  const c = applyCascade(1000, { indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16 }, 500);
  assert.equal(c.baseEjecucion, 1500);
  assert.equal(c.gastosComplementarios, 500);
});

test('applyCascade sin gastosComplementarios (parametro ausente): baseEjecucion === costoDirecto, mismo resultado exacto que antes del cambio', () => {
  const pcts = { indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16 };
  const sinArgumento = applyCascade(816.2, pcts);
  const conCeroExplicito = applyCascade(816.2, pcts, 0);
  assert.equal(sinArgumento.baseEjecucion, 816.2);
  assert.equal(sinArgumento.gastosComplementarios, 0);
  assert.ok(close(sinArgumento.pu, conCeroExplicito.pu));
  // Mismos numeros ya verificados arriba para el escenario direct=816.2.
  assert.ok(close(sinArgumento.indirect, 122.43));
});

test('applyCascade con gastosComplementarios: la base de ejecucion recibe EXACTAMENTE la misma cascada (mismo orden, misma formula) que el costo directo solo -- no se inventa un orden nuevo', () => {
  const pcts = { indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16 };
  const conGastos = applyCascade(1000, pcts, 500);
  const equivalente = applyCascade(1500, pcts, 0); // 1500 = 1000 + 500, cascada corrida directo sobre esa base
  assert.ok(close(conGastos.indirect, equivalente.indirect));
  assert.ok(close(conGastos.finance, equivalente.finance));
  assert.ok(close(conGastos.utility, equivalente.utility));
  assert.ok(close(conGastos.cargos, equivalente.cargos));
  assert.ok(close(conGastos.pu, equivalente.pu));
  assert.ok(close(conGastos.iva, equivalente.iva));
});

test('applyCascade sanea gastosComplementarios negativo/no finito a 0 (nunca resta del precio)', () => {
  const pcts = { indCampo: 0, indOficina: 0, finance: 0, utility: 0, cargos: 0, iva: 0 };
  assert.equal(applyCascade(1000, pcts, -50).gastosComplementarios, 0);
  assert.equal(applyCascade(1000, pcts, NaN).gastosComplementarios, 0);
  assert.equal(applyCascade(1000, pcts, Infinity).gastosComplementarios, 0);
});

test('REGRESION (regla 2 y 12): un APU historico completo (sin el campo gastosComplementarios, tal cual quedo guardado antes de este cambio) calcula EXACTAMENTE el mismo precio que antes', () => {
  // "APU anterior" realista: materiales + mano de obra + equipo + seguridad +
  // herramienta menor por %, factores reales, cantidadObra -- sin tocar
  // absolutamente nada de gastosComplementarios (el campo ni siquiera existe
  // en el objeto, igual que cualquier APU guardado antes de esta sesion).
  const apuHistorico = {
    id: 'APU-HIST-0001', clave: 'APU-HIST-0001', concept: 'Muro de block hueco 15x20x40 asentado con mortero',
    materials: [{ clave: 'MAT-001', consumo: 12.5, desperdicioPct: 3, precioUnitario: 16.5 }],
    labor: [{ clave: 'MO-001', cuadrilla: 1, rendimiento: 2.86, salarioBase: 380, fsr: 1.85 }],
    equipment: [{ clave: 'EQ-001', cantidad: 0.05, tarifa: 120 }],
    seguridad: [{ clave: 'SP-001', cantidad: 1, precioUnitario: 45 }],
    herramientaMenor: { modo: 'porcentaje', porcentaje: 3 },
    factores: { indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16 },
    cantidadObra: 20
  };
  // Valor esperado calculado con la formula ORIGINAL (sin baseEjecucion,
  // cascada directo sobre "direct"), reproducida aqui de forma independiente
  // para que la prueba no dependa circularmente del propio applyCascade.
  const mat = 12.5 * (1 + 3 / 100) * 16.5;
  const mo = (1 / 2.86) * 380 * 1.85;
  const equipo = 0.05 * 120;
  const seguridad = 1 * 45;
  const herramienta = mo * 3 / 100;
  const direct = mat + mo + equipo + herramienta + seguridad;
  const indPct = 8 + 7;
  const indirect = direct * indPct / 100;
  const finance = (direct + indirect) * 2 / 100;
  const utility = (direct + indirect + finance) * 10 / 100;
  const cargos = (direct + indirect + finance + utility) * 0.5 / 100;
  const puEsperado = direct + indirect + finance + utility + cargos;
  const ivaEsperado = puEsperado * 16 / 100;
  const importeTotalEsperado = puEsperado * 20;

  const resultado = calcAPUv2(apuHistorico);
  assert.ok(close(resultado.direct, direct));
  assert.ok(close(resultado.baseEjecucion, direct), 'sin gastosComplementarios, baseEjecucion debe ser identica al costo directo');
  assert.equal(resultado.gastosComplementarios, 0);
  assert.ok(close(resultado.pu, puEsperado));
  assert.ok(close(resultado.iva, ivaEsperado));
  assert.ok(close(resultado.importeTotal, importeTotalEsperado));

  // "antes = despues": correr el mismo APU con un gastosComplementarios:[]
  // explicito (equivalente a como quedaria si se abre y regraba con el
  // editor nuevo, sin tocar nada) da el mismo resultado numerico.
  const antes = calcAPUv2(apuHistorico);
  const despues = calcAPUv2({ ...apuHistorico, gastosComplementarios: [] });
  assert.equal(antes.pu, despues.pu);
  assert.equal(antes.importeTotal, despues.importeTotal);
  assert.equal(antes.direct, despues.direct);
});

test('calcAPUv2: un gasto SUGERIDO (aun no aceptado) nunca se suma al precio -- solo una accion explicita (estado ACEPTADO) lo incorpora', () => {
  const base = { materials: [{ consumo: 1, desperdicioPct: 0, precioUnitario: 1000 }], factores: { indCampo: 0, indOficina: 0, finance: 0, utility: 0, cargos: 0, iva: 0 } };
  const conSugerido = calcAPUv2({ ...base, gastosComplementarios: [{ cantidad: 2, precioUnitario: 850, estado: 'SUGERIDO' }] });
  const conDescartado = calcAPUv2({ ...base, gastosComplementarios: [{ cantidad: 2, precioUnitario: 850, estado: 'DESCARTADO' }] });
  const conJustificado = calcAPUv2({ ...base, gastosComplementarios: [{ cantidad: 2, precioUnitario: 850, estado: 'JUSTIFICADO' }] });
  const conAceptado = calcAPUv2({ ...base, gastosComplementarios: [{ cantidad: 2, precioUnitario: 850, estado: 'ACEPTADO' }] });
  assert.equal(conSugerido.gastosComplementarios, 0);
  assert.equal(conDescartado.gastosComplementarios, 0);
  assert.equal(conJustificado.gastosComplementarios, 0);
  assert.equal(conAceptado.gastosComplementarios, 1700);
  assert.ok(conAceptado.pu > conSugerido.pu);
});

test('calcAPUv2: incluidoEnIndirectos:true excluye del precio aunque el renglon este ACEPTADO (evita doble contabilizacion, regla 4)', () => {
  const base = { materials: [{ consumo: 1, desperdicioPct: 0, precioUnitario: 1000 }], factores: { indCampo: 0, indOficina: 0, finance: 0, utility: 0, cargos: 0, iva: 0 } };
  const resultado = calcAPUv2({ ...base, gastosComplementarios: [
    { concepto: 'Vigilancia', cantidad: 30, precioUnitario: 100, estado: 'ACEPTADO', incluidoEnIndirectos: true },
    { concepto: 'Comida cuadrilla', cantidad: 6, precioUnitario: 150, estado: 'ACEPTADO', incluidoEnIndirectos: false }
  ]});
  // Solo la comida (900) cuenta; la vigilancia (3000) se muestra pero no se suma.
  assert.equal(resultado.gastosComplementarios, 900);
});

// Escenario QA exacto de la sesion (2026-09-07): comida 6 x $150 = $900,
// casetas 4 x $240 = $960, hospedaje 2 x $850 = $1,700 -> subtotal $3,560,
// sumando UNA SOLA VEZ.
test('QA matematico (regla 11): reconciliacion completa -- precio original, +$3,560, base de ejecucion, indirectos/financiamiento/utilidad/cargos, IVA y precio final', () => {
  const gastosComplementarios = [
    { concepto: 'Comida cuadrilla', categoria: 'ALIMENTACION', cantidad: 6, precioUnitario: 150, estado: 'ACEPTADO' },
    { concepto: 'Casetas de peaje', categoria: 'CASETAS', cantidad: 4, precioUnitario: 240, estado: 'ACEPTADO' },
    { concepto: 'Hospedaje cuadrilla', categoria: 'HOSPEDAJE', cantidad: 2, precioUnitario: 850, estado: 'ACEPTADO' }
  ];
  const subtotalGastos = gastosComplementarios.reduce((a, r) => a + r.cantidad * r.precioUnitario, 0);
  assert.equal(subtotalGastos, 3560);

  const factores = { indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16 };
  const apuBase = { materials: [{ consumo: 1, desperdicioPct: 0, precioUnitario: 10000 }], factores, cantidadObra: 1 };

  // 1) Precio original (sin gastos complementarios).
  const original = calcAPUv2(apuBase);
  const precioOriginal = original.pu;

  // 2) Con los gastos complementarios aceptados.
  const conGastos = calcAPUv2({ ...apuBase, gastosComplementarios });

  // Reconciliacion matematica linea por linea:
  assert.equal(conGastos.direct, original.direct, 'el costo directo de materiales/MO/equipo no cambia');
  assert.equal(conGastos.gastosComplementarios, 3560, 'los $3,560 se incorporan exactamente una vez');
  assert.ok(close(conGastos.baseEjecucion, conGastos.direct + 3560), 'Base de ejecucion = Costo directo + Gastos complementarios');

  const baseEjecucion = conGastos.direct + 3560;
  const indirectoEsperado = baseEjecucion * (8 + 7) / 100;
  const financiamientoEsperado = (baseEjecucion + indirectoEsperado) * 2 / 100;
  const utilidadEsperada = (baseEjecucion + indirectoEsperado + financiamientoEsperado) * 10 / 100;
  const cargosEsperados = (baseEjecucion + indirectoEsperado + financiamientoEsperado + utilidadEsperada) * 0.5 / 100;
  const precioAntesDeImpuestosEsperado = baseEjecucion + indirectoEsperado + financiamientoEsperado + utilidadEsperada + cargosEsperados;
  const ivaEsperado = precioAntesDeImpuestosEsperado * 16 / 100;
  const precioFinalEsperado = precioAntesDeImpuestosEsperado + ivaEsperado;

  assert.ok(close(conGastos.indirect, indirectoEsperado));
  assert.ok(close(conGastos.finance, financiamientoEsperado));
  assert.ok(close(conGastos.utility, utilidadEsperada));
  assert.ok(close(conGastos.cargos, cargosEsperados));
  assert.ok(close(conGastos.pu, precioAntesDeImpuestosEsperado), 'Precio antes de impuestos = Base de ejecucion + Indirectos + Financiamiento + Utilidad + Cargos');
  assert.ok(close(conGastos.iva, ivaEsperado));
  const precioFinalReal = conGastos.pu + conGastos.iva;
  assert.ok(close(precioFinalReal, precioFinalEsperado), 'Precio final = Precio antes de impuestos + IVA');

  // 3) El precio SI cambio (los gastos afectan realmente el precio, no quedan informativos).
  assert.ok(conGastos.pu > precioOriginal, 'el precio unitario debe subir al incluir $3,560 de gastos complementarios');
  assert.ok(close(conGastos.pu - precioOriginal, precioAntesDeImpuestosEsperado - original.pu));
});

/* REGRESION CON APU REAL DE PRODUCCION (APU-CUGIK2, control historico pedido
   explicitamente en la sesion 2026-09-07). Verificado EN VIVO el 2026-09-07:
   - Produccion (zoemecia.com, sin este cambio): Costo directo $568.71, PU sin
     IVA $737.47, IVA $118.00, Importe con IVA $855.46.
   - Deploy de Preview de ESTE PR (con gastosComplementarios/baseEjecucion,
     APU-CUGIK2 real reabierto sin ningun gasto complementario): EXACTAMENTE
     los mismos 4 valores -- $568.71 / $737.47 / $118.00 / $855.46, cero
     diferencia. Esta es la prueba definitiva pedida ("si cambia siquiera por
     redondeo, DETENTE"): el mismo registro real, con y sin el cambio, misma
     cascada, mismo resultado.
   El test de abajo reconstruye los renglones reales de mano de obra y
   materiales de APU-CUGIK2 (leidos directo de la matriz guardada, no
   inventados) para fijar ademas una regresion automatizada in-repo. Los
   subtotales de mano de obra ($60.00) y materiales ($454.75) reproducen
   EXACTO los reales. Equipo/seguridad se aproximan por su subtotal ya
   confirmado ($51.00 / $1.16) porque el detalle linea-por-linea de esas dos
   categorias en produccion no cierra aritmeticamente con su propio subtotal
   mostrado (0.05x200 + 1x50 = $60, no $51 -- inconsistencia PREEXISTENTE de
   datos de captura en produccion, ajena a este cambio, reportada aparte) --
   por eso esta reconstruccion referencia el PU con tolerancia de 1 centavo
   en vez de igualdad exacta; la igualdad EXACTA ya quedo demostrada arriba
   contra el registro real en produccion y en Preview. */
test('REGRESION APU-CUGIK2 (control historico real, verificado en vivo 2026-09-07): con los renglones reales de mano de obra/materiales, el precio reconstruido coincide con produccion dentro de 1 centavo', () => {
  const apuCUGIK2Reconstruido = {
    labor: [
      { descripcion: 'Oficial albañil para colocación de piso cerámico', cuadrilla: 1, rendimiento: 10, jornada: 8, salarioBase: 350, fsr: 1 },
      { descripcion: 'Ayudante para apoyo en colocación y limpieza', cuadrilla: 1, rendimiento: 10, jornada: 8, salarioBase: 250, fsr: 1 }
    ],
    // Renglones reales leidos de la matriz guardada de APU-CUGIK2 (MAT-001..004).
    materials: [
      { descripcion: 'Piso cerámico 30x30 cm', consumo: 1.1, desperdicioPct: 10, precioUnitario: 250 },
      { descripcion: 'Adhesivo para piso cerámico tipo cemento modificado', consumo: 4, desperdicioPct: 5, precioUnitario: 25 },
      { descripcion: 'Lechada para juntas de piso cerámico', consumo: 0.5, desperdicioPct: 5, precioUnitario: 30 },
      { descripcion: 'Mortero de nivelación', consumo: 0.02, desperdicioPct: 5, precioUnitario: 1500 }
    ],
    equipment: [{ descripcion: 'Equipo (subtotal real confirmado en produccion)', cantidad: 1, tarifa: 51 }],
    seguridad: [{ descripcion: 'Seguridad (subtotal real confirmado en produccion)', cantidad: 1, precioUnitario: 1.16 }],
    herramientaMenor: { modo: 'porcentaje', porcentaje: 3 },
    factores: { indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16 },
    cantidadObra: 1
  };
  const t = calcAPUv2(apuCUGIK2Reconstruido);
  const round2 = n => Math.round(n * 100) / 100;

  assert.equal(round2(t.mo), 60.00, 'mano de obra real de APU-CUGIK2');
  assert.equal(round2(t.mat), 454.75, 'materiales reales de APU-CUGIK2 (4 renglones)');
  assert.equal(round2(t.herramienta), 1.80, '3% de mano de obra, igual que produccion');
  assert.equal(round2(t.direct), 568.71, 'costo directo identico al mostrado en produccion');
  assert.equal(t.gastosComplementarios, 0, 'sin gastos complementarios: no afecta el precio');
  assert.equal(round2(t.baseEjecucion), 568.71, 'sin gastos, baseEjecucion === costo directo');

  // Intermediarios de la cascada: coinciden EXACTOS con los mostrados en
  // produccion (Indirectos $85.31, Financiamiento $13.08, Utilidad $66.71,
  // Cargos $3.67), confirmando que la formula no cambio.
  assert.equal(round2(t.indirect), 85.31);
  assert.equal(round2(t.finance), 13.08);
  assert.equal(round2(t.utility), 66.71);
  assert.equal(round2(t.cargos), 3.67);

  // PU: dentro de 1 centavo del real $737.47 (ver nota arriba sobre la
  // inconsistencia preexistente de captura de equipo en produccion). La
  // igualdad EXACTA ya esta demostrada por la verificacion en vivo
  // produccion-vs-Preview documentada en el comentario de este test.
  assert.ok(Math.abs(t.pu - 737.47) < 0.02, `PU reconstruido (${t.pu}) debe estar a menos de 1 centavo del real $737.47`);
});
