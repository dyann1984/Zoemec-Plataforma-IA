/* Persistencia real de AiJobsContext (ver src/contexts/AiJobsContext.jsx).
   Mismo patron ya aprobado que apuBatchQueueCloud.js: users/{uid}/state/{key}
   ("allow read, write: if isOwner(uid)" para cualquier stateKey en
   firestore.rules), asi que esto NO requiere ninguna regla nueva.

   Por que existe: el store en memoria (useState de AiJobsContext) ya
   resuelve que un job sobreviva cambiar de modulo/pestana/minimizar el
   navegador (el proceso de React sigue vivo, el estado nunca se pierde).
   Pero un refresh (F5) o cerrar y volver a abrir la pestana SI destruye ese
   estado -- no hay forma de sobrevivir eso sin escribir a algo fuera del
   proceso del navegador. Este modulo espeja cada job a Firestore para que,
   al volver a cargar la app, se pueda reconstruir que jobs seguian activos o
   habian terminado.

   Limite real, honesto: esto persiste el ESTADO/RESULTADO de un job (para
   que un job que YA TERMINO su llamada a OpenAI antes de que la pestana se
   cerrara se pueda recuperar al reabrir). NO hace que la llamada HTTP en
   curso siga corriendo si la pestana se cierra a la mitad -- eso apagaria el
   fetch igual (ningun navegador mantiene vivo un fetch sin la pestana), y
   arreglarlo de verdad requeriria mover la llamada a OpenAI a un proceso que
   no dependa de la conexion del navegador (fuera de alcance de este cambio,
   ver nota en AiJobsContext.jsx). Un job que estaba "processing" cuando la
   pestana se cerro se recupera marcado como "interrupted" (ver
   markInterruptedOnLoad), nunca como si hubiera terminado solo. */
import { collection, deleteDoc, doc, getDoc, getDocs, query, where, documentId, setDoc } from 'firebase/firestore';

const jobDocKey = (jobId) => `aiJob:${jobId}`;
const INDEX_KEY = 'aiJobsIndex';
const MAX_INDEX = 15;

/* Firestore rechaza arrays anidados (array dentro de array) en cualquier
   profundidad -- y el resultado real de un job de APU trae justo eso
   (shim.materials/labor/equipo son arrays de tuplas, ver v2RowsToLegacy en
   main.jsx). setDoc() valida esto de forma SINCRONA y truena antes de
   devolver una promesa rechazable -- envolver solo la promesa en .catch()
   no alcanza a cubrirlo, por eso este modulo usa try/catch real. `result` y
   `payload` (las dos partes de un job que pueden traer cualquier forma,
   segun el tipo de trabajo) se guardan como texto JSON en vez de objeto
   anidado: evita el problema de raiz sin tener que conocer aqui la forma
   exacta de cada tipo de resultado. */
export function toCloudDoc(job){
  const out = { ...job };
  if(out.result !== undefined) out.result = out.result == null ? null : JSON.stringify(out.result);
  if(out.payload !== undefined) out.payload = out.payload == null ? null : JSON.stringify(out.payload);
  return out;
}

export function fromCloudDoc(raw){
  if(!raw) return raw;
  const job = { ...raw };
  if(typeof job.result === 'string'){ try{ job.result = JSON.parse(job.result); }catch{ job.result = null; } }
  if(typeof job.payload === 'string'){ try{ job.payload = JSON.parse(job.payload); }catch{ job.payload = null; } }
  return job;
}

export async function saveJobToCloud(db, uid, job){
  if(!db || !uid || !job) return;
  try{
    await setDoc(doc(db, 'users', uid, 'state', jobDocKey(job.id)), toCloudDoc(job));
  }catch{ /* nunca bloquear la UI por un fallo de persistencia -- el job sigue vivo en memoria */ }
}

export async function deleteJobFromCloud(db, uid, jobId){
  if(!db || !uid || !jobId) return;
  await deleteDoc(doc(db, 'users', uid, 'state', jobDocKey(jobId))).catch(() => {});
  await removeFromIndex(db, uid, jobId);
}

async function readIndex(db, uid){
  const snap = await getDoc(doc(db, 'users', uid, 'state', INDEX_KEY));
  return snap.exists() ? (snap.data()?.jobIds || []) : [];
}

export async function addToIndex(db, uid, jobId){
  if(!db || !uid || !jobId) return;
  try{
    const ids = await readIndex(db, uid);
    const next = [jobId, ...ids.filter(id => id !== jobId)].slice(0, MAX_INDEX);
    await setDoc(doc(db, 'users', uid, 'state', INDEX_KEY), { jobIds: next, updatedAt: Date.now() });
  }catch{ /* el indice es solo para hidratar mas rapido; si falla, la app sigue funcionando en memoria */ }
}

async function removeFromIndex(db, uid, jobId){
  try{
    const ids = await readIndex(db, uid);
    const next = ids.filter(id => id !== jobId);
    if(next.length !== ids.length){
      await setDoc(doc(db, 'users', uid, 'state', INDEX_KEY), { jobIds: next, updatedAt: Date.now() });
    }
  }catch{ /* mismo criterio: nunca bloquear la UI por esto */ }
}

/* Reconstruye los jobs recientes de este usuario desde Firestore (login,
   refresh, reabrir la app). Lee el indice de ids y luego cada documento en
   chunks de 30 (limite real de Firestore para "in"). Nunca truena: si
   Firestore no responde, regresa [] y la app sigue con el store en memoria
   vacio (mismo criterio de "nunca fingir" que el resto del proyecto). */
export async function loadRecentJobsFromCloud(db, uid){
  if(!db || !uid) return [];
  try{
    const ids = await readIndex(db, uid);
    if(!ids.length) return [];
    const docIds = ids.map(jobDocKey);
    const stateCol = collection(db, 'users', uid, 'state');
    const chunks = [];
    for(let i = 0; i < docIds.length; i += 30) chunks.push(docIds.slice(i, i + 30));
    const jobs = [];
    for(const chunk of chunks){
      const snaps = await getDocs(query(stateCol, where(documentId(), 'in', chunk)));
      snaps.forEach(s => jobs.push(fromCloudDoc(s.data())));
    }
    return jobs;
  }catch{
    return [];
  }
}

/* Un job que seguia "processing" cuando la pestana se cerro/recargo NUNCA
   puede saberse que sigue en curso de verdad (el fetch murio con la
   pestana) -- se reclasifica a "failed" con un motivo honesto en vez de
   dejarlo "processing" para siempre (lo que congelaria el indicador de
   "Procesos" en 1 tarea activa que nunca va a terminar). Logica PURA
   (probada en aiJobQueue.test.js via este mismo shape) para poder testear
   sin Firestore real. */
export function markInterruptedOnLoad(job){
  if(job.status !== 'pending' && job.status !== 'processing') return job;
  return {
    ...job,
    status: 'failed',
    error: 'La sesion se cerro o se recargo la pagina antes de que este proceso terminara.',
    finishedAt: job.finishedAt || Date.now(),
    updatedAt: Date.now(),
  };
}
