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
