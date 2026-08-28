/* Motor universal de APUs: pruebas de los casos concretos encontrados
   durante la auditoria y la corrida de evidencia (25+ conceptos nunca
   antes cubiertos) -- no solo "los tests pasan", sino que cada caso aqui
   reproduce un defecto real ya verificado antes de escribir el fix. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAPUFromConcept } from './apuGeneration.js';
import { finalizeProfessionalAPU } from './apuProfessional.js';
import { migrateLegacyApuToV2 } from './apuSchema.js';
import { runTechnicalQualityRules } from './technicalQualityRules.js';
import { classifyConstructionSystem, extractSecondaryActivities } from './constructionSystems.js';
import { calcLaborRow } from '../lib/apuCalc.js';

test('Bug reportado: "acero...incluye acarreos" clasifica como acero (Estructura metalica), no como acarreo_manual (Terracerias)', () => {
  const apu = makeAPUFromConcept('Suministro y habilitado de acero de refuerzo fy=4200, incluye acarreos, cortes y dobleces', []);
  assert.equal(apu.primaryActivity, 'acero');
  assert.equal(apu.family, 'Estructura metalica');
  assert.ok(apu.materials.some(r => /acero/i.test(r[0])), 'debe traer acero como material, no lista vacia');
  assert.deepEqual(new Set(apu.secondaryActivities), new Set(['acarreo', 'acarreos', 'corte', 'cortes', 'dobleces']));
});

test('Regresion preservada: "acarreo de loseta" sigue clasificando como acarreo_manual (Terracerias), no como piso', () => {
  const apu = makeAPUFromConcept('Acarreo de loseta 1.5m3 distancia 25m', []);
  assert.equal(apu.primaryActivity, 'acarreo_manual');
  assert.equal(apu.family, 'Terracerias');
  assert.ok(!apu.materials.some(r => /loseta/i.test(r[0])), 'no debe traer loseta como material nueva');
});

test('Disciplinas antes sin cobertura (voz y datos, HVAC, contra incendio) ya no caen al generico $0', () => {
  const cases = [
    ['Suministro e instalación de cableado estructurado categoría 6 para voz y datos', 'voz_datos'],
    ['Instalación de sistema de aire acondicionado tipo minisplit 1 tonelada', 'hvac'],
    ['Suministro e instalación de sistema de rociadores (sprinkler) contra incendio', 'contra_incendio']
  ];
  for(const [concept, tipoEsperado] of cases){
    const apu = makeAPUFromConcept(concept, []);
    assert.equal(apu.primaryActivity, tipoEsperado, `"${concept}" deberia clasificar como ${tipoEsperado}, clasifico como ${apu.primaryActivity}`);
    assert.equal(apu.incomplete, false);
    assert.ok(apu.materials.length > 0 && apu.materials.every(r => Number(r[3]) > 0), `"${concept}" debe traer materiales reales con precio, no "Pendiente de cotizacion" a $0`);
  }
});

test('Bug reportado: "boquilla epoxica" (piso) ya no se confunde con pintura por la palabra "epox"', () => {
  const apu = makeAPUFromConcept('Colocacion de azulejo en cocina con boquilla epoxica', []);
  assert.equal(apu.primaryActivity, 'piso');
  assert.ok(apu.materials.some(r => /azulejo|loseta/i.test(r[0])));
});

test('Pintura epoxica real (con contexto de muro/recubrimiento) sigue clasificando como pintura', () => {
  const apu = makeAPUFromConcept('Aplicacion de pintura epoxica en muro industrial', []);
  assert.equal(apu.primaryActivity, 'pintura');
});

test('Concepto sin ningun sentido tecnico cae al fallback generico mejorado, nunca inventa una disciplina', () => {
  const result = classifyConstructionSystem('fabricacion completamente desconocida de widget cuantico industrial');
  assert.equal(result.matchType, 'generico');
  assert.equal(result.tipo, 'generico');
});

// --- Prioridad explicita de clasificacion (bug reportado: "impermeabilizante
// acrilico" clasificaba como pintura porque la regla de pintura, que
// contiene "acril", se evaluaba antes que "impermeabiliz" solo por posicion
// accidental en el array). Cada caso reproduce una colision real encontrada
// durante el mismo audit -- no solo el ejemplo original. */
test('Impermeabilizacion vs pintura: "impermeabilizante acrilico" ya NO cae en pintura solo por la palabra "acrilico"', () => {
  const cases = [
    'Impermeabilizacion con impermeabilizante acrilico',
    'impermeabilización con impermeabilizante acrílico elastomérico',
    'Suministro y colocacion de impermeabilizante por termofusion, membrana 4mm.',
    'Impermeabilizacion con manto asfaltico'
  ];
  for(const c of cases){
    const r = classifyConstructionSystem(c.toLowerCase());
    assert.equal(r.tipo, 'imper', `"${c}" deberia clasificar como imper, clasifico como ${r.tipo}`);
    assert.equal(r.priority, 0, 'imper debe ganar por prioridad 0 (sistema constructivo especifico), no por orden de array');
  }
});

test('Impermeabilizacion vs pintura: la pintura acrilica/vinilica real (con contexto de actividad o sustrato) sigue clasificando como pintura', () => {
  const cases = [
    'Aplicacion de pintura acrilica en muro',
    'Pintura vinilica en plafon',
    'Suministro y aplicacion de pintura vinilica en muros, 2 manos, 40m2',
    'Pintura acrilica impermeable para fachadas',
    'Aplicacion de pintura acrilica impermeable en fachada, 2 manos'
  ];
  for(const c of cases){
    const r = classifyConstructionSystem(c.toLowerCase());
    assert.equal(r.tipo, 'pintura', `"${c}" deberia clasificar como pintura, clasifico como ${r.tipo}`);
  }
});

test('Caso ambiguo (pedido explicito): "Primer acrilico impermeable" no se asume como pintura ni como impermeabilizacion', () => {
  const r = classifyConstructionSystem('primer acrilico impermeable');
  assert.notEqual(r.tipo, 'imper', 'no debe asumirse imper: no hay raiz "impermeabiliz", solo el adjetivo "impermeable"');
  assert.notEqual(r.matchType, 'exact', 'un texto sin verbo de pintura ni sustrato (muro/plafon/fachada) y sin raiz "impermeabiliz" no debe resolverse con certeza (matchType exact)');
});

test('Impermeabilizacion vs concreto: "losa"/"concreto" como contexto no le ganan a impermeabilizacion', () => {
  const r = classifyConstructionSystem('retiro de impermeabilizante prefabricado existente hasta losa de concreto.');
  assert.equal(r.tipo, 'imper');
  const r2 = classifyConstructionSystem("colado de losa de concreto f'c=200 kg/cm2");
  assert.equal(r2.tipo, 'concreto', 'un concreto real (sin mencionar impermeabilizacion) debe seguir clasificando como concreto');
});

test('Concreto vs mortero: un muro de tabique con mortero de junteo clasifica como block (albañileria), no como concreto', () => {
  const r = classifyConstructionSystem('muro de tabique asentado con mortero cemento-cal-arena');
  assert.equal(r.tipo, 'block');
});

test('Demolicion vs retiro generico: "retiro de X" solo es demolicion cuando X es un acabado a demoler, nunca un retiro generico (ej. mobiliario)', () => {
  const demo = classifyConstructionSystem('retiro de loseta existente en area de cocina');
  assert.equal(demo.tipo, 'demolicion');
  const generico = classifyConstructionSystem('retiro de mueble de la oficina');
  assert.notEqual(generico.tipo, 'demolicion', '"retiro de mueble" no es demolicion de obra');
});

test('Instalacion electrica vs obra civil: el sustrato (muro de block/tablaroca) no le gana a la actividad electrica', () => {
  const cases = [
    'Canalizacion electrica con conduit en muro de block',
    'Instalacion de contacto duplex en muro de tablaroca',
    'Instalacion electrica de contactos y apagadores'
  ];
  for(const c of cases){
    const r = classifyConstructionSystem(c.toLowerCase());
    assert.equal(r.tipo, 'electrica', `"${c}" deberia clasificar como electrica, clasifico como ${r.tipo}`);
    assert.equal(r.priority, 0);
  }
});

test('Plafon vs muro: "aplanado...con yeso" en un muro es aplanado (actividad), no tablaroca solo por la palabra "yeso"', () => {
  const aplanado = classifyConstructionSystem('aplanado fino en muros interiores con yeso, espesor de 1.5cm');
  assert.equal(aplanado.tipo, 'aplanado', `deberia clasificar como aplanado, clasifico como ${aplanado.tipo}`);
  const plafon = classifyConstructionSystem('plafon de yeso liso con perimetral de esquinero, 85m2');
  assert.equal(plafon.tipo, 'plafon_suspendido', 'un plafon de yeso real (compuesto "plafon de yeso") debe seguir clasificando como plafon_suspendido');
  const tablarocaReal = classifyConstructionSystem('suministro y colocacion de muro de tablaroca');
  assert.equal(tablarocaReal.tipo, 'tablaroca', 'tablaroca/durock explicitos siguen clasificando como tablaroca');
});

test('Piso vs recubrimiento: loseta en piso sigue siendo piso, recubrimiento vinilico en muro sigue siendo pintura', () => {
  const piso = classifyConstructionSystem('colocacion de loseta ceramica en piso');
  assert.equal(piso.tipo, 'piso');
  const recubrimiento = classifyConstructionSystem('aplicacion de recubrimiento vinilico en muro');
  assert.equal(recubrimiento.tipo, 'pintura');
});

test('Evidencia de clasificacion: un match exacto expone familia, regla que gano, confianza y prioridad', () => {
  const r = classifyConstructionSystem('impermeabilizacion con manto asfaltico');
  assert.equal(r.tipo, 'imper');
  assert.equal(r.matchType, 'exact');
  assert.equal(r.discipline, 'Acabados');
  assert.equal(r.priority, 0);
  assert.ok(r.ruleId && r.ruleId.startsWith('imper#'), `ruleId deberia identificar la regla que gano, fue "${r.ruleId}"`);
  assert.equal(typeof r.confidence, 'number');
  assert.ok(r.confidence > 0);
  assert.ok(Array.isArray(r.matchedTerms));
});

test('Evidencia de clasificacion: un match generico (priority:2) reporta confianza reducida respecto al mismo tipo en priority 0/1', () => {
  // "Producto acrilico industrial" no trae ni verbo de pintura (pintura/pintar/
  // esmalte) ni sustrato (muro/plafon/fachada) -- solo dispara la regla
  // priority:2 (acr[ií]l bare), a proposito, para aislar la penalizacion de
  // confianza sin depender de que otra regla mas especifica coincida primero.
  const r = classifyConstructionSystem('producto acrilico industrial');
  assert.equal(r.tipo, 'pintura');
  assert.equal(r.priority, 2, `esperaba que solo la regla priority:2 coincidiera, gano la regla ${r.ruleId} (priority ${r.priority})`);
  const r1 = classifyConstructionSystem('suministro y aplicacion de pintura vinilica en muros, 40m2');
  assert.equal(r1.priority, 1);
  assert.ok(r.confidence < r1.confidence, `un match priority:2 (${r.confidence}) debe reportar menor confianza que un match priority:1 del mismo tipo (${r1.confidence})`);
});

test('extractSecondaryActivities solo lee la clausula "incluye...", nunca cambia fuera de ese contexto', () => {
  assert.deepEqual(extractSecondaryActivities('Concepto sin ninguna clausula de inclusion'), []);
  assert.deepEqual(new Set(extractSecondaryActivities('Muro de block, incluye acarreo y limpieza.')), new Set(['acarreo', 'limpieza']));
});

test('Motor de QA tecnico: "acero sin acero" se reporta como error, un APU real de acero no dispara nada', () => {
  const badApu = { primaryActivity: 'acero', materials: [{ descripcion: 'Cemento gris' }], labor: [], equipment: [], consumables: [], seguridad: [] };
  const issues = runTechnicalQualityRules(badApu);
  assert.ok(issues.some(i => i.code === 'discipline_missing_expected_resource' && i.severity === 'error'));

  const goodApu = finalizeProfessionalAPU(migrateLegacyApuToV2(makeAPUFromConcept('Acero de refuerzo fy=4200', [])));
  assert.equal(runTechnicalQualityRules(goodApu).length, 0);
});

test('QA tecnico ignora acentos al comparar (Camara vs camara)', () => {
  const apu = { primaryActivity: 'cctv', materials: [{ descripcion: 'Cámara de seguridad HD' }], labor: [], equipment: [], consumables: [], seguridad: [] };
  assert.equal(runTechnicalQualityRules(apu).length, 0);
});

test('Confianza de 8 dimensiones: un APU con match exacto tiene mejor comprension/clasificacion que uno generico', () => {
  const exact = finalizeProfessionalAPU(migrateLegacyApuToV2(makeAPUFromConcept('Suministro y colocacion de block hueco 15x20x40', [])));
  const generic = finalizeProfessionalAPU(migrateLegacyApuToV2(makeAPUFromConcept('fabricacion completamente desconocida de widget cuantico', [])));
  assert.ok(exact.confidence.dimensions.comprensionConcepto > generic.confidence.dimensions.comprensionConcepto);
  assert.ok(exact.confidence.dimensions.clasificacion > generic.confidence.dimensions.clasificacion);
  assert.equal(generic.confidence.dimensions.clasificacion, 0);
  ['comprensionConcepto','clasificacion','materiales','manoDeObra','evidenciaMercado','especificaciones'].forEach(k => {
    assert.ok(k in exact.confidence.dimensions, `falta la dimension "${k}"`);
  });
});

test('Variables tecnicas nuevas: espesor, profundidad, diametro, resistencia y grado de material se extraen del texto', () => {
  const apu = makeAPUFromConcept("Colado de zapata aislada de concreto, f'c=250 kg/cm2, profundidad de 1.2m", []);
  assert.equal(apu.variables.strength, 250);
  assert.equal(apu.variables.depth, 1.2);
  const apu2 = makeAPUFromConcept('Montaje de estructura metalica con soldadura certificada, fy=46', []);
  assert.equal(apu2.variables.materialGrade, 'fy=46');
  const apu3 = makeAPUFromConcept('Aplanado fino en muros interiores con yeso, espesor de 1.5cm', []);
  assert.equal(apu3.variables.thickness, 1.5);
  const apu4 = makeAPUFromConcept('Instalacion de tuberia hidraulica, diametro de 1 pulgada', []);
  assert.equal(apu4.variables.diameter, 1);
});

// --- Cuadrilla + rendimiento verificables por familia (motor universal,
// punto "no acepto mano de obra = cantidad fija sin explicar como se
// obtiene") -- una familia representativa por cada una de las 15 pedidas. */
const FAMILY_CASES = [
  ['demolicion', 'Demolicion de loseta 20m2'],
  ['excavacion', 'Excavacion manual, 10m3'],
  ['acarreo', 'Acarreo de escombro en costales dentro de la obra'],
  ['concreto', "Colado de losa de concreto f'c=200 kg/cm2"],
  ['acero', 'Acero de refuerzo fy=4200'],
  ['albañileria', 'Muro de block hueco 15x20x40 cm'],
  ['loseta/piso', 'Suministro y colocacion de loseta ceramica 30x30'],
  ['pintura', 'Aplicacion de pintura vinilica en muros'],
  ['impermeabilizacion', 'Impermeabilizacion de azotea con membrana asfaltica'],
  ['electrica', 'Instalacion electrica de contactos y apagadores'],
  ['hidraulica', 'Instalacion de tuberia hidraulica de cobre'],
  ['HVAC', 'Instalacion de aire acondicionado tipo minisplit'],
  ['soldadura/herreria', 'Montaje de estructura metalica con soldadura certificada'],
  ['pavimento', 'Construccion de pavimento con carpeta asfaltica'],
  ['jardineria', 'Servicio de jardineria con siembra de pasto en rollo']
];

for(const [familyLabel, concept] of FAMILY_CASES){
  test(`Cuadrilla+rendimiento verificable -- ${familyLabel}: "${concept}"`, () => {
    const v1 = makeAPUFromConcept(concept, []);
    const v2 = finalizeProfessionalAPU(migrateLegacyApuToV2(v1));
    assert.ok(v2.labor.length > 0, `${familyLabel}: cuadrilla vacia`);
    v2.labor.forEach((row, i) => {
      assert.ok(Number(row.cuadrilla) > 0, `${familyLabel} renglon ${i}: cuadrilla debe ser > 0, fue ${row.cuadrilla}`);
      assert.ok(Number(row.rendimiento) > 0, `${familyLabel} renglon ${i}: rendimiento debe ser > 0, fue ${row.rendimiento}`);
      assert.ok(Number(row.jornada) > 0, `${familyLabel} renglon ${i}: jornada debe ser > 0, fue ${row.jornada}`);
      const incidencia = calcLaborRow(row);
      assert.ok(incidencia > 0, `${familyLabel} renglon ${i}: incidencia laboral debe ser > 0`);
      // incidencia ~ funcion(cuadrilla, rendimiento): calcLaborRow ya usa
      // cuadrilla/rendimiento (apuCalc.js#laborUnitQty) cuando rendimiento>0,
      // asi que la relacion es exacta por construccion -- se verifica el
      // costo de mano de obra completo (cuadrilla/rendimiento * salario real).
      const expectedIncidenciaUnidades = row.cuadrilla / row.rendimiento;
      const expectedImporte = expectedIncidenciaUnidades * Number(row.salarioBase) * Number(row.fsr || 1);
      assert.ok(Math.abs(incidencia - expectedImporte) < 1e-9, `${familyLabel} renglon ${i}: incidencia (${incidencia}) no coincide con cuadrilla/rendimiento*salario*fsr (${expectedImporte})`);
      assert.ok(row.rendimientoFuente, `${familyLabel} renglon ${i}: debe declarar rendimientoFuente`);
    });
  });
}
