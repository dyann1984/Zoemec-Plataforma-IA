/* "Vistos"/descartados para jobs server-side (users/{uid}/jobs/{jobId}).
   El cliente NUNCA puede escribir ese documento (firestore.rules: allow
   write: if false -- solo el servidor, con Admin SDK, escribe resultado y
   estado), asi que "ya lo vi / ya lo aplique" no puede vivir en el propio
   documento del job como en el mecanismo anterior (aiJobsCloud.js, que si
   era propiedad del cliente). Se guarda en localStorage, con el mismo
   namespacing por usuario que el resto de la app (ver
   src/utils/scopedStorage.js) -- basta con que sobreviva en ESTE
   navegador/dispositivo para que el banner de recuperacion no vuelva a
   aparecer tras aplicarlo o descartarlo una vez. */
import { scopedKey } from '../utils/scopedStorage.js';

const MAX_SEEN = 200;

function storageKey(uid){
  return scopedKey('server-jobs-seen', uid);
}

export function loadSeenServerJobIds(uid){
  try{
    const raw = localStorage.getItem(storageKey(uid));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  }catch{
    return new Set();
  }
}

export function markServerJobSeen(uid, jobId){
  try{
    const ids = Array.from(loadSeenServerJobIds(uid));
    const next = [jobId, ...ids.filter(id => id !== jobId)].slice(0, MAX_SEEN);
    localStorage.setItem(storageKey(uid), JSON.stringify(next));
  }catch{ /* localStorage no disponible (modo privado, cuota llena): degrada sin tronar */ }
}
