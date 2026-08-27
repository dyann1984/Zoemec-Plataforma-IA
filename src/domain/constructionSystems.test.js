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
