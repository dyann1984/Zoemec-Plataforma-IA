/* ZOEMEC CONFIDENCE ENGINE (Fase 2): pruebas del motor multidimensional.
   Fixtures controladas contra SYSTEM_RESOURCES (constructionSystems.js) para
   poder razonar con precision sobre cada dimension, mas el pipeline real de
   generacion (makeAPUFromConcept -> migrateLegacyApuToV2 -> finalizeProfessionalAPU)
   para el caso de concepto no clasificable. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runApuConfidence, runProjectConfidence, CONFIDENCE_STATUS } from './apuConfidence.js';
import { finalizeProfessionalAPU } from './apuProfessional.js';
import { makeAPUFromConcept } from './apuGeneration.js';
import { migrateLegacyApuToV2 } from './apuSchema.js';
import { SYSTEM_RESOURCES } from './constructionSystems.js';

// Plantilla REAL completa de una disciplina (todos los materiales/mano de
// obra de SYSTEM_RESOURCES, no un subconjunto elegido a mano) -- un
// subconjunto truncado distorsiona artificialmente la proporcion de costos
// entre renglones (se detecto exactamente este problema al construir estas
// pruebas: un fixture con solo 2 de 6 materiales reales disparaba una falsa
// concentracion de costo). "acero" tiene solo 2 renglones de mano de obra
// (Fierrero + Ayudante), por debajo del umbral de "posible_fragmentacion_cuadrilla"
// del Auditor (>2 renglones) -- evita ruido de ese heuristico advisory en el
// caso de referencia "sano".
function idealApuFixture(overrides = {}){
  const tipo = overrides.primaryActivity || 'acero';
  const fuente = { proveedor: 'Proveedor Confiable S.A.', fecha: new Date().toISOString(), estado: 'VERIFICADO' };
  const materials = SYSTEM_RESOURCES[tipo].materials.map(([descripcion, consumo, unidad, precioUnitario, desperdicioPct]) => ({ descripcion, consumo, unidad, precioUnitario, desperdicioPct, fuente }));
  const labor = SYSTEM_RESOURCES[tipo].labor.map(([descripcion, coef, unidad, salarioBase, fsr]) => ({ descripcion, cuadrilla: 1, rendimiento: 1 / coef, salarioBase, fsr, fuente, rendimientoFuente: 'HISTORICO' }));
  return {
    concept: 'Suministro y habilitado de acero de refuerzo fy=4200', unit: SYSTEM_RESOURCES[tipo].unit, cantidadObra: 800,
    primaryActivity: tipo, classificationMatch: 'exact',
    procedimientoConstructivo: ['Habilitar', 'Armar', 'Colocar'],
    controlCalidad: ['Verificacion de traslapes y recubrimientos'],
    criterioMedicion: { unidadMedicion: SYSTEM_RESOURCES[tipo].unit },
    variables: { weight: 800, materialGrade: 'fy=4200' },
    materials, labor,
    equipment: [], consumables: [], seguridad: [], factores: {},
    ...overrides
  };
}

// CASO A: APU completo, precios con evidencia, calculo correcto, rendimiento
// razonable -> Confidence HIGH.
test('runApuConfidence CASO A: APU sano con evidencia completa produce status HIGH, sin factores criticos', () => {
  const apu = finalizeProfessionalAPU(idealApuFixture());
  const result = runApuConfidence(apu);
  assert.equal(result.status, CONFIDENCE_STATUS.HIGH);
  assert.ok(result.score >= 85);
  assert.deepEqual(result.criticalFactors, []);
  assert.equal(result.dimensions.calculation.status, CONFIDENCE_STATUS.HIGH);
  assert.equal(result.dimensions.prices.status, CONFIDENCE_STATUS.HIGH);
});

// CASO B: APU correcto pero sin fuentes de precios -> penalizado en
// evidence/prices, NO HIGH artificial.
test('runApuConfidence CASO B: sin fuentes de precio, prices/evidence se penalizan y el global NO es HIGH', () => {
  const noSource = idealApuFixture();
  noSource.materials.forEach(m => { delete m.fuente; });
  noSource.labor.forEach(l => { delete l.fuente; });
  const apu = finalizeProfessionalAPU(noSource);
  const result = runApuConfidence(apu);

  const sano = runApuConfidence(finalizeProfessionalAPU(idealApuFixture()));
  assert.ok(result.dimensions.prices.score < sano.dimensions.prices.score, 'prices debe bajar respecto al caso sano');
  assert.ok(result.dimensions.evidence.score < sano.dimensions.evidence.score, 'evidence debe bajar respecto al caso sano');
  assert.notEqual(result.status, CONFIDENCE_STATUS.HIGH);
  assert.ok(result.score < sano.score);
});

// CASO D: error matematico (valor negativo real, detectado por el Auditor)
// -> calculation critica, score global limitado a <=40.
test('runApuConfidence CASO D: valor negativo real limita calculation y el score global a <=40', () => {
  const broken = idealApuFixture();
  broken.materials[0].consumo = -5;
  const apu = finalizeProfessionalAPU(broken);
  const result = runApuConfidence(apu);
  assert.ok(result.dimensions.calculation.score <= 30);
  assert.ok(result.score <= 40);
  assert.ok(result.criticalFactors.some(c => c.dimension === 'calculation'));
});

// CASO F: concepto no clasificable ("widget cuantico", mismo caso ya usado
// en constructionSystems.test.js) -> INSUFFICIENT_EVIDENCE, nunca inventa
// comparables ni confianza.
test('runApuConfidence CASO F: concepto no clasificable produce INSUFFICIENT_EVIDENCE, no un numero inventado', () => {
  const apu = finalizeProfessionalAPU(migrateLegacyApuToV2(makeAPUFromConcept('fabricacion completamente desconocida de widget cuantico', [])));
  const result = runApuConfidence(apu);
  assert.equal(result.status, CONFIDENCE_STATUS.INSUFFICIENT_EVIDENCE);
  assert.equal(result.score, null);
  assert.equal(result.dimensions.productivity.status, CONFIDENCE_STATUS.INSUFFICIENT_EVIDENCE);
  assert.equal(result.dimensions.historicalConsistency.status, CONFIDENCE_STATUS.INSUFFICIENT_EVIDENCE);
});

test('runApuConfidence: dimension sin renglones de mano de obra es INSUFFICIENT_EVIDENCE, no 0', () => {
  const apu = finalizeProfessionalAPU(idealApuFixture({ labor: [] }));
  const result = runApuConfidence(apu);
  assert.equal(result.dimensions.productivity.status, CONFIDENCE_STATUS.INSUFFICIENT_EVIDENCE);
  assert.equal(result.dimensions.productivity.score, null);
});

test('runApuConfidence: costo directo en $0 marca prices/evidence como INSUFFICIENT_EVIDENCE, no un 0 punitivo', () => {
  const apu = finalizeProfessionalAPU(idealApuFixture({
    materials: [{ descripcion: 'Cemento gris CPC 30R', consumo: 0, unidad: 'bulto', precioUnitario: 0, fuente: {} }],
    labor: []
  }));
  const result = runApuConfidence(apu);
  assert.equal(result.dimensions.prices.status, CONFIDENCE_STATUS.INSUFFICIENT_EVIDENCE);
  assert.equal(result.dimensions.evidence.status, CONFIDENCE_STATUS.INSUFFICIENT_EVIDENCE);
});

// Propiedades importantes del spec.
test('propiedad: agregar evidencia valida (fuente real) no puede bajar el score respecto a no tener ninguna', () => {
  const sinFuente = idealApuFixture();
  sinFuente.materials.forEach(m => { delete m.fuente; });
  sinFuente.labor.forEach(l => { delete l.fuente; });
  const antes = runApuConfidence(finalizeProfessionalAPU(sinFuente));
  const despues = runApuConfidence(finalizeProfessionalAPU(idealApuFixture()));
  assert.ok(despues.score >= antes.score);
});

test('propiedad: nunca se genera NaN ni Infinity en el score global ni en las dimensiones', () => {
  const fixtures = [
    idealApuFixture(),
    idealApuFixture({ labor: [], materials: [] }),
    idealApuFixture({ cantidadObra: 0 }),
    migrateLegacyApuToV2(makeAPUFromConcept('fabricacion completamente desconocida de widget cuantico', []))
  ];
  fixtures.forEach(raw => {
    const apu = finalizeProfessionalAPU(raw);
    const result = runApuConfidence(apu);
    if(result.score != null){
      assert.ok(Number.isFinite(result.score));
    }
    Object.values(result.dimensions).forEach(d => {
      if(d.score != null) assert.ok(Number.isFinite(d.score));
    });
  });
});

test('propiedad: mismo input produce siempre el mismo resultado (determinista)', () => {
  const apu = finalizeProfessionalAPU(idealApuFixture());
  const a = runApuConfidence(apu, { now: '2026-01-01' });
  const b = runApuConfidence(apu, { now: '2026-01-01' });
  assert.deepEqual(a, b);
});

test('runProjectConfidence (Fase 8 Parte 2): distribucion real por status, nunca recalcula runApuConfidence a mano', () => {
  const sano = finalizeProfessionalAPU(idealApuFixture());
  const sinEvidencia = finalizeProfessionalAPU(migrateLegacyApuToV2(makeAPUFromConcept('fabricacion completamente desconocida de widget cuantico', [])));
  const project = runProjectConfidence([sano, sinEvidencia]);
  assert.equal(project.totalAPUs, 2);
  assert.equal(project.insufficientEvidence, 1);
  assert.equal(project.high + project.medium + project.low, 1);
  assert.deepEqual(project.perApu[0].result, runApuConfidence(sano));
  assert.equal(project.perApu[1].status, 'INSUFFICIENT_EVIDENCE');
});

test('runProjectConfidence: averageScore ignora los APU sin evidencia suficiente (nunca los cuenta como 0)', () => {
  const sano = finalizeProfessionalAPU(idealApuFixture());
  const sinEvidencia = finalizeProfessionalAPU(migrateLegacyApuToV2(makeAPUFromConcept('fabricacion completamente desconocida de widget cuantico', [])));
  const project = runProjectConfidence([sano, sinEvidencia]);
  assert.equal(project.averageScore, runApuConfidence(sano).score);
});

test('runProjectConfidence: sin APUs devuelve distribucion vacia, nunca inventa un promedio', () => {
  const project = runProjectConfidence([]);
  assert.deepEqual(project, { totalAPUs: 0, high: 0, medium: 0, low: 0, insufficientEvidence: 0, averageScore: null, perApu: [] });
});

/* ---------- Auditoria APU-N29HGJ (items F/H): reconexion primaryActivity <-> Confidence Engine ---------- */

// TEST 9: un rendimiento real presente (20 m3/jornada, misma mano de obra en
// ambos casos) ya no queda forzado a N/D (INSUFFICIENT_EVIDENCE) SOLO porque
// la ruta de IA nunca seteaba primaryActivity -- antes de la correccion en
// normalizeAIApuToV2 (apuSchema.js), todo APU generado por IA perdia esta
// dimension sin importar el concepto.
test('TEST 9: con primaryActivity ausente la productividad es N/D; con primaryActivity presente deja de serlo (mismo rendimiento)', () => {
  const sinClasificar = finalizeProfessionalAPU(idealApuFixture({ primaryActivity: null }));
  const clasificado = finalizeProfessionalAPU(idealApuFixture());
  const resultSinClasificar = runApuConfidence(sinClasificar);
  const resultClasificado = runApuConfidence(clasificado);

  assert.equal(resultSinClasificar.dimensions.productivity.status, CONFIDENCE_STATUS.INSUFFICIENT_EVIDENCE);
  assert.equal(resultSinClasificar.dimensions.productivity.score, null);

  assert.notEqual(resultClasificado.dimensions.productivity.status, CONFIDENCE_STATUS.INSUFFICIENT_EVIDENCE);
  assert.ok(resultClasificado.dimensions.productivity.score != null);
});

// TEST 10: el Confidence Engine NO convierte automaticamente un rendimiento
// sin evidencia historica real (rendimientoFuente: 'IA', nunca calibrado
// contra una matriz real) en alta confianza solo porque ahora SI hay
// primaryActivity clasificado -- "tener un rendimiento no significa
// automaticamente alta confianza" (spec explicito de la correccion).
test('TEST 10: primaryActivity presente + rendimiento solo de IA (sin calibrar) sigue distinguiendose de uno calibrado, nunca se cuenta como historico', () => {
  const rendimientoSoloIA = idealApuFixture();
  rendimientoSoloIA.labor.forEach(l => { l.rendimientoFuente = 'IA'; });
  const apu = finalizeProfessionalAPU(rendimientoSoloIA);
  const result = runApuConfidence(apu);

  // La dimension "historicalConsistency" (la que especificamente mide
  // procedencia HISTORICO/BIBLIOTECA/VALIDADO) nunca trata un rendimiento
  // de IA como si fuera calibrado -- score 0, nunca HIGH, aunque el resto
  // del APU (precios verificados, calculo correcto) sea intachable.
  assert.equal(result.dimensions.historicalConsistency.score, 0);
  assert.notEqual(result.dimensions.historicalConsistency.status, CONFIDENCE_STATUS.HIGH);

  const calibrado = runApuConfidence(finalizeProfessionalAPU(idealApuFixture()));
  assert.equal(calibrado.dimensions.historicalConsistency.score, 100);
  assert.ok(result.score < calibrado.score, 'un rendimiento sin calibrar debe puntuar menos globalmente que uno respaldado por historico real, aun con la misma disciplina clasificada');
});
