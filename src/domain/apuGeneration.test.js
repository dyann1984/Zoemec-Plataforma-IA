import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAPUFromConcept, standardAPUForConcept, templateFallbackAPU, applyConceptMetadataV2 } from './apuGeneration.js';
import { calcAPU } from '../lib/apuCalc.js';
import { migrateLegacyApuToV2 } from './apuSchema.js';
import { finalizeProfessionalAPU } from './apuProfessional.js';

// Caso real reportado: 6 conceptos pegados a mano que ZOEMEC fusiono en un
// solo APU "generico de colocacion de loseta". Aqui se prueba el motor de
// clasificacion (src/domain/apuGeneration.js#makeAPUFromConcept, el que de
// verdad usa la app -- no src/lib/apuFlow.js, que es codigo muerto) con cada
// concepto POR SEPARADO, como ya llega despues de la segmentacion de texto
// (ver src/lib/excelImport.js#parseConceptListText).
const REAL_CASE = [
  'Movimiento de mueble',
  'demolicion de loseta 64m2',
  'acarreo 46 costales distancia 25m',
  'acarreo de loseta 1.5m3 distancia 25m',
  'aplicación de adhesivo 64m2',
  'colocación de loseta 64m2'
];

const materialText = (apu) => (apu.materials || []).map(r => String(r[0] || '').toLowerCase()).join(' | ');

test('Test K: los 6 conceptos reales producen 6 tipos/matrices propias, ninguna cruzada con "colocacion de loseta"', () => {
  const apus = REAL_CASE.map(c => makeAPUFromConcept(c, []));
  const [movimiento, demolicion, acarreoCostales, acarreoLoseta, adhesivo, colocacion] = apus;

  // Ninguno de los 5 primeros (todo menos la colocacion real) debe traer
  // loseta NUEVA como insumo -- esa es la contaminacion exacta que se reporto.
  for (const apu of [movimiento, demolicion, acarreoCostales, acarreoLoseta, adhesivo]) {
    assert.ok(!materialText(apu).includes('loseta'), `no deberia incluir loseta: ${apu.family} -> ${materialText(apu)}`);
  }
  // La demolicion tampoco debe traer boquilla/adhesivo (alcance de colocacion).
  assert.ok(!materialText(demolicion).includes('adhesivo') && !materialText(demolicion).includes('boquilla'));
  // El movimiento de mobiliario tampoco debe traer materiales de piso.
  assert.ok(!materialText(movimiento).includes('boquilla') && !materialText(movimiento).includes('adhesivo'));
  // La aplicacion de adhesivo aislada nunca debe traer boquilla (eso es colocacion).
  assert.ok(!materialText(adhesivo).includes('boquilla'));

  // La colocacion real (unico que si es "colocacion de loseta") si trae loseta.
  assert.ok(materialText(colocacion).includes('loseta'));

  // Las familias/tipos deben distinguirse: no los 6 caen en el mismo cajon.
  const families = apus.map(a => a.family);
  assert.ok(new Set(families).size >= 4, `se esperaban al menos 4 familias distintas, hubo: ${families.join(', ')}`);
});

test('demolicion de loseta no hereda materiales de colocacion (mano de obra/equipo propios de demolicion)', () => {
  const apu = makeAPUFromConcept('Demolición de loseta en área de cocina', []);
  assert.equal(apu.family, 'Limpieza y preliminares');
  assert.ok(!materialText(apu).includes('loseta'));
  const laborText = apu.labor.map(r => String(r[0] || '').toLowerCase()).join(' | ');
  assert.ok(laborText.includes('demolici'));
});

test('acarreo manual (sin camion) nunca hereda el tipo acarreo_camion ni materiales de colocacion', () => {
  const apu = makeAPUFromConcept('Acarreo de escombro en costales dentro de la obra', []);
  assert.equal(apu.family, 'Terracerias');
  assert.ok(!materialText(apu).includes('loseta'));
});

test('acarreo con camion de volteo sigue clasificando como acarreo_camion (no se rompe lo existente)', () => {
  const apu = makeAPUFromConcept('Acarreo de material producto de excavación con camión de volteo', []);
  const laborText = apu.labor.map(r => String(r[0] || '').toLowerCase()).join(' | ');
  assert.ok(laborText.includes('cami') || laborText.includes('volteo'));
});

test('aplicacion de adhesivo aislada no trae loseta/boquilla; si el concepto menciona loseta, clasifica como colocacion completa', () => {
  const soloAdhesivo = makeAPUFromConcept('Aplicación de adhesivo en muro, 64 m2', []);
  assert.ok(!materialText(soloAdhesivo).includes('loseta'));

  const colocacionConAdhesivo = makeAPUFromConcept('Colocación de loseta con adhesivo y boquilla, 64 m2', []);
  assert.ok(materialText(colocacionConAdhesivo).includes('loseta'));
});

test('movimiento de mobiliario clasifica con su propia matriz (cuadrilla + proteccion), no generico vacio', () => {
  const apu = makeAPUFromConcept('Movimiento de mueble', []);
  assert.equal(apu.family, 'Equipamiento');
  assert.equal(apu.incomplete, false);
});

test('colocacion de loseta sin la palabra "suministro" queda marcada con la hipotesis de alcance para revision', () => {
  const apu = makeAPUFromConcept('colocación de loseta 64m2', []);
  assert.ok(apu.aiNotes.some(n => /alcance asumido/i.test(n)));
});

test('standardAPUForConcept / templateFallbackAPU (camino real usado por generate()/generateAI()) preservan la clasificacion por concepto', () => {
  const items = REAL_CASE.map((concept, i) => ({ code:`CON-00${i + 1}`, concept, unit:'', qty:1, referencePU:0 }));
  const apus = items.map((item, i) => templateFallbackAPU(item, [], i, 'Texto pegado', 'IA no disponible (prueba)'));
  assert.equal(apus.length, 6);
  const [movimiento, demolicion] = apus;
  assert.ok(!materialText(demolicion).includes('loseta'));
  assert.ok(!materialText(movimiento).includes('loseta'));
  // Cada APU conserva su propio concepto/clave -- nunca se fusionan en pantalla.
  const claves = new Set(apus.map(a => a.clave));
  assert.equal(claves.size, 6);
});

// --- Test M: makeAPUFromConcept nunca recorta la descripcion original ---
test('Test M: apu.concept conserva la descripcion completa (incluida la distancia) para los 6 conceptos reales', () => {
  const apus = REAL_CASE.map(c => makeAPUFromConcept(c, []));
  apus.forEach((apu, i) => assert.equal(apu.concept, REAL_CASE[i], `apu.concept debe ser exactamente igual al texto de entrada del concepto ${i + 1}`));
  assert.ok(apus[3].concept.toLowerCase().includes('distancia 25m'), 'el concepto de acarreo de loseta debe conservar "distancia 25m" en su descripcion');
});

// --- Test N/O: apu.variables expone lo detectado, sin pisar unit/qty existentes ---
test('Test N: apu.variables expone volumen + distancia para "acarreo de loseta 1.5m3 distancia 25m"', () => {
  const apu = makeAPUFromConcept(REAL_CASE[3], []);
  assert.equal(apu.variables.volume, 1.5);
  assert.equal(apu.variables.volumeUnit, 'm³');
  assert.equal(apu.variables.distance, 25);
  assert.equal(apu.variables.distanceUnit, 'm');
});

test('Test O: apu.variables expone pieceCount + distancia para "acarreo 46 costales distancia 25m"', () => {
  const apu = makeAPUFromConcept(REAL_CASE[2], []);
  assert.equal(apu.variables.pieceCount, 46);
  assert.equal(apu.variables.pieceUnit, 'costal');
  assert.equal(apu.variables.distance, 25);
});

// --- Test P: el motor APU CONSUME la distancia -- 10m/25m/50m producen rendimiento/costo distintos ---
test('Test P: acarreo a 10m, 25m y 50m produce PU (costo por unidad) coherentemente distinto, nunca identico', () => {
  const pu = (distanceText) => calcAPU(makeAPUFromConcept(`acarreo de 46 costales distancia ${distanceText}`, [])).pu;
  const pu10 = pu('10m');
  const pu25 = pu('25m');
  const pu50 = pu('50m');
  assert.ok(pu10 > 0 && pu25 > 0 && pu50 > 0, 'los 3 PU deben ser positivos (mano de obra con costo real)');
  assert.ok(pu10 < pu25, `a mayor distancia, mayor costo por unidad: pu10=${pu10} deberia ser < pu25=${pu25}`);
  assert.ok(pu25 < pu50, `a mayor distancia, mayor costo por unidad: pu25=${pu25} deberia ser < pu50=${pu50}`);

  // Lo mismo para acarreo volumetrico (m³), no solo para piezas/costales.
  const puVol = (distanceText) => calcAPU(makeAPUFromConcept(`acarreo de material 1.5m3 distancia ${distanceText}`, [])).pu;
  assert.ok(puVol('10m') < puVol('25m') && puVol('25m') < puVol('50m'));
});

test('Test P (rendimiento): el coeficiente de mano de obra (jornales por unidad) tambien varia con la distancia', () => {
  const laborCoef = (distanceText) => {
    const apu = makeAPUFromConcept(`acarreo de 46 costales distancia ${distanceText}`, []);
    return apu.labor[0][1]; // [descripcion, coeficiente, unidad, salario, fsr]
  };
  const c10 = laborCoef('10m'), c25 = laborCoef('25m'), c50 = laborCoef('50m');
  assert.ok(c10 < c25 && c25 < c50, `coeficiente de mano de obra debe crecer con la distancia: ${c10} / ${c25} / ${c50}`);
});

test('Test P (pipeline real v2): 10m/25m/50m producen PU e importe total distintos en el mismo motor que usa el lote (applyConceptMetadataV2 -> finalizeProfessionalAPU)', () => {
  const puFor = (distanceText) => {
    const v1 = makeAPUFromConcept(`acarreo de 46 costales distancia ${distanceText}`, []);
    const withMeta = applyConceptMetadataV2(migrateLegacyApuToV2(v1), { concept: v1.concept, unit: v1.unit, qty: 46 }, 0, 'test');
    return finalizeProfessionalAPU(withMeta).calculated.pu;
  };
  const pu10 = puFor('10m'), pu25 = puFor('25m'), pu50 = puFor('50m');
  assert.ok(pu10 < pu25 && pu25 < pu50, `PU debe crecer con la distancia en el pipeline v2 real: ${pu10} / ${pu25} / ${pu50}`);
});

// --- Test Q: la distancia jamas se interpreta como cantidad/precio/volumen en el motor APU ---
test('Test Q: un concepto de acarreo sin ninguna otra cifra usa cantidad=1 (nunca la distancia) y no fabrica volumen/piezas', () => {
  const apu = makeAPUFromConcept('acarreo de material distancia 40m', []);
  assert.equal(apu.variables.quantity, 1);
  assert.equal(apu.variables.distance, 40);
  assert.equal(apu.variables.volume, null);
  assert.equal(apu.variables.pieceCount, null);
});
