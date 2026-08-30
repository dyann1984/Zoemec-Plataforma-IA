/* Material & Price Intelligence 2.1 -- pruebas de integracion del
   orquestador (materialPriceIntelligence2.js). TODAS usan un searchFn MOCK
   inyectado -- CERO llamadas reales a OpenAI/red, por diseno del spec
   ("regla 10: sin gastar API"). Cubre TEST 1 y TEST 14 de punta a punta
   (cache + presupuesto reales, busqueda simulada), y prueba explicitamente
   que el resto de Intelligence (Challenge/BidRisk/Confidence/Auditor, todos
   REALES, sin mock) responde correctamente a los nuevos PRICE_STATUS -- sin
   modificar ni un caracter de esos motores. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveResourcePrice, auditNoPriceFindings } from './materialPriceIntelligence2.js';
import { createPriceSearchCache } from './priceSearchCache.js';
import { createPriceSearchBudget, PRICE_SEARCH_DEFERRED } from './priceSearchBudget.js';
import { createPriceTelemetry } from './priceTelemetry.js';
import { PRICE_STATUS, priceStatusToLegacyState } from './priceStatus.js';
import { MATERIAL_ORIGIN } from './materialOrigin.js';
import { runApuChallenge } from './apuChallenge.js';
import { runBidRisk, BID_RISK_CATEGORY } from './bidRisk.js';
import { runApuConfidence } from './apuConfidence.js';
import { runApuAudit } from './apuAuditor.js';

function altoSearchResult(overrides = {}){
  return {
    fichaTecnica: { familia: 'cemento', keywordsObligatorias: ['cemento'], keywordsExcluyentes: [] },
    referencias: [{ proveedor: 'Home Depot Mexico', url: 'https://www.homedepot.com.mx/x', precioNormalizado: 250, match: { verdict: 'ALTO', score: 91 } }],
    precioRecomendado: 250, nivelEvidencia: 'MERCADO',
    ...overrides
  };
}
function sinEvidenciaSearchResult(){
  return { fichaTecnica: {}, referencias: [], precioRecomendado: null, nivelEvidencia: 'ESTIMADO_IA' };
}

test('TEST 1 (orquestador completo) -- 20 recursos identicos: solo 1 llamada real a searchFn, 19 CACHE_HIT', async () => {
  const cache = createPriceSearchCache({ now: () => 1000 });
  const budget = createPriceSearchBudget({ maxSearches: 100 });
  const telemetry = createPriceTelemetry();
  let searchCalls = 0;
  const searchFn = async () => { searchCalls++; return altoSearchResult(); };

  const resource = { description: 'Cemento CPC 30R 50 kg', unit: 'saco', kind: 'materials', currentPrice: 250 };
  const results = [];
  for(let i = 0; i < 20; i++){
    results.push(await resolveResourcePrice({ resource, concept: 'Cemento CPC 30R 50 kg', cache, budget, telemetry, searchFn }));
  }

  assert.equal(searchCalls, 1, 'NO debe hacerse mas de 1 busqueda real para 20 recursos identicos');
  assert.equal(results.filter(r => r.cacheResult === 'CACHE_MISS').length, 1);
  assert.equal(results.filter(r => r.cacheResult === 'CACHE_HIT').length, 19);
  assert.equal(telemetry.snapshot().webSearchCalls, 1);
  assert.equal(telemetry.snapshot().cacheHits, 19);
  assert.equal(telemetry.snapshot().cacheMisses, 1);
  results.forEach(r => assert.equal(r.priceStatus, PRICE_STATUS.VERIFIED_MARKET));
});

test('TEST 2 (orquestador) -- mismo texto pero especificacion tecnica distinta: 2 busquedas reales, no comparten cache', async () => {
  const cache = createPriceSearchCache({ now: () => 1000 });
  const budget = createPriceSearchBudget({ maxSearches: 100 });
  let searchCalls = 0;
  const searchFn = async () => { searchCalls++; return altoSearchResult(); };

  await resolveResourcePrice({ resource: { description: 'Disco diamantado', unit: 'pza', technicalSpecification: '4.5 pulgadas, amoladora' }, cache, budget, searchFn });
  await resolveResourcePrice({ resource: { description: 'Disco diamantado', unit: 'pza', technicalSpecification: '14 pulgadas, sierra de piso' }, cache, budget, searchFn });

  assert.equal(searchCalls, 2, 'especificaciones tecnicas distintas nunca deben compartir cache (caso CLAVE 45)');
});

test('TEST 14 (orquestador completo) -- MAX_PRICE_SEARCHES_PER_BATCH alcanzado: no mas llamadas, PRICE_SEARCH_DEFERRED, el batch continua', async () => {
  const cache = createPriceSearchCache({ now: () => 1000 });
  const budget = createPriceSearchBudget({ maxSearches: 2 });
  let searchCalls = 0;
  const searchFn = async () => { searchCalls++; return altoSearchResult(); };

  const recursos = ['Material A', 'Material B', 'Material C', 'Material D'];
  const results = [];
  for(const description of recursos){
    results.push(await resolveResourcePrice({ resource: { description, unit: 'pza' }, cache, budget, searchFn }));
  }

  assert.equal(searchCalls, 2, 'no debe exceder MAX_PRICE_SEARCHES_PER_BATCH');
  assert.equal(results.filter(r => r.deferred).length, 2, 'los recursos restantes deben quedar diferidos, no fallar');
  results.filter(r => r.deferred).forEach(r => assert.equal(r.status, PRICE_SEARCH_DEFERRED));
  // El batch termino de procesar los 4 recursos sin lanzar ninguna excepcion:
  assert.equal(results.length, 4, 'el procesamiento del batch debe continuar hasta el final, nunca abortar');
});

test('sin evidencia de mercado -> AI_ESTIMATE_UNVERIFIED y origen calculado correctamente', async () => {
  const cache = createPriceSearchCache({ now: () => 1000 });
  const budget = createPriceSearchBudget();
  const searchFn = async () => sinEvidenciaSearchResult();
  const result = await resolveResourcePrice({
    resource: { description: 'Valvula check de acero de 6 pulgadas, clase 150', unit: 'pza', currentPrice: 3200 },
    concept: 'Suministro de valvula check de acero de 6 pulgadas', cache, budget, searchFn
  });
  assert.equal(result.priceStatus, PRICE_STATUS.AI_ESTIMATE_UNVERIFIED);
  assert.equal(result.origin, MATERIAL_ORIGIN.EXPLICIT);
});

test('recurso especializado marcado sin precio publico -> QUOTATION_REQUIRED', async () => {
  const cache = createPriceSearchCache({ now: () => 1000 });
  const budget = createPriceSearchBudget();
  const searchFn = async () => sinEvidenciaSearchResult();
  const result = await resolveResourcePrice({
    resource: { description: 'Turbina especializada a medida', unit: 'pza', currentPrice: 450000, specializedNoPublicPrice: true },
    cache, budget, searchFn
  });
  assert.equal(result.priceStatus, PRICE_STATUS.QUOTATION_REQUIRED);
});

test('normalizacion determinista se adjunta al resultado cuando el recurso trae presentacion comercial', async () => {
  const cache = createPriceSearchCache({ now: () => 1000 });
  const budget = createPriceSearchBudget();
  const searchFn = async () => altoSearchResult();
  const result = await resolveResourcePrice({
    resource: { description: 'Tubo de acero', unit: 'm', presentation: { presentationPrice: 600, presentationQty: 6, presentationUnit: 'm' } },
    cache, budget, searchFn
  });
  assert.equal(result.normalization.normalizationRequired, false);
  assert.equal(result.normalization.pricePerUnit, 100);
});

/* ======================================================================
   COMPATIBILIDAD CON INTELLIGENCE (regla 11) -- runApuChallenge, runBidRisk,
   runApuConfidence y runApuAudit son los motores REALES, SIN MODIFICAR.
   Estas pruebas demuestran que mapear PRICE_STATUS -> fuente.estado
   (priceStatusToLegacyState) es suficiente para que esos motores existentes
   reaccionen correctamente, sin necesidad de tocarlos.
   ====================================================================== */

function apuFixture(overrides = {}){
  return {
    concept: 'Suministro e instalacion de tuberia de acero', unit: 'm', cantidadObra: 12,
    primaryActivity: 'tuberia',
    materials: [], labor: [], equipment: [], consumables: [], seguridad: [],
    factores: {}, ...overrides
  };
}

test('AI_ESTIMATE_UNVERIFIED -> Challenge genera un finding categoria "precio" (sin respaldo de mercado)', () => {
  const legacyEstado = priceStatusToLegacyState(PRICE_STATUS.AI_ESTIMATE_UNVERIFIED);
  const apu = apuFixture({
    materials: [{ descripcion: 'Valvula check de acero de 6 pulgadas', consumo: 1, unidad: 'pza', precioUnitario: 3200, fuente: { estado: legacyEstado }, priceRecord: { references: [] } }]
  });
  const { challenges } = runApuChallenge(apu);
  const priceFinding = challenges.find(c => c.category === 'precio');
  assert.ok(priceFinding, 'debe existir un finding de precio sin evidencia');
  assert.ok(priceFinding.unitImpact > 0);
});

test('VERIFIED_MARKET (referencia ALTO) -> Challenge NO cuestiona el precio', () => {
  const legacyEstado = priceStatusToLegacyState(PRICE_STATUS.VERIFIED_MARKET);
  const apu = apuFixture({
    materials: [{ descripcion: 'Cemento CPC 30R', consumo: 1, unidad: 'saco', precioUnitario: 250, fuente: { estado: legacyEstado }, priceRecord: { references: [{ match: { verdict: 'ALTO' } }] } }]
  });
  const { challenges } = runApuChallenge(apu);
  assert.equal(challenges.filter(c => c.category === 'precio').length, 0, 'un precio con referencia ALTO no debe generar un challenge de precio');
});

test('QUOTATION_REQUIRED en material critico -> se traduce a Bid Risk (PRICE_WITHOUT_EVIDENCE)', () => {
  const legacyEstado = priceStatusToLegacyState(PRICE_STATUS.QUOTATION_REQUIRED);
  const apu = apuFixture({
    materials: [{ descripcion: 'Valvula check especializada clase 150', consumo: 1, unidad: 'pza', precioUnitario: 3200, fuente: { estado: legacyEstado }, priceRecord: { references: [] } }]
  });
  const { findings } = runBidRisk(apu);
  const priceRisk = findings.find(f => f.category === BID_RISK_CATEGORY.PRICE_WITHOUT_EVIDENCE);
  assert.ok(priceRisk, 'QUOTATION_REQUIRED debe verse reflejado como riesgo de licitacion por precio sin evidencia');
});

test('NO_PRICE -> auditNoPriceFindings produce un finding de Auditor (aditivo, sin tocar apuAuditor.js)', () => {
  const rows = [{ kind: 'materials', index: 0, description: 'Bridas de acero', priceStatus: PRICE_STATUS.NO_PRICE }];
  const findings = auditNoPriceFindings(rows);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'no_price');
  assert.equal(findings[0].severity, 'HIGH');
});

test('AI_ESTIMATE_UNVERIFIED reduce la dimension "precios/evidencia" de Confidence frente a VERIFIED_MARKET', () => {
  const unverifiedApu = apuFixture({
    labor: [{ descripcion: 'Tubero / plomero (oficial)', cuadrilla: 1, rendimiento: 5, salarioBase: 400, fsr: 1.85 }],
    materials: [{ descripcion: 'Valvula check de acero de 6 pulgadas', consumo: 1, unidad: 'pza', precioUnitario: 3200, fuente: { estado: priceStatusToLegacyState(PRICE_STATUS.AI_ESTIMATE_UNVERIFIED) }, priceRecord: { references: [] } }]
  });
  const verifiedApu = apuFixture({
    labor: [{ descripcion: 'Tubero / plomero (oficial)', cuadrilla: 1, rendimiento: 5, salarioBase: 400, fsr: 1.85 }],
    materials: [{ descripcion: 'Valvula check de acero de 6 pulgadas', consumo: 1, unidad: 'pza', precioUnitario: 3200, fuente: { estado: priceStatusToLegacyState(PRICE_STATUS.VERIFIED_MARKET) }, priceRecord: { references: [{ match: { verdict: 'ALTO' } }] } }]
  });

  const unverifiedConfidence = runApuConfidence(unverifiedApu);
  const verifiedConfidence = runApuConfidence(verifiedApu);
  const evidenceScore = c => c.dimensions.evidenciaMercado?.score ?? c.dimensions.evidence?.score ?? null;

  assert.ok(evidenceScore(unverifiedConfidence) != null && evidenceScore(verifiedConfidence) != null, 'ambas corridas deben producir un score de evidencia de mercado');
  assert.ok(evidenceScore(unverifiedConfidence) < evidenceScore(verifiedConfidence), 'AI_ESTIMATE_UNVERIFIED debe penalizar la dimension de evidencia frente a VERIFIED_MARKET');
});

test('runApuAudit real sigue funcionando sin cambios sobre un APU enriquecido con los nuevos campos (aditivos, nunca rompen el esquema)', () => {
  const apu = apuFixture({
    labor: [{ descripcion: 'Tubero / plomero (oficial)', cuadrilla: 1, rendimiento: 5, salarioBase: 400, fsr: 1.85 }],
    materials: [{
      descripcion: 'Cemento CPC 30R', consumo: 1, unidad: 'saco', precioUnitario: 250,
      fuente: { estado: priceStatusToLegacyState(PRICE_STATUS.VERIFIED_MARKET) },
      priceRecord: { references: [{ match: { verdict: 'ALTO' } }] },
      origin: MATERIAL_ORIGIN.EXPLICIT, priceStatus: PRICE_STATUS.VERIFIED_MARKET
    }]
  });
  const audit = runApuAudit(apu);
  assert.ok(Array.isArray(audit.findings), 'runApuAudit debe seguir devolviendo su forma normal sin modificacion alguna');
});
