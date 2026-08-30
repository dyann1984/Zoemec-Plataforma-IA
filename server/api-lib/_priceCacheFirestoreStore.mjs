/* Material & Price Intelligence 2.1 -- adapter de Firestore para el cache de
   Price Intelligence (regla 4 de la integracion final). Implementa el MISMO
   contrato async get(key)/set(key,entry)/delete(key) que
   src/domain/priceSearchCache.js#createInMemoryPriceCacheStore -- cualquier
   codigo que orqueste el cache (createPriceSearchCache) recibe uno u otro
   sin cambiar su logica ni una linea (regla explicita: "no acoplar el
   dominio directamente a Firebase").

   Coleccion: 'priceIntelligenceCache' (plana, mismo criterio que el resto
   de server/api-lib -- ver _technicalMemoryFirestoreAdapter.mjs). El id del
   documento es el propio queryHash (pq_<sha256>), ya seguro como Firestore
   doc id (sin '/', longitud fija). searchedAt/expiresAt se guardan como
   numero (epoch ms), no Timestamp de Firestore -- priceSearchCache.js los
   compara directamente contra Date.now() numerico, sin conversion.

   Alcance (regla 5, aislamiento tenant): esta coleccion SOLO debe recibir
   entradas cuyo fingerprint ya paso por assertCacheKeySafe (nunca
   projectId/clientName/userEmail/cantidades privadas) -- este adapter no
   valida eso de nuevo (ya lo hace priceSearchCache.js antes de llamar a
   set()), pero por eso vive en una coleccion PROPIA, nunca mezclada con
   projects/apus/technicalMemory. */
import { getAdminDb } from './_firebaseAdmin.mjs';

const COLLECTION = 'priceIntelligenceCache';

export function createFirestorePriceCacheStore(db = null){
  const database = db || getAdminDb();
  const col = database.collection(COLLECTION);
  return {
    async get(key){
      const doc = await col.doc(key).get();
      return doc.exists ? doc.data() : undefined;
    },
    async set(key, entry){
      await col.doc(key).set(entry);
    },
    async delete(key){
      await col.doc(key).delete();
    }
  };
}
