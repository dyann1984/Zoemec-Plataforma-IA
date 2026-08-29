/* ZOEMEC SCENARIO ENGINE (Fase 3): pruebas del simulador what-if. Fixtures
   con plantillas REALES completas de SYSTEM_RESOURCES (mismo criterio que
   apuConfidence.test.js/bidRisk.test.js -- un subconjunto truncado
   distorsiona proporciones de costo). Cubre al menos 3 disciplinas distintas
   (acero, piso, acarreo_manual, concreto) para no hardcodear solo concreto. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenario, compareScenarios, applyChangeAcrossProject, CHANGE_TYPE, WARNING_CODE } from './apuScenario.js';
import { calcAPUv2 } from '../lib/apuCalc.js';
import { SYSTEM_RESOURCES } from './constructionSystems.js';

function templateApuFixture(tipo, overrides = {}){
  const fuente = { proveedor: 'Proveedor Confiable S.A.', fecha: new Date().toISOString(), estado: 'VERIFICADO' };
  const materials = SYSTEM_RESOURCES[tipo].materials.map(([descripcion, consumo, unidad, precioUnitario, desperdicioPct]) => ({ descripcion, consumo, unidad, precioUnitario, desperdicioPct, fuente }));
  const labor = SYSTEM_RESOURCES[tipo].labor.map(([descripcion, coef, unidad, salarioBase, fsr]) => ({ descripcion, cuadrilla: 1, rendimiento: 1 / coef, salarioBase, fsr, fuente, rendimientoFuente: 'HISTORICO' }));
  const equipment = (SYSTEM_RESOURCES[tipo].equipment || []).map(([descripcion, cantidad, unidad, tarifa]) => ({ descripcion, cantidad, unidad, tarifa, integracion: 'POR_UNIDAD_OBRA' }));
  return {
    concept: `concepto de ${tipo}`, unit: SYSTEM_RESOURCES[tipo].unit, cantidadObra: 100,
    primaryActivity: tipo, classificationMatch: 'exact',
    procedimientoConstructivo: ['paso 1', 'paso 2'], controlCalidad: ['control 1'],
    criterioMedicion: { unidadMedicion: SYSTEM_RESOURCES[tipo].unit }, variables: {},
    materials, labor, equipment, consumables: [], seguridad: [], factores: {},
    ...overrides
  };
}

// CASO A: material +10%.
test('CASO A: PRICE_PERCENT_CHANGE +10% sobre un material sube el costo unitario del escenario', () => {
  const apu = templateApuFixture('acero');
  const result = createScenario({ apu, changes: [{ type: CHANGE_TYPE.PRICE_PERCENT_CHANGE, selector: { descripcion: 'Acero de refuerzo fy=4200' }, value: 10 }] });
  assert.equal(result.warnings.length, 0);
  assert.equal(result.appliedChanges.length, 1);
  assert.ok(result.delta.scenarioUnitCost > result.delta.baseUnitCost);
  assert.equal(result.appliedChanges[0].field, 'precioUnitario');
  assert.ok(Math.abs(result.appliedChanges[0].newValue - result.appliedChanges[0].previousValue * 1.1) < 1e-9);
});

// CASO B: mano de obra +15%.
test('CASO B: LABOR_COST_PERCENT_CHANGE +15% solo afecta renglones de labor', () => {
  const apu = templateApuFixture('acero');
  const result = createScenario({ apu, changes: [{ type: CHANGE_TYPE.LABOR_COST_PERCENT_CHANGE, selector: { kind: 'labor' }, value: 15 }] });
  assert.equal(result.appliedChanges.length, apu.labor.length);
  result.appliedChanges.forEach(c => assert.equal(c.kind, 'labor'));
  assert.ok(result.delta.scenarioUnitCost > result.delta.baseUnitCost);
});

// CASO C: rendimiento -20%.
test('CASO C: PRODUCTIVITY_PERCENT_CHANGE -20% sube el costo (menos rendimiento = mas jornadas)', () => {
  const apu = templateApuFixture('acarreo_manual', { cantidadObra: 300 });
  const result = createScenario({ apu, changes: [{ type: CHANGE_TYPE.PRODUCTIVITY_PERCENT_CHANGE, selector: { kind: 'labor' }, value: -20 }] });
  assert.equal(result.appliedChanges.length, 1);
  assert.ok(result.delta.scenarioUnitCost > result.delta.baseUnitCost);
});

// CASO D: desperdicio +5 puntos.
test('CASO D: WASTE_PERCENT_CHANGE +5 (puntos, aditivo) sube desperdicioPct sin tocar otros campos', () => {
  const apu = templateApuFixture('piso');
  const before = apu.materials.find(m => m.descripcion === 'Loseta cerámica 30x30').desperdicioPct;
  const result = createScenario({ apu, changes: [{ type: CHANGE_TYPE.WASTE_PERCENT_CHANGE, selector: { descripcion: 'Loseta cerámica 30x30' }, value: 5 }] });
  assert.equal(result.appliedChanges[0].field, 'desperdicioPct');
  assert.equal(result.appliedChanges[0].newValue, before + 5);
  assert.ok(result.delta.scenarioUnitCost > result.delta.baseUnitCost);
});

// CASO E: override de precio.
test('CASO E: RESOURCE_PRICE_OVERRIDE fija un precio absoluto exacto', () => {
  const apu = templateApuFixture('acero');
  const result = createScenario({ apu, changes: [{ type: CHANGE_TYPE.RESOURCE_PRICE_OVERRIDE, selector: { descripcion: 'Acero de refuerzo fy=4200' }, mode: 'absolute', value: 30 }] });
  assert.equal(result.appliedChanges[0].newValue, 30);
  assert.equal(result.scenario.materials.find(m => m.descripcion === 'Acero de refuerzo fy=4200').precioUnitario, 30);
});

// CASO F: recurso inexistente.
test('CASO F: selector sin coincidencias produce warning RESOURCE_NOT_FOUND, no corrompe el escenario', () => {
  const apu = templateApuFixture('acero');
  const result = createScenario({ apu, changes: [{ type: CHANGE_TYPE.PRICE_PERCENT_CHANGE, selector: { descripcion: 'Material que no existe' }, value: 10 }] });
  assert.equal(result.appliedChanges.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, WARNING_CODE.RESOURCE_NOT_FOUND);
  assert.deepEqual(result.scenario.materials, result.base.materials);
});

// CASO G: precio negativo.
test('CASO G: precio absoluto negativo se rechaza (NEGATIVE_PRICE_NOT_ALLOWED), no se aplica', () => {
  const apu = templateApuFixture('acero');
  const result = createScenario({ apu, changes: [{ type: CHANGE_TYPE.PRICE_ABSOLUTE_CHANGE, selector: { descripcion: 'Acero de refuerzo fy=4200' }, mode: 'absolute', value: -5 }] });
  assert.equal(result.appliedChanges.length, 0);
  assert.equal(result.warnings[0].code, WARNING_CODE.NEGATIVE_PRICE_NOT_ALLOWED);
  assert.deepEqual(result.scenario.materials, result.base.materials);
});

// CASO H: rendimiento cero.
test('CASO H: rendimiento llevado a 0 se rechaza (INVALID_PRODUCTIVITY), no se aplica', () => {
  const apu = templateApuFixture('acero');
  const result = createScenario({ apu, changes: [{ type: CHANGE_TYPE.PRODUCTIVITY_PERCENT_CHANGE, selector: { kind: 'labor', descripcion: apu.labor[0].descripcion }, value: -100 }] });
  assert.equal(result.appliedChanges.length, 0);
  assert.equal(result.warnings[0].code, WARNING_CODE.INVALID_PRODUCTIVITY);
});

// CASO I: el APU original no se muta.
test('CASO I: el apu original pasado a createScenario permanece byte-equivalente', () => {
  const apu = templateApuFixture('concreto');
  const snapshot = JSON.stringify(apu);
  createScenario({ apu, changes: [
    { type: CHANGE_TYPE.PRICE_PERCENT_CHANGE, selector: { kind: 'materials' }, value: 25 },
    { type: CHANGE_TYPE.PRODUCTIVITY_PERCENT_CHANGE, selector: { kind: 'labor' }, value: -30 }
  ] });
  assert.equal(JSON.stringify(apu), snapshot, 'el objeto apu original no debe cambiar en absoluto');
});

// CASO J: el escenario recalcula con calcAPUv2 correctamente.
test('CASO J: scenario.calculated coincide exactamente con un calcAPUv2 manual sobre los renglones mutados', () => {
  const apu = templateApuFixture('block');
  const result = createScenario({ apu, changes: [{ type: CHANGE_TYPE.PRICE_PERCENT_CHANGE, selector: { kind: 'materials' }, value: 8 }] });
  const manual = calcAPUv2(result.scenario);
  assert.deepEqual(result.scenario.calculated, manual);
});

// CASO K: Confidence se recalcula.
test('CASO K: Confidence del escenario difiere del base cuando el cambio degrada evidencia (cambio de proveedor sin fuente confirmada)', () => {
  const apu = templateApuFixture('acero');
  const result = createScenario({ apu, changes: [{ type: CHANGE_TYPE.RESOURCE_REPLACEMENT, selector: { descripcion: 'Acero de refuerzo fy=4200' }, replacement: { descripcion: 'Acero de refuerzo (proveedor nuevo, cotizacion sin confirmar)', fuente: {} } }] });
  assert.notDeepEqual(result.confidence.base, result.confidence.scenario);
  assert.ok(result.confidence.scenario.dimensions.prices.score < result.confidence.base.dimensions.prices.score);
});

// CASO L: Bid Risk se recalcula.
test('CASO L: Bid Risk cambia de severidad cuando el escenario introduce un riesgo real', () => {
  const apu = templateApuFixture('acero');
  const result = createScenario({ apu, changes: [{ type: CHANGE_TYPE.PRODUCTIVITY_PERCENT_CHANGE, selector: { kind: 'labor' }, value: 60 }] });
  assert.notEqual(result.bidRisk.base.severity, result.bidRisk.scenario.severity);
});

// CASO M: multiples escenarios comparables.
test('CASO M: compareScenarios rankea 3 escenarios sobre el mismo apu base de forma independiente', () => {
  const apu = templateApuFixture('acero');
  const { scenarios, ranking } = compareScenarios(apu, [
    { label: 'A - Acero +10%', changes: [{ type: CHANGE_TYPE.PRICE_PERCENT_CHANGE, selector: { kind: 'materials' }, value: 10 }] },
    { label: 'B - Mano de obra +15%', changes: [{ type: CHANGE_TYPE.LABOR_COST_PERCENT_CHANGE, selector: { kind: 'labor' }, value: 15 }] },
    { label: 'C - Rendimiento -20%', changes: [{ type: CHANGE_TYPE.PRODUCTIVITY_PERCENT_CHANGE, selector: { kind: 'labor' }, value: -20 }] }
  ]);
  assert.equal(scenarios.length, 3);
  // Cada escenario parte del MISMO apu base -- el orden de la lista no debe afectar el resultado individual.
  scenarios.forEach(s => assert.deepEqual(s.result.base.materials, apu.materials));
  assert.equal(ranking.byCostDesc.length, 3);
  assert.ok(ranking.byCostDesc[0].result.delta.scenarioUnitCost >= ranking.byCostDesc[1].result.delta.scenarioUnitCost);
});

// CASO N: proyecto con multiples APU.
test('CASO N: applyChangeAcrossProject aplica un cambio a varios APU y separa afectados/no afectados', () => {
  const acero = templateApuFixture('acero', { id: 'APU-ACERO' });
  const block = templateApuFixture('block', { id: 'APU-BLOCK' });
  const piso = templateApuFixture('piso', { id: 'APU-PISO' });
  const change = { type: CHANGE_TYPE.PRICE_PERCENT_CHANGE, selector: { descripcion: 'Acero de refuerzo fy=4200' }, value: 15 };
  const project = applyChangeAcrossProject([acero, block, piso], change);
  assert.equal(project.totalAPUs, 3);
  assert.deepEqual(project.affectedApus.map(a => a.apuId), ['APU-ACERO']);
  assert.deepEqual(new Set(project.unaffectedApus.map(a => a.apuId)), new Set(['APU-BLOCK', 'APU-PISO']));
  assert.ok(project.topImpacts[0].apuId === 'APU-ACERO');
});

// CASO O: proyecto sin cantidadObra -> impacto de proyecto null.
test('CASO O: sin cantidadObra capturada en ningun APU afectado, totalProjectDelta es null', () => {
  const acero = templateApuFixture('acero', { id: 'APU-ACERO', cantidadObra: 0 });
  const change = { type: CHANGE_TYPE.PRICE_PERCENT_CHANGE, selector: { kind: 'materials' }, value: 10 };
  const project = applyChangeAcrossProject([acero], change);
  assert.equal(project.totalProjectDelta, null);
  assert.equal(project.affectedApus.length, 1);
  assert.equal(project.topImpacts[0].projectDelta, null);
});

// CASO P: determinismo.
test('CASO P: mismo escenario sobre el mismo apu produce siempre el mismo resultado', () => {
  const apu = templateApuFixture('acero');
  const changes = [{ type: CHANGE_TYPE.PRICE_PERCENT_CHANGE, selector: { kind: 'materials' }, value: 12 }];
  const a = createScenario({ apu, changes, options: { now: '2026-01-01' } });
  const b = createScenario({ apu, changes, options: { now: '2026-01-01' } });
  assert.deepEqual(a, b);
});

// CASO Q: al menos 3 disciplinas distintas ya cubiertas arriba (acero, block,
// piso, acarreo_manual, concreto) -- verificacion explicita adicional con
// una disciplina mas (concreto, historico calibrado) para no hardcodear.
test('CASO Q: PRICE_PERCENT_CHANGE funciona igual sobre una 5a disciplina (concreto)', () => {
  const apu = templateApuFixture('concreto');
  const result = createScenario({ apu, changes: [{ type: CHANGE_TYPE.PRICE_PERCENT_CHANGE, selector: { descripcion: 'Cemento gris CPC 30R' }, value: 20 }] });
  assert.equal(result.appliedChanges.length, 1);
  assert.ok(result.delta.scenarioUnitCost > result.delta.baseUnitCost);
});

// Guardrails adicionales: NaN/Infinity nunca se cuelan.
test('propiedad: un valor no finito en el cambio se rechaza, nunca produce NaN/Infinity en el escenario', () => {
  const apu = templateApuFixture('acero');
  const result = createScenario({ apu, changes: [{ type: CHANGE_TYPE.PRICE_ABSOLUTE_CHANGE, selector: { kind: 'materials' }, mode: 'absolute', value: NaN }] });
  assert.equal(result.appliedChanges.length, 0);
  assert.equal(result.warnings[0].code, WARNING_CODE.NON_FINITE_VALUE);
  assert.ok(Number.isFinite(result.scenario.calculated.pu));
});

test('propiedad: cantidad negativa se rechaza (NEGATIVE_QUANTITY_NOT_ALLOWED)', () => {
  const apu = templateApuFixture('acero');
  const result = createScenario({ apu, changes: [{ type: CHANGE_TYPE.RESOURCE_QUANTITY_CHANGE, selector: { kind: 'materials' }, mode: 'absolute', value: -1 }] });
  assert.equal(result.appliedChanges.length, 0);
  assert.equal(result.warnings[0].code, WARNING_CODE.NEGATIVE_QUANTITY_NOT_ALLOWED);
});

// Provenance (regla 10): cada cambio aplicado explica que paso.
test('provenance: cada cambio aplicado registra tipo, valores antes/despues y razon', () => {
  const apu = templateApuFixture('acero');
  const result = createScenario({ apu, changes: [{ type: CHANGE_TYPE.PRICE_PERCENT_CHANGE, selector: { descripcion: 'Acero de refuerzo fy=4200' }, value: 12, reason: 'Alza reportada por el proveedor', source: 'usuario' }] });
  const record = result.appliedChanges[0];
  assert.equal(record.type, CHANGE_TYPE.PRICE_PERCENT_CHANGE);
  assert.equal(record.resourceDescripcion, 'Acero de refuerzo fy=4200');
  assert.ok(record.previousValue > 0);
  assert.ok(record.newValue > record.previousValue);
  assert.equal(record.reason, 'Alza reportada por el proveedor');
  assert.equal(record.source, 'usuario');
  assert.ok(record.timestamp);
});
