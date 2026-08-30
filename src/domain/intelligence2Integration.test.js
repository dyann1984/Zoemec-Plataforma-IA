/* Material & Price Intelligence 2.1 -- INTEGRACION FINAL: pruebas A-L
   obligatorias del spec. Todo mockeado (searchFn inyectado) -- CERO
   llamadas reales a OpenAI/red. Ejercitan enrichApuWithIntelligence2, el
   MISMO punto de entrada que main.jsx usa tanto en generateAI (individual)
   como en generateBatchAPU (lote) -- ver src/domain/intelligence2Runtime.js
   para el wiring real de produccion (searchFn real ahi, nunca aqui). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichApuWithIntelligence2, resolveResourcePrice } from './materialPriceIntelligence2.js';
import { createPriceSearchCache, createInMemoryPriceCacheStore, CACHE_RESULT } from './priceSearchCache.js';
import { createPriceSearchBudget, PRICE_SEARCH_DEFERRED } from './priceSearchBudget.js';
import { createPriceTelemetry } from './priceTelemetry.js';
import { createInFlightRegistry } from './inFlightRegistry.js';
import { PRICE_STATUS } from './priceStatus.js';
import { MATERIAL_ORIGIN } from './materialOrigin.js';
import { runApuChallenge } from './apuChallenge.js';
import { runBidRisk } from './bidRisk.js';
import { runApuConfidence } from './apuConfidence.js';
import { runApuAudit } from './apuAuditor.js';

function altoResult(){
  return { fichaTecnica: { familia: 'cemento' }, referencias: [{ proveedor: 'Home Depot Mexico', url: 'https://x', precioNormalizado: 250, match: { verdict: 'ALTO', score: 91 } }], precioRecomendado: 250, nivelEvidencia: 'MERCADO' };
}
function sinEvidenciaResult(){
  return { fichaTecnica: {}, referencias: [], precioRecomendado: null, nivelEvidencia: 'ESTIMADO_IA' };
}

function aiApuFixture(overrides = {}){
  return {
    concept: 'Suministro e instalacion de columna de descarga de tuberia de acero de 6 pulgadas, incluye valvula check',
    unit: 'pza', family: 'plomeria', primaryActivity: 'tuberia', cantidadObra: 1,
    materials: [
      { descripcion: 'Tuberia de acero al carbon cedula 40 de 6 pulgadas', consumo: 1, unidad: 'm', precioUnitario: 350, fuente: {} },
      { descripcion: 'Valvula check de acero de 6 pulgadas, clase 150', consumo: 1, unidad: 'pza', precioUnitario: 3200, fuente: {} }
    ],
    labor: [{ descripcion: 'Tubero / plomero (oficial)', cuadrilla: 1, rendimiento: 5, salarioBase: 400, fsr: 1.85, fuente: {} }],
    equipment: [], seguridad: [], factores: {},
    ...overrides
  };
}

function freshContext({ maxSearches = 100, store = createInMemoryPriceCacheStore(), now = () => 1000 } = {}){
  return {
    cache: createPriceSearchCache({ store, now }),
    budget: createPriceSearchBudget({ maxSearches }),
    telemetry: createPriceTelemetry(),
    inFlightRegistry: createInFlightRegistry()
  };
}

test('TEST A -- single APU: los nuevos campos (materialOrigin, priceStatus, priceConfidence) llegan al APU final', async () => {
  const ctx = freshContext();
  const searchFn = async () => altoResult();
  const result = await enrichApuWithIntelligence2({
    aiApu: aiApuFixture(), userInput: { concept: aiApuFixture().concept, unit: 'm', qty: 12 },
    concept: aiApuFixture().concept, ...ctx, searchFn
  });
  const row = result.apu.materials[0];
  assert.ok(row.materialOrigin, 'debe traer materialOrigin');
  assert.ok(row.priceStatus, 'debe traer priceStatus');
  assert.ok('priceConfidence' in row, 'debe traer priceConfidence (aunque sea null)');
  assert.ok(Array.isArray(row.confidenceReasons));
  assert.ok(row.priceRecord, 'debe traer priceRecord con las referencias');
});

test('TEST B -- guardar/recuperar (roundtrip JSON, igual que Firestore): Material Origin y Price Status sobreviven', async () => {
  const ctx = freshContext();
  const searchFn = async () => altoResult();
  const result = await enrichApuWithIntelligence2({
    aiApu: aiApuFixture(), userInput: {}, concept: aiApuFixture().concept, ...ctx, searchFn
  });
  const persisted = JSON.parse(JSON.stringify(result.apu));
  assert.equal(persisted.materials[0].materialOrigin, result.apu.materials[0].materialOrigin);
  assert.equal(persisted.materials[0].priceStatus, result.apu.materials[0].priceStatus);
  assert.deepEqual(persisted.materials[0].confidenceReasons, result.apu.materials[0].confidenceReasons);
});

test('TEST C -- APU legacy SIN los nuevos campos sigue funcionando en los motores reales (Auditor/Challenge/BidRisk/Confidence)', () => {
  const legacyApu = {
    concept: 'Concepto legacy', unit: 'm2', cantidadObra: 10, primaryActivity: 'tuberia',
    materials: [{ descripcion: 'Material legacy', consumo: 1, unidad: 'pza', precioUnitario: 100, fuente: { estado: 'IMPORTADO' } }],
    labor: [{ descripcion: 'Oficial', cuadrilla: 1, rendimiento: 5, salarioBase: 400, fsr: 1.85 }],
    equipment: [], consumables: [], seguridad: [], factores: {}
    // SIN materialOrigin/priceStatus/priceConfidence/queryHash/normalization en ningun renglon.
  };
  assert.doesNotThrow(() => runApuAudit(legacyApu));
  assert.doesNotThrow(() => runApuChallenge(legacyApu));
  assert.doesNotThrow(() => runBidRisk(legacyApu));
  assert.doesNotThrow(() => runApuConfidence(legacyApu));
});

test('TEST D -- 20 recursos identicos concurrentes (Promise.all): single-flight produce 1 sola busqueda real', async () => {
  const ctx = freshContext();
  let searchCalls = 0;
  const searchFn = async () => { searchCalls++; await new Promise(r => setTimeout(r, 5)); return altoResult(); };
  const resource = { description: 'Cemento CPC 30R 50 kg', unit: 'saco', kind: 'materials', currentPrice: 250 };

  const results = await Promise.all(
    Array.from({ length: 20 }, () => resolveResourcePrice({ resource, cache: ctx.cache, budget: ctx.budget, telemetry: ctx.telemetry, inFlightRegistry: ctx.inFlightRegistry, searchFn }))
  );

  assert.equal(searchCalls, 1, 'CERO CACHE_MISS simultaneos deben derivar en mas de 1 llamada real a searchFn');
  results.forEach(r => assert.equal(r.priceStatus, PRICE_STATUS.VERIFIED_MARKET));
  assert.ok(ctx.telemetry.snapshot().inFlightDeduplications >= 19, 'al menos 19 de las 20 llamadas deben reportarse como deduplicadas in-flight');
});

test('TEST E -- cache persistente vigente: 0 busquedas nuevas', async () => {
  const sharedStore = createInMemoryPriceCacheStore();
  const ctxA = freshContext({ store: sharedStore, now: () => 1000 });
  let searchCalls = 0;
  const searchFn = async () => { searchCalls++; return altoResult(); };
  const resource = { description: 'Cemento CPC 30R 50 kg', unit: 'saco', currentPrice: 250 };

  await resolveResourcePrice({ resource, cache: ctxA.cache, budget: ctxA.budget, searchFn });
  assert.equal(searchCalls, 1);

  // Nueva "sesion" (nuevo cache/budget) contra el MISMO store persistente:
  const ctxB = freshContext({ store: sharedStore, now: () => 2000 });
  await resolveResourcePrice({ resource, cache: ctxB.cache, budget: ctxB.budget, searchFn });
  assert.equal(searchCalls, 1, 'con cache vigente (TTL no vencido) compartido, NO debe hacerse una busqueda nueva');
});

test('TEST F -- cache expirado: 1 busqueda nueva', async () => {
  const sharedStore = createInMemoryPriceCacheStore();
  let now = 1000;
  const cache = createPriceSearchCache({ store: sharedStore, now: () => now, defaultTtlMs: 5000 });
  const budget = createPriceSearchBudget();
  let searchCalls = 0;
  const searchFn = async () => { searchCalls++; return altoResult(); };
  const resource = { description: 'Cemento CPC 30R 50 kg', unit: 'saco', currentPrice: 250 };

  await resolveResourcePrice({ resource, cache, budget, searchFn });
  assert.equal(searchCalls, 1);

  now += 5000 + 1; // vence el TTL
  await resolveResourcePrice({ resource, cache, budget, searchFn });
  assert.equal(searchCalls, 2, 'tras expirar, debe ejecutarse una busqueda nueva');
});

test('TEST G -- budget 3 + 10 recursos unicos -> 3 busquedas + 7 PRICE_SEARCH_DEFERRED, el batch continua completo', async () => {
  const ctx = freshContext({ maxSearches: 3 });
  let searchCalls = 0;
  const searchFn = async () => { searchCalls++; return altoResult(); };

  const results = [];
  for(let i = 0; i < 10; i++){
    results.push(await resolveResourcePrice({ resource: { description: `Material unico ${i}`, unit: 'pza' }, cache: ctx.cache, budget: ctx.budget, telemetry: ctx.telemetry, searchFn }));
  }
  assert.equal(searchCalls, 3);
  assert.equal(results.filter(r => r.deferred).length, 7);
  assert.equal(results.length, 10, 'el batch debe procesar los 10 recursos, ninguno debe tumbar el resto');
  results.filter(r => r.deferred).forEach(r => assert.equal(r.status, PRICE_SEARCH_DEFERRED));
});

test('TEST H -- unidad usuario "m" + IA propone "pza" en el flujo real completo -> se conserva "m" + UNIT_WARNING', async () => {
  const ctx = freshContext();
  const searchFn = async () => sinEvidenciaResult();
  const result = await enrichApuWithIntelligence2({
    aiApu: aiApuFixture({ unit: 'pza' }), userInput: { unit: 'm', qty: 12 },
    concept: aiApuFixture().concept, ...ctx, searchFn
  });
  assert.equal(result.apu.unit, 'm');
  assert.ok(result.unitWarning);
  assert.equal(result.unitWarning.capturedUnit, 'm');
  assert.equal(result.unitWarning.suggestedUnit, 'pza');
});

test('TEST I -- generacion individual y de lote usan el MISMO orquestador con resultados consistentes', async () => {
  const ctx = freshContext();
  const searchFn = async () => altoResult();
  const individualResult = await enrichApuWithIntelligence2({
    aiApu: aiApuFixture(), userInput: { concept: 'Concepto individual', unit: 'm', qty: 12 },
    concept: 'Concepto individual', ...ctx, searchFn
  });
  const batchResult = await enrichApuWithIntelligence2({
    aiApu: aiApuFixture(), userInput: { concept: 'Concepto de lote', unit: 'm', qty: 12, clave: 'CON-001' },
    concept: 'Concepto de lote', ...ctx, searchFn
  });
  // Misma forma de resultado, mismos campos nuevos presentes en ambos --
  // no existen dos implementaciones distintas para individual vs lote.
  for(const r of [individualResult, batchResult]){
    assert.ok('apu' in r && 'unitWarning' in r && 'deferredCount' in r);
    assert.ok(r.apu.materials[0].materialOrigin);
    assert.ok(r.apu.materials[0].priceStatus);
  }
  assert.equal(batchResult.apu.clave, 'CON-001', 'el flujo de lote sigue protegiendo la clave capturada, igual interfaz que individual');
});

test('TEST J -- fallo del cache persistente (store roto): degradacion segura, el APU se sigue generando completo', async () => {
  const brokenStore = {
    get: async () => { throw new Error('Firestore no disponible'); },
    set: async () => { throw new Error('Firestore no disponible'); },
    delete: async () => { throw new Error('Firestore no disponible'); }
  };
  const cache = createPriceSearchCache({ store: brokenStore, now: () => 1000 });
  const budget = createPriceSearchBudget();
  const searchFn = async () => altoResult();

  const result = await enrichApuWithIntelligence2({
    aiApu: aiApuFixture(), userInput: {}, concept: aiApuFixture().concept, cache, budget, searchFn
  });
  assert.equal(result.apu.materials.length, 2, 'el APU debe seguir completo, no perderse por el fallo del store');
  assert.ok(result.apu.materials[0].priceStatus, 'el precio se sigue resolviendo (busqueda real) aunque no se pueda cachear');
});

test('TEST K -- fallo de la busqueda de precio (red/OpenAI caido): conserva estado auditable, NUNCA inventa un precio', async () => {
  const ctx = freshContext();
  const searchFn = async () => { throw new Error('OpenAI no disponible'); };
  const result = await enrichApuWithIntelligence2({
    aiApu: aiApuFixture(), userInput: {}, concept: aiApuFixture().concept, ...ctx, searchFn
  });
  const row = result.apu.materials[0];
  assert.equal(row.priceStatus, PRICE_STATUS.AI_ESTIMATE_UNVERIFIED, 'sin busqueda exitosa, el precio queda como estimacion de IA sin evidencia, nunca "verificado"');
  assert.equal(row.precioUnitario, 350, 'el precio original de la IA se conserva intacto, nunca se reemplaza por $0 ni se inventa uno nuevo');
});

test('TEST L -- aislamiento tenant: un recurso marcado tenant-specific nunca comparte cache con la busqueda global', async () => {
  const ctx = freshContext();
  let searchCalls = 0;
  const searchFn = async () => { searchCalls++; return altoResult(); };
  const baseResource = { description: 'Pieza de catalogo interno XYZ-1', unit: 'pza', currentPrice: 500 };

  await resolveResourcePrice({ resource: baseResource, cache: ctx.cache, budget: ctx.budget, searchFn });
  await resolveResourcePrice({ resource: { ...baseResource, tenantSpecific: true, organizationId: 'ORG-A' }, cache: ctx.cache, budget: ctx.budget, searchFn });
  await resolveResourcePrice({ resource: { ...baseResource, tenantSpecific: true, organizationId: 'ORG-B' }, cache: ctx.cache, budget: ctx.budget, searchFn });

  assert.equal(searchCalls, 3, 'global + ORG-A + ORG-B deben ser 3 fingerprints distintos, ninguno debe reusar el cache de otro');
});
