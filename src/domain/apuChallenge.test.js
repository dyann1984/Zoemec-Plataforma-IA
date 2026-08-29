/* ZOEMEC CHALLENGE (Fase 1): pruebas del segundo mecanismo de revision.
   Fixtures armadas directamente contra SYSTEM_RESOURCES (constructionSystems.js)
   para controlar con precision el porcentaje de desviacion de rendimiento y
   poder verificar el impacto economico a mano contra calcAPUv2 -- el mismo
   motor determinista que usa el resto de la plataforma. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runApuChallenge } from './apuChallenge.js';
import { calcAPUv2 } from '../lib/apuCalc.js';
import { SYSTEM_RESOURCES } from './constructionSystems.js';

function apuFixture(overrides = {}){
  return {
    concept: 'Concepto de prueba', unit: 'm2', cantidadObra: 100,
    materials: [], labor: [], equipment: [], consumables: [], seguridad: [],
    factores: {}, ...overrides
  };
}

test('runApuChallenge: rendimiento 30% mas optimista que la plantilla dispara un challenge con impacto verificable', () => {
  const [descripcion, cantidadPorUnidad, , salarioBase, fsr] = SYSTEM_RESOURCES.tablaroca.labor[0];
  const baselineRendimiento = 1 / cantidadPorUnidad;
  const currentRendimiento = baselineRendimiento * 1.3; // 30% mas optimista
  const apu = apuFixture({
    primaryActivity: 'tablaroca',
    labor: [{ descripcion, cuadrilla: 1, rendimiento: currentRendimiento, salarioBase, fsr }]
  });

  const { challenges } = runApuChallenge(apu);
  const finding = challenges.find(c => c.category === 'rendimiento');
  assert.ok(finding, 'debe reportar la desviacion de rendimiento');
  assert.ok(Math.abs(finding.deltaPct - 30) < 0.5);
  assert.equal(finding.baselineSource, 'Plantilla tecnica ZOEMEC (no calibrada contra historico real -- unica base disponible hoy)');
  assert.equal(finding.resourceDescripcion, descripcion, 'Fase 5: identificador estructurado del renglon para que la UI construya un selector exacto sin parsear el titulo');
  assert.equal(finding.resourceKind, 'labor');
  assert.deepEqual(finding.actions, ['MANTENER', 'CORREGIR', 'JUSTIFICAR']);

  // Impacto economico verificado a mano contra calcAPUv2, el mismo motor
  // determinista que usa toda la plataforma -- no un calculo aparte.
  const original = calcAPUv2(apu);
  const withBaseline = structuredClone(apu);
  withBaseline.labor[0] = { ...withBaseline.labor[0], cuadrilla: 1, rendimiento: baselineRendimiento };
  const recalculated = calcAPUv2(withBaseline);
  assert.equal(finding.unitImpact, Number((recalculated.pu - original.pu).toFixed(2)));
  assert.equal(finding.projectImpact, Number((recalculated.importeTotal - original.importeTotal).toFixed(2)));
});

test('runApuChallenge: desviacion menor al umbral (15%) no dispara ningun challenge de rendimiento', () => {
  const [descripcion, cantidadPorUnidad, , salarioBase, fsr] = SYSTEM_RESOURCES.tablaroca.labor[0];
  const baselineRendimiento = 1 / cantidadPorUnidad;
  const apu = apuFixture({
    primaryActivity: 'tablaroca',
    labor: [{ descripcion, cuadrilla: 1, rendimiento: baselineRendimiento * 1.05, salarioBase, fsr }]
  });
  const { challenges } = runApuChallenge(apu);
  assert.equal(challenges.filter(c => c.category === 'rendimiento').length, 0);
});

test('runApuChallenge: etiqueta el baseline como historico calibrado solo para concreto/acero, plantilla para el resto', () => {
  const [descripcion, cantidadPorUnidad, , salarioBase, fsr] = SYSTEM_RESOURCES.concreto.labor[0];
  const baselineRendimiento = 1 / cantidadPorUnidad;
  const apu = apuFixture({
    primaryActivity: 'concreto',
    labor: [{ descripcion, cuadrilla: 1, rendimiento: baselineRendimiento * 1.5, salarioBase, fsr }]
  });
  const { challenges } = runApuChallenge(apu);
  const finding = challenges.find(c => c.category === 'rendimiento');
  assert.ok(finding);
  assert.equal(finding.baselineSource, 'Historico calibrado (Biblioteca ZOEMEC, matriz real)');
});

test('runApuChallenge: sin primaryActivity conocido no genera ningun challenge de rendimiento (nunca inventa una comparacion)', () => {
  const apu = apuFixture({
    primaryActivity: null,
    labor: [{ descripcion: 'Renglon sin clasificar', cuadrilla: 1, rendimiento: 3, salarioBase: 400, fsr: 1.8 }]
  });
  const { challenges } = runApuChallenge(apu);
  assert.equal(challenges.filter(c => c.category === 'rendimiento').length, 0);
});

test('runApuChallenge: renglon editado que ya no corresponde por descripcion a la plantilla se omite (no compara lo incomparable)', () => {
  const apu = apuFixture({
    primaryActivity: 'tablaroca',
    labor: [{ descripcion: 'Renglon totalmente distinto agregado a mano', cuadrilla: 1, rendimiento: 50, salarioBase: 420, fsr: 1.85 }]
  });
  const { challenges } = runApuChallenge(apu);
  assert.equal(challenges.filter(c => c.category === 'rendimiento').length, 0);
});

test('runApuChallenge: precio sin evidencia de mercado se cuestiona con impacto real (consumo x precio, via calcMaterialRow)', () => {
  // apuFixture trae cantidadObra:100 por defecto -- consumo (NO "cantidad",
  // ese campo no existe en el esquema real de un renglon v2 de materiales)
  // x precioUnitario = costo por unidad de concepto; x cantidadObra = costo
  // de proyecto. El mismo calcMaterialRow que usa calcAPUv2, no un calculo
  // aparte.
  const apu = apuFixture({
    materials: [{ descripcion: 'Material sin respaldo', consumo: 5, unidad: 'pza', precioUnitario: 120, fuente: {} }]
  });
  const { challenges } = runApuChallenge(apu);
  const finding = challenges.find(c => c.category === 'precio');
  assert.ok(finding);
  assert.equal(finding.unitImpact, 600);
  assert.equal(finding.projectImpact, 60000);
  assert.deepEqual(finding.actions, ['MANTENER', 'CORREGIR', 'JUSTIFICAR']);
  assert.equal(finding.resourceDescripcion, 'Material sin respaldo');
  assert.equal(finding.resourceKind, 'materials');
});

test('runApuChallenge: precio sin evidencia y sin cantidadObra capturada -> projectImpact null (nunca inventa la cantidad)', () => {
  const apu = apuFixture({
    cantidadObra: 0,
    materials: [{ descripcion: 'Material sin respaldo', consumo: 5, unidad: 'pza', precioUnitario: 120, fuente: {} }]
  });
  const { challenges } = runApuChallenge(apu);
  const finding = challenges.find(c => c.category === 'precio');
  assert.ok(finding);
  assert.equal(finding.unitImpact, 600);
  assert.equal(finding.projectImpact, null);
});

test('runApuChallenge: precio VERIFICADO nunca se cuestiona (es dato real de catalogo, no una estimacion)', () => {
  const apu = apuFixture({
    materials: [{ descripcion: 'Material verificado', consumo: 5, unidad: 'pza', precioUnitario: 120, fuente: { estado: 'VERIFICADO' } }]
  });
  const { challenges } = runApuChallenge(apu);
  assert.equal(challenges.filter(c => c.category === 'precio').length, 0);
});
