import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REGIONAL_COVERAGE_LEVEL, REFERENCE_LEVEL_LABEL, getApuLocation, hasApuLocation, collectRegionalRows,
  summarizeRegionalCoverage, describeReferenceLevel, describeReferenceSentence
} from './apuRegionalContext.js';

test('getApuLocation: lee ubicacionEstructurada, NUNCA los campos de texto libre legados pais/estado/municipio', () => {
  const apu = { ubicacionEstructurada: { country: 'MX', state: 'Estado de Mexico', city: 'Tecamac' }, pais: 'otro-pais-legado', estado: 'otro-estado-legado' };
  assert.deepEqual(getApuLocation(apu), { country: 'MX', state: 'Estado de Mexico', city: 'Tecamac', region: null });
});

test('getApuLocation: incluye la region/zona cuando el snapshot la trae', () => {
  const apu = { ubicacionEstructurada: { country: 'MX', state: 'Estado de México', region: 'Zona Metropolitana', city: 'Tecámac' } };
  assert.deepEqual(getApuLocation(apu), { country: 'MX', state: 'Estado de México', city: 'Tecámac', region: 'Zona Metropolitana' });
});

test('hasApuLocation: false cuando ubicacionEstructurada esta vacia o ausente', () => {
  assert.equal(hasApuLocation({}), false);
  assert.equal(hasApuLocation({ ubicacionEstructurada: { country: null, state: null, city: null } }), false);
  assert.equal(hasApuLocation({ ubicacionEstructurada: { country: 'MX', state: null, city: null } }), true);
  assert.equal(hasApuLocation({ ubicacionEstructurada: { region: 'Zona Metropolitana' } }), true);
});

test('describeReferenceLevel: texto honesto por nivel, "Sin referencia disponible" para nivel desconocido/ausente', () => {
  assert.equal(describeReferenceLevel(REGIONAL_COVERAGE_LEVEL.CIUDAD), 'Ciudad');
  assert.equal(describeReferenceLevel(REGIONAL_COVERAGE_LEVEL.ESTADO), 'Estado');
  assert.equal(describeReferenceLevel(REGIONAL_COVERAGE_LEVEL.NACIONAL), 'Nacional');
  assert.equal(describeReferenceLevel(REGIONAL_COVERAGE_LEVEL.SIN_DATO), 'Sin referencia disponible');
  assert.equal(describeReferenceLevel(null), REFERENCE_LEVEL_LABEL.sin_dato);
  assert.equal(describeReferenceLevel('nivel-inventado'), REFERENCE_LEVEL_LABEL.sin_dato);
});

test('describeReferenceSentence: nivel ciudad nombra la ciudad; nivel estado explica honestamente el fallback', () => {
  const ciudad = describeReferenceSentence({
    hasLocation: true, primaryLevel: REGIONAL_COVERAGE_LEVEL.CIUDAD, location: { city: 'Tecámac' }
  });
  assert.equal(ciudad, 'Referencia de precios utilizada: Tecámac.');

  const estado = describeReferenceSentence({
    hasLocation: true, primaryLevel: REGIONAL_COVERAGE_LEVEL.ESTADO, location: { state: 'Estado de México' }
  });
  assert.equal(estado, 'No existe referencia municipal suficiente. Se está utilizando referencia estatal (Estado de México).');

  const nacional = describeReferenceSentence({ hasLocation: true, primaryLevel: REGIONAL_COVERAGE_LEVEL.NACIONAL, location: {} });
  assert.equal(nacional, 'No existe referencia estatal ni municipal suficiente. Se está utilizando referencia nacional.');
});

test('describeReferenceSentence: sin ubicacion o sin datos todavia, nunca inventa un nivel', () => {
  assert.equal(describeReferenceSentence({ hasLocation: false }), 'Este APU todavía no tiene una ubicación definida.');
  assert.equal(
    describeReferenceSentence({ hasLocation: true, primaryLevel: null }),
    'Ningún insumo de este APU ha buscado precio regional todavía.'
  );
});

test('collectRegionalRows: un renglon sin regionalFallbackLevel NI priceStatus es SIN_DATO, nunca NACIONAL por default', () => {
  const apu = { materials: [{ descripcion: 'Cemento', precioUnitario: 245 }] };
  const rows = collectRegionalRows(apu);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hasRegionalData, false);
  assert.equal(rows[0].level, REGIONAL_COVERAGE_LEVEL.SIN_DATO);
});

test('collectRegionalRows: un renglon CON priceStatus pero sin regionalFallbackLevel explicito cae a NACIONAL (si tiene evidencia pero no nivel geografico)', () => {
  const apu = { materials: [{ descripcion: 'Acero', precioUnitario: 800, priceStatus: 'MARKET_REFERENCE' }] };
  const rows = collectRegionalRows(apu);
  assert.equal(rows[0].hasRegionalData, true);
  assert.equal(rows[0].level, REGIONAL_COVERAGE_LEVEL.NACIONAL);
});

test('collectRegionalRows: recorre las 5 categorias de recurso, cada renglon con su "kind"', () => {
  const apu = {
    materials: [{ descripcion: 'Cemento' }], labor: [{ descripcion: 'Albañil' }],
    equipment: [{ descripcion: 'Revolvedora' }], consumables: [{ descripcion: 'Disco de corte' }], seguridad: [{ descripcion: 'Casco' }]
  };
  const rows = collectRegionalRows(apu);
  assert.deepEqual(rows.map(r => r.kind), ['materials', 'labor', 'equipment', 'consumables', 'seguridad']);
});

test('summarizeRegionalCoverage: sin ningun renglon con dato, hasLocation puede ser true pero primaryLevel/dominantConfidence quedan null (ausencia real, no una BAJA inventada)', () => {
  const apu = { ubicacionEstructurada: { country: 'MX', state: 'CDMX', city: 'CDMX' }, materials: [{ descripcion: 'Cemento', precioUnitario: 245 }] };
  const summary = summarizeRegionalCoverage(apu);
  assert.equal(summary.hasLocation, true);
  assert.equal(summary.primaryLevel, null);
  assert.equal(summary.dominantConfidence, null);
  assert.equal(summary.rowsWithData, 0);
});

test('summarizeRegionalCoverage: primaryLevel prefiere el nivel MAS GRANULAR presente entre los renglones con dato', () => {
  const apu = {
    materials: [
      { descripcion: 'A', regionalFallbackLevel: 'nacional', regionalConfidence: 'BAJA' },
      { descripcion: 'B', regionalFallbackLevel: 'ciudad', regionalConfidence: 'ALTA' },
      { descripcion: 'C', regionalFallbackLevel: 'estado', regionalConfidence: 'MEDIA' }
    ]
  };
  const summary = summarizeRegionalCoverage(apu);
  assert.equal(summary.primaryLevel, REGIONAL_COVERAGE_LEVEL.CIUDAD);
  assert.equal(summary.coverageByLevel.ciudad, 1);
  assert.equal(summary.coverageByLevel.estado, 1);
  assert.equal(summary.coverageByLevel.nacional, 1);
});

test('summarizeRegionalCoverage: dominantConfidence reporta la mas FRECUENTE real, nunca un promedio artificial', () => {
  const apu = {
    materials: [
      { descripcion: 'A', regionalFallbackLevel: 'ciudad', regionalConfidence: 'ALTA' },
      { descripcion: 'B', regionalFallbackLevel: 'ciudad', regionalConfidence: 'ALTA' },
      { descripcion: 'C', regionalFallbackLevel: 'nacional', regionalConfidence: 'BAJA' }
    ]
  };
  const summary = summarizeRegionalCoverage(apu);
  assert.equal(summary.dominantConfidence, 'ALTA');
});

test('summarizeRegionalCoverage: apu sin ningun renglon de ningun tipo no lanza, todo queda en su default seguro', () => {
  const summary = summarizeRegionalCoverage({});
  assert.equal(summary.totalRows, 0);
  assert.equal(summary.rowsWithData, 0);
  assert.equal(summary.primaryLevel, null);
  assert.equal(summary.hasLocation, false);
});

/* ======================================================================
   QA ronda 2 -- 4 escenarios explicitos de fallback de precios pedidos:
   A) existe referencia ciudad. B) no existe ciudad pero si region/estado.
   C) solo existe referencia nacional. D) no existe ninguna referencia
   confiable. Cada uno via el pipeline REAL (collectRegionalRows/
   summarizeRegionalCoverage/describeReferenceSentence), nunca un texto
   fabricado aparte -- y nunca eleva la confianza cuando el sistema tuvo
   que ampliar el radio geografico (regla explicita del brief). ====================================================================== */

const UBICACION_TECAMAC = { ubicacionEstructurada: { country: 'MX', state: 'MEX', region: 'Zona Metropolitana', city: 'Tecámac' } };

test('Escenario A -- existe referencia de CIUDAD: nivel real "ciudad", nunca elevado a mas confianza de la que la fuente reporto', () => {
  const apu = { ...UBICACION_TECAMAC, materials: [{ descripcion: 'Cemento', regionalFallbackLevel: 'ciudad', regionalConfidence: 'ALTA', priceStatus: 'VERIFIED_MARKET' }] };
  const summary = summarizeRegionalCoverage(apu);
  assert.equal(summary.primaryLevel, REGIONAL_COVERAGE_LEVEL.CIUDAD);
  assert.equal(summary.dominantConfidence, 'ALTA');
  assert.equal(describeReferenceSentence(summary), 'Referencia de precios utilizada: Tecámac.');
});

test('Escenario B -- NO existe ciudad pero SI region/estado: nivel real "estado" (nunca se disfraza de ciudad), confianza nunca elevada a ALTA', () => {
  const apu = { ...UBICACION_TECAMAC, materials: [{ descripcion: 'Cemento', regionalFallbackLevel: 'estado', regionalConfidence: 'MEDIA', priceStatus: 'MARKET_REFERENCE' }] };
  const summary = summarizeRegionalCoverage(apu);
  assert.equal(summary.primaryLevel, REGIONAL_COVERAGE_LEVEL.ESTADO);
  assert.notEqual(summary.dominantConfidence, 'ALTA');
  assert.equal(describeReferenceSentence(summary), 'No existe referencia municipal suficiente. Se está utilizando referencia estatal (Estado de México).');
});

test('Escenario C -- SOLO existe referencia NACIONAL: nivel real "nacional", confianza BAJA honesta', () => {
  const apu = { ...UBICACION_TECAMAC, materials: [{ descripcion: 'Cemento', regionalFallbackLevel: 'nacional', regionalConfidence: 'BAJA', priceStatus: 'MARKET_REFERENCE' }] };
  const summary = summarizeRegionalCoverage(apu);
  assert.equal(summary.primaryLevel, REGIONAL_COVERAGE_LEVEL.NACIONAL);
  assert.equal(summary.dominantConfidence, 'BAJA');
  assert.equal(describeReferenceSentence(summary), 'No existe referencia estatal ni municipal suficiente. Se está utilizando referencia nacional.');
});

test('Escenario D -- NO existe ninguna referencia confiable (nunca se busco / busqueda sin evidencia usable): SIN_DATO, nunca NACIONAL inventado', () => {
  const apu = { ...UBICACION_TECAMAC, materials: [{ descripcion: 'Cemento', precioUnitario: 100 }] };
  const summary = summarizeRegionalCoverage(apu);
  assert.equal(summary.rowsWithData, 0);
  assert.equal(summary.primaryLevel, null, 'ausencia real de busqueda, nunca un nivel fabricado');
  assert.equal(summary.dominantConfidence, null);
  assert.equal(describeReferenceSentence(summary), 'Ningún insumo de este APU ha buscado precio regional todavía.');
});

test('Los 4 escenarios producen niveles MUTUAMENTE DISTINTOS -- nunca dos escenarios distintos con el mismo texto de referencia', () => {
  const base = kind => ({ ...UBICACION_TECAMAC, materials: [{ descripcion: 'Cemento', ...kind }] });
  const textos = [
    describeReferenceSentence(summarizeRegionalCoverage(base({ regionalFallbackLevel: 'ciudad', regionalConfidence: 'ALTA', priceStatus: 'VERIFIED_MARKET' }))),
    describeReferenceSentence(summarizeRegionalCoverage(base({ regionalFallbackLevel: 'estado', regionalConfidence: 'MEDIA', priceStatus: 'MARKET_REFERENCE' }))),
    describeReferenceSentence(summarizeRegionalCoverage(base({ regionalFallbackLevel: 'nacional', regionalConfidence: 'BAJA', priceStatus: 'MARKET_REFERENCE' }))),
    describeReferenceSentence(summarizeRegionalCoverage(base({ precioUnitario: 100 }))),
  ];
  assert.equal(new Set(textos).size, 4);
});
