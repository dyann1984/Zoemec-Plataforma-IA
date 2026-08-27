/* Prueba de CONTRATO de la ruta IA (motor universal, punto 11): sin
   OPENAI_API_KEY no se puede llamar a OpenAI real (ver punto 12, marcado
   PENDIENTE DE CREDENCIAL), pero SI se puede probar que un JSON crudo con
   EXACTAMENTE la forma que el prompt de generateAPUv2 pide (ver
   server/api-lib/_openaiApuCore.mjs) se normaliza correctamente hacia
   ProfessionalAPU -- cuadrilla, rendimiento, consumibles, equipo, EPP,
   justificaciones, precios y fuentes, todos verificados de punta a punta.
   Esto NO sustituye una prueba real con OpenAI (la respuesta real de un
   LLM puede variar de forma que este fixture no cubre), pero garantiza que
   la integracion estructural (JSON -> normalizeAIApuToV2 -> finalizeProfessionalAPU
   -> validateAPU) nunca se rompe por un cambio de schema. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAIApuToV2, APU_DATA_STATE } from '../src/domain/apuSchema.js';
import { applyConceptMetadataV2 } from '../src/domain/apuGeneration.js';
import { finalizeProfessionalAPU, validateAPU } from '../src/domain/apuProfessional.js';
import { calcLaborRow } from '../src/lib/apuCalc.js';

/* Fixture: respuesta cruda que generateAPUv2 (server/api-lib/_openaiApuCore.mjs)
   pide explicitamente en su prompt -- misma forma exacta, un concepto de
   estructura metalica con las 6 categorias A-F completas. */
function aiRawFixture(){
  return {
    concept: 'Montaje de estructura metalica con soldadura certificada, perfil IPR',
    unit: 'kg',
    family: 'Estructura metalica',
    confidence: 90,
    sat: '72101700',
    materials: [['Acero estructural ASTM A500 Fy=46 KSI', 1.05, 'kg', 46.5, 0], ['Soldadura E-7018', 0.03, 'kg', 120, 0]],
    materialSources: [{ proveedor: 'Deacero', region: 'CDMX', integracion: 'POR_UNIDAD_OBRA' }, { proveedor: null, region: null, integracion: 'POR_UNIDAD_OBRA' }],
    labor: [['Cuadrilla de montadores y soldadores calificados', 0.012, 'jor', 1650, 1], ['Trazo y verificacion de montaje', 0.004, 'jor', 900, 1]],
    laborDetails: [{ cuadrilla: 2, rendimiento: 166.67, jornada: 8 }, { cuadrilla: 1, rendimiento: 250, jornada: 8 }],
    equipment: [['Grua / equipo de izaje', 0.015, 'hr', 550], ['Soldadora y herramienta de montaje', 0.018, 'hr', 180]],
    equipmentDetails: [{ integracion: 'POR_JORNADA', rendimientoDiario: 166.67, vidaUtilDias: null, factorUso: null, modalidad: 'renta_jornada' }, { integracion: 'POR_UNIDAD_OBRA', rendimientoDiario: null, vidaUtilDias: null, factorUso: null, modalidad: 'costo_horario' }],
    seguridad: [['Casco de seguridad', 2, 'pza', 250], ['Guantes de trabajo', 2, 'par', 70], ['Arnes de seguridad', 2, 'pza', 850]],
    seguridadDetails: [{ integracion: 'AMORTIZABLE', rendimientoDiario: 166.67, vidaUtilDias: 180, factorReposicion: 1 }, { integracion: 'AMORTIZABLE', rendimientoDiario: 166.67, vidaUtilDias: 90, factorReposicion: 1 }, { integracion: 'AMORTIZABLE', rendimientoDiario: 166.67, vidaUtilDias: 365, factorReposicion: 1 }],
    consumables: [['Disco de corte para metal', 0.02, 'pza', 45, 0], ['Electrodos adicionales de acabado', 0.01, 'kg', 120, 0]],
    consumableSources: [{ especificacion: 'Disco 4.5 pulgadas', proveedor: null, region: null, integracion: 'POR_UNIDAD_OBRA', technicalReason: 'Corte de perfiles de acero en obra' }, { especificacion: null, proveedor: null, region: null, integracion: 'POR_UNIDAD_OBRA', technicalReason: 'Acabado de soldadura en juntas visibles' }],
    procedimientoConstructivo: ['Trazo y plomeo de ejes', 'Izaje y posicionamiento de perfiles', 'Soldadura de juntas', 'Aplicacion de primario anticorrosivo'],
    controlCalidad: [{ especificacion: 'Verticalidad de columnas', criterio: '± 3 mm por cada 3 m de altura' }],
    criterioMedicion: { incluye: ['suministro de perfiles', 'soldadura', 'mano de obra', 'equipo de izaje'], excluye: ['pintura de acabado final', 'placas base adicionales'] },
    technicalJustifications: {
      materials: 'Acero ASTM A500 y soldadura E-7018 requeridos por la especificacion estructural del proyecto.',
      labor: 'Cuadrilla de 2 montadores/soldadores con rendimiento de 166.67 kg/jornada, calibre estandar para montaje de estructura ligera.',
      equipment: 'Grua necesaria para el izaje de perfiles pesados; soldadora para las juntas.',
      smallTools: 'Herramienta menor de montaje calculada como % de mano de obra.',
      consumables: 'Discos de corte y electrodos adicionales necesarios para el procedimiento de soldadura y corte en obra.',
      safety: 'EPP obligatorio para trabajo en altura y soldadura: casco, guantes, arnes de seguridad.'
    },
    herramienta: 3, indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16,
    confidenceBreakdown: { precios: 70, rendimientos: 85, cantidades: 80, composicion: 90 },
    notes: ['Rendimiento asumido para cuadrilla estandar de 2 montadores calificados.']
  };
}

test('Contrato IA: normalizeAIApuToV2 mapea las 6 categorias A-F completas del fixture, sin perder ningun dato', () => {
  const raw = aiRawFixture();
  const apu = normalizeAIApuToV2(raw, raw.concept);
  assert.equal(apu.materials.length, 2);
  assert.equal(apu.labor.length, 2);
  assert.equal(apu.equipment.length, 2);
  assert.equal(apu.seguridad.length, 3);
  assert.equal(apu.consumables.length, 2);
  assert.equal(apu.consumables[0].especificacion, 'Disco 4.5 pulgadas');
  assert.equal(apu.consumables[0].technicalReason, 'Corte de perfiles de acero en obra');
  Object.entries(raw.technicalJustifications).forEach(([k, v]) => assert.equal(apu.technicalJustifications[k], v));
});

test('Contrato IA: cuadrilla y rendimiento del fixture (laborDetails) se normalizan y producen una incidencia laboral verificable', () => {
  const raw = aiRawFixture();
  const apu = normalizeAIApuToV2(raw, raw.concept);
  apu.labor.forEach((row, i) => {
    assert.equal(row.cuadrilla, raw.laborDetails[i].cuadrilla);
    assert.equal(row.rendimiento, raw.laborDetails[i].rendimiento);
    assert.equal(row.jornada, raw.laborDetails[i].jornada);
    const incidencia = calcLaborRow(row);
    const esperado = (row.cuadrilla / row.rendimiento) * row.salarioBase * row.fsr;
    assert.ok(Math.abs(incidencia - esperado) < 1e-9, `renglon ${i}: incidencia (${incidencia}) != cuadrilla/rendimiento*salario*fsr (${esperado})`);
  });
});

test('Contrato IA: EPP reutilizable queda AMORTIZABLE (nunca cobrado completo por unidad de obra)', () => {
  const raw = aiRawFixture();
  const apu = normalizeAIApuToV2(raw, raw.concept);
  apu.seguridad.forEach((row, i) => {
    assert.equal(row.integracion, 'AMORTIZABLE');
    assert.equal(row.vidaUtilDias, raw.seguridadDetails[i].vidaUtilDias);
    assert.equal(row.rendimientoDiario, raw.seguridadDetails[i].rendimientoDiario);
  });
});

test('Contrato IA: ningun precio/fuente se marca VERIFICADO -- todo nace ESTIMADO_IA hasta que un humano lo confirme', () => {
  const raw = aiRawFixture();
  const apu = normalizeAIApuToV2(raw, raw.concept);
  [...apu.materials, ...apu.labor, ...apu.equipment, ...apu.seguridad, ...apu.consumables].forEach(row => {
    assert.equal(row.fuente.estado, APU_DATA_STATE.ESTIMADO_IA);
  });
});

test('Contrato IA de punta a punta: JSON crudo -> normalizeAIApuToV2 -> applyConceptMetadataV2 -> finalizeProfessionalAPU -> validateAPU produce un APU calculable con costo directo y PU > 0', () => {
  const raw = aiRawFixture();
  const normalized = normalizeAIApuToV2(raw, raw.concept);
  const withMeta = applyConceptMetadataV2(normalized, { code: 'CONTRATO-IA-001', concept: raw.concept, unit: raw.unit, qty: 500 }, 0, 'Fixture de contrato IA');
  const apu = finalizeProfessionalAPU(withMeta);
  assert.ok(apu.calculated.direct > 0, 'costo directo debe ser > 0');
  assert.ok(apu.calculated.pu > 0, 'PU debe ser > 0');
  assert.equal(apu.calculated.importeTotal, apu.calculated.pu * 500);
  const validation = validateAPU(apu, { totals: apu.calculated });
  assert.ok(['VALIDADO', 'CON OBSERVACIONES', 'REQUIERE REVISION'].includes(validation.status));
  // El motor de QA tecnico (technicalQualityRules.js) solo aplica cuando
  // hay primaryActivity conocido (ruta determinista) -- el fixture de IA no
  // lo trae, asi que esta prueba confirma que eso NO bloquea ni rompe la
  // ruta de IA (se omite en silencio, ver runTechnicalQualityRules).
  assert.equal(validation.issues.filter(i => i.code === 'discipline_missing_expected_resource').length, 0);
});
