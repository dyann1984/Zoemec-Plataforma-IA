import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findApuMatches, rankApuMatches } from './apuMatchLookup.js';

const apus = [
  { id: 'A1', clave: 'ALB-001', concept: 'Muro de block hueco de concreto 15 cm', unit: 'm²', capitulo: 'ALBANILERIA', ubicacionEstructurada: { country: 'MX', state: 'CDMX', city: 'CDMX' } },
  { id: 'A2', clave: 'CIM-002', concept: 'Zapata aislada de concreto armado', unit: 'm³', capitulo: 'CIMENTACION', ubicacionEstructurada: { country: 'MX', state: 'Jalisco', city: 'Guadalajara' } },
  { id: 'A3', clave: 'ALB-003', concept: 'Muro de block hueco de concreto 10 cm', unit: 'm²', capitulo: 'ALBANILERIA', ubicacionEstructurada: null }
];

test('findApuMatches: clave_exacta gana con confianza 1', () => {
  const result = findApuMatches(apus, { clave: 'ALB-001', desc: 'algo distinto' });
  assert.equal(result.match.id, 'A1');
  assert.equal(result.matchMethod, 'clave_exacta');
  assert.equal(result.confidence, 1);
});

test('findApuMatches: descripcion_normalizada ignora acentos/mayusculas', () => {
  const result = findApuMatches(apus, { desc: 'ZAPATA AISLADA DE CONCRETO ARMADO' });
  assert.equal(result.match.id, 'A2');
  assert.equal(result.matchMethod, 'descripcion_normalizada');
});

test('findApuMatches: fuzzy_token encuentra el mas parecido por token', () => {
  const result = findApuMatches(apus, { desc: 'Muro de block hueco 15cm concreto' });
  assert.equal(result.match.id, 'A1');
  assert.equal(result.matchMethod, 'fuzzy_token');
});

test('findApuMatches: sin coincidencia real retorna null (nunca inventa)', () => {
  const result = findApuMatches(apus, { desc: 'Instalacion electrica trifasica subterranea' });
  assert.equal(result, null);
});

test('findApuMatches: region distinta penaliza confianza pero NO excluye el match', () => {
  const sameRegion = findApuMatches(apus, { clave: 'CIM-002', desc: 'x', region: { country: 'MX', state: 'Jalisco', city: 'Guadalajara' } });
  const otherRegion = findApuMatches(apus, { clave: 'CIM-002', desc: 'x', region: { country: 'MX', state: 'CDMX', city: 'CDMX' } });
  assert.equal(sameRegion.match.id, 'A2');
  assert.equal(sameRegion.sameRegion, true);
  assert.equal(otherRegion.match.id, 'A2');
  assert.equal(otherRegion.sameRegion, false);
  assert.ok(otherRegion.confidence < sameRegion.confidence);
});

test('findApuMatches: un APU sin ubicacion no se evalua por region (sameRegion null, sin penalizar)', () => {
  const result = findApuMatches(apus, { clave: 'ALB-003', desc: 'x', region: { country: 'MX', state: 'CDMX', city: 'CDMX' } });
  assert.equal(result.sameRegion, null);
  assert.equal(result.confidence, 1);
});

test('rankApuMatches: devuelve varios candidatos ordenados por confianza', () => {
  const ranked = rankApuMatches(apus, { desc: 'Muro de block hueco de concreto' });
  assert.ok(ranked.length >= 2);
  assert.ok(ranked[0].confidence >= ranked[1].confidence);
  assert.deepEqual(ranked.slice(0, 2).map(r => r.match.id).sort(), ['A1', 'A3']);
});

test('findApuMatches: catalogo vacio retorna null', () => {
  assert.equal(findApuMatches([], { desc: 'algo' }), null);
  assert.equal(findApuMatches(null, { desc: 'algo' }), null);
});
