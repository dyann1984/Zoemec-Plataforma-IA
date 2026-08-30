/* Material & Price Intelligence 2.1 -- CACHE PERSISTENTE server-side, contra
   el EMULADOR REAL de Firestore (nunca produccion, ver
   server/api-lib/_priceIntelligenceCache.mjs). searchImpl siempre mockeado
   -- CERO llamadas reales a OpenAI. Corre con `npm run test:priceCache`
   (firestore + auth emulator, igual patron que test:security). Cubre las
   pruebas A-J obligatorias de la integracion final del cache persistente. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { searchMarketReferencesWithCache, CACHE_WRITE_STATUS } from '../server/api-lib/_priceIntelligenceCache.mjs';
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
    assert.equal(result.cacheWriteStatus, CACHE_WRITE_STATUS.PERSISTED, 'hotfix 2.1.1: una escritura real contra el emulador debe reportarse PERSISTED, verificada por lectura inmediata');
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
    assert.equal(second.cacheWriteStatus, CACHE_WRITE_STATUS.NOT_APPLICABLE, 'un CACHE_HIT no escribe nada -- no debe reportar PERSISTED/FAILED de una escritura que no ocurrio');
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

  it('TEST G -- fallo de Firestore (store roto): degradacion segura, nunca lanza, nunca inventa precio, cacheWriteStatus:FAILED observable', async () => {
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
    // Hotfix 2.1.1 -- regla 1/2: el fallo del cache write NUNCA debe
    // desaparecer en silencio, ni fingir persistencia.
    assert.equal(result.cacheWriteStatus, CACHE_WRITE_STATUS.FAILED, 'un store.set() roto debe reportarse como FAILED, nunca como PERSISTED');
  });

  it('TEST -- store.set() "miente" (no lanza pero el documento no queda recuperable): read-after-write lo detecta como FAILED', async () => {
    // Este es exactamente el tipo de fallo sospechado en el CONTROLLED LIVE
    // TEST real: un store.set() que no lanza ningun error observable, pero
    // cuyo documento no aparece despues. Antes del hotfix, esto se
    // reportaba como webSearchPerformed:true SIN ninguna senal de que el
    // cache jamas quedo escrito -- exactamente el bug reproducido con
    // "Lentes de seguridad" en el live test.
    const lyingStore = {
      get: async () => undefined, // el documento nunca esta ahi, ni siquiera tras haber "guardado"
      set: async () => { /* no lanza -- pero tampoco persiste nada de verdad */ },
      delete: async () => {}
    };
    let calls = 0;
    const searchImpl = async () => { calls++; return altoSearchResult(82); };
    const result = await searchMarketReferencesWithCache({ description: uniq('Lentes de seguridad'), unit: 'pza', store: lyingStore, searchImpl });
    assert.equal(calls, 1);
    assert.equal(result.webSearchPerformed, true);
    assert.equal(result.cacheWriteStatus, CACHE_WRITE_STATUS.FAILED, 'read-after-write debe detectar que el documento no quedo realmente disponible, aunque store.set() no haya lanzado');
  });

  it('TEST -- tras un cacheWriteStatus:FAILED real (Firestore emulador), la siguiente peticion identica sigue siendo CACHE_MISS (nunca inventa un HIT)', async () => {
    const description = uniq('Material que nunca se persistio de verdad');
    const brokenStore = {
      get: async () => { throw new Error('Firestore no disponible'); },
      set: async () => { throw new Error('Firestore no disponible'); },
      delete: async () => { throw new Error('Firestore no disponible'); }
    };
    let calls = 0;
    const searchImpl = async () => { calls++; return altoSearchResult(150); };

    const first = await searchMarketReferencesWithCache({ description, unit: 'pza', store: brokenStore, searchImpl });
    assert.equal(first.cacheWriteStatus, CACHE_WRITE_STATUS.FAILED);

    // Segunda peticion, ahora contra el Firestore REAL del emulador (sin
    // store roto): como la primera nunca persistio de verdad, esto debe
    // ser CACHE_MISS -- nunca un HIT fabricado sobre un guardado que fallo.
    const second = await searchMarketReferencesWithCache({ description, unit: 'pza', searchImpl });
    assert.equal(calls, 2, 'sin un guardado real previo, la segunda peticion debe ejecutar una busqueda real de nuevo');
    assert.equal(second.cacheStatus, 'CACHE_MISS');
    assert.equal(second.cacheWriteStatus, CACHE_WRITE_STATUS.PERSISTED, 'esta segunda escritura, contra Firestore real, si debe persistir correctamente');
  });

  it('TEST -- payload con campo anidado undefined (forma real de una referencia con optional ausente): comportamiento definido, nunca silencioso', async () => {
    // Reproduce contra el Firestore REAL del emulador (no un store roto)
    // para inspeccionar el comportamiento real de Admin SDK ante un
    // undefined anidado, tal como pide la regla 3 del hotfix ("identificar
    // causa exacta antes de cambiar datos arbitrariamente"). No se agrego
    // ningun sanitizer nuevo porque _priceIntelligenceCore.mjs ya
    // sanitiza explicitamente cada campo (String()/Number()/|| null) antes
    // de construir una referencia real -- este test deja evidencia
    // explicita de que, SI algun dia un campo llega undefined, el sistema
    // ahora lo reporta como FAILED (auditable) en vez de perderlo en
    // silencio, sea cual sea la causa exacta de Firestore.
    const searchImpl = async () => ({
      fichaTecnica: { familia: 'epp' },
      referencias: [{
        proveedor: 'Proveedor real', url: 'https://x', precioNormalizado: 82,
        match: { verdict: 'ALTO', score: 90 },
        campoOpcionalAusente: undefined
      }],
      precioRecomendado: 82, nivelEvidencia: 'MERCADO'
    });
    const result = await searchMarketReferencesWithCache({ description: uniq('Lentes de seguridad con campo undefined'), unit: 'pza', searchImpl });
    assert.equal(result.webSearchPerformed, true);
    assert.ok(
      result.cacheWriteStatus === CACHE_WRITE_STATUS.PERSISTED || result.cacheWriteStatus === CACHE_WRITE_STATUS.FAILED,
      'cacheWriteStatus siempre debe ser un valor auditable conocido, nunca undefined ni ausente'
    );
    if(result.cacheWriteStatus === CACHE_WRITE_STATUS.FAILED){
      const db = getAdminDb();
      const doc = await db.collection('priceIntelligenceCache').doc(result.queryHash).get();
      assert.ok(!doc.exists || doc.data()?.references?.[0]?.campoOpcionalAusente === undefined, 'si Firestore rechazo el undefined, el documento nunca debe quedar guardado a medias con ese campo');
    }
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
