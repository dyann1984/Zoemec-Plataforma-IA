/* Persistencia real de la cola de generacion masiva (endurecimiento RC4).
   Reutiliza EXACTAMENTE la ruta ya existente y ya aprobada en
   firestore.rules -- users/{uid}/state/{stateKey}, "allow read, write: if
   isOwner(uid)" para cualquier stateKey -- por eso esta funcionalidad nueva
   NO requiere ninguna regla de Firestore nueva. Cada concepto del lote es su
   PROPIO documento pequeno (nunca un array gigante como useCloudState/
   saveCloud en cloud.js, que tiene un limite de ~950KB POR TODO el arreglo:
   con 100-200 APUs profesionales completos eso se desbordaria facil). Asi
   cada escritura es independiente y pequena, y el limite de 1MB de Firestore
   aplica por concepto, no por lote completo.

   `db` se recibe como parametro (no se importa el singleton de la app) para
   que este modulo sea probable de verdad contra el emulador real de
   Firestore (ver test/apuBatchQueueCloud.test.mjs), no solo simulado. */
import { doc, getDoc, getDocs, setDoc, deleteDoc, query, where, documentId, writeBatch, collection } from 'firebase/firestore';

const jobKey = (batchId) => `apuBatchJob:${batchId}`;
const itemKeyDoc = (batchId, itemKey) => `apuBatchItem:${batchId}:${itemKey}`;

/* Guarda SOLO los metadatos del lote (fileName, fingerprint, la lista de
   identidades hoja+fila+clave con su concepto/unidad/cantidad de origen --
   nunca el APU desarrollado, eso vive en cada item). Pequeno siempre, aunque
   el lote tenga 200 conceptos (cada entrada son unos 100-150 bytes). */
export async function saveJobMeta(db, uid, job){
  if(!db || !uid) return;
  const meta = {
    batchId: job.batchId,
    fileName: job.fileName,
    catalogFingerprint: job.catalogFingerprint,
    total: job.total,
    createdAt: job.createdAt,
    updatedAt: Date.now(),
    cancelled: Boolean(job.cancelled),
    itemKeys: job.items.map(it => it.itemKey),
    itemSeeds: job.items.map(it => ({ itemKey: it.itemKey, item: it.item }))
  };
  await setDoc(doc(db, 'users', uid, 'state', jobKey(job.batchId)), meta);
}

export async function saveItemState(db, uid, batchId, itemState){
  if(!db || !uid) return;
  // apu puede ser un objeto grande (matriz completa): se guarda tal cual,
  // cada item es su propio documento, muy por debajo del limite de 1MB.
  await setDoc(doc(db, 'users', uid, 'state', itemKeyDoc(batchId, itemState.itemKey)), {
    itemKey: itemState.itemKey,
    status: itemState.status,
    attempts: itemState.attempts,
    error: itemState.error,
    apu: itemState.apu || null,
    startedAt: itemState.startedAt,
    finishedAt: itemState.finishedAt,
    updatedAt: Date.now()
  });
}

export async function markJobCancelled(db, uid, batchId){
  if(!db || !uid) return;
  const ref = doc(db, 'users', uid, 'state', jobKey(batchId));
  const snap = await getDoc(ref);
  if(!snap.exists()) return;
  await setDoc(ref, { ...snap.data(), cancelled: true, updatedAt: Date.now() });
}

/* Busca si el usuario tiene un lote sin terminar (para ofrecer "Reanudar").
   No hay forma barata de "listar todas las claves de job" sin un indice
   dedicado, asi que se guarda el ultimo batchId activo aparte, en una clave
   fija y pequena -- igual patron que el resto de useCloudState (una clave
   nombrada por slot, no una coleccion a recorrer). */
const ACTIVE_BATCH_KEY = 'apuBatchActive';
export async function setActiveBatchId(db, uid, batchId){
  if(!db || !uid) return;
  await setDoc(doc(db, 'users', uid, 'state', ACTIVE_BATCH_KEY), { batchId, updatedAt: Date.now() });
}
export async function clearActiveBatchId(db, uid){
  if(!db || !uid) return;
  await deleteDoc(doc(db, 'users', uid, 'state', ACTIVE_BATCH_KEY)).catch(() => {});
}
export async function getActiveBatchId(db, uid){
  if(!db || !uid) return null;
  const snap = await getDoc(doc(db, 'users', uid, 'state', ACTIVE_BATCH_KEY));
  return snap.exists() ? snap.data()?.batchId || null : null;
}

/* Reconstruye el job completo (metadatos + estado real de cada item) para
   reanudar tras recargar la pagina. Los items se leen en chunks de 30 (limite
   de Firestore para "in" queries) usando el id de documento como clave --
   nunca se reconstruye a partir de memoria del navegador, siempre de lo
   ultimo escrito de verdad en Firestore. */
export async function loadJob(db, uid, batchId){
  if(!db || !uid) return null;
  const metaSnap = await getDoc(doc(db, 'users', uid, 'state', jobKey(batchId)));
  if(!metaSnap.exists()) return null;
  const meta = metaSnap.data();
  const itemKeys = meta.itemKeys || [];
  const itemDocIds = itemKeys.map(k => itemKeyDoc(batchId, k));
  const stateCol = collection(db, 'users', uid, 'state');
  const chunks = [];
  for(let i = 0; i < itemDocIds.length; i += 30) chunks.push(itemDocIds.slice(i, i + 30));
  const byItemKey = new Map();
  for(const chunk of chunks){
    if(!chunk.length) continue;
    const snaps = await getDocs(query(stateCol, where(documentId(), 'in', chunk)));
    snaps.forEach(s => { const d = s.data(); byItemKey.set(d.itemKey, d); });
  }
  const seeds = new Map((meta.itemSeeds || []).map(s => [s.itemKey, s.item]));
  const items = itemKeys.map((itemKey, index) => {
    const saved = byItemKey.get(itemKey);
    return {
      itemKey,
      index,
      item: seeds.get(itemKey) || {},
      status: saved?.status || 'pendiente',
      attempts: saved?.attempts || 0,
      error: saved?.error || null,
      apu: saved?.apu || null,
      startedAt: saved?.startedAt || null,
      finishedAt: saved?.finishedAt || null
    };
  });
  return {
    batchId: meta.batchId,
    fileName: meta.fileName,
    catalogFingerprint: meta.catalogFingerprint,
    total: meta.total,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    cancelled: Boolean(meta.cancelled),
    items
  };
}

/* Limpieza tras exportar/cerrar el lote con exito: borra los documentos del
   lote (metadatos + items + el puntero de "lote activo") para no acumular
   basura en Firestore indefinidamente. Nunca se llama automaticamente si el
   lote no termino -- solo cuando el usuario cierra el panel de resultados. */
export async function deleteJob(db, uid, job){
  if(!db || !uid) return;
  const batchWriter = writeBatch(db);
  batchWriter.delete(doc(db, 'users', uid, 'state', jobKey(job.batchId)));
  job.items.forEach(it => {
    batchWriter.delete(doc(db, 'users', uid, 'state', itemKeyDoc(job.batchId, it.itemKey)));
  });
  await batchWriter.commit().catch(() => {});
  await clearActiveBatchId(db, uid);
}
