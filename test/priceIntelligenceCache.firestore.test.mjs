/* Material & Price Intelligence 2.1 -- CACHE PERSISTENTE server-side, contra
   el EMULADOR REAL de Firestore (nunca produccion, ver
   server/api-lib/_priceIntelligenceCache.mjs). searchImpl siempre mockeado
   -- CERO llamadas reales a OpenAI. Corre con `npm run test:priceCache`
   (firestore + auth emulator, igual patron que test:security). Cubre las
   pruebas A-J obligatorias de la integracion final del cache persistente. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { searchMarketReferencesWithCache } from '../server/api-lib/_priceIntelligenceCache.mjs';
import { getAdminDb, getAdminAuth } from '../server/api-lib/_firebaseAdmin.mjs';
import priceIntelligenceHandler from '../api/price-intelligence.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/priceIntelligenceCache.firestore.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:priceCache`.');
}

function altoSearchResult(precio = 250){
  return { fichaTecnica: { familia: 'cemento' }, referencias: [{ proveedor: 'Home Depot Mexico', url: 'https://x', precioNormalizado: precio, match: { verdict: 'ALTO', score: 91 } }], estadisticas: null, precioRecomendado: precio, nivelEvidencia: 'MERCADO' };
}

const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

describe('Price Intelligence 2.1 -- cache persistente (Firestore real, emulador)', () => {
  it('TEST A -- Firestore MISS: 1 busqueda simulada, se guarda en Firestore', async () => {
    let calls = 0;
    const searchImpl = async () => { calls++; return altoSearchResult(); };
    const result = await searchMarketReferencesWithCache({
      description: uniq('Cemento CPC 30R 50 kg'), unit: 'saco', searchImpl
    });
    assert.equal(calls, 1);
    assert.equal(result.cacheStatus, 'CACHE_MISS');
    assert.equal(result.webSearchPerformed, true);
    assert.ok(result.queryHash);
  });

  it('TEST B -- segunda peticion identica: Firestore HIT real, 0 busquedas nuevas', async () => {
    const description = uniq('Adhesivo cementicio 20 kg');
    let calls = 0;
    const searchImpl = async () => { calls++; return altoSearchResult(900); };

    const first = await searchMarketReferencesWithCache({ description, unit: 'cubeta', searchImpl });
    assert.equal(calls, 1);
    assert.equal(first.cacheStatus, 'CACHE_MISS');

    const second = await searchMarketReferencesWithCache({ description, unit: 'cubeta', searchImpl });
    assert.equal(calls, 1, 'la segunda peticion identica NO debe volver a llamar a searchImpl');
    assert.equal(second.cacheStatus, 'CACHE_HIT');
    assert.equal(second.webSearchPerformed, false);
    assert.equal(second.precioRecomendado, 900);
  });

  it('TEST C -- registro expirado en Firestore real: nueva busqueda, expiresAt se actualiza', async () => {
    const description = uniq('Varilla de acero 3/8');
    let calls = 0;
    const searchImpl = async () => { calls++; return altoSearchResult(180); };

    // TTL de 1ms para forzar expiracion real sin esperar 7 dias.
    const db = getAdminDb();
    const first = await searchMarketReferencesWithCache({ description, unit: 'pza', searchImpl, db, maxDailySearches: 1000 });
    assert.equal(calls, 1);

    // Sobrescribe expiresAt directamente en Firestore para simular vencimiento real.
    const col = db.collection('priceIntelligenceCache');
    await col.doc(first.queryHash).update({ expiresAt: Date.now() - 1000 });

    const second = await searchMarketReferencesWithCache({ description, unit: 'pza', searchImpl, db, maxDailySearches: 1000 });
    assert.equal(calls, 2, 'con el registro vencido debe ejecutarse una busqueda nueva');
    assert.equal(second.cacheStatus, 'CACHE_EXPIRED');
    assert.ok(second.expiresAt > first.expiresAt, 'expiresAt debe actualizarse tras la nueva busqueda');
  });

  it('TEST D -- dos organizaciones tenant-specific: aislamiento correcto (fingerprints distintos, sin compartir cache)', async () => {
    const description = uniq('Pieza de catalogo interno XYZ');
    let calls = 0;
    const searchImpl = async () => { calls++; return altoSearchResult(500); };

    await searchMarketReferencesWithCache({ description, unit: 'pza', tenantScope: { organizationId: 'ORG-A' }, searchImpl });
    await searchMarketReferencesWithCache({ description, unit: 'pza', tenantScope: { organizationId: 'ORG-B' }, searchImpl });
    assert.equal(calls, 2, 'ORG-A y ORG-B nunca deben compartir el cache del mismo recurso');

    // Repetir ORG-A: debe ser HIT (no 3ra llamada).
    await searchMarketReferencesWithCache({ description, unit: 'pza', tenantScope: { organizationId: 'ORG-A' }, searchImpl });
    assert.equal(calls, 2, 'repetir la misma organizacion SI debe reusar su propio cache');
  });

  it('TEST E -- cache global publico (sin tenantScope): reutilizacion correcta entre llamadas', async () => {
    const description = uniq('Cemento gris CPC 30R publico');
    let calls = 0;
    const searchImpl = async () => { calls++; return altoSearchResult(255); };

    await searchMarketReferencesWithCache({ description, unit: 'saco', searchImpl });
    await searchMarketReferencesWithCache({ description, unit: 'saco', searchImpl });
    await searchMarketReferencesWithCache({ description, unit: 'saco', searchImpl });
    assert.equal(calls, 1, 'evidencia de mercado publica debe reutilizarse globalmente sin tenantScope');
  });

  it('TEST F -- el registro persistido en Firestore NO contiene campos privados prohibidos', async () => {
    const description = uniq('Material sin datos privados');
    const searchImpl = async () => altoSearchResult(300);
    const result = await searchMarketReferencesWithCache({ description, unit: 'pza', searchImpl });

    const db = getAdminDb();
    const doc = await db.collection('priceIntelligenceCache').doc(result.queryHash).get();
    assert.ok(doc.exists);
    const stored = doc.data();
    const forbidden = ['projectId', 'clientName', 'client', 'userEmail', 'email', 'ownerUid', 'uid', 'budget', 'presupuesto', 'cantidadObra', 'quantity', 'cantidad', 'concept', 'concepto'];
    const present = forbidden.filter(k => stored[k] !== undefined);
    assert.deepEqual(present, [], `el registro de cache nunca debe incluir campos privados/tenant: ${present.join(', ')}`);
  });

  it('TEST G -- fallo de Firestore (store roto): degradacion segura, nunca lanza, nunca inventa precio', async () => {
    const brokenStore = {
      get: async () => { throw new Error('Firestore no disponible'); },
      set: async () => { throw new Error('Firestore no disponible'); },
      delete: async () => { throw new Error('Firestore no disponible'); }
    };
    let calls = 0;
    const searchImpl = async () => { calls++; return altoSearchResult(400); };
    const result = await searchMarketReferencesWithCache({ description: uniq('Material con Firestore caido'), unit: 'pza', store: brokenStore, searchImpl });
    assert.equal(calls, 1, 'con el store roto, debe seguir intentando la busqueda real (degradacion segura -- nunca bloquea la operacion)');
    assert.equal(result.webSearchPerformed, true);
    assert.equal(result.precioRecomendado, 400);
  });

  it('TEST -- presupuesto diario agotado: no llama a OpenAI, marca deferred, nunca inventa precio', async () => {
    let calls = 0;
    const searchImpl = async () => { calls++; return altoSearchResult(999); };
    const result = await searchMarketReferencesWithCache({ description: uniq('Material sin presupuesto disponible'), unit: 'pza', searchImpl, maxDailySearches: 0 });
    assert.equal(calls, 0, 'con el presupuesto diario en 0, NUNCA debe llamarse a la busqueda real');
    assert.equal(result.webSearchPerformed, false);
    assert.equal(result.deferred, true);
    assert.equal(result.precioRecomendado, null);
  });

  it('TEST H -- el endpoint /api/price-intelligence sigue exigiendo autenticacion real (sin token -> 401)', async () => {
    const res = { statusCode: 200, body: null, status(c){ this.statusCode = c; return this; }, json(d){ this.body = d; return this; } };
    await priceIntelligenceHandler({ method: 'POST', headers: {}, body: { description: 'Material', unit: 'pza' } }, res);
    assert.equal(res.statusCode, 401);
  });
});
