/* Bid Readiness Score: pruebas del "traductor" de motores existentes a un
   score explicable. No vuelve a probar runApuAudit/runBidRisk/runApuConfidence
   (ya cubiertos en sus propios *.test.js) -- verifica que la resta de
   puntos sea transparente, documentada y nunca negativa/inventada. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBidReadiness, BID_READINESS_STATUS } from './bidReadiness.js';
import { SYSTEM_RESOURCES } from './constructionSystems.js';

// Mismo patron de fixture que bidRisk.test.js/apuConfidence.test.js: plantilla
// REAL completa de una disciplina, no un subconjunto elegido a mano.
function templateApuFixture(tipo, overrides = {}){
  const fuente = { proveedor: 'Proveedor Confiable S.A.', fecha: new Date().toISOString(), estado: 'VERIFICADO' };
  const materials = SYSTEM_RESOURCES[tipo].materials.map(([descripcion, consumo, unidad, precioUnitario, desperdicioPct]) => ({ descripcion, consumo, unidad, precioUnitario, desperdicioPct, fuente }));
  const labor = SYSTEM_RESOURCES[tipo].labor.map(([descripcion, coef, unidad, salarioBase, fsr]) => ({ descripcion, cuadrilla: 1, rendimiento: 1 / coef, salarioBase, fsr, fuente, rendimientoFuente: 'HISTORICO' }));
  return {
    concept: `concepto de ${tipo}`, unit: SYSTEM_RESOURCES[tipo].unit, cantidadObra: 80,
    primaryActivity: tipo, classificationMatch: 'exact',
    procedimientoConstructivo: ['paso 1', 'paso 2'], controlCalidad: ['control 1'],
    criterioMedicion: { unidadMedicion: SYSTEM_RESOURCES[tipo].unit }, variables: { volume: 80 },
    materials, labor, equipment: [], consumables: [], seguridad: [], factores: {},
    ...overrides
  };
}
const healthyApuFixture = (overrides = {}) => templateApuFixture('acero', overrides);

function acidRecursoFaltanteFixture(overrides = {}){
  return { concept: 'Acero', unit: 'kg', cantidadObra: 500, primaryActivity: 'acero', materials: [{ descripcion: 'Cemento gris' }], labor: [{ descripcion: 'Fierrero', cuadrilla: 1, rendimiento: 5, salarioBase: 400, fsr: 1.8 }], equipment: [], consumables: [], seguridad: [], factores: {}, ...overrides };
}

test('sin APUs: score null, status NO_DATA, sin deducciones -- nunca un numero de relleno', () => {
  const result = computeBidReadiness([]);
  assert.equal(result.score, null);
  assert.equal(result.status, BID_READINESS_STATUS.NO_DATA);
  assert.deepEqual(result.deductions, []);
  assert.equal(result.totalAPUs, 0);
});

test('un proyecto con APUs sanos (precios con fuente, sin recursos faltantes) obtiene un score alto sin deducciones criticas', () => {
  const apus = [healthyApuFixture(), healthyApuFixture({ concept: 'concepto de acero 2' })];
  const result = computeBidReadiness(apus);
  assert.ok(result.score >= 70, `esperaba score alto, obtuve ${result.score}`);
  assert.equal(result.totalAPUs, 2);
  assert.equal(result.evaluatedAPUs, 2);
  // Ninguna deduccion CRITICAL_AUDIT_FINDINGS ni PRICES_WITHOUT_EVIDENCE:
  // todos los renglones traen fuente VERIFICADO y no falta ningun recurso.
  const codes = result.deductions.map(d => d.code);
  assert.ok(!codes.includes('CRITICAL_AUDIT_FINDINGS'));
  assert.ok(!codes.includes('PRICES_WITHOUT_EVIDENCE'));
});

test('un recurso critico faltante ("acero sin acero") produce la deduccion CRITICAL_AUDIT_FINDINGS y baja el score', () => {
  const sano = computeBidReadiness([healthyApuFixture()]);
  const conFalla = computeBidReadiness([acidRecursoFaltanteFixture()]);
  assert.ok(conFalla.score < sano.score, `esperaba que ${conFalla.score} < ${sano.score}`);
  const deduction = conFalla.deductions.find(d => d.code === 'CRITICAL_AUDIT_FINDINGS');
  assert.ok(deduction, 'deberia existir la deduccion CRITICAL_AUDIT_FINDINGS');
  assert.ok(deduction.count > 0);
  assert.match(deduction.labelEs, /hallazgo/i);
});

test('precios sin fuente producen la deduccion PRICES_WITHOUT_EVIDENCE con el conteo real', () => {
  const apu = healthyApuFixture({
    materials: SYSTEM_RESOURCES.acero.materials.map(([descripcion, consumo, unidad, precioUnitario, desperdicioPct]) => ({ descripcion, consumo, unidad, precioUnitario, desperdicioPct, fuente: {} }))
  });
  const result = computeBidReadiness([apu]);
  const deduction = result.deductions.find(d => d.code === 'PRICES_WITHOUT_EVIDENCE');
  assert.ok(deduction, 'deberia existir la deduccion PRICES_WITHOUT_EVIDENCE');
  assert.equal(deduction.count, apu.materials.length);
});

test('el score nunca baja de 0, sin importar cuantas deducciones se acumulen', () => {
  // Muchos APUs con falla critica multiple (recurso faltante + sin fuente de
  // precio) empujan varias categorias de deduccion a la vez cerca de sus
  // topes individuales -- el score jamas debe volverse negativo.
  const apus = Array.from({ length: 15 }, (_, i) => acidRecursoFaltanteFixture({ concept: `Acero ${i}` }));
  const result = computeBidReadiness(apus);
  assert.ok(result.score >= 0, `el score nunca debe ser negativo, obtuve ${result.score}`);
  assert.ok(result.score <= 10, `esperaba un score muy bajo dado el volumen de fallas, obtuve ${result.score}`);
});

test('un APU con forma invalida (no procesable) no rompe el score del proyecto -- cuenta como evidencia insuficiente', () => {
  const apus = [healthyApuFixture(), { thisIsNotAValidApu: true }];
  assert.doesNotThrow(() => computeBidReadiness(apus));
  const result = computeBidReadiness(apus);
  assert.equal(result.totalAPUs, 2);
  assert.ok(result.evaluatedAPUs <= 2);
});

test('cada categoria de deduccion documenta code/count/points/labelEs/labelEn -- nunca un numero sin explicacion', () => {
  const result = computeBidReadiness([acidRecursoFaltanteFixture()]);
  for(const d of result.deductions){
    assert.equal(typeof d.code, 'string');
    assert.equal(typeof d.count, 'number');
    assert.ok(d.count > 0);
    assert.equal(typeof d.points, 'number');
    assert.ok(d.points > 0);
    assert.match(d.labelEs, /\d/);
    assert.match(d.labelEn, /\d/);
  }
});

test('status refleja el score: >=90 READY, >=70 READY_WITH_OBSERVATIONS, >=50 NEEDS_REVIEW, <50 NOT_READY', () => {
  const sano = computeBidReadiness([healthyApuFixture(), healthyApuFixture({ concept: 'acero 2' })]);
  assert.ok([BID_READINESS_STATUS.READY, BID_READINESS_STATUS.READY_WITH_OBSERVATIONS].includes(sano.status));

  const muyMal = computeBidReadiness(Array.from({ length: 10 }, (_, i) => acidRecursoFaltanteFixture({ concept: `Acero ${i}` })));
  assert.equal(muyMal.status, BID_READINESS_STATUS.NOT_READY);
});

test('computeBidReadiness es determinista: mismos APUs producen siempre el mismo score', () => {
  const apus = [healthyApuFixture(), acidRecursoFaltanteFixture()];
  const a = computeBidReadiness(apus, { now: '2026-01-01T00:00:00Z' });
  const b = computeBidReadiness(apus, { now: '2026-01-01T00:00:00Z' });
  assert.equal(a.score, b.score);
  assert.deepEqual(a.deductions, b.deductions);
});
