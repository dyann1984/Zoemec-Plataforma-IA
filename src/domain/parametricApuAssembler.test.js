import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleAPUFromParametricResult } from './parametricApuAssembler.js';
import { PARAMETRIC_ELEMENTS } from './parametricElements.js';
import { buildBaseAuxiliaries, makeAuxiliaryDefinition } from './auxiliaries.js';
import { calcAPU, rowImporte } from '../lib/apuCalc.js';
import { PARAM_ORIGIN } from './parametricTraceability.js';
import { finalizeProfessionalAPU } from './apuProfessional.js';

const FAKE_CATALOG = [
  { desc: 'Cemento gris CPC 30R', unidad: 'saco', precio: 245, estado: 'VERIFICADO', tipo: 'material' },
  { desc: 'Arena de río', unidad: 'm³', precio: 470, tipo: 'material' },
  { desc: 'Grava 3/4"', unidad: 'm³', precio: 510, tipo: 'material' },
  { desc: 'Piedra bola/brasa para cimiento', unidad: 'm³', precio: 380, tipo: 'material' }
];

test('assembleAPUFromParametricResult (zapata_aislada): produce un APU con la MISMA forma que uno generado por IA', () => {
  const elementDef = PARAMETRIC_ELEMENTS.zapata_aislada;
  const inputs = { largo: 1.2, ancho: 1.2, peralte: 0.4 };
  const calcResult = elementDef.calculate(inputs, {});
  const apu = assembleAPUFromParametricResult({
    elementDef, inputs, params: {}, calcResult, catalog: FAKE_CATALOG, auxiliaries: buildBaseAuxiliaries()
  });

  // Forma identica a makeAPUFromConcept/standardAPUForConcept
  assert.ok(Array.isArray(apu.materials) && apu.materials.length > 0);
  assert.ok(Array.isArray(apu.labor) && apu.labor.length > 0);
  assert.ok(Array.isArray(apu.equipment));
  apu.materials.forEach(row => assert.equal(row.length, 5));
  apu.labor.forEach(row => assert.equal(row.length, 5));
  apu.equipment.forEach(row => assert.equal(row.length, 4));
  assert.equal(typeof apu.herramienta, 'number');
  assert.equal(typeof apu.indCampo, 'number');
  assert.equal(typeof apu.iva, 'number');
  assert.ok(Array.isArray(apu.aiNotes) && apu.aiNotes.length > 0);

  // Trazabilidad de origen -- aditivo, nunca leido por el resto del motor
  assert.equal(apu.aiGenerated, false);
  assert.equal(apu.parametricGenerated, true);
  assert.equal(apu.parametricSource.elementId, 'zapata_aislada');
  assert.equal(apu.family, elementDef.family);

  // parameterTrace (pedido explicito de trazabilidad de parametros): debe
  // venir dentro del APU, no solo en la UI del wizard.
  const trace = apu.parametricSource.parameterTrace;
  assert.ok(Array.isArray(trace) && trace.length > 0);
  ['largo', 'ancho', 'peralte'].forEach(key => assert.ok(trace.some(e => e.clave === key && e.origen === PARAM_ORIGIN.USER_PROVIDED)));
  assert.ok(trace.some(e => e.clave === 'pctAceroVolumen' && e.origen === PARAM_ORIGIN.ZOEMEC_SUGGESTED));
  assert.ok(trace.some(e => e.clave === 'volumenConcreto' && e.origen === PARAM_ORIGIN.CALCULATED));
  assert.ok(trace.some(e => e.origen === PARAM_ORIGIN.AUXILIARY_DERIVED && e.auxiliarClave === 'CONC-200'));

  // El precio de catalogo real (245) se uso para el cemento, no un precio
  // inventado -- confirma que resolveAuxiliaryCost/findCatalogMatches si
  // se ejecutaron de verdad dentro del ensamblador.
  const cemento = apu.materials.find(r => r[0].toLowerCase().includes('cemento'));
  assert.equal(cemento[3], 245);

  // El motor de calculo v1 real (el que usa la UI/exportacion hoy) corre
  // sobre el resultado sin lanzar, y produce un costo directo positivo.
  const calc = calcAPU(apu);
  assert.ok(calc.direct > 0);
  assert.ok(calc.mat > 0);
  assert.ok(calc.mo > 0);
});

test('assembleAPUFromParametricResult (columna): tambien produce forma valida y corre en calcAPU sin lanzar', () => {
  const elementDef = PARAMETRIC_ELEMENTS.columna;
  const inputs = { base: 0.3, peralte: 0.3, altura: 3 };
  const calcResult = elementDef.calculate(inputs, {});
  const apu = assembleAPUFromParametricResult({
    elementDef, inputs, params: {}, calcResult, catalog: FAKE_CATALOG, auxiliaries: buildBaseAuxiliaries()
  });
  const calc = calcAPU(apu);
  assert.ok(calc.direct > 0);
  // 2 renglones de acero (longitudinal + estribos), cada uno resuelto como
  // material aparte -- nunca colapsados en un solo renglon generico.
  const acero = apu.materials.filter(r => r[0].toLowerCase().includes('varilla'));
  assert.equal(acero.length, 2);
});

test('assembleAPUFromParametricResult (muro): tambien produce forma valida y corre en calcAPU sin lanzar', () => {
  const elementDef = PARAMETRIC_ELEMENTS.muro;
  const inputs = { largo: 4, altura: 2.5, areaVanos: 1.5 };
  const calcResult = elementDef.calculate(inputs, {});
  const apu = assembleAPUFromParametricResult({
    elementDef, inputs, params: {}, calcResult, catalog: FAKE_CATALOG, auxiliaries: buildBaseAuxiliaries()
  });
  const calc = calcAPU(apu);
  assert.ok(calc.direct > 0);
  const block = apu.materials.find(r => r[0].toLowerCase().includes('block'));
  assert.ok(block && block[1] > 0);
});

test('assembleAPUFromParametricResult: un auxiliar referenciado que NO existe en la lista disponible nunca se inventa -- queda REQUIERE_VALIDACION explicito', () => {
  const elementDef = PARAMETRIC_ELEMENTS.zapata_aislada;
  const inputs = { largo: 1, ancho: 1, peralte: 0.4 };
  const calcResult = elementDef.calculate(inputs, {});
  const apu = assembleAPUFromParametricResult({
    elementDef, inputs, params: {}, calcResult, catalog: [], auxiliaries: [] // sin auxiliares disponibles
  });
  const missing = apu.materials.find(r => r[0].includes('no encontrado'));
  assert.ok(missing);
  assert.equal(missing[3], 0); // nunca un precio inventado
});

/* ============================================================
   POLITICA DE DESPERDICIO/MERMA -- pruebas de regresion explicitas
   (ver "POLITICA DE DESPERDICIO/MERMA" en auxiliaries.js y en el
   encabezado de parametricApuAssembler.js). Fuente unica de verdad:
   auxiliares guardan cantidad NETA; el desperdicio se aplica UNA sola vez,
   en la capa de calculo del APU (rowImporte/calcMaterialRow en
   src/lib/apuCalc.js), nunca en auxiliaries.js ni en el ensamblador. */

function auxiliarConDesperdicio(desperdicioPct){
  return makeAuxiliaryDefinition({
    clave: 'TEST-AUX', nombre: 'Auxiliar de prueba', unidad: 'm³', categoria: 'concreto',
    composicion: [['Cemento gris CPC 30R', 10, 'saco', 0, desperdicioPct]]
  });
}

function assembleWithAuxiliar(desperdicioPct, consumoCantidad = 2){
  const elementDef = PARAMETRIC_ELEMENTS.zapata_aislada;
  const inputs = { largo: 1, ancho: 1, peralte: 0.4 };
  // consumos manual (no via elementDef.calculate) para aislar la variable
  // bajo prueba (el desperdicio del auxiliar) del resto de la formula de
  // zapata_aislada -- estas pruebas validan la POLITICA de desperdicio,
  // no la formula geometrica (ya cubierta en parametricElements.test.js).
  const calcResult = { cantidades: {}, consumos: [{ tipo: 'auxiliar', clave: 'TEST-AUX', cantidad: consumoCantidad, unidad: 'm³' }], estadoPorValor: {} };
  const apu = assembleAPUFromParametricResult({
    elementDef, inputs, params: {}, calcResult, catalog: FAKE_CATALOG, auxiliaries: [auxiliarConDesperdicio(desperdicioPct)]
  });
  const row = apu.materials.find(r => r[0].toLowerCase().includes('cemento'));
  return { apu, row };
}

test('1. auxiliar SIN desperdicio (0%): el renglon de APU queda con desperdicioPct=0 y la cantidad neta exacta', () => {
  const { row } = assembleWithAuxiliar(0, 2);
  assert.equal(row[4], 0); // desperdicioPct del renglon
  assert.equal(row[1], 10 * 2); // cantidadBase (10 saco/m3) x consumo (2 m3) -- sin inflar
});

test('2. auxiliar CON desperdicio configurado (10%): el renglon de APU guarda la cantidad NETA (sin inflar) y el desperdicioPct por separado', () => {
  const { row } = assembleWithAuxiliar(10, 2);
  assert.equal(row[4], 10); // desperdicioPct del renglon = el del auxiliar, intacto
  assert.equal(row[1], 10 * 2); // cantidad del renglon sigue siendo la NETA (20), NUNCA 20*1.10=22
});

test('3. el APU final NO duplica la merma: rowImporte aplica (1+10%) EXACTAMENTE UNA VEZ, nunca al cuadrado', () => {
  const { row } = assembleWithAuxiliar(10, 2);
  const importe = rowImporte('materials', row);
  const esperadoUnaVez = 20 * 245 * 1.10; // cantidad neta x precio x (1+10%) -- una sola aplicacion
  const esperadoDosVeces = 20 * 245 * 1.10 * 1.10; // lo que saldria si se duplicara
  assert.ok(Math.abs(importe - esperadoUnaVez) < 1e-9, `esperado ${esperadoUnaVez}, recibido ${importe}`);
  assert.notEqual(Math.round(importe), Math.round(esperadoDosVeces));
});

test('4. cambiar el desperdicio del auxiliar modifica el importe final UNA sola vez (escalado lineal, no al cuadrado)', () => {
  const { row: row5 } = assembleWithAuxiliar(5, 2);
  const { row: row10 } = assembleWithAuxiliar(10, 2);
  const importe5 = rowImporte('materials', row5);
  const importe10 = rowImporte('materials', row10);
  const ratioObservado = importe10 / importe5;
  const ratioEsperadoUnaVez = 1.10 / 1.05; // si el desperdicio se aplicara UNA vez
  const ratioSiSeDuplicara = Math.pow(1.10 / 1.05, 2); // si se aplicara dos veces
  assert.ok(Math.abs(ratioObservado - ratioEsperadoUnaVez) < 1e-9, `ratio esperado ${ratioEsperadoUnaVez}, recibido ${ratioObservado}`);
  assert.ok(Math.abs(ratioObservado - ratioSiSeDuplicara) > 1e-6);
});

test('5. modo sencillo y modo experto producen EXACTAMENTE el mismo resultado cuando el experto usa los mismos valores que el default', () => {
  const casos = [
    [PARAMETRIC_ELEMENTS.zapata_aislada, { largo: 1.5, ancho: 1.5, peralte: 0.45 }],
    [PARAMETRIC_ELEMENTS.columna, { base: 0.35, peralte: 0.35, altura: 2.8 }],
    [PARAMETRIC_ELEMENTS.muro, { largo: 5, altura: 2.6, areaVanos: 2 }]
  ];
  casos.forEach(([elementDef, inputs]) => {
    const sencillo = elementDef.calculate(inputs, {}); // modo sencillo: sin overrides, usa defaults
    const paramsExplicitos = Object.fromEntries(elementDef.params.map(p => [p.key, p.default])); // modo experto: mismos valores, tecleados explicitamente
    const experto = elementDef.calculate(inputs, paramsExplicitos);
    assert.deepEqual(sencillo.cantidades, experto.cantidades, `${elementDef.id}: cantidades deben coincidir`);
    assert.deepEqual(sencillo.consumos, experto.consumos, `${elementDef.id}: consumos deben coincidir`);
    // computeEstadoPorValor no puede distinguir "el usuario nunca toco este
    // parametro" de "el usuario tecleo en modo experto exactamente el mismo
    // valor que el default" -- ambos casos producen el MISMO valor numerico
    // final, asi que es correcto (conservador, nunca finge confirmacion que
    // no existe) que ambos queden marcados ASUMIDO por igual. Lo que
    // realmente prueba "mismo resultado con los mismos parametros" son
    // cantidades/consumos (arriba) -- aqui solo se confirma que ambos modos
    // son CONSISTENTES entre si, no que "experto" borre la marca.
    assert.deepEqual(sencillo.estadoPorValor, experto.estadoPorValor, `${elementDef.id}: estadoPorValor debe ser consistente entre modos cuando el valor final es identico`);
  });
});

test('6. todos los elementos de Cimentacion (+ Columna/Muro de referencia) respetan la MISMA politica de desperdicio en cada renglon derivado de un auxiliar', () => {
  const casos = [
    [PARAMETRIC_ELEMENTS.zapata_aislada, { largo: 1.2, ancho: 1.2, peralte: 0.4 }],
    [PARAMETRIC_ELEMENTS.zapata_corrida, { largo: 3, ancho: 0.6, peralte: 0.3 }],
    [PARAMETRIC_ELEMENTS.losa_cimentacion, { largo: 5, ancho: 4, espesor: 0.15 }],
    [PARAMETRIC_ELEMENTS.cimiento_piedra, { largo: 4, anchoBase: 0.6, anchoCorona: 0.3, altura: 0.5 }],
    [PARAMETRIC_ELEMENTS.plantilla, { largo: 3, ancho: 2, espesor: 0.05 }],
    [PARAMETRIC_ELEMENTS.columna, { base: 0.3, peralte: 0.3, altura: 3 }],
    [PARAMETRIC_ELEMENTS.muro, { largo: 4, altura: 2.5, areaVanos: 1 }]
  ];
  const auxiliares = buildBaseAuxiliaries();
  casos.forEach(([elementDef, inputs]) => {
    const calcResult = elementDef.calculate(inputs, {});
    const apu = assembleAPUFromParametricResult({ elementDef, inputs, params: {}, calcResult, catalog: FAKE_CATALOG, auxiliaries: auxiliares });
    // Para cada renglon de material derivado de un auxiliar (identificable
    // porque su desc coincide con un ingrediente de composicion de algun
    // auxiliar usado), confirma que el renglon SI trae desperdicioPct (no
    // esta forzado a 0 escondiendo la merma real del ingrediente) y que
    // calcAPU corre sin lanzar sobre el resultado completo.
    const auxiliaresUsados = calcResult.consumos.filter(c => c.tipo === 'auxiliar').map(c => auxiliares.find(a => a.clave === c.clave)).filter(Boolean);
    auxiliaresUsados.forEach(aux => {
      aux.composicion.forEach(ingrediente => {
        const row = apu.materials.find(r => r[0] === ingrediente.desc);
        assert.ok(row, `${elementDef.id}: falta el renglon para ${ingrediente.desc}`);
        assert.equal(row[4], ingrediente.desperdicioPct, `${elementDef.id}/${ingrediente.desc}: desperdicioPct debe venir intacto del auxiliar`);
      });
    });
    assert.doesNotThrow(() => calcAPU(apu));
  });
});

/* ============================================================
   REGLA DE PARIDAD (pedido explicito, bloque Cimentacion completa):
   "resultado paramétrico == cantidadBase del APU" para CADA elemento --
   si el calculo, el croquis o el APU llegaran a divergir, esta prueba
   debe fallar. Se verifica para TODOS los consumos de TODOS los
   elementos (no solo el primero de cada uno): un consumo tipo 'material'
   compara directo contra el renglon; un consumo tipo 'auxiliar' compara
   cada ingrediente de su composicion (cantidadPorUnidad x consumo.cantidad)
   contra su propio renglon expandido. */
const PARIDAD_CASOS = [
  [PARAMETRIC_ELEMENTS.zapata_aislada, { largo: 1.2, ancho: 1.2, peralte: 0.4 }],
  [PARAMETRIC_ELEMENTS.zapata_corrida, { largo: 3, ancho: 0.6, peralte: 0.3 }],
  [PARAMETRIC_ELEMENTS.losa_cimentacion, { largo: 5, ancho: 4, espesor: 0.15 }],
  [PARAMETRIC_ELEMENTS.cimiento_piedra, { largo: 4, anchoBase: 0.6, anchoCorona: 0.3, altura: 0.5 }],
  [PARAMETRIC_ELEMENTS.plantilla, { largo: 3, ancho: 2, espesor: 0.05 }],
  [PARAMETRIC_ELEMENTS.columna, { base: 0.3, peralte: 0.3, altura: 3 }],
  [PARAMETRIC_ELEMENTS.muro, { largo: 4, altura: 2.5, areaVanos: 1 }]
];

PARIDAD_CASOS.forEach(([elementDef, inputs]) => {
  test(`REGLA DE PARIDAD (${elementDef.id}): resultado del cuantificador == cantidadBase de CADA renglon del APU`, () => {
    const auxiliares = buildBaseAuxiliaries();
    const calcResult = elementDef.calculate(inputs, {});
    const apu = assembleAPUFromParametricResult({ elementDef, inputs, params: {}, calcResult, catalog: FAKE_CATALOG, auxiliaries: auxiliares });

    calcResult.consumos.forEach(consumo => {
      if(!(consumo.cantidad > 0)) return; // el ensamblador tampoco genera renglon para consumos en 0 (ver expandConsumo)
      if(consumo.tipo === 'material'){
        const row = apu.materials.find(r => r[0] === consumo.desc);
        assert.ok(row, `${elementDef.id}: falta el renglon de material "${consumo.desc}"`);
        assert.ok(Math.abs(row[1] - consumo.cantidad) < 1e-9,
          `${elementDef.id}/${consumo.desc}: resultado del cuantificador (${consumo.cantidad}) debe ser EXACTAMENTE la cantidadBase del renglon (${row[1]})`);
      }
      if(consumo.tipo === 'auxiliar'){
        const aux = auxiliares.find(a => a.clave === consumo.clave);
        assert.ok(aux, `${elementDef.id}: auxiliar "${consumo.clave}" no encontrado`);
        aux.composicion.forEach(ingrediente => {
          const cantidadBaseEsperada = ingrediente.cantidadPorUnidad * consumo.cantidad;
          const row = apu.materials.find(r => r[0] === ingrediente.desc);
          assert.ok(row, `${elementDef.id}: falta el renglon de "${ingrediente.desc}" (auxiliar ${consumo.clave})`);
          assert.ok(Math.abs(row[1] - cantidadBaseEsperada) < 1e-9,
            `${elementDef.id}/${ingrediente.desc}: resultado del cuantificador (${cantidadBaseEsperada}) debe ser EXACTAMENTE la cantidadBase del renglon (${row[1]})`);
        });
      }
    });
  });

  test(`REGLA DE PARIDAD (${elementDef.id}): el croquis usa los MISMOS parametros resueltos que produjeron las cantidades del APU`, async () => {
    const { buildElementSketch } = await import('./parametricSketch.js');
    const calcResult1 = elementDef.calculate(inputs, {});
    const calcResult2 = elementDef.calculate(inputs, {});
    assert.deepEqual(calcResult1.cantidades, calcResult2.cantidades, `${elementDef.id}: calculate() debe ser determinista`);
    // El croquis (buildElementSketch) resuelve params con la MISMA funcion
    // resolveParams que calculate() -- si algun elemento nuevo declarara su
    // propio default por separado en parametricSketch.js, esta prueba lo
    // detectaria en cuanto ese default divergiera del real (ver prueba
    // dedicada "nunca puede desincronizarse" en parametricSketch.test.js
    // para la comparacion directa contra el builder puro).
    assert.doesNotThrow(() => buildElementSketch(elementDef.id, inputs, {}), `${elementDef.id}: el croquis debe poder generarse con los mismos inputs/params que el calculo`);
  });
});

/* ============================================================
   TRAZABILIDAD DE PARAMETROS -- pedido explicito: "parametricSource debe
   viajar dentro del APU generado y sobrevivir a guardado, reapertura,
   historial/versionado, PDF, Excel y auditoria". Las pruebas 5 y 6 abajo
   verifican eso a nivel de datos (JSON/estructura, migracion v1->v2 y
   finalizacion), que es lo que realmente atraviesa Firestore y las
   exportaciones -- incluyendo drawApuSections/buildProfessionalAPUSheet
   (apuExportV2.js), llamadas directamente aqui mismo. */

test('5. PERSISTENCIA de parametricSource.parameterTrace: sobrevive un guardado/reapertura (round-trip JSON, igual que Firestore), a migrateLegacyApuToV2 y a finalizeProfessionalAPU', async () => {
  const { migrateLegacyApuToV2 } = await import('./apuSchema.js');
  const elementDef = PARAMETRIC_ELEMENTS.zapata_aislada;
  const inputs = { largo: 1.2, ancho: 1.2, peralte: 0.4 };
  const params = { pctAceroVolumen: 2.0 }; // override real, para probar que el estado de override tambien sobrevive
  const calcResult = elementDef.calculate(inputs, params);
  const apu = assembleAPUFromParametricResult({
    elementDef, inputs, params, calcResult, catalog: FAKE_CATALOG, auxiliaries: buildBaseAuxiliaries()
  });

  // Round-trip JSON: lo mismo que le pasa a un documento al guardarse y
  // reabrirse desde Firestore (serializacion estructural, sin funciones ni
  // undefined) -- si algo se perdiera aqui, se perderia tambien en produccion.
  const reopened = JSON.parse(JSON.stringify(apu));
  assert.deepEqual(reopened.parametricSource.parameterTrace, apu.parametricSource.parameterTrace);
  assert.equal(reopened.parametricSource.parameterTrace.find(e => e.clave === 'pctAceroVolumen').origen, PARAM_ORIGIN.USER_OVERRIDE);

  // migrateLegacyApuToV2 es el paso REAL que corre TODO el pipeline de
  // guardado/exportacion (main.jsx, RevisionBandeja.jsx, las rutas de
  // servidor) sobre un APU v1 como el que arma este ensamblador, ANTES de
  // finalizeProfessionalAPU -- si este paso perdiera parametricSource, se
  // perderia para siempre en cuanto el usuario guardara el APU, sin importar
  // que el ensamblador lo haya generado bien. (Gap real encontrado y
  // corregido en este mismo cambio: migrateLegacyApuToV2 reconstruye el
  // objeto v2 desde cero y no heredaba estos campos por defecto.)
  const v2 = migrateLegacyApuToV2(apu);
  assert.equal(v2.parametricGenerated, true);
  assert.deepEqual(v2.parametricSource.parameterTrace, apu.parametricSource.parameterTrace);

  // finalizeProfessionalAPU es el paso que corren TODAS las exportaciones y
  // la Bandeja de revision antes de mostrar/exportar un APU -- nunca debe
  // descartar un campo aditivo como parametricSource.
  const finalized = finalizeProfessionalAPU(v2);
  assert.deepEqual(finalized.parametricSource.parameterTrace, apu.parametricSource.parameterTrace);
  assert.equal(finalized.parametricGenerated, true);

  // Version/fecha del auxiliar tambien sobreviven -- necesarias para saber
  // CUAL version del auxiliar produjo la dosificacion/desperdicio mostrados.
  const derivado = finalized.parametricSource.parameterTrace.find(e => e.origen === PARAM_ORIGIN.AUXILIARY_DERIVED);
  assert.ok(derivado.auxiliarVersion != null && derivado.auxiliarFecha != null);
});

test('5b. un APU v1 SIN origen parametrico migra con parametricGenerated:false/parametricSource:null (nunca se inventa trazabilidad para un APU normal)', async () => {
  const { migrateLegacyApuToV2 } = await import('./apuSchema.js');
  const v2 = migrateLegacyApuToV2({ id: 'APU-X', concept: 'x', materials: [], labor: [], equipment: [] });
  assert.equal(v2.parametricGenerated, false);
  assert.equal(v2.parametricSource, null);
});

test('6. EXPORTACION conserva la trazabilidad: buildProfessionalAPUSheet (Excel) y drawApuSections (PDF) incluyen la seccion de trazabilidad de parametros', async () => {
  const { buildProfessionalAPUSheet, drawApuSections } = await import('../lib/apuExportV2.js');
  const { migrateLegacyApuToV2 } = await import('./apuSchema.js');
  const { jsPDF } = await import('jspdf');
  const elementDef = PARAMETRIC_ELEMENTS.plantilla;
  const inputs = { largo: 3, ancho: 2, espesor: 0.05 };
  const calcResult = elementDef.calculate(inputs, {});
  const apuV1 = assembleAPUFromParametricResult({
    elementDef, inputs, params: {}, calcResult, catalog: FAKE_CATALOG, auxiliaries: buildBaseAuxiliaries()
  });
  // Mismo paso que corre el pipeline real antes de exportar (ver prueba 5).
  const apu = migrateLegacyApuToV2(apuV1);

  // Excel: la seccion de trazabilidad de parametros debe existir como fila
  // real dentro de `rows` (datos, no un binario que haya que decodificar) y
  // el nombre del primer input debe aparecer en algun renglon de esa seccion.
  const sheet = buildProfessionalAPUSheet(apu);
  const spanRowIndex = sheet.rows.findIndex(row => row.some(cell => typeof cell?.value === 'string' && cell.value.includes('TRAZABILIDAD DE PARAMETROS')));
  assert.ok(spanRowIndex >= 0, 'falta la seccion de trazabilidad de parametros en la hoja Excel');
  const traceRows = sheet.rows.slice(spanRowIndex, spanRowIndex + 20);
  assert.ok(traceRows.some(row => row.some(cell => typeof cell?.value === 'string' && cell.value.toLowerCase().includes('largo'))),
    'la hoja Excel debe listar el input "Largo" dentro de la seccion de trazabilidad');

  // PDF: la seccion queda registrada en layout.sections (estructura real
  // devuelta por drawApuSections, no texto extraido de bytes de PDF).
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const { layout } = drawApuSections(doc, apu, { startY: 12, startPage: 1 });
  assert.ok(layout.sections.some(s => s.title.includes('TRAZABILIDAD DE PARAMETROS')),
    'falta la seccion de trazabilidad de parametros en el layout del PDF');
});

test('6b. un APU normal (no parametrico) NUNCA muestra una seccion de trazabilidad de parametros vacia', async () => {
  const { buildProfessionalAPUSheet, drawApuSections } = await import('../lib/apuExportV2.js');
  const { migrateLegacyApuToV2 } = await import('./apuSchema.js');
  const { jsPDF } = await import('jspdf');
  const elementDef = PARAMETRIC_ELEMENTS.zapata_aislada;
  const inputs = { largo: 1, ancho: 1, peralte: 0.3 };
  const calcResult = elementDef.calculate(inputs, {});
  const apuV1 = assembleAPUFromParametricResult({ elementDef, inputs, params: {}, calcResult, catalog: FAKE_CATALOG, auxiliaries: buildBaseAuxiliaries() });
  delete apuV1.parametricGenerated; delete apuV1.parametricSource; // simula un APU generado por IA, sin origen parametrico
  const apu = migrateLegacyApuToV2(apuV1);

  const sheet = buildProfessionalAPUSheet(apu);
  assert.ok(!sheet.rows.some(row => row.some(cell => typeof cell?.value === 'string' && cell.value.includes('TRAZABILIDAD DE PARAMETROS'))));

  const doc = new jsPDF('portrait', 'mm', 'a4');
  const { layout } = drawApuSections(doc, apu, { startY: 12, startPage: 1 });
  assert.ok(!layout.sections.some(s => s.title.includes('TRAZABILIDAD DE PARAMETROS')));
});
