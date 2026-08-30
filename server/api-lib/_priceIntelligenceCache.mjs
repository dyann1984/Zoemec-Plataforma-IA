/* Material & Price Intelligence 2.1 -- CACHE PERSISTENTE, correctamente
   server-side (correccion de arquitectura: el cache autoritativo NUNCA
   puede vivir en el navegador, ver VERCEL_HOBBY_COMPAT.md-style rationale
   abajo). Este archivo es el UNICO lugar que conecta:
     - src/domain/priceSearchCache.js (fingerprint SHA-256 + TTL, dominio
       puro, el MISMO modulo que usa el cliente para su cache L1 -- no se
       duplica el hashing ni el TTL en ningun lado)
     - server/api-lib/_priceCacheFirestoreStore.mjs (Firestore Admin, ya
       existia, estaba sin usar -- ahora conectado de verdad)
     - server/api-lib/_priceIntelligenceCore.mjs#searchMarketReferences
       (motor de busqueda real, EXACTAMENTE el mismo, cero cambios, cero
       duplicacion)

   Por que server-side: main.jsx corre en el navegador; firebase-admin
   (Firestore Admin SDK, credenciales de servicio) NUNCA debe estar en el
   bundle del cliente. El cliente solo habla con /api/price-intelligence
   por HTTP; el cache autoritativo, compartido entre TODOS los usuarios y
   sesiones, vive aqui, protegido detras de requireFeature('ai') igual que
   siempre.

   Presupuesto (regla "budget/policy" del flujo pedido): un contador diario
   real en Firestore (FieldValue.increment, atomico de verdad entre
   invocaciones serverless concurrentes -- a diferencia de un Map en
   memoria, un incremento atomico de Firestore SI es correcto entre
   procesos distintos) limita cuantas busquedas REALES a OpenAI se permiten
   por dia, independientemente de cuantos clientes/lotes esten corriendo a
   la vez. Un cache hit NUNCA consume este presupuesto.

   Cache stampede (regla "concurrencia server-side" del spec): Vercel
   serverless no comparte memoria entre invocaciones -- un Map/lock en
   memoria de ESTE archivo NO protege contra dos invocaciones concurrentes
   en procesos distintos buscando el MISMO recurso al mismo tiempo. Esto se
   documenta explicitamente, no se finge resuelto: la mitigacion real
   implementada es (1) el presupuesto diario atomico de Firestore arriba
   (limite duro, sin importar duplicados), (2) TTL de 7 dias -- una vez que
   CUALQUIER invocacion puebla el cache para un fingerprint, todas las
   siguientes (de cualquier cliente, cualquier invocacion) son CACHE_HIT
   real durante 7 dias. El peor caso NO mitigado es: N invocaciones
   concurrentes buscando el MISMO recurso nunca antes cacheado, en la
   MISMA ventana de tiempo (antes de que la primera termine de guardar) --
   ahi puede haber hasta N busquedas duplicadas reales, acotadas por la
   concurrencia del cliente (4, ver mapWithConcurrency en main.jsx), nunca
   ilimitadas. */
import { getAdminDb, FieldValue } from './_firebaseAdmin.mjs';
import { createFirestorePriceCacheStore } from './_priceCacheFirestoreStore.mjs';
import { createPriceSearchCache, CACHE_RESULT, PRICE_CACHE_TTL_MS } from '../../src/domain/priceSearchCache.js';
import { searchMarketReferences } from './_priceIntelligenceCore.mjs';
import { derivePriceStatus } from '../../src/domain/priceStatus.js';
import { computePriceConfidence } from '../../src/domain/priceConfidence.js';

const USAGE_COLLECTION = 'priceIntelligenceUsage';
const DEFAULT_MAX_DAILY_SEARCHES = Number(process.env.PRICE_INTELLIGENCE_MAX_DAILY_SEARCHES) || 200;

function todayKey(){ return new Date().toISOString().slice(0, 10); }

/* claimDailySearchBudget: incremento atomico real (regla "budget/policy"
   server-side). Firestore garantiza que dos invocaciones concurrentes
   incrementando el MISMO documento nunca pierden un incremento (a
   diferencia de "leer, sumar 1, escribir" sin transaccion, que si puede
   perder incrementos bajo concurrencia real) -- por eso se usa
   FieldValue.increment dentro de una transaccion que primero lee el valor
   para decidir si ya se alcanzo el limite. */
async function claimDailySearchBudget(db, maxDailySearches){
  const ref = db.collection(USAGE_COLLECTION).doc(todayKey());
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const used = snap.exists ? Number(snap.data().used) || 0 : 0;
    if(used >= maxDailySearches) return { allowed: false, used };
    tx.set(ref, { used: FieldValue.increment(1), updatedAt: Date.now() }, { merge: true });
    return { allowed: true, used: used + 1 };
  });
}

/* searchMarketReferencesWithCache: reemplaza, en api/price-intelligence.mjs,
   la llamada directa a searchMarketReferences -- MISMO contrato de entrada/
   salida ({fichaTecnica, referencias, estadisticas, precioRecomendado,
   nivelEvidencia}), mas los campos nuevos pedidos explicitamente
   (cacheStatus, webSearchPerformed, queryHash, searchedAt, expiresAt).
   `searchImpl` es inyectable SOLO para pruebas (por defecto es la funcion
   real, sin mock) -- asi las pruebas contra el emulador de Firestore nunca
   llaman a OpenAI de verdad. */
export const CACHE_WRITE_STATUS = Object.freeze({
  PERSISTED: 'PERSISTED',
  FAILED: 'FAILED',
  NOT_APPLICABLE: 'NOT_APPLICABLE'
});

/* logCacheWriteFailure: unico punto donde un fallo de escritura del cache
   persistente se hace VISIBLE (hotfix 2.1.1 -- regla 1: "cache save no
   puede fallar silenciosamente"). Antes de este hotfix, cache.save()
   atrapaba el error y searchMarketReferencesWithCache lo ignoraba por
   completo: el bug del live test (queryHash ya buscado que volvio a
   consumir OpenAI) nunca aparecio en ningun log porque nada lo registraba.
   Solo campos seguros: queryHash (identidad tecnica publica del insumo,
   nunca projectId/clientName/userEmail/cantidades), codigo/mensaje de
   error, operacion y timestamp -- NUNCA credenciales ni el service
   account. */
function logCacheWriteFailure({ queryHash, operation, errorCode, error }){
  console.error('[PriceIntelligenceCache] cache write failed', {
    queryHash: queryHash || null,
    operation,
    errorCode: errorCode || null,
    error: error || 'unknown',
    timestamp: new Date().toISOString()
  });
}

export async function searchMarketReferencesWithCache({
  description, unit, kind = 'materials', location = '', dateBase = '', categoriaLaboral = '',
  technicalSpecification = '', region = '', currency = 'MXN', tenantScope = null,
  maxDailySearches = DEFAULT_MAX_DAILY_SEARCHES, searchImpl = searchMarketReferences, db = null, store = null
} = {}){
  const database = db || getAdminDb();
  // `store` inyectable (pruebas): permite forzar un store roto sin tener
  // que romper el emulador real de Firestore -- ver TEST G (degradacion
  // segura ante fallo de Firestore). El presupuesto diario sigue usando
  // `database` real incluso cuando `store` esta forzado, para poder probar
  // el fallo del CACHE de forma aislada del presupuesto.
  const cache = createPriceSearchCache({ store: store || createFirestorePriceCacheStore(database), defaultTtlMs: PRICE_CACHE_TTL_MS.NORMAL });
  const fingerprintInput = { normalizedDescription: description, technicalSpecification, unit, region: region || location, currency, tenantScope };

  const lookup = await cache.lookup(fingerprintInput);
  if(lookup.result === CACHE_RESULT.HIT){
    const entry = lookup.entry;
    return {
      fichaTecnica: entry.technicalMatch, referencias: entry.references,
      precioRecomendado: entry.selectedReference?.precioNormalizado ?? null,
      nivelEvidencia: entry.priceStatus === 'VERIFIED_MARKET' ? 'MERCADO' : entry.priceStatus === 'MARKET_REFERENCE' ? 'REFERENCIAL' : 'ESTIMADO_IA',
      cacheStatus: CACHE_RESULT.HIT, webSearchPerformed: false, cacheWriteStatus: CACHE_WRITE_STATUS.NOT_APPLICABLE,
      queryHash: lookup.queryHash, searchedAt: entry.searchedAt, expiresAt: entry.expiresAt
    };
  }

  const cacheStatus = lookup.result === CACHE_RESULT.EXPIRED ? CACHE_RESULT.EXPIRED : CACHE_RESULT.MISS;
  const budget = await claimDailySearchBudget(database, maxDailySearches);
  if(!budget.allowed){
    // Presupuesto diario agotado (regla 9/13 del hardening): NUNCA se
    // inventa un precio -- se devuelve sin referencias, exactamente igual
    // que "sin evidencia", con webSearchPerformed:false para que el
    // cliente lo cuente correctamente (no como una busqueda real).
    return {
      fichaTecnica: {}, referencias: [], precioRecomendado: null, nivelEvidencia: 'ESTIMADO_IA',
      cacheStatus, webSearchPerformed: false, cacheWriteStatus: CACHE_WRITE_STATUS.NOT_APPLICABLE,
      deferred: true, reason: 'DAILY_SEARCH_BUDGET_EXHAUSTED',
      queryHash: lookup.queryHash
    };
  }

  const searchResult = await searchImpl({ description, unit, kind, location: region || location, dateBase, categoriaLaboral });
  const priceStatus = derivePriceStatus({ price: searchResult.precioRecomendado ?? 0, references: searchResult.referencias || [] });
  const confidence = computePriceConfidence({ references: searchResult.referencias || [] });
  const selectedReference = (searchResult.referencias || []).find(r => r?.match?.verdict === 'ALTO') || null;
  const entry = await cache.save(fingerprintInput, {
    references: searchResult.referencias || [], selectedReference, technicalMatch: searchResult.fichaTecnica || null,
    priceStatus, priceConfidence: confidence
  });

  // Hotfix 2.1.1 -- regla 1: la respuesta NUNCA finge persistencia. Si
  // entry.persisted es false (store.set() fallo O la verificacion
  // read-after-write no confirmo el documento), se registra server-side de
  // inmediato y el llamador (cliente) recibe cacheWriteStatus:FAILED en vez
  // de un queryHash silenciosamente huerfano.
  const cacheWriteStatus = entry.persisted ? CACHE_WRITE_STATUS.PERSISTED : CACHE_WRITE_STATUS.FAILED;
  if(!entry.persisted){
    logCacheWriteFailure({ queryHash: entry.queryHash, operation: 'cache.save', errorCode: entry.storeErrorCode, error: entry.storeError });
  }

  return {
    ...searchResult, cacheStatus, webSearchPerformed: true, cacheWriteStatus,
    queryHash: entry.queryHash, searchedAt: entry.searchedAt, expiresAt: entry.expiresAt
  };
}
