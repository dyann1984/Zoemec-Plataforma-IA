import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeResourceOverconsumption } from './resourceOverconsumption.js';

function row(overrides = {}){
  return {
    key: 'block-hueco', descripcion: 'Block hueco de concreto', unidad: 'pza', cantidadFinal: 1000, precioUnitario: 17.2,
    origenes: [{ apuId: 'APU-1', cantidadFinalAportada: 1000 }], ...overrides
  };
}

test('sin insumos, arreglo vacio (nunca lanza)', () => {
  assert.deepEqual(computeResourceOverconsumption({}), []);
});

test('siempre calcula presupuestada y teorica ejecutada, aunque no haya dato reportado (informativo, nunca marca sobreconsumo)', () => {
  const avanceFisicoPctByApuId = new Map([['APU-1', 50]]);
  const [r] = computeResourceOverconsumption({ explosionRows: [row()], avanceFisicoPctByApuId });
  assert.equal(r.presupuestada, 1000);
  assert.equal(r.teoricaEjecutada, 500);
  assert.equal(r.reportadaUsada, null);
  assert.equal(r.hasOverconsumption, false, 'sin dato independiente de uso real, nunca se marca sobreconsumo (no inventar consumo)');
});

test('con cantidad reportada real dentro del umbral, no marca sobreconsumo', () => {
  const reportedUsageByResourceKey = new Map([['block-hueco', 1050]]); // 5% arriba, umbral default 10%
  const [r] = computeResourceOverconsumption({ explosionRows: [row()], reportedUsageByResourceKey });
  assert.equal(r.hasOverconsumption, false);
});

test('con cantidad reportada real por encima del umbral, marca sobreconsumo con severidad segun magnitud', () => {
  const reportedUsageByResourceKey = new Map([['block-hueco', 1150]]); // 15% arriba -> MEDIA
  const [r] = computeResourceOverconsumption({ explosionRows: [row()], reportedUsageByResourceKey });
  assert.equal(r.hasOverconsumption, true);
  assert.equal(r.severity, 'MEDIA');
  assert.ok(Math.abs(r.desviacionPct - 15) < 1e-6);
  assert.ok(Math.abs(r.impactoEstimado - (150 * 17.2)) < 1e-6);

  const reportedUsageAlta = new Map([['block-hueco', 1400]]); // 40% arriba -> ALTA
  const [rAlta] = computeResourceOverconsumption({ explosionRows: [row()], reportedUsageByResourceKey: reportedUsageAlta });
  assert.equal(rAlta.severity, 'ALTA');
});

test('la teorica ejecutada suma por APU segun el avance fisico REAL del concepto que usa ese APU, nunca un promedio inventado', () => {
  const multiOrigen = row({ cantidadFinal: 2000, origenes: [{ apuId: 'APU-1', cantidadFinalAportada: 1000 }, { apuId: 'APU-2', cantidadFinalAportada: 1000 }] });
  const avanceFisicoPctByApuId = new Map([['APU-1', 100], ['APU-2', 0]]);
  const [r] = computeResourceOverconsumption({ explosionRows: [multiOrigen], avanceFisicoPctByApuId });
  assert.equal(r.teoricaEjecutada, 1000, 'APU-1 al 100% aporta completo, APU-2 al 0% no aporta nada');
});

test('un APU sin avance registrado (no esta en el mapa) no aporta a la teorica -- nunca se asume 0 ni se inventa un valor', () => {
  const [r] = computeResourceOverconsumption({ explosionRows: [row()], avanceFisicoPctByApuId: new Map() });
  assert.equal(r.teoricaEjecutada, 0);
});
