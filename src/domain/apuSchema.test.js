import test from 'node:test';
import assert from 'node:assert/strict';
import { APU_DATA_STATE, REQUIERE_VALIDACION_TEXT, makeEmptyAPUv2, migrateLegacyApuToV2, validateApuSchemaV2, normalizeAIApuToV2 } from './apuSchema.js';
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

/* ---------- Auditoria APU-N29HGJ: regresion de los 6 bugs confirmados ---------- */

// TEST 1: referencePU sobrevive parseo -> request -> normalizacion -> APU final.
test('TEST 1: normalizeAIApuToV2 preserva options.referencePU en el APU final', () => {
  const v2 = normalizeAIApuToV2(rawAIFixture(), 'fallback', { referencePU: 12.5 });
  assert.equal(v2.referencePU, 12.5);
});

test('TEST 1b: sin options.referencePU, el APU final queda en 0 (nunca undefined/NaN)', () => {
  const v2 = normalizeAIApuToV2(rawAIFixture(), 'fallback');
  assert.equal(v2.referencePU, 0);
});

// TEST 2: referencePU NO altera el PU calculado (solo queda disponible para
// comparacion/desviacion, ver explainApuDifference en apuReview.js).
test('TEST 2: referencePU no altera el PU calculado por calcAPUv2', () => {
  const sinReferencia = calcAPUv2(normalizeAIApuToV2(rawAIFixture(), 'fallback'));
  const conReferenciaBaja = calcAPUv2(normalizeAIApuToV2(rawAIFixture(), 'fallback', { referencePU: 0.01 }));
  const conReferenciaAlta = calcAPUv2(normalizeAIApuToV2(rawAIFixture(), 'fallback', { referencePU: 999999 }));
  assert.equal(conReferenciaBaja.pu, sinReferencia.pu);
  assert.equal(conReferenciaAlta.pu, sinReferencia.pu);
});

// TEST 3: 1 operador + 1 ayudante -> cuadrilla por renglon = 1 y 1, nunca 2 y 2
// (bug de semantica: la IA repetia el total de la cuadrilla en cada renglon).
test('TEST 3: cuadrilla se preserva por renglon (1 y 1), no se suma al total de la cuadrilla', () => {
  const raw = rawAIFixture({
    labor: [['Operador de retroexcavadora', 0.04, 'jor', 450, 1.85], ['Ayudante general', 0.04, 'jor', 258, 1.82]],
    laborDetails: [{ cuadrilla: 1, rendimiento: 20, jornada: 8 }, { cuadrilla: 1, rendimiento: 20, jornada: 8 }]
  });
  const v2 = normalizeAIApuToV2(raw, 'fallback');
  assert.equal(v2.labor[0].cuadrilla, 1);
  assert.equal(v2.labor[1].cuadrilla, 1);
  assert.notEqual(v2.labor[0].cuadrilla, 2);
  assert.notEqual(v2.labor[1].cuadrilla, 2);
});

// TEST 5/6: criterioMedicion.criterio y .formaPago se conservan tal cual los
// entrega la IA (antes: el exportador leia claves que nunca existian en el
// esquema, asi que el PDF mostraba estas secciones siempre vacias).
test('TEST 5: criterioMedicion.criterio se conserva del JSON crudo', () => {
  const raw = rawAIFixture({ criterioMedicion: { criterio: 'Se mide por metro cubico de excavacion realmente ejecutado, medido en banco.', formaPago: 'Pago unico al 100% de avance verificado.', incluye: [], excluye: [] } });
  const v2 = normalizeAIApuToV2(raw, 'fallback');
  assert.equal(v2.criterioMedicion.criterio, 'Se mide por metro cubico de excavacion realmente ejecutado, medido en banco.');
});

test('TEST 6: criterioMedicion.formaPago se conserva del JSON crudo', () => {
  const raw = rawAIFixture({ criterioMedicion: { criterio: 'Se mide por metro cubico de excavacion realmente ejecutado, medido en banco.', formaPago: 'Pago unico al 100% de avance verificado.', incluye: [], excluye: [] } });
  const v2 = normalizeAIApuToV2(raw, 'fallback');
  assert.equal(v2.criterioMedicion.formaPago, 'Pago unico al 100% de avance verificado.');
});

// TEST 7: si la IA no entrega criterio/formaPago, el APU final declara
// explicitamente REQUIERE VALIDACION -- nunca una cadena vacia silenciosa que
// el exportador podria confundir con "no aplica".
test('TEST 7: criterio/formaPago ausentes producen REQUIERE_VALIDACION_TEXT, nunca cadena vacia', () => {
  const raw = rawAIFixture({ criterioMedicion: { incluye: [], excluye: [] } });
  const v2 = normalizeAIApuToV2(raw, 'fallback');
  assert.equal(v2.criterioMedicion.criterio, REQUIERE_VALIDACION_TEXT);
  assert.equal(v2.criterioMedicion.formaPago, REQUIERE_VALIDACION_TEXT);
  assert.notEqual(v2.criterioMedicion.criterio, '');
  assert.notEqual(v2.criterioMedicion.formaPago, '');
});

// TEST 8: un APU generado por IA obtiene primaryActivity usando el MISMO
// clasificador que ya usaba la ruta de plantillas (classifyConstructionSystem,
// constructionSystems.js) -- antes quedaba null incondicionalmente en la
// ruta de IA, anulando el score global del Confidence Engine sin importar
// el concepto (ver TEST 9/10 en apuConfidence.test.js).
test('TEST 8: normalizeAIApuToV2 clasifica primaryActivity con el motor universal existente', () => {
  const raw = rawAIFixture({ concept: 'Excavación a cielo abierto en material tipo II' });
  const v2 = normalizeAIApuToV2(raw, 'fallback');
  assert.equal(v2.primaryActivity, 'excavacion');
});

test('TEST 8b: un concepto sin disciplina reconocida queda "generico", no se inventa una clasificacion', () => {
  const raw = rawAIFixture({ concept: 'Fabricacion completamente desconocida de widget cuantico interdimensional' });
  const v2 = normalizeAIApuToV2(raw, 'fallback');
  assert.equal(v2.primaryActivity, 'generico');
});

// TEST 11: el motivo tecnico de un consumible (consumableSources[i].technicalReason)
// sobrevive a la normalizacion hasta el modelo final que consume el
// exportador (apuExportV2.js#drawApuSections ya lo imprime por renglon).
test('TEST 11: technicalReason de un consumible sobrevive a normalizeAIApuToV2', () => {
  const raw = rawAIFixture({
    consumables: [['Disco de corte para concreto', 2, 'pza', 85, 0]],
    consumableSources: [{ especificacion: 'Disco diamantado 14"', technicalReason: 'Se estima 1 disco cada 40 m de corte segun rendimiento de fabricante para concreto simple.' }]
  });
  const v2 = normalizeAIApuToV2(raw, 'fallback');
  assert.equal(v2.consumables.length, 1);
  assert.equal(v2.consumables[0].technicalReason, 'Se estima 1 disco cada 40 m de corte segun rendimiento de fabricante para concreto simple.');
});

// TEST 12: regresion multi-concepto -- procesar varios conceptos distintos en
// "lote" (normalizeAIApuToV2 es una funcion pura sin estado compartido) no
// mezcla referencePU/primaryActivity/criterioMedicion entre APUs distintos.
test('TEST 12: lote de conceptos distintos, cada APU conserva sus propios datos sin mezclarse', () => {
  const lote = [
    { raw: rawAIFixture({ concept: 'Excavación a cielo abierto en material tipo II' }), referencePU: 12.5, esperadoTipo: 'excavacion' },
    { raw: rawAIFixture({ concept: 'Suministro y habilitado de acero de refuerzo fy=4200' }), referencePU: 0, esperadoTipo: 'acero' },
    { raw: rawAIFixture({ concept: 'Fabricacion completamente desconocida de widget cuantico interdimensional' }), referencePU: 45.75, esperadoTipo: 'generico' }
  ];
  const resultados = lote.map(item => normalizeAIApuToV2(item.raw, 'fallback', { referencePU: item.referencePU }));
  resultados.forEach((v2, i) => {
    assert.equal(v2.referencePU, lote[i].referencePU, `referencePU del APU ${i} no debe mezclarse con otro del lote`);
    assert.equal(v2.primaryActivity, lote[i].esperadoTipo, `primaryActivity del APU ${i} no debe mezclarse con otro del lote`);
  });
  // Ninguno de los 3 IDs generados se repite (cada APU del lote es independiente).
  const ids = resultados.map(v2 => v2.id);
  assert.equal(new Set(ids).size, 3);
});
