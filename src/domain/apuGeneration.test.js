import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAPUFromConcept, standardAPUForConcept, templateFallbackAPU, applyConceptMetadataV2 } from './apuGeneration.js';
import { calcAPU } from '../lib/apuCalc.js';
import { migrateLegacyApuToV2 } from './apuSchema.js';
import { finalizeProfessionalAPU } from './apuProfessional.js';
import { reconcileAPU } from '../lib/apuReconciliation.js';

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

// --- Biblioteca Inteligente (Fase catalogo real): makeAPUFromConcept debe
// preferir un match de catalogo real por CLAVE/similitud sobre el precio de
// plantilla, y declarar de que renglon vino via materialSources/
// equipmentSources -- sin catalogo (arreglo vacio, como en TODOS los tests
// anteriores de este archivo), el comportamiento es identico a siempre. ---
test('Test R: sin catalogo, materialSources/equipmentSources son arreglos de null (regresion cero)', () => {
  const apu = makeAPUFromConcept('colocación de loseta 64m2', []);
  assert.ok(Array.isArray(apu.materialSources));
  assert.ok(apu.materialSources.every(s => s === null));
  assert.ok(Array.isArray(apu.equipmentSources));
  assert.ok(apu.equipmentSources.every(s => s === null));
});

test('Test S: un material de catalogo por similitud de descripcion sustituye el precio de plantilla y queda declarado en materialSources (con su clave real, no MAT-XXX generico)', () => {
  // El renglon de plantilla es solo texto ('Loseta cerámica 30x30'), sin
  // clave propia -- por eso el match real aqui es por similitud de
  // descripcion, no por clave (clave_exacta es para cuando el CONCEPTO ya
  // trae una clave del catalogo importado, no el texto generico de plantilla).
  const catalog = [
    { desc: 'Loseta cerámica 30x30 antiderrapante', unidad: 'm²', precio: 199, clave: 'MAT-LOSETA-30' }
  ];
  const apu = makeAPUFromConcept('colocación de loseta 64m2', catalog);
  const idx = apu.materials.findIndex(r => /loseta/i.test(r[0]));
  assert.ok(idx >= 0);
  assert.equal(apu.materials[idx][3], 199);
  assert.equal(apu.materialSources[idx].clave, 'MAT-LOSETA-30');
  assert.equal(apu.materialSources[idx].matchMethod, 'fuzzy_token');
});

test('Test T: el equipo tambien consulta el catalogo real (antes solo materiales lo hacia)', () => {
  const catalog = [
    { desc: 'Cortadora de loseta electrica', unidad: 'día', precio: 220 }
  ];
  const apu = makeAPUFromConcept('colocación de loseta 64m2', catalog);
  const idx = apu.equipment.findIndex(r => /cortadora/i.test(r[0]));
  assert.ok(idx >= 0);
  assert.equal(apu.equipment[idx][3], 220);
  assert.equal(apu.equipmentSources[idx].matchMethod, 'fuzzy_token');
});

test('Test V: mano de obra tambien consulta el catalogo real (brecha encontrada en auditoria de aceptacion: antes solo materiales/equipo lo hacian) -- sustituye SOLO el salario, nunca el coeficiente/incidencia', () => {
  const catalog = [
    { desc: 'Colocador de loseta oficial de albañileria', unidad: 'jor', precio: 950, tipo: 'labor' }
  ];
  const sinCatalogo = makeAPUFromConcept('colocación de loseta 64m2', []);
  const conCatalogo = makeAPUFromConcept('colocación de loseta 64m2', catalog);
  const idx = conCatalogo.labor.findIndex(r => /colocador/i.test(r[0]));
  assert.ok(idx >= 0);
  assert.equal(conCatalogo.labor[idx][3], 950); // salario sustituido
  assert.equal(conCatalogo.labor[idx][1], sinCatalogo.labor[idx][1]); // coeficiente/incidencia SIN CAMBIOS
  assert.equal(conCatalogo.laborSources[idx].matchMethod, 'fuzzy_token');
  // La cuadrilla/rendimiento derivados (crewModel.js) deben ser IDENTICOS
  // con o sin catalogo: solo cambia el precio, nunca la incidencia/rendimiento.
  assert.deepEqual(conCatalogo.laborDetails[idx], sinCatalogo.laborDetails[idx]);
});

test('Test W: un catalogo con `tipo` no cruza mano de obra con materiales (regresion del hueco encontrado en auditoria)', () => {
  const catalog = [
    // Misma palabra "loseta" en ambos, tipos distintos -- no deben mezclarse.
    { desc: 'Cuadrilla especializada en loseta cerámica', unidad: 'jor', precio: 999, tipo: 'labor' },
    { desc: 'Loseta cerámica 30x30 antiderrapante', unidad: 'm²', precio: 199, tipo: 'material' }
  ];
  const apu = makeAPUFromConcept('colocación de loseta 64m2', catalog);
  const matIdx = apu.materials.findIndex(r => /loseta/i.test(r[0]));
  const laborIdx = apu.labor.findIndex(r => /colocador/i.test(r[0]));
  assert.equal(apu.materials[matIdx][3], 199); // el material tomo su propio precio
  assert.equal(apu.materialSources[matIdx].clave, null); // sin clave declarada, no rompe
  if(laborIdx >= 0 && apu.laborSources[laborIdx]){
    assert.notEqual(apu.labor[laborIdx][3], 199); // la mano de obra NUNCA debe tomar el precio del material
  }
});

// --- Rendimientos reales de Biblioteca (fase de correccion): el rendimiento
// se aplica DESDE EL ORIGEN (recalcula el coeficiente ANTES de derivar
// cuadrilla/rendimiento/jornada), nunca como un overwrite posterior que deja
// el coeficiente viejo sin tocar. ---
test('Test X: rendimiento encontrado por SINONIMO (texto de plantilla registrado como sinonimo de un registro con redaccion distinta) recalcula el coeficiente de mano de obra desde el origen', () => {
  const catalog = [
    { desc: 'Oficial de colocacion con cuadrilla real validada en campo', unidad: 'jor', precio: 950, tipo: 'labor', sinonimos: ['Colocador (oficial)'], rendimiento: 30, rendimientoUnidad: 'm²/jornada', cuadrilla: 1 }
  ];
  const sinCatalogo = makeAPUFromConcept('colocación de loseta 64m2', []);
  const conCatalogo = makeAPUFromConcept('colocación de loseta 64m2', catalog);
  const idx = conCatalogo.labor.findIndex(r => /colocador/i.test(r[0]));
  assert.equal(conCatalogo.laborSources[idx].matchMethod, 'alias_sinonimo');
  // Coeficiente recalculado: cuadrilla/rendimiento = 1/30, NO el de plantilla.
  assert.ok(Math.abs(conCatalogo.labor[idx][1] - 1/30) < 1e-9);
  assert.notEqual(conCatalogo.labor[idx][1], sinCatalogo.labor[idx][1]);
  // Salario tambien tomado del catalogo (mismo renglon, mismo match).
  assert.equal(conCatalogo.labor[idx][3], 950);
  // laborDetails refleja cuadrilla/rendimiento REALES, no la reconstruccion
  // generica de crewModel.js (que asumiria cuadrilla=1 y "rendimiento" =
  // inverso del coeficiente de plantilla).
  assert.equal(conCatalogo.laborDetails[idx].cuadrilla, 1);
  assert.equal(conCatalogo.laborDetails[idx].rendimiento, 30);
  assert.equal(conCatalogo.laborDetails[idx].rendimientoFuente, 'BIBLIOTECA');
  assert.ok(conCatalogo.laborDetails[idx].yieldConfidence >= 90);
  // Trazabilidad capturada en la fuente del renglon.
  assert.ok(conCatalogo.laborSources[idx].rendimientoOriginal > 0);
  assert.equal(conCatalogo.laborSources[idx].rendimientoAdoptado, 30);
  assert.equal(conCatalogo.laborSources[idx].cuadrillaAdoptada, 1);
  assert.equal(conCatalogo.laborSources[idx].rendimientoMetodo, 'alias_sinonimo');
});

test('Test Y: rendimiento INEXISTENTE en el catalogo (solo precio) -- coeficiente/cuadrilla/rendimiento de plantilla SIN CAMBIOS (regresion)', () => {
  const catalog = [
    { desc: 'Oficial de colocacion con cuadrilla real validada en campo', unidad: 'jor', precio: 950, tipo: 'labor', sinonimos: ['Colocador (oficial)'] } // sin rendimiento
  ];
  const sinCatalogo = makeAPUFromConcept('colocación de loseta 64m2', []);
  const conCatalogo = makeAPUFromConcept('colocación de loseta 64m2', catalog);
  const idx = conCatalogo.labor.findIndex(r => /colocador/i.test(r[0]));
  assert.equal(conCatalogo.labor[idx][1], sinCatalogo.labor[idx][1]); // coeficiente identico
  assert.equal(conCatalogo.labor[idx][3], 950); // solo el salario cambio
  assert.deepEqual(conCatalogo.laborDetails[idx], sinCatalogo.laborDetails[idx]); // cuadrilla/rendimiento identicos
  assert.equal(conCatalogo.laborSources[idx].rendimientoOriginal, undefined);
});

test('Test Z: rendimiento real de Biblioteca en ACARREO recalcula MO y EQUIPO desde el mismo coeficiente (unica relacion real modelada hoy entre mano de obra y equipo)', () => {
  const catalog = [
    { desc: 'Cuadrilla de acarreo de costales con rendimiento validado en campo, 25 metros', unidad: 'jor', precio: 500, tipo: 'labor', sinonimos: ['Peon de acarreo'], rendimiento: 8, cuadrilla: 1 }
  ];
  // El renglon 0 de labor en acarreo_manual es 'Peon de acarreo' segun la plantilla.
  const sinCatalogo = makeAPUFromConcept('acarreo 46 costales distancia 25m', []);
  const conCatalogo = makeAPUFromConcept('acarreo 46 costales distancia 25m', catalog);
  assert.equal(conCatalogo.laborSources[0]?.rendimiento, 8, 'se esperaba match en el renglon 0 de mano de obra');
  const nuevoCoef = 1 / 8;
  assert.ok(Math.abs(conCatalogo.labor[0][1] - nuevoCoef) < 1e-9);
  // Equipo[0] (equipo menor de acarreo) DEBE compartir el mismo coeficiente recalculado.
  assert.ok(Math.abs(conCatalogo.equipment[0][1] - nuevoCoef) < 1e-9);
  assert.notEqual(conCatalogo.equipment[0][1], sinCatalogo.equipment[0][1]);
});

test('Test AA: reconciliacion matematica sigue OK despues de aplicar un rendimiento real de Biblioteca (pipeline v2 completo)', () => {
  const catalog = [
    { desc: 'Oficial de colocacion con cuadrilla real validada en campo', unidad: 'jor', precio: 950, tipo: 'labor', sinonimos: ['Colocador (oficial)'], rendimiento: 30, cuadrilla: 1 }
  ];
  const v1 = makeAPUFromConcept('colocación de loseta 64m2', catalog);
  const v2 = applyConceptMetadataV2(migrateLegacyApuToV2(v1), { concept: v1.concept, unit: v1.unit, qty: 64 }, 0, 'test');
  const final = finalizeProfessionalAPU(v2);
  const idx = v1.labor.findIndex(r => /colocador/i.test(r[0]));
  assert.equal(final.labor[idx].rendimientoFuente, 'BIBLIOTECA');
  assert.ok(final.labor[idx].rendimientoTrazabilidad, 'se esperaba trazabilidad de rendimiento en el renglon v2');
  assert.equal(final.labor[idx].rendimientoTrazabilidad.valorAdoptado, 30);
  const reconciliation = reconcileAPU(final, { claimedTotals: final.calculated });
  assert.equal(reconciliation.ok, true, `reconciliacion deberia seguir OK: ${JSON.stringify(reconciliation.diffs)}`);
});

// --- EPP dinamico (Prioridad 2): resuelto por riesgo, nunca hardcodeado por
// disciplina, y presente en CUALQUIER concepto (incluidas las ~40 plantillas
// ya existentes, sin haberlas tocado una por una). ---
test('Test AB: cualquier concepto de plantilla trae EPP base automaticamente (sin tocar SYSTEM_RESOURCES) y queda REQUIERE_VALIDACION sin catalogo', () => {
  const apu = makeAPUFromConcept('colocación de loseta 64m2', []);
  assert.ok(apu.seguridad.length >= 3);
  assert.ok(apu.seguridad.every(r => r.requiereValidacion === true));
  assert.ok(apu.seguridad.every(r => r.precioUnitario === 0), 'nunca debe fabricar un precio de EPP');
});

test('Test AC: con catalogo real de EPP, el precio se aplica y el renglon deja de requerir validacion (cuando ademas hay rendimiento diario, que siempre existe por defecto)', () => {
  const catalog = [
    { desc: 'Casco de seguridad industrial', unidad: 'pza', precio: 175, tipo: 'epp', sinonimos: ['Casco de seguridad'] }
  ];
  const apu = makeAPUFromConcept('colocación de loseta 64m2', catalog);
  const casco = apu.seguridad.find(r => r.descripcion === 'Casco de seguridad');
  assert.equal(casco.precioUnitario, 175);
  assert.equal(casco.requiereValidacion, false);
  assert.ok(casco.rendimientoDiario > 0);
});

test('Test U (pipeline v2 real): un renglon con match de catalogo llega a migrateLegacyApuToV2 marcado IMPORTADO, aunque el resto del APU sea de plantilla (ASUMIDO)', () => {
  const catalog = [
    { desc: 'Loseta cerámica antiderrapante 30x30 nacional', unidad: 'm²', precio: 199, clave: 'MAT-LOSETA-30' }
  ];
  const v1 = makeAPUFromConcept('colocación de loseta 64m2', catalog);
  const v2 = migrateLegacyApuToV2(v1);
  const idx = v1.materials.findIndex(r => /loseta/i.test(r[0]));
  assert.equal(v2.materials[idx].fuente.estado, 'IMPORTADO');
  assert.equal(v2.materials[idx].clave, 'MAT-LOSETA-30');
  // Un material SIN match de catalogo en el mismo APU conserva el estado
  // uniforme anterior (ASUMIDO -- plantilla sin sourceFile ni IA).
  const otherIdx = v1.materials.findIndex((_, i) => i !== idx);
  assert.equal(v2.materials[otherIdx].fuente.estado, 'ASUMIDO');
});
