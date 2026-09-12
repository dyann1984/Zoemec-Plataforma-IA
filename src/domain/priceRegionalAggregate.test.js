import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateLevel, recomputeRegionalIntelligence, buildTraceabilitySummary,
  assertAggregateNeverLeaksOrgId, isBucketReadyForGlobalPromotion,
  MIN_DISTINCT_ORGS_REGIONAL, REGIONAL_LEVEL,
} from './priceRegionalAggregate.js';

const NOW = new Date('2026-02-01T00:00:00.000Z').getTime();

function obs(organizationId, precio, fecha = '2026-01-15', overrides = {}){
  return { organizationId, precio, fecha, ...overrides };
}

test('aggregateLevel: con menos de MIN_DISTINCT_ORGS_REGIONAL organizaciones, usable es SIEMPRE false (garantia de anonimato)', () => {
  const observations = [obs('org-1', 100), obs('org-2', 102), obs('org-3', 98), obs('org-4', 101)]; // 4 orgs distintas
  const agg = aggregateLevel(observations, { level: REGIONAL_LEVEL.CIUDAD, now: NOW });
  assert.equal(agg.nOrganizaciones, 4);
  assert.equal(agg.usable, false);
});

test('aggregateLevel: con exactamente MIN_DISTINCT_ORGS_REGIONAL organizaciones distintas, usable es true', () => {
  const observations = Array.from({ length: MIN_DISTINCT_ORGS_REGIONAL }, (_, i) => obs(`org-${i}`, 100 + i));
  const agg = aggregateLevel(observations, { level: REGIONAL_LEVEL.CIUDAD, now: NOW });
  assert.equal(agg.nOrganizaciones, MIN_DISTINCT_ORGS_REGIONAL);
  assert.equal(agg.usable, true);
});

test('aggregateLevel: multiples observaciones de la MISMA organizacion nunca inflan nOrganizaciones (no es "5 filas", es "5 empresas")', () => {
  const observations = [
    ...Array.from({ length: 20 }, (_, i) => obs('org-dominante', 100 + i)), // una sola empresa manda 20 filas
    obs('org-2', 105), obs('org-3', 98),
  ];
  const agg = aggregateLevel(observations, { level: REGIONAL_LEVEL.CIUDAD, now: NOW });
  assert.equal(agg.nOrganizaciones, 3);
  assert.equal(agg.usable, false);
});

test('aggregateLevel: outlier (>40% de desviacion de la mediana cruda) se excluye del calculo ponderado pero se sigue contando en nObservaciones', () => {
  const observations = [obs('org-1', 100), obs('org-2', 100), obs('org-3', 100), obs('org-4', 100), obs('org-5', 500)]; // 500 es outlier
  const agg = aggregateLevel(observations, { level: REGIONAL_LEVEL.CIUDAD, now: NOW });
  assert.equal(agg.nObservaciones, 5);
  assert.equal(agg.nOrganizaciones, 5);
  assert.equal(agg.mediana, 100);
  assert.equal(agg.maximo, 500); // minimo/maximo SIEMPRE reales, nunca ocultan el outlier
});

test('aggregateLevel: observaciones mas viejas pesan menos en la mediana ponderada', () => {
  // 5 organizaciones "viejas" (>1 ano) dicen 100; 5 organizaciones RECIENTES dicen 200.
  // El peso reciente (1.0) debe dominar sobre el peso viejo (0.15).
  const vieja = '2024-01-01';
  const reciente = '2026-01-20';
  const observations = [
    ...Array.from({ length: 5 }, (_, i) => obs(`org-vieja-${i}`, 100, vieja)),
    ...Array.from({ length: 5 }, (_, i) => obs(`org-reciente-${i}`, 200, reciente)),
  ];
  const agg = aggregateLevel(observations, { level: REGIONAL_LEVEL.CIUDAD, now: NOW });
  assert.ok(agg.mediana > 150, `esperaba que la mediana ponderada se acercara a 200 (reciente), fue ${agg.mediana}`);
});

test('aggregateLevel: sin observaciones, no usable y todo null', () => {
  const agg = aggregateLevel([], { level: REGIONAL_LEVEL.NACIONAL, now: NOW });
  assert.equal(agg.usable, false);
  assert.equal(agg.mediana, null);
  assert.equal(agg.nObservaciones, 0);
});

test('recomputeRegionalIntelligence: fuentePredominante prioriza ciudad > estado > nacional, solo si es usable', () => {
  const usableGroup = Array.from({ length: MIN_DISTINCT_ORGS_REGIONAL }, (_, i) => obs(`org-${i}`, 100));
  const result = recomputeRegionalIntelligence({
    ciudadObservations: usableGroup, estadoObservations: usableGroup, nacionalObservations: usableGroup,
  }, { now: NOW });
  assert.equal(result.fuentePredominante, REGIONAL_LEVEL.CIUDAD);
});

test('recomputeRegionalIntelligence: si ciudad no es usable pero estado si, fuentePredominante cae a estado', () => {
  const noUsable = [obs('org-1', 100), obs('org-2', 100)];
  const usable = Array.from({ length: MIN_DISTINCT_ORGS_REGIONAL }, (_, i) => obs(`org-${i}`, 100));
  const result = recomputeRegionalIntelligence({ ciudadObservations: noUsable, estadoObservations: usable, nacionalObservations: usable }, { now: NOW });
  assert.equal(result.fuentePredominante, REGIONAL_LEVEL.ESTADO);
});

test('recomputeRegionalIntelligence: si ningun nivel es usable, fuentePredominante es null (nunca se inventa uno)', () => {
  const noUsable = [obs('org-1', 100), obs('org-2', 100)];
  const result = recomputeRegionalIntelligence({ ciudadObservations: noUsable, estadoObservations: noUsable, nacionalObservations: noUsable }, { now: NOW });
  assert.equal(result.fuentePredominante, null);
});

test('recomputeRegionalIntelligence: el resultado NUNCA contiene un organizationId individual', () => {
  const usableGroup = Array.from({ length: MIN_DISTINCT_ORGS_REGIONAL }, (_, i) => obs(`org-${i}`, 100));
  const result = recomputeRegionalIntelligence({ ciudadObservations: usableGroup, estadoObservations: [], nacionalObservations: [] }, { now: NOW });
  assert.doesNotThrow(() => assertAggregateNeverLeaksOrgId(result));
  assert.equal(JSON.stringify(result).includes('org-0'), false);
});

test('buildTraceabilitySummary: devuelve null para un nivel no usable (nunca se muestra un bucket con pocas empresas)', () => {
  const agg = aggregateLevel([obs('org-1', 100)], { level: REGIONAL_LEVEL.CIUDAD, now: NOW });
  assert.equal(buildTraceabilitySummary(agg, 'Guadalajara, Jalisco'), null);
});

test('buildTraceabilitySummary: produce las 5 lineas pedidas cuando el nivel SI es usable', () => {
  const observations = Array.from({ length: MIN_DISTINCT_ORGS_REGIONAL }, (_, i) => obs(`org-${i}`, 100 + i));
  const agg = aggregateLevel(observations, { level: REGIONAL_LEVEL.CIUDAD, now: NOW });
  const summary = buildTraceabilitySummary(agg, 'Guadalajara, Jalisco, México');
  assert.equal(summary.lines.length, 5);
  assert.match(summary.lines[0], /referencia\(s\) regionales/);
  assert.match(summary.lines[1], /Fuente predominante: Guadalajara/);
  assert.match(summary.lines[2], /Última actualización/);
  assert.match(summary.lines[3], /Nivel de confianza/);
  assert.match(summary.lines[4], /Rango observado/);
});

test('isBucketReadyForGlobalPromotion: exige multiples buckets regionales convergentes, no solo uno', () => {
  const usable = { usable: true, confianza: 'MEDIA' };
  assert.equal(isBucketReadyForGlobalPromotion([usable]), false);
  assert.equal(isBucketReadyForGlobalPromotion([usable, usable, usable]), true);
});

test('isBucketReadyForGlobalPromotion: un bucket de confianza BAJA nunca cuenta para la convergencia', () => {
  const baja = { usable: true, confianza: 'BAJA' };
  const media = { usable: true, confianza: 'MEDIA' };
  assert.equal(isBucketReadyForGlobalPromotion([baja, baja, media]), false);
});
