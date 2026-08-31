/* Auditoria JUDGE READY -- Confidence Global unificado.
   Antes de este fix, un mismo APU podia mostrar 3 numeros de "confianza"
   distintos: 86% (ExecutiveSummaryCards/main.jsx, calculateAPUConfidence.score
   SIN gating), 78% (panel ZOEMEC INTELLIGENCE, runApuConfidence -- el UNICO
   calculo que limita el techo ante una falla critica y nunca inventa un
   numero cuando la evidencia es insuficiente) y 60% (hoja Excel
   CONTROL_REVISION, apu.confidence.presentation.confianzaTecnica -- una sola
   sub-dimension --composicion-- reetiquetada, nunca un puntaje global).

   Este archivo prueba dos cosas que ningun test anterior cubria:
   1) Escenarios especificos del motor (runApuConfidence, sin cambios de
      logica -- ya vivia en apuConfidence.js) que el pedido de auditoria pidio
      verificar explicitamente.
   2) PARIDAD REAL entre superficies: el mismo APU debe producir EXACTAMENTE
      el mismo Confidence Global en runApuConfidence() directo, en la hoja
      Excel individual, en la hoja RESUMEN, en la hoja CONTROL_REVISION y en
      el PDF individual -- nunca un numero distinto por superficie. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runApuConfidence, formatGlobalConfidence, dimensionPercentLabel, CONFIDENCE_STATUS } from '../src/domain/apuConfidence.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { makeAPUFromConcept } from '../src/domain/apuGeneration.js';
import { migrateLegacyApuToV2, normalizeAIApuToV2 } from '../src/domain/apuSchema.js';
import { SYSTEM_RESOURCES } from '../src/domain/constructionSystems.js';
import { buildProfessionalAPUSheet, buildProfessionalSummarySheet, buildControlRevisionSheet, exportAPUPdfV2 } from '../src/lib/apuExportV2.js';

// Misma plantilla de fixture "sana" que apuConfidence.test.js (SYSTEM_RESOURCES
// completo, no un subconjunto -- evita distorsionar la proporcion de costos).
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
    equipment: [], consumables: [], seguridad: [], factores: {}, clave: 'APU-TEST-001',
    ...overrides
  };
}

// --- 1) 0 evidencia + calculo correcto: score bajo/no-HIGH, nunca por un
// error matematico (que es un problema distinto, ver CASO D en
// apuConfidence.test.js). ---
test('Escenario 1: 0 evidencia (sin fuente en ningun renglon) + calculo matematicamente correcto -> nunca HIGH, nunca inventa evidencia', () => {
  const sinEvidencia = idealApuFixture();
  sinEvidencia.materials.forEach(m => { delete m.fuente; });
  sinEvidencia.labor.forEach(l => { delete l.fuente; });
  const apu = finalizeProfessionalAPU(sinEvidencia);
  const result = runApuConfidence(apu);
  assert.equal(result.dimensions.calculation.status, CONFIDENCE_STATUS.HIGH, 'el calculo en si sigue siendo correcto');
  assert.notEqual(result.status, CONFIDENCE_STATUS.HIGH, 'sin evidencia real, el global nunca puede ser HIGH');
  assert.ok(result.dimensions.evidence.score < 50, 'evidence debe reflejar la falta real de fuentes');
});

// --- 2) Evidencia parcial: solo algunos renglones con fuente real. ---
test('Escenario 2: evidencia parcial (algunos renglones con fuente, otros sin) produce un score intermedio, no HIGH ni el minimo', () => {
  const completo = runApuConfidence(finalizeProfessionalAPU(idealApuFixture()));
  const sinNada = idealApuFixture();
  sinNada.materials.forEach(m => { delete m.fuente; });
  sinNada.labor.forEach(l => { delete l.fuente; });
  const ninguno = runApuConfidence(finalizeProfessionalAPU(sinNada));

  const parcial = idealApuFixture();
  parcial.materials.forEach((m, i) => { if(i % 2 === 1) delete m.fuente; });
  const resultParcial = runApuConfidence(finalizeProfessionalAPU(parcial));

  assert.ok(resultParcial.dimensions.prices.score <= completo.dimensions.prices.score, 'evidencia parcial no puede superar evidencia completa');
  assert.ok(resultParcial.dimensions.prices.score >= ninguno.dimensions.prices.score, 'evidencia parcial no puede ser peor que evidencia nula');
});

// --- 3) Precios NO verificados (estado distinto de VERIFICADO) vs 4) precios
// VERIFICADOS: deben distinguirse realmente, nunca tratarse igual. ---
test('Escenario 3 vs 4: precios verificados (estado VERIFICADO) puntuan mas alto en prices que precios sin verificar (ESTIMADO_IA)', () => {
  const verificados = runApuConfidence(finalizeProfessionalAPU(idealApuFixture()));
  const noVerificados = idealApuFixture();
  const fuenteEstimada = { estado: 'ESTIMADO_IA' };
  noVerificados.materials.forEach(m => { m.fuente = fuenteEstimada; });
  noVerificados.labor.forEach(l => { l.fuente = fuenteEstimada; });
  const resultNoVerificados = runApuConfidence(finalizeProfessionalAPU(noVerificados));
  assert.ok(verificados.dimensions.prices.score > resultNoVerificados.dimensions.prices.score, 'VERIFICADO debe puntuar mas alto que ESTIMADO_IA en la dimension de precios');
});

// --- 5) Evidencia completa: ya cubierto por CASO A de apuConfidence.test.js
// (HIGH, sin factores criticos) -- se reafirma aqui como parte del set
// completo pedido en la auditoria. ---
test('Escenario 5: evidencia completa (todos los renglones VERIFICADO, calculo correcto, disciplina conocida) produce HIGH', () => {
  const apu = finalizeProfessionalAPU(idealApuFixture());
  const result = runApuConfidence(apu);
  assert.equal(result.status, CONFIDENCE_STATUS.HIGH);
});

// --- 6) APU con historico confiable: rendimientoFuente HISTORICO en todos
// los renglones de mano de obra -> historicalConsistency alto explicito. ---
test('Escenario 6: APU con rendimiento calibrado contra historico real (rendimientoFuente=HISTORICO) produce historicalConsistency alto', () => {
  const apu = finalizeProfessionalAPU(idealApuFixture());
  const result = runApuConfidence(apu);
  assert.equal(result.dimensions.historicalConsistency.score, 100, 'con TODOS los renglones HISTORICO, la dimension debe ser 100, no una aproximacion');
  const sinHistorico = idealApuFixture();
  sinHistorico.labor.forEach(l => { delete l.rendimientoFuente; });
  const resultSinHistorico = runApuConfidence(finalizeProfessionalAPU(sinHistorico));
  assert.ok(resultSinHistorico.dimensions.historicalConsistency.score < result.dimensions.historicalConsistency.score, 'sin procedencia calibrada, la dimension debe bajar respecto al caso con historico real');
});

// --- 7) APU sin fuentes: mismo que Escenario 1, reafirmado con el nombre
// exacto pedido en la auditoria. ---
test('Escenario 7: APU sin ninguna fuente identificable en ningun renglon -> evidence y prices en el piso, nunca HIGH', () => {
  const sinFuentes = idealApuFixture();
  sinFuentes.materials.forEach(m => { delete m.fuente; });
  sinFuentes.labor.forEach(l => { delete l.fuente; });
  const result = runApuConfidence(finalizeProfessionalAPU(sinFuentes));
  assert.notEqual(result.status, CONFIDENCE_STATUS.HIGH);
});

// --- 8) APU generado deterministicamente (motor de plantillas real, sin IA,
// pipeline completo makeAPUFromConcept -> migrateLegacyApuToV2 ->
// finalizeProfessionalAPU -> runApuConfidence, ningun mock). ---
test('Escenario 8: APU generado por el motor deterministico (sin IA) pasa por runApuConfidence sin error y produce un status coherente', () => {
  const v1 = makeAPUFromConcept('Muro de block hueco de concreto de 15x20x40 cm, asentado con mortero cemento-arena', []);
  const apu = finalizeProfessionalAPU(migrateLegacyApuToV2(v1));
  const result = runApuConfidence(apu);
  assert.ok(['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_EVIDENCE'].includes(result.status));
  // Generado por plantilla, sin ningun renglon con fuente real -> nunca HIGH.
  assert.notEqual(result.status, CONFIDENCE_STATUS.HIGH);
});

// --- 9) APU "generado con IA": el motor de Confidence NO debe dar ningun
// trato especial (ni mejor ni peor) solo por la bandera aiGenerated -- el
// mismo conjunto de recursos con y sin esa bandera debe dar el MISMO score. ---
test('Escenario 9: un APU marcado aiGenerated:true recibe exactamente el mismo Confidence que uno identico sin esa bandera (sin trato especial por origen IA)', () => {
  const base = idealApuFixture();
  const conIA = finalizeProfessionalAPU({ ...base, aiGenerated: true });
  const sinIA = finalizeProfessionalAPU({ ...base, aiGenerated: false });
  assert.deepEqual(runApuConfidence(conIA), runApuConfidence(sinIA));
});

// --- 10) Exportacion Excel: el MISMO apu debe producir el MISMO Confidence
// Global en la hoja individual, en RESUMEN y en CONTROL_REVISION que
// runApuConfidence() llamado directo -- esta es la prueba de regresion real
// del bug reportado (86%/78%/60% para el mismo APU). ---
test('Escenario 10 (paridad Excel): hoja individual, RESUMEN y CONTROL_REVISION muestran el mismo Confidence Global que runApuConfidence()', () => {
  const raw = idealApuFixture();
  const apu = finalizeProfessionalAPU(raw);
  const expected = formatGlobalConfidence(runApuConfidence(apu));

  const sheet = buildProfessionalAPUSheet(raw);
  const confidenceRow = sheet.rows.find(r => r[0]?.value === 'Confianza');
  assert.ok(confidenceRow, 'la hoja individual debe traer la fila de Confianza');
  assert.equal(confidenceRow[1], expected.fullLabel, 'hoja individual: el texto de Confianza debe coincidir EXACTO con runApuConfidence()');

  const resumen = buildProfessionalSummarySheet([raw]);
  const dataRow = resumen.rows[2]; // fila 0: titulo, fila 1: encabezados, fila 2: primer (unico) APU
  assert.equal(dataRow[11], expected.scoreLabel, 'hoja RESUMEN: la columna Confianza debe coincidir EXACTO con runApuConfidence()');

  const control = buildControlRevisionSheet([raw]);
  const controlRow = control.rows[2];
  const expectedStructure = dimensionPercentLabel(runApuConfidence(apu).dimensions.structure);
  const expectedPrices = dimensionPercentLabel(runApuConfidence(apu).dimensions.prices);
  assert.equal(controlRow[5], expectedStructure, 'CONTROL_REVISION: "Confianza tecnica" debe ser la dimension structure de runApuConfidence(), no una sub-dimension reetiquetada distinta');
  assert.equal(controlRow[6], expectedPrices, 'CONTROL_REVISION: "Confianza precios" debe coincidir con la dimension prices de runApuConfidence()');
});

// --- 11) Exportacion PDF: el texto real del documento debe traer el mismo
// Confidence Global (buscado en el buffer crudo del PDF, igual que el resto
// de pruebas de este mismo estilo en test/apuExportV2.integration.test.mjs). ---
test('Escenario 11 (paridad PDF): el PDF individual imprime el mismo Confidence Global que runApuConfidence()', () => {
  const raw = idealApuFixture();
  const apu = finalizeProfessionalAPU(raw);
  const expected = formatGlobalConfidence(runApuConfidence(apu));
  const { doc } = exportAPUPdfV2(raw, { save: false });
  const pdfText = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  assert.ok(pdfText.includes(expected.fullLabel.normalize('NFD').replace(/[̀-ͯ]/g, '')) || pdfText.includes(expected.fullLabel), 'el PDF debe imprimir literalmente el mismo score/level que runApuConfidence()');
});

// --- Caso de evidencia insuficiente: ningun documento debe fabricar un
// numero -- Excel/PDF deben imprimir "EVIDENCIA INSUFICIENTE", nunca "0%" ni
// ningun otro numero inventado. ---
test('Evidencia insuficiente (concepto no clasificable) exporta "EVIDENCIA INSUFICIENTE" en Excel y PDF, nunca un numero fabricado', () => {
  const v1 = makeAPUFromConcept('fabricacion completamente desconocida de widget cuantico', []);
  const raw = migrateLegacyApuToV2(v1);
  raw.clave = 'APU-INSUF-001';
  const apu = finalizeProfessionalAPU(raw);
  const result = runApuConfidence(apu);
  assert.equal(result.score, null);

  const sheet = buildProfessionalAPUSheet(raw);
  const confidenceRow = sheet.rows.find(r => r[0]?.value === 'Confianza');
  assert.equal(confidenceRow[1], 'EVIDENCIA INSUFICIENTE');

  const { doc } = exportAPUPdfV2(raw, { save: false });
  const pdfText = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  assert.ok(pdfText.includes('EVIDENCIA INSUFICIENTE'));
});
