/* Cliente para los jobs de IA server-side (Fase 2 de la auditoria -- ver
   server/api-lib/_route-jobs.mjs). Dos piezas:
   1. createServerJob(): POST /api/jobs, regresa {jobId} de inmediato -- el
      servidor sigue procesando despues de responder (waitUntil), sin
      depender de que el navegador siga conectado.
   2. subscribeToServerJob()/subscribeToRecentServerJobs(): listener de
      Firestore (onSnapshot), NUNCA polling -- el cliente se entera del
      progreso/resultado en cuanto el servidor escribe el documento. */
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { apiPost } from '../services/apiClient.js';

export async function createServerJob({ type, payload, idempotencyKey, projectId }){
  return apiPost('/api/jobs', { type, payload, idempotencyKey, projectId });
}

/* onUpdate(job) se llama con el documento completo cada vez que cambia
   (queued -> processing -> completed|failed). Devuelve la funcion de
   unsubscribe (llamarla al desmontar o al llegar a un estado terminal para
   no dejar el listener abierto indefinidamente). */
export function subscribeToServerJob(db, uid, jobId, onUpdate, onError){
  const ref = doc(db, 'users', uid, 'jobs', jobId);
  return onSnapshot(ref, snap => {
    if(!snap.exists()) return;
    onUpdate({ id: snap.id, ...snap.data() });
  }, err => { onError?.(err); });
}

/* Jobs recientes del usuario (mas nuevo primero), para reconstruir el
   centro de "Procesos" y detectar si alguno termino mientras el usuario
   estaba fuera -- se usa al montar la app/modulo, en vez de una consulta
   puntual + polling. */
export function subscribeToRecentServerJobs(db, uid, onUpdate, onError, max = 10){
  const col = collection(db, 'users', uid, 'jobs');
  const q = query(col, orderBy('createdAt', 'desc'), limit(max));
  return onSnapshot(q, snap => {
    onUpdate(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, err => { onError?.(err); });
}
