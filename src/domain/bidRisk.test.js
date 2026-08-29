/* ZOEMEC BID RISK (Fase 2): pruebas del motor de riesgo de licitacion.
   Consume runApuAudit/runApuChallenge/runApuConfidence (Fase 1 + Confidence)
   sin recrearlos -- estas pruebas verifican la TRADUCCION a riesgo y el
   calculo de impacto, no vuelven a probar la logica ya cubierta en
   apuAuditor.test.js / apuChallenge.test.js / apuConfidence.test.js. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runBidRisk, runProjectBidRisk, BID_RISK_SEVERITY, BID_RISK_CATEGORY } from './bidRisk.js';
import { finalizeProfessionalAPU } from './apuProfessional.js';
import { calcAPUv2 } from '../lib/apuCalc.js';
import { SYSTEM_RESOURCES } from './constructionSystems.js';

// Plantilla REAL completa de una disciplina (todos los materiales/mano de
// obra de SYSTEM_RESOURCES, no un subconjunto elegido a mano) -- un
// subconjunto truncado distorsiona artificialmente la proporcion de costos
// entre renglones (ver apuConfidence.test.js, mismo problema detectado ahi).
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

// "acero" (solo 2 renglones de mano de obra, por debajo del umbral de
// "posible_fragmentacion_cuadrilla" del Auditor) como referencia SANA --
// confirmado severity LOW / findings vacio al construir estas pruebas.
const healthyApuFixture = (overrides = {}) => templateApuFixture('acero', overrides);
// "concreto" para los casos que manipulan rendimiento (es una de las 2
// disciplinas calibradas contra historico real, ver LIBRARY_CALIBRATED_TIPOS
// en crewModel.js -- necesario para que el challenge se etiquete "historico").
const concretoApuFixture = (overrides = {}) => templateApuFixture('concreto', overrides);
// "acarreo_manual": disciplina LABOR-dominante (sin materiales, un solo
// renglon de mano de obra) -- necesaria para el Caso C/G: en una disciplina
// materiales-intensiva (concreto/block) una desviacion de rendimiento en UN
// renglon de mano de obra es real pero pesa poco sobre el costo TOTAL del
// concepto (se verifico empiricamente: incluso 300% de desviacion en las 4
// cuadrillas de concreto se queda por debajo del umbral HIGH de impacto,
// porque el cemento domina >60% del costo). Aqui la mano de obra ES el
// costo, asi que la misma desviacion produce un impacto economico
// proporcional real -- no es un umbral inflado a modo, es la disciplina
// correcta para demostrar "impacto relevante".
const acarreoManualApuFixture = (overrides = {}) => templateApuFixture('acarreo_manual', { cantidadObra: 300, ...overrides });
// CASO J (2a especialidad, no solo concreto/acero): block, con UN renglon
// barato ("Agua") sin fuente -- deja un riesgo real pero acotado, a
// diferencia de dejar TODO sin fuente (eso si escala a CRITICAL via el
// agregado de Challenge, verificado empiricamente al construir esta prueba
// -- ver HIGH_CHALLENGE_IMPACT).
const blockApuFixture = (overrides = {}) => {
  const fuente = { proveedor: 'Proveedor Confiable S.A.', fecha: new Date().toISOString(), estado: 'VERIFICADO' };
  return templateApuFixture('block', {
    materials: SYSTEM_RESOURCES.block.materials.map(([descripcion, consumo, unidad, precioUnitario, desperdicioPct]) => ({ descripcion, consumo, unidad, precioUnitario, desperdicioPct, fuente: descripcion === 'Agua' ? {} : fuente })),
    ...overrides
  });
};

// Fixture minima para los casos "critico" reutilizados en varias pruebas
// (recurso critico faltante -- ver apuAuditor.test.js, mismo escenario).
function acidRecursoFaltanteFixture(overrides = {}){
  return { concept: 'Acero', unit: 'kg', cantidadObra: 500, primaryActivity: 'acero', materials: [{ descripcion: 'Cemento gris' }], labor: [{ descripcion: 'Fierrero', cuadrilla: 1, rendimiento: 5, salarioBase: 400, fsr: 1.8 }], equipment: [], consumables: [], seguridad: [], factores: {}, ...overrides };
}

// CASO E: recurso critico faltante -> Auditor CRITICAL, Bid Risk CRITICAL.
test('runBidRisk CASO E: "acero sin acero" produce CRITICAL_RESOURCE_MISSING con severidad CRITICAL', () => {
  const apu = { concept: 'Acero', unit: 'kg', cantidadObra: 500, primaryActivity: 'acero', materials: [{ descripcion: 'Cemento gris' }], labor: [{ descripcion: 'Fierrero', cuadrilla: 1, rendimiento: 5, salarioBase: 400, fsr: 1.8 }], equipment: [], consumables: [], seguridad: [], factores: {} };
  const result = runBidRisk(apu);
  const finding = result.findings.find(f => f.category === BID_RISK_CATEGORY.CRITICAL_RESOURCE_MISSING);
  assert.ok(finding);
  assert.equal(finding.severity, BID_RISK_SEVERITY.CRITICAL);
  assert.equal(result.severity, BID_RISK_SEVERITY.CRITICAL);
});

// CASO C + G: rendimiento manipulado agresivamente -> AGGRESSIVE_PRODUCTIVITY
// o POSSIBLE_UNDERESTIMATION con severidad HIGH/CRITICAL, impacto verificado
// matematicamente contra calcAPUv2 (Caso G).
test('runBidRisk CASO C/G: rendimiento 50% mas optimista que la plantilla produce riesgo alto con impacto verificable', () => {
  const raw = acarreoManualApuFixture();
  raw.labor[0].rendimiento = raw.labor[0].rendimiento * 1.5;
  const apu = finalizeProfessionalAPU(raw);
  const result = runBidRisk(apu);
  const finding = result.findings.find(f => f.category === BID_RISK_CATEGORY.POSSIBLE_UNDERESTIMATION || f.category === BID_RISK_CATEGORY.AGGRESSIVE_PRODUCTIVITY);
  assert.ok(finding, 'debe traducir el challenge de rendimiento a un finding de riesgo');
  assert.ok([BID_RISK_SEVERITY.HIGH, BID_RISK_SEVERITY.CRITICAL].includes(finding.severity));
  assert.ok(finding.projectImpact > 0, 'el impacto debe ser una magnitud positiva (exposicion), nunca negativa');

  // Verificacion matematica independiente contra calcAPUv2 (Caso G).
  const baselineRendimiento = raw.labor[0].rendimiento / 1.5;
  const withBaseline = structuredClone(apu);
  withBaseline.labor[0] = { ...withBaseline.labor[0], rendimiento: baselineRendimiento };
  const expectedProjectImpact = Math.abs(calcAPUv2(withBaseline).importeTotal - calcAPUv2(apu).importeTotal);
  assert.ok(Math.abs(finding.projectImpact - expectedProjectImpact) < 0.01);
});

// CASO I: riesgo sin datos suficientes para monetizar -> projectImpact null.
test('runBidRisk CASO I: sin cantidadObra capturada, projectImpact queda null con razon explicita', () => {
  const raw = acarreoManualApuFixture({ cantidadObra: 0 });
  raw.labor[0].rendimiento = raw.labor[0].rendimiento * 1.5;
  const apu = finalizeProfessionalAPU(raw);
  const result = runBidRisk(apu);
  const finding = result.findings.find(f => f.category === BID_RISK_CATEGORY.POSSIBLE_UNDERESTIMATION || f.category === BID_RISK_CATEGORY.AGGRESSIVE_PRODUCTIVITY);
  assert.ok(finding);
  assert.equal(finding.projectImpact, null);
  assert.ok(finding.unitImpact > 0, 'el impacto por unidad si es calculable aunque falte la cantidad de obra');
  assert.equal(finding.reason, 'PROJECT_QUANTITY_NOT_CAPTURED');
});

test('runBidRisk: APU sano (Caso A del Confidence Engine) produce severidad LOW, sin findings', () => {
  const apu = finalizeProfessionalAPU(healthyApuFixture());
  const result = runBidRisk(apu);
  assert.equal(result.severity, BID_RISK_SEVERITY.LOW);
  assert.deepEqual(result.findings, []);
});

test('runBidRisk: precio sin evidencia (Caso B del Confidence Engine) produce PRICE_WITHOUT_EVIDENCE', () => {
  const raw = concretoApuFixture();
  raw.materials.forEach(m => { delete m.fuente; });
  raw.labor.forEach(l => { delete l.fuente; });
  const apu = finalizeProfessionalAPU(raw);
  const result = runBidRisk(apu);
  const priceFindings = result.findings.filter(f => f.category === BID_RISK_CATEGORY.PRICE_WITHOUT_EVIDENCE);
  assert.ok(priceFindings.length > 0);
  priceFindings.forEach(f => assert.ok(f.projectImpact >= 0));
});

// CASO F (Confidence INSUFFICIENT_EVIDENCE) -> Bid Risk debe reflejarlo sin
// inventar severidad ni impacto.
test('runBidRisk: confianza INSUFFICIENT_EVIDENCE se traduce a un finding INSUFFICIENT_EVIDENCE, no a LOW_CONFIDENCE inventado', () => {
  const apu = concretoApuFixture({ primaryActivity: null, classificationMatch: null });
  const result = runBidRisk(finalizeProfessionalAPU(apu));
  assert.equal(result.confidence.status, 'INSUFFICIENT_EVIDENCE');
  const finding = result.findings.find(f => f.category === BID_RISK_CATEGORY.INSUFFICIENT_EVIDENCE);
  assert.ok(finding);
  assert.equal(result.findings.some(f => f.category === BID_RISK_CATEGORY.LOW_CONFIDENCE), false);
});

// CASO H: proyecto con multiples APU -> ranking correcto de riesgo. Incluye
// dos especialidades distintas (concreto + block, ver blockApuFixture) para
// no probar exclusivamente concreto (Caso J).
test('runBidRisk / runProjectBidRisk CASO H+J: ranking de proyecto ordena el APU critico primero, cubre 2 especialidades', () => {
  const sano = finalizeProfessionalAPU(healthyApuFixture({ id: 'APU-SANO' }));
  const critico = finalizeProfessionalAPU(acidRecursoFaltanteFixture({ id: 'APU-CRITICO' }));
  const medio = finalizeProfessionalAPU(blockApuFixture({ id: 'APU-BLOCK-MEDIO' }));

  const project = runProjectBidRisk([sano, critico, medio]);
  const rank = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  assert.equal(project.totalAPUs, 3);
  assert.equal(project.critical + project.high + project.medium + project.low, 3);
  assert.equal(project.topRisks[0].apuId, 'APU-CRITICO');
  assert.equal(project.topRisks[0].severity, BID_RISK_SEVERITY.CRITICAL);
  // Ranking real, no solo el primero: el critico pesa mas que el block (que
  // a su vez tiene al menos un finding real, nunca LOW como el sano).
  const byId = id => project.topRisks.find(r => r.apuId === id);
  assert.ok(rank[byId('APU-CRITICO').severity] > rank[byId('APU-BLOCK-MEDIO').severity]);
  assert.notEqual(byId('APU-BLOCK-MEDIO').severity, BID_RISK_SEVERITY.LOW);
});

// Propiedades importantes del spec.
test('propiedad: un finding CRITICAL nunca puede reducir la severidad global respecto a un APU sano', () => {
  const sano = runBidRisk(finalizeProfessionalAPU(healthyApuFixture()));
  const critico = runBidRisk(finalizeProfessionalAPU(acidRecursoFaltanteFixture()));
  const rank = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  assert.ok(rank[critico.severity] > rank[sano.severity]);
});

test('propiedad: ningun finding trae NaN, Infinity, ni impacto negativo', () => {
  const fixtures = [
    concretoApuFixture(),
    concretoApuFixture({ cantidadObra: 0 }),
    blockApuFixture(),
    { concept: 'vacio', unit: '', cantidadObra: 0, materials: [], labor: [], equipment: [], consumables: [], seguridad: [], factores: {} }
  ];
  fixtures.forEach(raw => {
    const apu = finalizeProfessionalAPU(raw);
    const result = runBidRisk(apu);
    result.findings.forEach(f => {
      if(f.unitImpact != null){ assert.ok(Number.isFinite(f.unitImpact)); assert.ok(f.unitImpact >= 0); }
      if(f.projectImpact != null){ assert.ok(Number.isFinite(f.projectImpact)); assert.ok(f.projectImpact >= 0); }
    });
    assert.ok(Number.isFinite(result.estimatedExposure));
    assert.ok(result.estimatedExposure >= 0);
  });
});

test('propiedad: mismo input produce siempre el mismo resultado (determinista)', () => {
  const apu = finalizeProfessionalAPU(concretoApuFixture());
  const a = runBidRisk(apu, { now: '2026-01-01' });
  const b = runBidRisk(apu, { now: '2026-01-01' });
  assert.deepEqual(a, b);
});
