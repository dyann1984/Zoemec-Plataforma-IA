import test from 'node:test';
import assert from 'node:assert/strict';
import { APU_DATA_STATE, makeEmptyAPUv2, migrateLegacyApuToV2, validateApuSchemaV2, normalizeAIApuToV2 } from './apuSchema.js';
import { calcAPUv2 } from '../lib/apuCalc.js';

test('makeEmptyAPUv2 trae las secciones del esquema profesional, todas vacias', () => {
  const apu = makeEmptyAPUv2();
  assert.equal(apu.schemaVersion, 2);
  // Encabezado
  for (const field of ['proyecto', 'cliente', 'ubicacion', 'fechaBase', 'moneda', 'partida', 'clave', 'concept', 'unit']) {
    assert.ok(field in apu, `falta el campo de encabezado "${field}"`);
  }
  assert.equal(apu.moneda, 'MXN');
  assert.equal(apu.cantidadObra, 0);
  // Recursos
  assert.deepEqual(apu.materials, []);
  assert.deepEqual(apu.labor, []);
  assert.deepEqual(apu.equipment, []);
  assert.deepEqual(apu.seguridad, []);
  assert.equal(apu.herramientaMenor.modo, 'porcentaje');
  assert.deepEqual(apu.herramientaMenor.detalle, []);
  // Ingenieria del APU
  assert.deepEqual(apu.procedimientoConstructivo, []);
  assert.deepEqual(apu.controlCalidad, []);
  assert.deepEqual(apu.criterioMedicion, { incluye: [], excluye: [], unidadMedicion: '' });
  // Factores, supuestos y confianza
  for (const field of ['indCampo', 'indOficina', 'finance', 'utility', 'cargos', 'iva']) {
    assert.ok(field in apu.factores, `falta el factor "${field}"`);
  }
  assert.deepEqual(apu.supuestos, []);
  assert.deepEqual(apu.confidence, { precios: 0, rendimientos: 0, cantidades: 0, composicion: 0 });
});

test('makeEmptyAPUv2 nunca nace con estado VERIFICADO en ningun lado', () => {
  const apu = makeEmptyAPUv2();
  const serialized = JSON.stringify(apu);
  assert.equal(serialized.includes(APU_DATA_STATE.VERIFICADO), false);
});

test('migrateLegacyApuToV2 convierte renglones posicionales a objetos con las mismas cantidades/precios', () => {
  const legacy = {
    id: 'APU-LEGACY1', clave: 'APU-0001', concept: 'Muro de block', unit: 'm2', date: '01/01/2026',
    materials: [['Block hueco 15x20x40', 12.5, 'pza', 16.5, 3]],
    labor: [['Albañil', 0.35, 'jor', 380, 1.85]],
    equipment: [['Andamio', 0.05, 'día', 280]],
    herramienta: 3, indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16,
    confidence: 92, aiGenerated: false, templateGenerated: true, sourceFile: 'Catalogo de conceptos',
    aiNotes: ['Plantilla tecnica aplicada.']
  };
  const v2 = migrateLegacyApuToV2(legacy);
  assert.equal(v2.schemaVersion, 2);
  assert.equal(v2.legacyId, 'APU-LEGACY1');
  assert.equal(v2.clave, 'APU-0001');
  assert.equal(v2.concept, 'Muro de block');
  assert.equal(v2.materials.length, 1);
  assert.equal(v2.materials[0].descripcion, 'Block hueco 15x20x40');
  assert.equal(v2.materials[0].consumo, 12.5);
  assert.equal(v2.materials[0].precioUnitario, 16.5);
  assert.equal(v2.materials[0].desperdicioPct, 3);
  assert.equal(v2.labor[0].salarioBase, 380);
  assert.equal(v2.labor[0].fsr, 1.85);
  assert.equal(v2.labor[0].cantidad, 0.35);
  assert.equal(v2.equipment[0].tarifa, 280);
  assert.equal(v2.factores.iva, 16);
  assert.equal(v2.supuestos.length, 1);
  assert.equal(v2.supuestos[0].texto, 'Plantilla tecnica aplicada.');
});

test('migrateLegacyApuToV2 no muta el APU original', () => {
  const legacy = { id: 'X', materials: [['Mat', 1, 'pza', 10, 0]] };
  const clone = JSON.parse(JSON.stringify(legacy));
  migrateLegacyApuToV2(legacy);
  assert.deepEqual(legacy, clone);
});

test('migrateLegacyApuToV2 nunca produce estado VERIFICADO: plantilla -> IMPORTADO', () => {
  const legacy = { templateGenerated: true, sourceFile: 'Catalogo base', materials: [['Mat', 1, 'pza', 10, 0]] };
  const v2 = migrateLegacyApuToV2(legacy);
  assert.equal(v2.materials[0].fuente.estado, APU_DATA_STATE.IMPORTADO);
  assert.notEqual(v2.materials[0].fuente.estado, APU_DATA_STATE.VERIFICADO);
});

test('migrateLegacyApuToV2 nunca produce estado VERIFICADO: IA -> ESTIMADO_IA', () => {
  const legacy = { aiGenerated: true, labor: [['MO', 1, 'jor', 100, 1]] };
  const v2 = migrateLegacyApuToV2(legacy);
  assert.equal(v2.labor[0].estado, APU_DATA_STATE.ESTIMADO_IA);
});

test('migrateLegacyApuToV2 nunca produce estado VERIFICADO: formulario en blanco -> ASUMIDO', () => {
  const legacy = { equipment: [['Eq', 1, 'hr', 10]] };
  const v2 = migrateLegacyApuToV2(legacy);
  assert.equal(v2.equipment[0].fuente.estado, APU_DATA_STATE.ASUMIDO);
});

test('migrateLegacyApuToV2 replica el confidence legacy en las 4 dimensiones nuevas', () => {
  const legacy = { confidence: 76 };
  const v2 = migrateLegacyApuToV2(legacy);
  assert.deepEqual(v2.confidence, { precios: 76, rendimientos: 76, cantidades: 76, composicion: 76 });
});

test('migrateLegacyApuToV2 -> calcAPUv2 reproduce el mismo costo directo que el legacy con calcAPU', () => {
  // Migrar un APU real y recalcularlo con el motor v2 no debe cambiar el
  // resultado numerico del costo directo (misma cascada, mismos importes).
  const legacy = {
    materials: [['Mat A', 2, 'pza', 100, 10]],
    labor: [['Oficial', 1, 'jor', 300, 1.8]],
    equipment: [['Equipo', 0.5, 'hr', 80]],
    herramienta: 3, indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16
  };
  const v2 = migrateLegacyApuToV2(legacy);
  const t2 = calcAPUv2(v2);
  // mat=220, mo=540, equipo=40, herramienta=540*3/100=16.2, direct=816.2 (mismos valores que apuCalc.test.js)
  assert.ok(Math.abs(t2.mat - 220) < 1e-6);
  assert.ok(Math.abs(t2.mo - 540) < 1e-6);
  assert.ok(Math.abs(t2.equipo - 40) < 1e-6);
  assert.ok(Math.abs(t2.herramienta - 16.2) < 1e-6);
  assert.ok(Math.abs(t2.direct - 816.2) < 1e-6);
});

test('validateApuSchemaV2 detecta cantidadObra negativa', () => {
  const issues = validateApuSchemaV2({ cantidadObra: -1 });
  assert.ok(issues.some(i => i.code === 'negative_cantidad_obra'));
});

test('validateApuSchemaV2 detecta un renglon VERIFICADO sin proveedor', () => {
  const apu = { materials: [{ fuente: { estado: APU_DATA_STATE.VERIFICADO, proveedor: null } }] };
  const issues = validateApuSchemaV2(apu);
  assert.ok(issues.some(i => i.code === 'verified_without_source'));
});

test('validateApuSchemaV2 no marca error si el renglon VERIFICADO trae proveedor', () => {
  const apu = { materials: [{ fuente: { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'CEMEX' } }] };
  const issues = validateApuSchemaV2(apu);
  assert.equal(issues.some(i => i.code === 'verified_without_source'), false);
});

test('validateApuSchemaV2 detecta herramienta menor en modo detalle sin renglones', () => {
  const issues = validateApuSchemaV2({ herramientaMenor: { modo: 'detalle', detalle: [] } });
  assert.ok(issues.some(i => i.code === 'empty_herramienta_detalle'));
});

test('validateApuSchemaV2 no reporta nada para un APU limpio', () => {
  const apu = makeEmptyAPUv2();
  apu.materials.push({ clave: 'MAT-001', descripcion: 'Mat', consumo: 1, precioUnitario: 10, fuente: { estado: APU_DATA_STATE.ASUMIDO, proveedor: null } });
  const issues = validateApuSchemaV2(apu);
  assert.deepEqual(issues, []);
});

/* ---------- normalizeAIApuToV2: JSON crudo de generateAPUv2 -> esquema v2 ---------- */

function rawAIFixture(overrides = {}){
  return {
    concept: 'Aplanado fino en muros a plomo y regla, mortero cemento-arena 1:4',
    unit: 'm2',
    family: 'Acabados',
    confidence: 88,
    sat: '72101514',
    materials: [
      ['Cemento gris CPC 30R', 0.09, 'bulto', 225, 3],
      ['Arena cernida', 0.025, 'm3', 480, 5]
    ],
    materialSources: [
      { proveedor: 'CEMEX', region: 'CDMX' },
      { proveedor: null, region: null }
    ],
    labor: [
      ['Oficial albañil', 0.04, 'jor', 380, 1.85],
      ['Ayudante', 0.04, 'jor', 258, 1.82]
    ],
    laborDetails: [
      { cuadrilla: 1, rendimiento: 25, jornada: 8 },
      { cuadrilla: 1, rendimiento: 25, jornada: 8 }
    ],
    equipment: [['Andamio de trabajo', 0.04, 'día', 120]],
    seguridad: [['Casco de seguridad', 0.001, 'pza', 220], ['Guantes de carnaza', 0.001, 'par', 90]],
    procedimientoConstructivo: ['Preparar la superficie', 'Aplicar mortero', 'Regla y aplomar', 'Curar con agua'],
    controlCalidad: [{ especificacion: 'Aplome ± 3mm en 3m', criterio: 'Verificar con plomada' }],
    criterioMedicion: { incluye: ['Materiales', 'Mano de obra', 'Limpieza'], excluye: ['Acabados finales'] },
    herramienta: 3, indCampo: 8, indOficina: 7, finance: 2, utility: 10, cargos: 0.5, iva: 16,
    confidenceBreakdown: { precios: 90, rendimientos: 85, cantidades: 88, composicion: 80 },
    notes: ['Rendimiento de cuadrilla asumido en condiciones normales de obra.'],
    ...overrides
  };
}

test('normalizeAIApuToV2 mapea materiales/mano de obra/equipo/seguridad del JSON crudo de la IA', () => {
  const v2 = normalizeAIApuToV2(rawAIFixture(), 'fallback');
  assert.equal(v2.schemaVersion, 2);
  assert.equal(v2.concept, 'Aplanado fino en muros a plomo y regla, mortero cemento-arena 1:4');
  assert.equal(v2.unit, 'm²');

  assert.equal(v2.materials.length, 2);
  assert.equal(v2.materials[0].descripcion, 'Cemento gris CPC 30R');
  assert.equal(v2.materials[0].consumo, 0.09);
  assert.equal(v2.materials[0].desperdicioPct, 3);
  assert.equal(v2.materials[0].precioUnitario, 225);
  assert.equal(v2.materials[0].fuente.proveedor, 'CEMEX');
  assert.equal(v2.materials[1].fuente.proveedor, null);

  assert.equal(v2.labor.length, 2);
  assert.equal(v2.labor[0].cuadrilla, 1);
  assert.equal(v2.labor[0].rendimiento, 25);
  assert.equal(v2.labor[0].jornada, 8);
  assert.equal(v2.labor[0].cantidad, 0.04); // se conserva aunque tambien haya cuadrilla/rendimiento
  assert.equal(v2.labor[0].salarioBase, 380);
  assert.equal(v2.labor[0].fsr, 1.85);

  assert.equal(v2.equipment.length, 1);
  assert.equal(v2.equipment[0].tarifa, 120);

  assert.equal(v2.seguridad.length, 2);
  assert.equal(v2.seguridad[0].descripcion, 'Casco de seguridad');
  assert.equal(v2.seguridad[0].precioUnitario, 220);
});

test('normalizeAIApuToV2 mapea procedimiento constructivo, control de calidad y criterio de medicion', () => {
  const v2 = normalizeAIApuToV2(rawAIFixture(), 'fallback');
  assert.deepEqual(v2.procedimientoConstructivo, ['Preparar la superficie', 'Aplicar mortero', 'Regla y aplomar', 'Curar con agua']);
  assert.equal(v2.controlCalidad.length, 1);
  assert.equal(v2.controlCalidad[0].especificacion, 'Aplome ± 3mm en 3m');
  assert.deepEqual(v2.criterioMedicion.incluye, ['Materiales', 'Mano de obra', 'Limpieza']);
  assert.deepEqual(v2.criterioMedicion.excluye, ['Acabados finales']);
  assert.equal(v2.criterioMedicion.unidadMedicion, 'm²');
});

test('normalizeAIApuToV2 nunca produce estado VERIFICADO, aunque el JSON crudo lo intente forzar', () => {
  const raw = rawAIFixture({
    materialSources: [{ proveedor: 'CEMEX', region: 'CDMX', estado: 'VERIFICADO' }, { proveedor: null, region: null, estado: 'VERIFICADO' }]
  });
  // Ataque directo: alguien (o la propia IA) intenta declarar VERIFICADO en el JSON.
  raw.estado = 'VERIFICADO';
  const v2 = normalizeAIApuToV2(raw, 'fallback');
  const serialized = JSON.stringify(v2);
  assert.equal(serialized.includes('VERIFICADO'), false);
  v2.materials.forEach(m => assert.equal(m.fuente.estado, APU_DATA_STATE.ESTIMADO_IA));
  v2.labor.forEach(l => {
    assert.equal(l.estado, APU_DATA_STATE.ESTIMADO_IA);
    assert.equal(l.fuente.estado, APU_DATA_STATE.ESTIMADO_IA);
  });
  v2.equipment.forEach(e => assert.equal(e.fuente.estado, APU_DATA_STATE.ESTIMADO_IA));
});

test('normalizeAIApuToV2 acota confidenceBreakdown a [0,100]', () => {
  const raw = rawAIFixture({ confidenceBreakdown: { precios: 150, rendimientos: -20, cantidades: 88, composicion: 80 } });
  const v2 = normalizeAIApuToV2(raw, 'fallback');
  assert.equal(v2.confidence.precios, 100);
  assert.equal(v2.confidence.rendimientos, 0);
  assert.equal(v2.confidence.cantidades, 88);
  assert.equal(v2.confidence.composicion, 80);
});

test('normalizeAIApuToV2 usa "confidence" como respaldo cuando falta confidenceBreakdown', () => {
  const raw = rawAIFixture({ confidenceBreakdown: undefined, confidence: 77 });
  const v2 = normalizeAIApuToV2(raw, 'fallback');
  assert.deepEqual(v2.confidence, { precios: 77, rendimientos: 77, cantidades: 77, composicion: 77 });
});

test('normalizeAIApuToV2 con JSON minimo (sin campos v2 opcionales) no truena y produce arrays vacios', () => {
  const v2 = normalizeAIApuToV2({ concept: 'Concepto minimo', unit: 'pza', materials: [['Mat', 1, 'pza', 10, 0]] }, 'fallback');
  assert.deepEqual(v2.seguridad, []);
  assert.deepEqual(v2.procedimientoConstructivo, []);
  assert.deepEqual(v2.controlCalidad, []);
  assert.deepEqual(v2.criterioMedicion.incluye, []);
  assert.equal(v2.labor.length, 0);
});

test('normalizeAIApuToV2 -> calcAPUv2 produce un costo directo reconstruible a mano', () => {
  const v2 = normalizeAIApuToV2(rawAIFixture(), 'fallback');
  const totals = calcAPUv2(v2);
  const matExpected = 0.09 * 1.03 * 225 + 0.025 * 1.05 * 480;
  const moExpected = (1 / 25) * 380 * 1.85 + (1 / 25) * 258 * 1.82; // oficial + ayudante, cada uno cuadrilla 1 / rendimiento 25
  const eqExpected = 0.04 * 120;
  const segExpected = 0.001 * 220 + 0.001 * 90;
  const herrExpected = totals.mo * 3 / 100;
  const directExpected = matExpected + moExpected + eqExpected + segExpected + herrExpected;
  assert.ok(Math.abs(totals.mat - matExpected) < 1e-6);
  assert.ok(Math.abs(totals.mo - moExpected) < 1e-6);
  assert.ok(Math.abs(totals.equipo - eqExpected) < 1e-6);
  assert.ok(Math.abs(totals.seguridad - segExpected) < 1e-6);
  assert.ok(Math.abs(totals.direct - directExpected) < 1e-6);
  assert.ok(totals.pu > totals.direct); // indirectos/utilidad/financiamiento suman sobre el directo
});
