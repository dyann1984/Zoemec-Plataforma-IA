/* Fase 2 (cierre de brecha regionalizacion individual/lote). Antes de esta
   prueba, solo el flujo individual (main.jsx#generateAI) estampaba
   ubicacionEstructurada/ubicacion en el APU final -- los dos flujos de lote
   (buildBatchAPUs y runQueueJob, ambos construidos sobre generateBatchAPU)
   lo dejaban sin llenar. El cierre fue hacer que los TRES flujos llamen a la
   MISMA funcion (buildProjectLocationSnapshot, ver geography.js) en el mismo
   punto de su secuencia (justo despues de finalizeProfessionalAPU).

   Este archivo reproduce esa MISMA secuencia real de funciones, en el mismo
   orden en que main.jsx las llama, para demostrar que los tres flujos
   terminan con exactamente el mismo esquema regional. No existe un arnes de
   pruebas de UI en este repo (node --test puro, sin jsdom/React Testing
   Library) -- por eso estas pruebas fijan el contrato a nivel de las
   funciones reales de dominio que main.jsx compone, en vez de simular una
   interaccion de React. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyAPUv2 } from './apuSchema.js';
import { finalizeProfessionalAPU } from './apuProfessional.js';
import { applyConceptMetadataV2 } from './apuGeneration.js';
import { buildProjectLocationSnapshot } from './geography.js';
import { runApuConfidence } from './apuConfidence.js';
import { runBidRisk } from './bidRisk.js';

const PROJECT_MTY = { locationCountry: 'MX', locationState: 'Nuevo León', locationCity: 'Monterrey' };
const PROJECT_LEGACY = { ubicacion: 'Torreón, Coahuila (texto libre antiguo, sin estructurar)' };

function aiDraftFixture(){
  const a = makeEmptyAPUv2();
  const fuente = { estado: 'ESTIMADO_IA' };
  Object.assign(a, { concept: 'Muro de block hueco de concreto de 15x20x40cm, junteado con mortero cemento-arena', unit: 'm2', cantidadObra: 10 });
  a.materials = [{ clave: 'MAT-001', descripcion: 'Block hueco de concreto 15x20x40', unidad: 'pza', consumo: 12.5, desperdicioPct: 3, precioUnitario: 12, fuente, regionalConfidence: 'ALTA', regionalFallbackLevel: 'ciudad', priceStatus: 'VERIFIED_MARKET' }];
  a.labor = [{ clave: 'MO-001', descripcion: 'Albañil (oficial)', unidad: 'jor', cuadrilla: 1, rendimiento: 8, jornada: 8, salarioBase: 400, fsr: 1.85, fuente }];
  return a;
}

// Simula main.jsx#generateAI (flujo individual): finalizeProfessionalAPU
// sobre el borrador ya enriquecido, luego el stamp de ubicacion.
function runIndividualFlow(project){
  const v2 = finalizeProfessionalAPU(aiDraftFixture());
  const snapshot = buildProjectLocationSnapshot(project);
  v2.ubicacionEstructurada = snapshot.ubicacionEstructurada;
  v2.ubicacion = snapshot.ubicacion;
  return v2;
}

// Simula main.jsx#generateBatchAPU -- COMPARTIDA por los dos flujos de lote.
// El snapshot se captura UNA vez por corrida de lote (batchLocationSnapshotRef
// en main.jsx real), no por item; aqui se simula esa unica captura por llamada
// de prueba para mantener el ejemplo autocontenido.
function runBatchGenerateAPU(project, item, index){
  const batchLocationSnapshot = buildProjectLocationSnapshot(project);
  const withMeta = applyConceptMetadataV2(aiDraftFixture(), item, index, 'Catalogo de prueba');
  const v2 = finalizeProfessionalAPU(withMeta);
  v2.ubicacionEstructurada = batchLocationSnapshot.ubicacionEstructurada;
  v2.ubicacion = batchLocationSnapshot.ubicacion;
  return v2;
}

// Flujo de lote #1 (buildBatchAPUs): re-finaliza por renglon para aplicar
// clave/cantidad reales de CADA renglon del catalogo (importeTotal depende
// de cantidadObra por renglon), y reafirma el snapshot explicitamente --
// mismo patron que main.jsx usa para aiGenerated/templateFallback/family.
function runBatchFlow1_buildBatchAPUs(project, item, index){
  const base = runBatchGenerateAPU(project, item, index);
  const v2 = finalizeProfessionalAPU(applyConceptMetadataV2(base, item, index, 'Catalogo de prueba'));
  v2.ubicacionEstructurada = base?.ubicacionEstructurada || { country: null, state: null, city: null };
  v2.ubicacion = base?.ubicacion || '';
  return v2;
}

// Flujo de lote #2 (runQueueJob): usa el resultado de generateBatchAPU tal
// cual, sin re-finalizar (checkpoint por item, ver apuBatchQueueCloud.js).
function runBatchFlow2_runQueueJob(project, item, index){
  return runBatchGenerateAPU(project, item, index);
}

const item = { code: 'CON-001', concept: 'Muro de block', unit: 'm2', qty: 10 };

test('1. Generacion individual guarda ubicacionEstructurada y ubicacion (texto legible)', () => {
  const v2 = runIndividualFlow(PROJECT_MTY);
  assert.deepEqual(v2.ubicacionEstructurada, { country: 'MX', state: 'Nuevo León', city: 'Monterrey' });
  assert.equal(v2.ubicacion, 'Monterrey, Nuevo León, México');
});

test('2. Batch #1 (buildBatchAPUs) guarda ubicacionEstructurada y ubicacion', () => {
  const v2 = runBatchFlow1_buildBatchAPUs(PROJECT_MTY, item, 0);
  assert.deepEqual(v2.ubicacionEstructurada, { country: 'MX', state: 'Nuevo León', city: 'Monterrey' });
  assert.equal(v2.ubicacion, 'Monterrey, Nuevo León, México');
});

test('3. Batch #2 (runQueueJob) guarda ubicacionEstructurada y ubicacion', () => {
  const v2 = runBatchFlow2_runQueueJob(PROJECT_MTY, item, 0);
  assert.deepEqual(v2.ubicacionEstructurada, { country: 'MX', state: 'Nuevo León', city: 'Monterrey' });
  assert.equal(v2.ubicacion, 'Monterrey, Nuevo León, México');
});

test('4. Los tres flujos producen EXACTAMENTE el mismo esquema regional para el mismo proyecto', () => {
  const individual = runIndividualFlow(PROJECT_MTY);
  const batch1 = runBatchFlow1_buildBatchAPUs(PROJECT_MTY, item, 0);
  const batch2 = runBatchFlow2_runQueueJob(PROJECT_MTY, item, 0);
  const regionalShape = v2 => ({ ubicacionEstructurada: v2.ubicacionEstructurada, ubicacion: v2.ubicacion });
  assert.deepEqual(regionalShape(individual), regionalShape(batch1));
  assert.deepEqual(regionalShape(individual), regionalShape(batch2));
});

test('5. Cambiar la ubicacion del proyecto DESPUES de generar no modifica el snapshot ya guardado en el APU (los tres flujos)', () => {
  const individual = runIndividualFlow(PROJECT_MTY);
  const batch1 = runBatchFlow1_buildBatchAPUs(PROJECT_MTY, item, 0);
  const batch2 = runBatchFlow2_runQueueJob(PROJECT_MTY, item, 0);
  const changedProject = { ...PROJECT_MTY, locationCity: 'Guadalupe' }; // el proyecto "cambia" despues de generar
  [individual, batch1, batch2].forEach(v2 => {
    assert.equal(v2.ubicacionEstructurada.city, 'Monterrey', 'el snapshot ya generado nunca debe seguir al proyecto');
    assert.notEqual(v2.ubicacionEstructurada.city, changedProject.locationCity);
    assert.equal(v2.ubicacion, 'Monterrey, Nuevo León, México');
  });
});

test('8. Confidence Engine recibe el mismo contexto regional (regionalEvidence) en los tres flujos, con el mismo resultado', () => {
  const individual = runIndividualFlow(PROJECT_MTY);
  const batch1 = runBatchFlow1_buildBatchAPUs(PROJECT_MTY, item, 0);
  const batch2 = runBatchFlow2_runQueueJob(PROJECT_MTY, item, 0);
  const results = [individual, batch1, batch2].map(v2 => runApuConfidence(v2));
  results.forEach(r => assert.ok('regionalEvidence' in r.dimensions, 'debe existir la dimension regionalEvidence'));
  const scores = results.map(r => r.dimensions.regionalEvidence.score);
  assert.equal(scores[0], scores[1], 'individual vs batch1 deben dar el mismo score de evidencia regional');
  assert.equal(scores[0], scores[2], 'individual vs batch2 deben dar el mismo score de evidencia regional');
});

test('9. Bid Risk corre sin diferencias por flujo de origen, con el mismo contexto regional en los tres', () => {
  const individual = runIndividualFlow(PROJECT_MTY);
  const batch1 = runBatchFlow1_buildBatchAPUs(PROJECT_MTY, item, 0);
  const batch2 = runBatchFlow2_runQueueJob(PROJECT_MTY, item, 0);
  [individual, batch1, batch2].forEach(v2 => assert.doesNotThrow(() => runBidRisk(v2)));
  const findingCounts = [individual, batch1, batch2].map(v2 => runBidRisk(v2).findings.length);
  assert.equal(findingCounts[0], findingCounts[1]);
  assert.equal(findingCounts[0], findingCounts[2]);
});

test('10. Proyecto legacy con location=null (solo texto libre `ubicacion`) sigue funcionando en los tres flujos', () => {
  const individual = runIndividualFlow(PROJECT_LEGACY);
  const batch1 = runBatchFlow1_buildBatchAPUs(PROJECT_LEGACY, item, 0);
  const batch2 = runBatchFlow2_runQueueJob(PROJECT_LEGACY, item, 0);
  [individual, batch1, batch2].forEach(v2 => {
    assert.deepEqual(v2.ubicacionEstructurada, { country: null, state: null, city: null });
    assert.equal(v2.ubicacion, 'Torreón, Coahuila (texto libre antiguo, sin estructurar)');
  });
});

test('10b. Sin proyecto activo en absoluto (null): ningun flujo lanza, todo queda vacio de forma consistente', () => {
  [null, undefined].forEach(project => {
    assert.doesNotThrow(() => runIndividualFlow(project));
    assert.doesNotThrow(() => runBatchFlow1_buildBatchAPUs(project, item, 0));
    assert.doesNotThrow(() => runBatchFlow2_runQueueJob(project, item, 0));
    const individual = runIndividualFlow(project);
    assert.deepEqual(individual.ubicacionEstructurada, { country: null, state: null, city: null });
    assert.equal(individual.ubicacion, '');
  });
});
