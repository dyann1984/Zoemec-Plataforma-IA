/* Material & Price Intelligence 2.1 -- orquestador + integracion final al
   flujo real. Une, sin reimplementar ninguno, los modulos de este hardening
   (materialOrigin, priceStatus, priceNormalization, priceConfidence,
   priceSearchCache, priceSearchBudget, priceTelemetry, inFlightRegistry) con
   el motor de equivalencia tecnica YA existente (src/lib/technicalMatch.js,
   via el resultado de searchFn) y el mismo contrato de resultado que ya
   produce server/api-lib/_priceIntelligenceCore.mjs#searchMarketReferences
   ({ fichaTecnica, referencias, estadisticas, precioRecomendado,
   nivelEvidencia }). `searchFn` es INYECTABLE: en pruebas es un mock puro
   (sin red, sin OpenAI); en produccion (ver src/domain/intelligence2Runtime.js)
   es un wrapper delgado alrededor de apiPost('/api/price-intelligence', ...),
   sin duplicar ni un renglon de esa logica.

   enrichApuWithIntelligence2() es el UNICO punto de entrada que usan tanto
   generateAI (individual) como generateBatchAPU (lote) en main.jsx -- regla
   11 del hardening: una sola politica de Material/Price Intelligence, nunca
   dos sistemas paralelos. */
import { classifyMaterialOrigin } from './materialOrigin.js';
import { derivePriceStatus, priceStatusToLegacyState, PRICE_STATUS } from './priceStatus.js';
import { normalizePresentationPrice } from './priceNormalization.js';
import { computePriceConfidence } from './priceConfidence.js';
import { CACHE_RESULT } from './priceSearchCache.js';
import { PRICE_SEARCH_DEFERRED, PRICE_SEARCH_SKIPPED_CATEGORY } from './priceSearchBudget.js';
import { resolveAuthoritativeInput } from './unitAuthority.js';

const RESOURCE_KINDS = Object.freeze(['materials', 'labor', 'equipment', 'seguridad']);
const PRICE_FIELD_BY_KIND = Object.freeze({ materials: 'precioUnitario', seguridad: 'precioUnitario', labor: 'salarioBase', equipment: 'tarifa' });

function priceDispersionPct(references){
  const alto = (Array.isArray(references) ? references : []).filter(r => r?.match?.verdict === 'ALTO' && Number(r.precioNormalizado) > 0);
  if(alto.length < 2) return null;
  const prices = alto.map(r => Number(r.precioNormalizado));
  const min = Math.min(...prices), max = Math.max(...prices);
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  if(!(median > 0)) return null;
  return (max - min) / median;
}

/* resolveResourcePrice: resuelve UN recurso contra cache + presupuesto +
   single-flight + busqueda inyectada. Nunca lanza -- incluso si el
   presupuesto se agoto (PRICE_SEARCH_DEFERRED), el store del cache fallo
   (degradacion segura, ver priceSearchCache.js), o la busqueda misma fallo
   (regla 12.K: "conservar estado auditable, no inventar precio" -- el
   recurso queda AI_ESTIMATE_UNVERIFIED con el error registrado, JAMAS con
   un precio inventado). */
export async function resolveResourcePrice({
  resource = {}, concept = '', cache, budget, telemetry = null, searchFn, ttlMsFor, inFlightRegistry = null
} = {}){
  if(!cache) throw new Error('resolveResourcePrice requiere un cache (ver createPriceSearchCache).');
  if(!budget) throw new Error('resolveResourcePrice requiere un budget (ver createPriceSearchBudget).');

  const origin = classifyMaterialOrigin({
    description: resource.description, concept,
    aiProposedOrigin: resource.aiProposedOrigin || null,
    technicallyRequired: Boolean(resource.technicallyRequired),
    optional: Boolean(resource.optional)
  });

  const fingerprintInput = {
    normalizedDescription: resource.description, technicalSpecification: resource.technicalSpecification || '',
    unit: resource.unit, region: resource.region || '', currency: resource.currency || 'MXN',
    tenantScope: resource.tenantSpecific && resource.organizationId ? { organizationId: resource.organizationId } : null
  };

  const cached = await cache.lookup(fingerprintInput);
  if(cached.result === CACHE_RESULT.HIT){
    telemetry?.recordUsage({ cacheHits: 1, resourcesAnalyzed: 1 });
    return { cacheResult: CACHE_RESULT.HIT, queryHash: cached.queryHash, origin, deferred: false, ...cached.entry };
  }
  if(cached.result === CACHE_RESULT.EXPIRED) telemetry?.recordUsage({ cacheExpired: 1, resourcesAnalyzed: 1 });
  else telemetry?.recordUsage({ cacheMisses: 1, resourcesAnalyzed: 1 });

  const runSearch = async () => {
    if(!budget.canSearch()){
      budget.recordDeferred(cached.queryHash);
      telemetry?.recordUsage({ searchesDeferred: 1 });
      return {
        cacheResult: cached.result, queryHash: cached.queryHash, origin, deferred: true, status: PRICE_SEARCH_DEFERRED,
        priceStatus: null, references: [], selectedReference: null, technicalMatch: null, normalization: null
      };
    }
    budget.recordSearch();

    let searchResult;
    let searchError = null;
    try{
      searchResult = await searchFn({
        description: resource.description, unit: resource.unit, kind: resource.kind || 'materials',
        region: resource.region || '', dateBase: resource.dateBase || '',
        technicalSpecification: resource.technicalSpecification || '',
        tenantScope: fingerprintInput.tenantScope
      });
    }catch(err){
      // Regla 12.K: la busqueda fallo (red/OpenAI caido) -- se conserva
      // AI_ESTIMATE_UNVERIFIED (nunca se inventa un precio ni una
      // referencia) y el error queda visible para auditoria, nunca oculto.
      searchError = err?.message || String(err);
      searchResult = { fichaTecnica: null, referencias: [], precioRecomendado: null, nivelEvidencia: 'ESTIMADO_IA' };
    }
    // El servidor (server/api-lib/_priceIntelligenceCache.mjs) es quien
    // sabe de verdad si hubo una llamada real a OpenAI o si respondio desde
    // su propio cache de Firestore -- webSearchPerformed:false (cache hit
    // SERVIDOR, autoritativo) nunca debe contarse como webSearchCalls, ni
    // siquiera cuando el cliente tuvo que llamar a searchFn por tener su
    // propio cache L1 en MISS. searchResult.webSearchPerformed ausente
    // (mocks de prueba que no lo declaran) se trata como true, por
    // compatibilidad hacia atras.
    if(searchResult?.webSearchPerformed === false) telemetry?.recordUsage({ serverCacheHits: 1 });
    else telemetry?.recordUsage({ webSearchCalls: 1, ...(searchResult?.usage || {}) });

    const references = Array.isArray(searchResult?.referencias) ? searchResult.referencias : [];
    const requiresQuotation = Boolean(resource.specializedNoPublicPrice) && !references.some(r => r?.match?.verdict === 'ALTO');
    const priceStatus = derivePriceStatus({
      estado: resource.estado || null,
      price: searchResult?.precioRecomendado ?? resource.currentPrice ?? 0,
      references, requiresQuotation
    });

    const normalization = resource.presentation
      ? normalizePresentationPrice({ ...resource.presentation, targetUnit: resource.unit })
      : null;

    const confidence = computePriceConfidence({
      references, recencyDays: resource.recencyDays ?? null, dispersionPct: priceDispersionPct(references)
    });

    const selectedReference = references.find(r => r?.match?.verdict === 'ALTO') || null;
    const entry = await cache.save(fingerprintInput, {
      references, selectedReference, technicalMatch: searchResult?.fichaTecnica || null,
      normalization, priceStatus, priceConfidence: confidence,
      precioRecomendado: searchResult?.precioRecomendado ?? null, searchError
    }, { ttlMs: ttlMsFor ? ttlMsFor(resource) : undefined });

    return { cacheResult: cached.result, queryHash: cached.queryHash, origin, deferred: false, ...entry };
  };

  // Single-flight (regla 8): si otro recurso identico ya disparo la MISMA
  // busqueda y sigue pendiente, se reutiliza esa promesa en vez de llamar a
  // searchFn otra vez -- sin esto, N recursos identicos concurrentes verian
  // N CACHE_MISS simultaneos.
  if(inFlightRegistry){
    let reused = true;
    const result = await inFlightRegistry.getOrCreate(cached.queryHash, () => { reused = false; return runSearch(); });
    telemetry?.recordUsage({ inFlightDeduplications: reused ? 1 : 0 });
    return { ...result, origin };
  }
  return runSearch();
}

/* auditNoPriceFindings: hallazgos ADITIVOS con la MISMA forma que produce
   runApuAudit (apuAuditor.js) para renglones en PRICE_STATUS.NO_PRICE. NO
   modifica apuAuditor.js/apuProfessional.js. */
export function auditNoPriceFindings(rows = []){
  return rows
    .filter(r => r.priceStatus === PRICE_STATUS.NO_PRICE)
    .map((r, index) => ({
      id: `price-intel2:no_price:${r.kind || 'resource'}:${index}`,
      severity: 'HIGH', category: r.kind || 'materials', code: 'no_price',
      message: `${r.description || r.clave || 'Recurso'} no tiene un precio utilizable ($0 o invalido).`,
      evidence: r.kind ? `${r.kind}${r.index != null ? ` #${r.index + 1}` : ''}` : null,
      kind: r.kind ?? null, index: r.index ?? null, field: null,
      recommendation: 'Capturar un precio real o marcar el recurso como QUOTATION_REQUIRED antes de aprobar el APU.',
      status: 'OPEN'
    }));
}

/* attachIntelligence2FieldsToRow: escribe los campos NUEVOS (aditivos) en un
   renglon del APU v2, SIN tocar ningun campo que apuCalc/apuChallenge/
   apuAuditor ya lean (descripcion/consumo/unidad/precioUnitario/fuente
   siguen exactamente igual). Ver esquema en apuSchema.js#INTELLIGENCE2_ROW_FIELDS. */
function attachIntelligence2FieldsToRow(row, resolved){
  row.materialOrigin = resolved.origin;
  row.priceStatus = resolved.priceStatus ?? null;
  row.priceConfidence = resolved.priceConfidence?.level ?? null;
  row.confidenceReasons = resolved.priceConfidence?.reasons ?? [];
  row.queryHash = resolved.queryHash ?? null;
  row.searchedAt = resolved.searchedAt ?? null;
  row.expiresAt = resolved.expiresAt ?? null;
  row.normalization = resolved.normalization ?? null;
  row.priceSearchStatus = resolved.skippedCategory ? PRICE_SEARCH_SKIPPED_CATEGORY
    : resolved.deferred ? PRICE_SEARCH_DEFERRED
    : (resolved.cacheResult || null);
  if(resolved.normalization?.normalizationRequired) row.normalizationStatus = 'NORMALIZATION_REQUIRED';
  row.priceRecord = {
    ...(row.priceRecord || {}),
    references: resolved.references || [],
    selectedReference: resolved.selectedReference ?? null,
    technicalMatch: resolved.technicalMatch ?? null,
    evidenceLevel: row.priceRecord?.evidenceLevel ?? null
  };
  // Compatibilidad (regla 3 del hardening original): el motor existente
  // (apuChallenge.js/bidRisk.js/apuConfidence.js) sigue leyendo fuente.estado
  // exactamente igual que siempre -- solo se le da un valor derivado del
  // nuevo PRICE_STATUS, nunca se le pide que entienda el vocabulario nuevo.
  if(resolved.priceStatus){
    row.fuente = { ...(row.fuente || {}), estado: priceStatusToLegacyState(resolved.priceStatus) };
  }
  return row;
}

/* enrichApuWithIntelligence2: flujo real completo pedido en la integracion
   final --
     (ya ejecutado por el llamador) generateAPUv2
     -> proteccion authoritative user input (unitAuthority.js)
     -> clasificacion Material Origin (materialOrigin.js, por recurso)
     -> deduplicacion/fingerprint + cache lookup (priceSearchCache.js)
     -> budget check (priceSearchBudget.js)
     -> busqueda Price Intelligence existente SOLO en CACHE_MISS/EXPIRED
        (searchFn inyectado, mismo contrato que /api/price-intelligence)
     -> normalizacion determinista (priceNormalization.js)
     -> Price Status (priceStatus.js)
     -> Price Confidence (priceConfidence.js)
     -> provenance (attachIntelligence2FieldsToRow)
   (el llamador continua con finalizeProfessionalAPU y los motores
   Intelligence existentes, sin cambios).

   `resourceTypes` (hotfix 2.1.1 -- regla 7, "control de categorias de
   busqueda"): array opcional de kinds ('materials'|'labor'|'equipment'|
   'seguridad') habilitados para busqueda real de precio. `null`/ausente
   preserva el comportamiento productivo actual (las 4 categorias, igual
   que siempre) -- SOLO cuando el llamador lo declara explicitamente (ver
   INTELLIGENCE2_CONFIG.priceSearchResourceTypes en intelligence2Runtime.js,
   pensado para pruebas controladas, ej. solo 'materials') se restringe.
   Un kind fuera de resourceTypes NUNCA llama a cache/budget/searchFn --
   cero costo, cero red -- pero SI se sigue clasificando su Material Origin
   (calculo puro, local, sin costo) para que el reporte siga siendo util. */
export async function enrichApuWithIntelligence2({
  aiApu, userInput = {}, concept = '', cache, budget, telemetry = null, inFlightRegistry = null, searchFn, ttlMsFor, resourceTypes = null
} = {}){
  const { resolved, unitWarning, overriddenFields } = resolveAuthoritativeInput({ userInput, aiProposed: aiApu });
  const apu = { ...aiApu, concept: resolved.concept ?? aiApu.concept, unit: resolved.unit ?? aiApu.unit };
  if(resolved.qty != null) apu.cantidadObra = resolved.qty;
  if(resolved.clave != null) apu.clave = resolved.clave;
  apu.unitWarning = unitWarning;
  apu.userInputOverrides = overriddenFields;

  let deferredCount = 0;
  for(const kind of RESOURCE_KINDS){
    const kindEnabled = !Array.isArray(resourceTypes) || resourceTypes.includes(kind);
    const rows = Array.isArray(apu[kind]) ? apu[kind] : [];
    for(const row of rows){
      if(!kindEnabled){
        const origin = classifyMaterialOrigin({
          description: row.descripcion, concept: resolved.concept ?? concept,
          aiProposedOrigin: row.materialOrigin || null,
          technicallyRequired: Boolean(row.technicallyRequired),
          optional: Boolean(row.optional)
        });
        attachIntelligence2FieldsToRow(row, { origin, skippedCategory: true, deferred: false, cacheResult: null });
        continue;
      }
      const priceField = PRICE_FIELD_BY_KIND[kind];
      const resolvedResource = await resolveResourcePrice({
        resource: {
          description: row.descripcion, unit: row.unidad, kind,
          currentPrice: Number(row[priceField]) || 0,
          estado: row.fuente?.estado || null,
          aiProposedOrigin: row.materialOrigin || null,
          technicallyRequired: Boolean(row.technicallyRequired),
          optional: Boolean(row.optional),
          specializedNoPublicPrice: Boolean(row.specializedNoPublicPrice)
        },
        concept: resolved.concept ?? concept, cache, budget, telemetry, searchFn, ttlMsFor, inFlightRegistry
      });
      attachIntelligence2FieldsToRow(row, resolvedResource);
      if(resolvedResource.deferred) deferredCount++;
    }
  }

  return { apu, unitWarning, deferredCount };
}
