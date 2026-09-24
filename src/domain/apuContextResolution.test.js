import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichApuWithIntelligence2 } from './materialPriceIntelligence2.js';
import { createPriceSearchCache, createInMemoryPriceCacheStore } from './priceSearchCache.js';
import { createPriceSearchBudget } from './priceSearchBudget.js';
import {
  resolveApuGenerationContext, toContextDiagnostics, compareContextParity, annotateApuPriceSources,
  CONTEXT_MODE, PRICE_SOURCE, EXCLUSION_REASON, RESOLUTION_WARNING
} from './apuContextResolution.js';

const org = (id, description, unit, price, extra = {}) => ({ id, organizationId: 'ORG-1', description, unit, price, currency: 'MXN', region: '', date: '2026-09-01', status: 'ACTIVE', ...extra });
const cat = (desc, unidad, precio, extra = {}) => ({ desc, unidad, precio, ...extra });

/* Regla 8 del encargo: Cemento CPC 30R en 4 capas -> gana proyecto. */
test('precedencia: proyecto > empresa > personal > global (Cemento CPC 30R)', () => {
  const ctx = resolveApuGenerationContext({
    contextMode: CONTEXT_MODE.ORGANIZATION, includePersonal: true, organizationId: 'ORG-1', projectId: 'P-1',
    layers: {
      project: [org('PRJPRICE-1', 'Cemento CPC 30R', 'saco', 245, { projectId: 'P-1' })],
      organization: [org('ORGPRICE-001', 'Cemento CPC 30R', 'saco', 239)],
      personal: [cat('Cemento CPC 30R', 'saco', 235)],
      global: [cat('cemento cpc 30r', 'Saco', 242)]
    }
  });
  assert.equal(ctx.resolvedCount, 1);
  const row = ctx.catalogForModel[0];
  assert.equal(row.precio, 245);
  assert.equal(row.priceSource, PRICE_SOURCE.PROJECT);
  assert.equal(row.sourceRecordId, 'PRJPRICE-1');
  assert.equal(ctx.conflicts.length, 3, 'los otros 3 precios quedan como conflicto informativo, no se mezclan');
  assert.equal(ctx.excludedCounts[EXCLUSION_REASON.SHADOWED], 3);
});

test('sin precio de proyecto -> gana empresa, y se registra priceSource=organization + sourceRecordId', () => {
  const ctx = resolveApuGenerationContext({
    contextMode: CONTEXT_MODE.ORGANIZATION, includePersonal: true,
    layers: {
      organization: [org('ORGPRICE-001', 'Cemento CPC 30R', 'saco', 239)],
      personal: [cat('Cemento CPC 30R', 'saco', 235)],
      global: [cat('Cemento CPC 30R', 'saco', 242)]
    }
  });
  assert.equal(ctx.catalogForModel[0].priceSource, 'organization');
  assert.equal(ctx.catalogForModel[0].sourceRecordId, 'ORGPRICE-001');
  assert.equal(ctx.catalogForModel[0].precio, 239);
});

test('modo empresa: el catalogo PERSONAL no participa salvo includePersonal (regla 11)', () => {
  const layers = {
    organization: [org('O1', 'Arena', 'm³', 450)],
    personal: [cat('Block hueco 12x20x40', 'pza', 14.5), cat('Arena', 'm³', 400)]
  };
  const orgOnly = resolveApuGenerationContext({ contextMode: CONTEXT_MODE.ORGANIZATION, layers });
  assert.equal(orgOnly.personalIncluded, false);
  assert.equal(orgOnly.personalCatalogSize, 0);
  assert.equal(orgOnly.resolvedCount, 1);
  assert.equal(orgOnly.catalogForModel[0].precio, 450);

  const withPersonal = resolveApuGenerationContext({ contextMode: CONTEXT_MODE.ORGANIZATION, includePersonal: true, layers });
  assert.equal(withPersonal.personalIncluded, true);
  assert.equal(withPersonal.resolvedCount, 2, 'block personal se agrega; arena sigue siendo la de empresa');
  assert.notEqual(withPersonal.contextHash, orgOnly.contextHash, 'incluir personal cambia el contexto de forma explicita y visible');
});

test('modo personal (usuario sin empresa): personal > global, comportamiento historico', () => {
  const ctx = resolveApuGenerationContext({
    contextMode: CONTEXT_MODE.PERSONAL,
    layers: { organization: [org('O1', 'Arena', 'm³', 450)], personal: [cat('Arena', 'm³', 400)], global: [cat('Grava', 'm³', 520)] }
  });
  assert.equal(ctx.organizationId, null);
  assert.equal(ctx.organizationCatalogSize, 0, 'en modo personal no se usa ninguna capa empresarial');
  assert.equal(ctx.resolvedCount, 2);
  assert.equal(ctx.catalogForModel.find(r => r.desc === 'Arena').priceSource, 'personal');
});

test('region incompatible se excluye (no se mezcla); region vacia aplica en cualquier region', () => {
  const ctx = resolveApuGenerationContext({
    contextMode: CONTEXT_MODE.ORGANIZATION,
    region: { country: 'Mexico', state: 'Estado de Mexico', city: 'Toluca' },
    layers: { organization: [
      org('O1', 'Cemento CPC 30R', 'saco', 239, { region: 'Estado de México' }),
      org('O2', 'Cemento CPC 30R', 'saco', 199, { region: 'Nuevo León' }),
      org('O3', 'Arena', 'm³', 450, { region: '' })
    ] }
  });
  assert.equal(ctx.catalogForModel.find(r => r.desc === 'Cemento CPC 30R').precio, 239);
  assert.equal(ctx.excludedCounts[EXCLUSION_REASON.REGION_MISMATCH], 1);
  assert.ok(ctx.catalogForModel.some(r => r.desc === 'Arena'));
});

test('moneda distinta se excluye; precio vencido cae a la siguiente capa', () => {
  const ctx = resolveApuGenerationContext({
    contextMode: CONTEXT_MODE.ORGANIZATION, asOf: '2026-09-24',
    layers: {
      project: [org('P1', 'Varilla 3/8', 'kg', 21, { projectId: 'P-1', validUntil: '2026-08-31' })],
      organization: [org('O1', 'Varilla 3/8', 'kg', 23.5), org('O2', 'Acero A36', 'kg', 2.1, { currency: 'USD' })]
    }
  });
  const varilla = ctx.catalogForModel.find(r => r.desc === 'Varilla 3/8');
  assert.equal(varilla.priceSource, 'organization', 'el precio de proyecto vencido no se usa');
  assert.equal(varilla.precio, 23.5);
  assert.equal(ctx.excludedCounts[EXCLUSION_REASON.EXPIRED], 1);
  assert.equal(ctx.excludedCounts[EXCLUSION_REASON.CURRENCY_MISMATCH], 1);
});

test('dentro de la misma capa: gana el precio mas reciente', () => {
  const ctx = resolveApuGenerationContext({
    contextMode: CONTEXT_MODE.ORGANIZATION,
    layers: { organization: [org('O-OLD', 'Block 12', 'pza', 13, { date: '2026-01-10' }), org('O-NEW', 'Block 12', 'pza', 14.5, { date: '2026-08-10' })] }
  });
  assert.equal(ctx.catalogForModel[0].sourceRecordId, 'O-NEW');
});

test('precio 0 / archivado nunca se usan', () => {
  const ctx = resolveApuGenerationContext({
    contextMode: CONTEXT_MODE.ORGANIZATION,
    layers: { organization: [org('O1', 'Cal', 'saco', 0), org('O2', 'Yeso', 'saco', 90, { archivedAt: '2026-09-01' })] }
  });
  assert.equal(ctx.resolvedCount, 0);
  assert.equal(ctx.excludedCounts[EXCLUSION_REASON.NO_PRICE], 1);
  assert.equal(ctx.excludedCounts[EXCLUSION_REASON.ARCHIVED], 1);
  assert.ok(ctx.warnings.some(w => w.code === RESOLUTION_WARNING.EMPTY_ORGANIZATION_CATALOG));
  assert.ok(ctx.warnings.some(w => w.code === RESOLUTION_WARNING.EMPTY_CONTEXT));
});

test('determinismo: el orden de entrada no cambia el contexto (mismo contextHash y mismo catalogo)', () => {
  const rows = Array.from({ length: 40 }, (_, i) => org(`O${String(i).padStart(3, '0')}`, `Insumo ${i}`, 'pza', 10 + i));
  const a = resolveApuGenerationContext({ contextMode: 'organization', concept: 'insumo', layers: { organization: rows } });
  const b = resolveApuGenerationContext({ contextMode: 'organization', concept: 'insumo', layers: { organization: [...rows].reverse() } });
  assert.equal(a.contextHash, b.contextHash);
  assert.deepEqual(a.catalogForModel, b.catalogForModel);
});

test('tope de filas para la IA: prioriza por relevancia al concepto, de forma determinista', () => {
  const rows = [
    ...Array.from({ length: 150 }, (_, i) => org(`X${String(i).padStart(3, '0')}`, `Pintura vinilica tono ${i}`, 'l', 80)),
    org('B1', 'Block hueco de concreto 12x20x40', 'pza', 14.5),
    org('B2', 'Mortero cemento arena 1:5', 'm³', 1850)
  ];
  const ctx = resolveApuGenerationContext({ contextMode: 'organization', concept: 'Muro de block hueco de concreto de 12 cm asentado con mortero cemento-arena', layers: { organization: rows }, maxModelRows: 120 });
  assert.equal(ctx.sentToModelCount, 120);
  assert.equal(ctx.resolvedCount, 152);
  const sent = ctx.catalogForModel.map(r => r.sourceRecordId);
  assert.ok(sent.includes('B1') && sent.includes('B2'), 'los insumos del concepto entran aunque haya 150 filas irrelevantes');
  assert.equal(sent.indexOf('B1') < 2 && sent.indexOf('B2') < 2, true);
});

test('compareContextParity: mismo contexto -> equivalent; distinto -> diffs por campo', () => {
  const layers = { organization: [org('O1', 'Arena', 'm³', 450)] };
  const a = toContextDiagnostics(resolveApuGenerationContext({ contextMode: 'organization', organizationId: 'ORG-1', layers }));
  const b = toContextDiagnostics(resolveApuGenerationContext({ contextMode: 'organization', organizationId: 'ORG-1', layers }));
  assert.equal(compareContextParity(a, b).equivalent, true);
  const c = toContextDiagnostics(resolveApuGenerationContext({ contextMode: 'organization', organizationId: 'ORG-1', layers: { organization: [] } }));
  const diff = compareContextParity(a, c);
  assert.equal(diff.equivalent, false);
  assert.ok(diff.diffs.some(d => d.field === 'organizationCatalogSize'));
});

test('toContextDiagnostics: enrichment fallido agrega warning ALTA y penalty', () => {
  const ctx = resolveApuGenerationContext({ contextMode: 'organization', layers: { organization: [org('O1', 'Arena', 'm³', 450)] } });
  const d = toContextDiagnostics(ctx, { enrichmentFailed: true, enrichmentError: 'HTTP 402' });
  assert.equal(d.confidencePenalty, 5);
  assert.ok(d.warnings.some(w => w.code === 'ENRICHMENT_FAILED' && /402/.test(w.message)));
  assert.equal('catalogForModel' in d, false, 'el diagnostico es compacto, no arrastra el catalogo completo');
});

test('annotateApuPriceSources: v2 y v1 -- precio igual a la fuente -> esa fuente; precio cambiado por IA -> ai_estimated', () => {
  const catalogForModel = [
    { desc: 'Block hueco 12x20x40', unidad: 'pza', precio: 14.5, priceSource: 'organization', sourceRecordId: 'ORGPRICE-7' },
    { desc: 'Arena', unidad: 'm³', precio: 450, priceSource: 'project', sourceRecordId: 'PRJ-2' }
  ];
  const v2 = annotateApuPriceSources({
    materials: [
      { descripcion: 'Block hueco 12x20x40', unidad: 'pza', precioUnitario: 14.5 },
      { descripcion: 'Arena', unidad: 'm3', precioUnitario: 480 },
      { descripcion: 'Agua', unidad: 'm³', precioUnitario: 30 }
    ]
  }, catalogForModel);
  assert.equal(v2.materials[0].priceSource, 'organization');
  assert.equal(v2.materials[0].sourceRecordId, 'ORGPRICE-7');
  assert.equal(v2.materials[1].priceSource, 'ai_estimated', 'misma identidad pero la IA cambio el precio -> nunca se atribuye a la fuente');
  assert.equal(v2.materials[2].priceSource, 'ai_estimated');
  assert.deepEqual(v2.priceSourceSummary, { project: 0, organization: 1, personal: 0, global: 0, ai_estimated: 2 });

  const v1 = annotateApuPriceSources({ materials: [['Arena', 0.05, 'm³', 450, 3]] }, catalogForModel);
  assert.deepEqual(v1.materials[0], ['Arena', 0.05, 'm³', 450, 3], 'el renglon v1 no se altera');
  assert.equal(v1.priceSourceByRow.materials[0].priceSource, 'project');
});

test('annotateApuPriceSources: renglon v2 de biblioteca declara evidencia BIBLIOTECA (nunca VERIFICADO automatico)', () => {
  const catalogForModel = [{ desc: 'Block hueco 12x20x40', unidad: 'pza', precio: 14.5, priceSource: 'organization', sourceRecordId: 'ORGPRICE-7' }];
  const out = annotateApuPriceSources({ materials: [
    { descripcion: 'Block hueco 12x20x40', unidad: 'pza', precioUnitario: 14.5, fuente: { estado: 'ESTIMADO_IA', proveedor: null } },
    { descripcion: 'Agua', unidad: 'm³', precioUnitario: 30, fuente: { estado: 'ESTIMADO_IA' } }
  ] }, catalogForModel);
  assert.equal(out.materials[0].fuente.estado, 'BIBLIOTECA');
  assert.equal(out.materials[0].fuente.sourceName, 'Biblioteca empresarial (ORGPRICE-7)');
  assert.equal(out.materials[0].fuente.sourceRecordId, 'ORGPRICE-7');
  assert.equal(out.materials[1].fuente.estado, 'ESTIMADO_IA', 'un estimado de IA sigue siendo estimado');
});

test('Price Intelligence NO degrada un precio de biblioteca cuando el mercado no tiene referencias', async () => {
  const run = (estado) => enrichApuWithIntelligence2({
    aiApu: { concept: 'Muro de block', unit: 'm²', materials: [{ descripcion: 'Block hueco 12x20x40', consumo: 12.5, unidad: 'pza', precioUnitario: 14.5, fuente: { estado } }], labor: [], equipment: [], seguridad: [], factores: {} },
    userInput: {}, concept: 'Muro de block',
    cache: createPriceSearchCache({ store: createInMemoryPriceCacheStore(), now: () => 1000 }),
    budget: createPriceSearchBudget({ maxSearches: 10 }),
    searchFn: async () => ({ fichaTecnica: {}, referencias: [], precioRecomendado: null, nivelEvidencia: 'ESTIMADO_IA' })
  });
  const library = await run('BIBLIOTECA');
  assert.equal(library.apu.materials[0].fuente.estado, 'BIBLIOTECA');
  assert.equal(library.apu.materials[0].precioUnitario, 14.5);
  const estimated = await run('ESTIMADO_IA');
  assert.equal(estimated.apu.materials[0].fuente.estado, 'ESTIMADO_IA', 'sin cambio para lo que ya era estimado');
});
