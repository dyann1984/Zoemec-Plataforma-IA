/* Material & Price Intelligence 2.1 -- regla 4/5/6/7 (integracion final):
   cache determinista de Price Intelligence. Modulo puro: NO llama a OpenAI,
   NO conoce fetch/red, NO importa Firebase (regla explicita: "no acoplar el
   dominio directamente a Firebase") -- solo fingerprint + almacenamiento +
   TTL. El store es INYECTABLE (interfaz async get/set/delete) para que la
   implementacion por defecto sea en memoria (pruebas, single-flight de una
   sesion) y una implementacion persistente (Firestore, ver
   server/api-lib/_priceCacheFirestoreStore.mjs) cumpla la MISMA interfaz sin
   tocar este archivo.

   Fingerprint: SHA-256 real (Web Crypto, igual criterio que
   src/domain/snapshotHash.js#computeSnapshotHash -- se reutiliza esa misma
   funcion, no se duplica hashing) en vez del FNV-1a de 32 bits de la version
   anterior: evidencia economica de mercado no debe depender de un hash corto
   con riesgo de colision innecesario.

   Aislamiento tenant (regla 5): el fingerprint NUNCA debe incluir
   projectId/clientName/userEmail/presupuesto/cantidades privadas -- eso
   volveria el cache (potencialmente global, entre proyectos/organizaciones)
   en una fuga de datos privados. ASSERT_FORBIDDEN_KEYS es una lista negra
   explicita que revienta en desarrollo si alguien intenta meter un campo
   prohibido en el fingerprint por error. Cuando un recurso SI es
   tenant-specific (ej. una clave interna de catalogo unica de un cliente),
   el llamador debe pasar tenantScope:{organizationId} explicitamente -- eso
   participa en el hash SOLO en ese caso, nunca por defecto. */
import { computeSnapshotHash } from './snapshotHash.js';

export const CACHE_RESULT = Object.freeze({ HIT: 'CACHE_HIT', MISS: 'CACHE_MISS', EXPIRED: 'CACHE_EXPIRED' });

/* TTL configurables (regla 5 del hardening 2.1): objeto exportado, no
   constantes atadas al codigo. */
export const PRICE_CACHE_TTL_MS = {
  NORMAL: 7 * 24 * 60 * 60 * 1000,   // material comercial normal: 7 dias
  VOLATILE: 24 * 60 * 60 * 1000      // material de alta volatilidad: 24 horas
};

const FORBIDDEN_FINGERPRINT_KEYS = Object.freeze([
  'projectId', 'clientName', 'client', 'userEmail', 'email', 'ownerUid', 'uid',
  'budget', 'presupuesto', 'cantidadObra', 'quantity', 'cantidad', 'concept', 'concepto'
]);

function text(value){ return String(value ?? '').trim(); }
function normalizeForFingerprint(value){ return text(value).toLowerCase().normalize('NFKC').replace(/\s+/g, ' '); }

/* assertCacheKeySafe: red de seguridad en desarrollo -- si alguien pasa un
   objeto con una clave de la lista negra directamente al fingerprint, esto
   lanza de inmediato en vez de dejar que el dato privado se hashee y quede
   implicitamente en un queryHash potencialmente compartido. Las funciones de
   este archivo SOLO leen los 5-6 campos declarados explicitamente, nunca
   iteran claves libres del input -- esta funcion es una capa adicional de
   defensa, no la unica. */
export function assertCacheKeySafe(fingerprintInput = {}){
  const present = FORBIDDEN_FINGERPRINT_KEYS.filter(k => fingerprintInput[k] !== undefined);
  if(present.length){
    throw new Error(`Fingerprint de Price Intelligence intento incluir campo(s) prohibido(s) (dato privado/tenant): ${present.join(', ')}. El cache de mercado nunca debe incluir identidad de proyecto/cliente/usuario/cantidades privadas.`);
  }
}

/* buildQueryFingerprint: fingerprint estable a partir de normalizedDescription
   + technicalSpecification + unit + region + currency (regla 4) -- estos 5
   campos son SIEMPRE seguros para compartir globalmente (identidad tecnica
   publica de un insumo, nunca datos de proyecto/cliente). tenantScope es
   OPCIONAL: solo se incluye cuando el llamador declara explicitamente que
   este recurso es tenant-specific (regla 5), aislando ese fingerprint por
   organizationId sin afectar el resto del cache global. */
export async function buildQueryFingerprint({ normalizedDescription = '', technicalSpecification = '', unit = '', region = '', currency = 'MXN', tenantScope = null } = {}){
  const canonical = {
    d: normalizeForFingerprint(normalizedDescription),
    s: normalizeForFingerprint(technicalSpecification),
    u: normalizeForFingerprint(unit),
    r: normalizeForFingerprint(region),
    c: normalizeForFingerprint(currency),
    // organizationId SOLO participa si el llamador declaro tenantScope --
    // ausente (undefined) para el 99% de los casos (evidencia de mercado
    // publica, compartible entre organizaciones).
    org: tenantScope?.organizationId ? normalizeForFingerprint(tenantScope.organizationId) : undefined
  };
  const hash = await computeSnapshotHash(canonical);
  return `pq_${hash}`;
}

/* Store en memoria (referencia por defecto, y unico store recomendado para
   pruebas/local -- regla 4). get/set/delete son "async-compatibles": pueden
   devolver el valor directo (await lo resuelve igual) o una Promise real,
   para que un store persistente (Firestore) cumpla la misma firma. */
export function createInMemoryPriceCacheStore(){
  const map = new Map();
  return {
    get: key => map.get(key),
    set: (key, entry) => { map.set(key, entry); },
    delete: key => { map.delete(key); },
    keys: () => map.keys(),
    size: () => map.size
  };
}

/* createPriceSearchCache: fabrica del cache real. `now` es inyectable para
   pruebas deterministas de expiracion. Si `store.get/set/delete` fallan (ej.
   Firestore caido), lookup() y save() NUNCA lanzan hacia el llamador -- se
   degradan a CACHE_MISS / guardado no confirmado, con el error disponible en
   el resultado (regla 12.J: "fallo del cache persistente -> degradacion
   segura, no perder APU"). Quien orquesta arriba (materialPriceIntelligence2.js)
   simplemente hace la busqueda real como si no hubiera cache. */
export function createPriceSearchCache({ store = createInMemoryPriceCacheStore(), now = () => Date.now(), defaultTtlMs = PRICE_CACHE_TTL_MS.NORMAL } = {}){
  async function lookup(fingerprintInput){
    assertCacheKeySafe(fingerprintInput);
    const queryHash = await buildQueryFingerprint(fingerprintInput);
    let entry;
    try{ entry = await store.get(queryHash); }
    catch(err){ return { result: CACHE_RESULT.MISS, queryHash, entry: null, storeError: err?.message || String(err) }; }
    if(!entry) return { result: CACHE_RESULT.MISS, queryHash, entry: null };
    if(entry.expiresAt <= now()) return { result: CACHE_RESULT.EXPIRED, queryHash, entry };
    return { result: CACHE_RESULT.HIT, queryHash, entry };
  }

  /* save: registra un resultado real de busqueda contra el fingerprint.
     Guarda exactamente los campos pedidos: queryHash, searchedAt, expiresAt,
     sourceCount, references, selectedReference, technicalMatch,
     normalization, priceStatus, priceConfidence -- ademas de lo que el
     llamador adjunte (category/volatilityClass, etc.).

     Hotfix 2.1.1 (regla 4 del hotfix -- read-after-write): un `store.set()`
     que no lanza NO es prueba suficiente de que el documento quedo
     realmente disponible (ver caso real del live test: un cache write se
     perdio sin que store.set() lanzara ningun error observado). Por eso,
     tras un set() exitoso, se hace SIEMPRE una lectura inmediata de
     verificacion -- solo en el camino de escritura (nunca en cada lookup/
     cache hit, eso si tendria costo en cada peticion). Solo si esa lectura
     confirma el mismo queryHash, persisted:true es una garantia real, no
     una suposicion. */
  async function save(fingerprintInput, resultData = {}, { ttlMs = defaultTtlMs } = {}){
    assertCacheKeySafe(fingerprintInput);
    const queryHash = await buildQueryFingerprint(fingerprintInput);
    const searchedAt = now();
    const entry = {
      queryHash,
      searchedAt,
      expiresAt: searchedAt + Math.max(0, Number(ttlMs) || 0),
      sourceCount: Array.isArray(resultData.references) ? resultData.references.length : 0,
      references: Array.isArray(resultData.references) ? resultData.references : [],
      selectedReference: resultData.selectedReference ?? null,
      technicalMatch: resultData.technicalMatch ?? null,
      normalization: resultData.normalization ?? null,
      priceStatus: resultData.priceStatus ?? null,
      priceConfidence: resultData.priceConfidence ?? null,
      ...resultData
    };
    try{
      await store.set(queryHash, entry);
    }catch(err){
      return { ...entry, persisted: false, verified: false, storeError: err?.message || String(err), storeErrorCode: err?.code ?? null };
    }
    try{
      const verify = await store.get(queryHash);
      if(!verify || verify.queryHash !== queryHash){
        return { ...entry, persisted: false, verified: false, storeError: 'read-after-write: el documento no se pudo recuperar tras guardarlo.', storeErrorCode: null };
      }
    }catch(err){
      return { ...entry, persisted: false, verified: false, storeError: `read-after-write: ${err?.message || String(err)}`, storeErrorCode: err?.code ?? null };
    }
    return { ...entry, persisted: true, verified: true };
  }

  async function invalidate(fingerprintInput){
    const queryHash = await buildQueryFingerprint(fingerprintInput);
    try{ await store.delete(queryHash); }catch{ /* degradacion segura: invalidate nunca lanza */ }
  }

  return { lookup, save, invalidate, store };
}
