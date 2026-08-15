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

test('calcEquipmentRow reproduce rowImporte("equipment", ...) para valores equivalentes', () => {
  const importe = calcEquipmentRow({ cantidad: 0.5, tarifa: 80 });
  assert.ok(close(importe, rowImporte('equipment', ['Eq', 0.5, 'hr', 80])));
  assert.ok(close(importe, 40));
});

test('calcHerramientaDetalleRow calcula cantidad x costo x %depreciacion', () => {
  // Caso de la matriz de referencia: HM-001 Cuchara de albañil, cantidad 0.10,
  // costo de reposicion $185, 10% de depreciacion -> importe $1.85.
  const importe = calcHerramientaDetalleRow({ cantidad: 0.1, costo: 185, pctDepreciacion: 10 });
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
    herramientaMenor: { modo: 'detalle', detalle: [{ cantidad: 1, costo: 50, pctDepreciacion: 10 }] },
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
