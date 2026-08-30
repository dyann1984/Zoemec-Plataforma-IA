/* Material & Price Intelligence 2.1 -- regla 4/5/6/7: cache determinista con
   fingerprint SHA-256 real (reutiliza src/domain/snapshotHash.js, no
   duplica hashing). TEST 1, 2, 3, 15 obligatorios del spec original, mas
   CACHE_EXPIRED explicito y aislamiento tenant de la integracion final. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPriceSearchCache, createInMemoryPriceCacheStore, buildQueryFingerprint, assertCacheKeySafe, CACHE_RESULT, PRICE_CACHE_TTL_MS } from './priceSearchCache.js';

const FINGERPRINT_CEMENTO = { normalizedDescription: 'Cemento CPC 30R 50 kg', technicalSpecification: 'CPC 30R', unit: 'saco', region: 'CDMX', currency: 'MXN' };

test('fingerprint es estable (SHA-256): la misma entrada siempre produce el mismo queryHash', async () => {
  const a = await buildQueryFingerprint(FINGERPRINT_CEMENTO);
  const b = await buildQueryFingerprint({ ...FINGERPRINT_CEMENTO });
  assert.equal(a, b);
  assert.match(a, /^pq_[0-9a-f]{64}$/, 'debe ser un SHA-256 completo (64 hex), no un hash corto');
});

test('diferencia tecnica relevante -> hash diferente', async () => {
  const a = await buildQueryFingerprint(FINGERPRINT_CEMENTO);
  const b = await buildQueryFingerprint({ ...FINGERPRINT_CEMENTO, technicalSpecification: 'CPC 40R' });
  assert.notEqual(a, b);
});

test('assertCacheKeySafe rechaza campos prohibidos (projectId/clientName/userEmail/budget/etc.)', () => {
  assert.throws(() => assertCacheKeySafe({ ...FINGERPRINT_CEMENTO, projectId: 'PRO-1' }), /prohibido/i);
  assert.throws(() => assertCacheKeySafe({ ...FINGERPRINT_CEMENTO, userEmail: 'a@b.com' }), /prohibido/i);
  assert.throws(() => assertCacheKeySafe({ ...FINGERPRINT_CEMENTO, cantidadObra: 64 }), /prohibido/i);
  assert.doesNotThrow(() => assertCacheKeySafe(FINGERPRINT_CEMENTO));
});

test('lookup()/save() rechazan (lanzan) si el fingerprint trae un campo prohibido -- nunca lo hashean en silencio', async () => {
  const cache = createPriceSearchCache({ now: () => 1000 });
  await assert.rejects(() => cache.save({ ...FINGERPRINT_CEMENTO, projectId: 'PRO-1' }, { priceStatus: 'VERIFIED_MARKET' }), /prohibido/i);
  await assert.rejects(() => cache.lookup({ ...FINGERPRINT_CEMENTO, clientName: 'Cliente X' }), /prohibido/i);
});

test('TEST 1 (parte cache) -- guardar una vez, 19 lookups adicionales son todos CACHE_HIT', async () => {
  const cache = createPriceSearchCache({ now: () => 1000 });
  await cache.save(FINGERPRINT_CEMENTO, { references: [{ match: { verdict: 'ALTO' } }], priceStatus: 'VERIFIED_MARKET' });

  let hits = 0;
  for(let i = 0; i < 19; i++){
    const { result } = await cache.lookup(FINGERPRINT_CEMENTO);
    if(result === CACHE_RESULT.HIT) hits++;
  }
  assert.equal(hits, 19);
});

test('TEST 2 -- mismo nombre pero especificacion tecnica diferente: cache independiente (no colisiona)', async () => {
  const cache = createPriceSearchCache({ now: () => 1000 });
  await cache.save({ normalizedDescription: 'Disco diamantado', technicalSpecification: '4.5 pulgadas, amoladora', unit: 'pza' }, { priceStatus: 'VERIFIED_MARKET' });

  const lookupDistinto = await cache.lookup({ normalizedDescription: 'Disco diamantado', technicalSpecification: '14 pulgadas, sierra de piso', unit: 'pza' });
  assert.equal(lookupDistinto.result, CACHE_RESULT.MISS, 'una especificacion tecnica distinta NUNCA debe compartir cache (caso CLAVE 45)');
});

test('TEST 3 -- cache expirado: CACHE_EXPIRED explicito (distinto de MISS), nueva busqueda requerida', async () => {
  let now = 1000;
  const cache = createPriceSearchCache({ now: () => now, defaultTtlMs: 5000 });
  await cache.save(FINGERPRINT_CEMENTO, { priceStatus: 'VERIFIED_MARKET' });

  assert.equal((await cache.lookup(FINGERPRINT_CEMENTO)).result, CACHE_RESULT.HIT);

  now = 1000 + 5000 + 1;
  const afterExpiry = await cache.lookup(FINGERPRINT_CEMENTO);
  assert.equal(afterExpiry.result, CACHE_RESULT.EXPIRED, 'un registro vencido debe distinguirse explicitamente (CACHE_EXPIRED), no confundirse con "nunca se busco" (MISS)');
});

test('nunca se busco -> CACHE_MISS (no CACHE_EXPIRED)', async () => {
  const cache = createPriceSearchCache({ now: () => 1000 });
  const { result } = await cache.lookup(FINGERPRINT_CEMENTO);
  assert.equal(result, CACHE_RESULT.MISS);
});

test('TTL configurable por llamada (material de alta volatilidad: 24h) distinto del TTL normal (7 dias)', async () => {
  let now = 0;
  const cache = createPriceSearchCache({ now: () => now, defaultTtlMs: PRICE_CACHE_TTL_MS.NORMAL });
  const entry = await cache.save(FINGERPRINT_CEMENTO, { priceStatus: 'VERIFIED_MARKET' }, { ttlMs: PRICE_CACHE_TTL_MS.VOLATILE });
  assert.equal(entry.expiresAt, PRICE_CACHE_TTL_MS.VOLATILE);
  assert.notEqual(PRICE_CACHE_TTL_MS.VOLATILE, PRICE_CACHE_TTL_MS.NORMAL);
});

test('TEST 15 -- cache reutilizable/persistente: un store compartido sobrevive a nuevas instancias de cache', async () => {
  const sharedStore = createInMemoryPriceCacheStore();
  const cacheSessionA = createPriceSearchCache({ store: sharedStore, now: () => 1000 });
  await cacheSessionA.save(FINGERPRINT_CEMENTO, { priceStatus: 'VERIFIED_MARKET' });

  const cacheSessionB = createPriceSearchCache({ store: sharedStore, now: () => 2000 });
  const { result } = await cacheSessionB.lookup(FINGERPRINT_CEMENTO);
  assert.equal(result, CACHE_RESULT.HIT, 'el resultado debe seguir disponible para una sesion nueva que comparte el store');
});

test('TEST J -- fallo del store (ej. Firestore caido) degrada a MISS de forma segura, nunca lanza hacia el llamador', async () => {
  const brokenStore = {
    get: async () => { throw new Error('Firestore no disponible'); },
    set: async () => { throw new Error('Firestore no disponible'); },
    delete: async () => { throw new Error('Firestore no disponible'); }
  };
  const cache = createPriceSearchCache({ store: brokenStore, now: () => 1000 });
  const lookupResult = await cache.lookup(FINGERPRINT_CEMENTO);
  assert.equal(lookupResult.result, CACHE_RESULT.MISS);
  assert.ok(lookupResult.storeError);

  const saveResult = await cache.save(FINGERPRINT_CEMENTO, { priceStatus: 'VERIFIED_MARKET' });
  assert.equal(saveResult.persisted, false);
  assert.ok(saveResult.storeError);
});

/* ======================================================================
   HOTFIX 2.1.1 -- regla 4 (read-after-write verification). Un store.set()
   que no lanza NO es prueba suficiente de que el documento quedo
   realmente disponible (causa sospechada del bug real del live test:
   "Lentes de seguridad" volvio a CACHE_MISS pese a un save() previo sin
   error). save() ahora hace SIEMPRE una lectura de verificacion tras un
   set() exitoso antes de declarar persisted:true.
   ====================================================================== */

test('TEST -- read-after-write exitoso: store normal -> persisted:true, verified:true', async () => {
  const cache = createPriceSearchCache({ now: () => 1000 });
  const entry = await cache.save(FINGERPRINT_CEMENTO, { priceStatus: 'VERIFIED_MARKET' });
  assert.equal(entry.persisted, true);
  assert.equal(entry.verified, true);
});

test('TEST -- store.set() no lanza pero el documento no queda recuperable (store "mentiroso"): persisted:false, verified:false, storeError explicito', async () => {
  const lyingStore = {
    get: async () => undefined, // nunca confirma el documento, ni siquiera tras "guardarlo"
    set: async () => { /* no lanza */ },
    delete: async () => {}
  };
  const cache = createPriceSearchCache({ store: lyingStore, now: () => 1000 });
  const entry = await cache.save(FINGERPRINT_CEMENTO, { priceStatus: 'VERIFIED_MARKET' });
  assert.equal(entry.persisted, false, 'sin confirmacion de lectura, persisted nunca debe ser true solo porque set() no lanzo');
  assert.equal(entry.verified, false);
  assert.ok(entry.storeError);
});

test('TEST -- store.get() de verificacion lanza tras un set() exitoso: persisted:false de forma segura, nunca lanza hacia el llamador', async () => {
  const flakyStore = {
    get: async () => { throw new Error('lectura de verificacion caida'); },
    set: async () => { /* set exitoso */ },
    delete: async () => {}
  };
  const cache = createPriceSearchCache({ store: flakyStore, now: () => 1000 });
  const entry = await cache.save(FINGERPRINT_CEMENTO, { priceStatus: 'VERIFIED_MARKET' });
  assert.equal(entry.persisted, false);
  assert.ok(entry.storeError);
});

test('aislamiento tenant -- tenantScope.organizationId distintas producen fingerprints distintos', async () => {
  const a = await buildQueryFingerprint({ ...FINGERPRINT_CEMENTO, tenantScope: { organizationId: 'ORG-A' } });
  const b = await buildQueryFingerprint({ ...FINGERPRINT_CEMENTO, tenantScope: { organizationId: 'ORG-B' } });
  const global_ = await buildQueryFingerprint(FINGERPRINT_CEMENTO);
  assert.notEqual(a, b);
  assert.notEqual(a, global_, 'un fingerprint con tenantScope nunca debe colisionar con el fingerprint global (sin tenantScope) del mismo recurso');
});

test('invalidate() borra una entrada especifica sin afectar otras', async () => {
  const cache = createPriceSearchCache({ now: () => 1000 });
  await cache.save(FINGERPRINT_CEMENTO, { priceStatus: 'VERIFIED_MARKET' });
  await cache.save({ normalizedDescription: 'Otro material', unit: 'pza' }, { priceStatus: 'AI_ESTIMATE_UNVERIFIED' });

  await cache.invalidate(FINGERPRINT_CEMENTO);
  assert.equal((await cache.lookup(FINGERPRINT_CEMENTO)).result, CACHE_RESULT.MISS);
  assert.equal((await cache.lookup({ normalizedDescription: 'Otro material', unit: 'pza' })).result, CACHE_RESULT.HIT);
});
