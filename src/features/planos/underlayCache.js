/* Cache LOCAL (IndexedDB) de la imagen de fondo del plano, por planoId. El
   PDF original no viaja a Firestore (solo la geometria/escala/objetos, que
   si se persisten versionados via /api/plano-takeoffs); sin esto, reabrir
   un plano en el mismo equipo mostraria la geometria sin el dibujo de
   referencia. Todo es best-effort: si IndexedDB no esta disponible
   (privado, cuota), simplemente no hay fondo y la UI lo dice. */
const DB_NAME = 'zoemec-plano-underlay';
const STORE = 'underlays';

function openDb(){
  return new Promise((resolve, reject) => {
    if(typeof indexedDB === 'undefined'){ reject(new Error('IndexedDB no disponible')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveUnderlay(planoId, underlay){
  try{
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(underlay, planoId);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  }catch{ return false; }
}

export async function loadUnderlay(planoId){
  try{
    const db = await openDb();
    const value = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(planoId);
      req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error);
    });
    db.close();
    return value;
  }catch{ return null; }
}
