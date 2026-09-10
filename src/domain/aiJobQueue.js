/* Cola de trabajos de IA de larga duracion (generacion individual de APU,
   Takeoff/Visual AI), independiente de cualquier componente de pantalla.
   Logica PURA (sin React, sin Firestore), igual patron que
   src/domain/apuBatchQueue.js: un objeto inmutable por job, transiciones via
   funciones que devuelven un nuevo objeto. El contexto de React que lo usa
   (src/contexts/AiJobsContext.jsx) es la unica pieza con estado real; este
   modulo solo describe COMO cambia ese estado, para poder probarlo con
   node --test sin montar nada.

   Por que existe: antes de esto, la generacion de un APU con IA (o un
   Takeoff) guardaba su resultado en el useState LOCAL del componente de
   pantalla (APU, PlanoTakeoff). Si el usuario cambiaba de modulo mientras la
   IA seguia trabajando, ese componente se desmontaba: el fetch seguia
   corriendo en segundo plano, pero al resolver, sus setState apuntaban a un
   componente que ya no existe -- el resultado se perdia en silencio. Un job
   vive en el store global (nunca se desmonta con la navegacion), asi que el
   resultado sobrevive aunque el usuario haya cambiado de pantalla. */

export const JOB_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

export function isTerminalJobStatus(status){
  return status === JOB_STATUS.COMPLETED || status === JOB_STATUS.FAILED;
}

export function createJob({ id, type, label, payload }){
  const now = Date.now();
  return {
    id,
    type: type || 'generic',
    label: label || '',
    payload: payload ?? null,
    status: JOB_STATUS.PENDING,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    // seen=false hasta que la UI que abrio el job (o el usuario, desde el
    // centro de procesos) reconoce el resultado -- distingue "termino pero
    // el usuario todavia no lo vio" de "ya se aplico/descarto".
    seen: false,
  };
}

export function markJobProcessing(job){
  return { ...job, status: JOB_STATUS.PROCESSING, startedAt: job.startedAt ?? Date.now(), updatedAt: Date.now() };
}

export function markJobCompleted(job, result){
  return { ...job, status: JOB_STATUS.COMPLETED, result, error: null, finishedAt: Date.now(), updatedAt: Date.now(), seen: false };
}

export function markJobFailed(job, error){
  return {
    ...job,
    status: JOB_STATUS.FAILED,
    error: String(error?.message || error || 'Error desconocido'),
    finishedAt: Date.now(),
    updatedAt: Date.now(),
    seen: false,
  };
}

export function markJobSeen(job){
  return { ...job, seen: true, updatedAt: Date.now() };
}

/* Jobs completados/fallidos que el usuario todavia no vio, del tipo dado
   (o de cualquier tipo si no se pasa `type`), mas recientes primero. Usado
   por la pantalla que abrio el job para ofrecer "recuperar resultado" al
   volver a montarse, y por el centro de procesos para el contador. */
export function unseenJobsOfType(jobs, type){
  return Object.values(jobs)
    .filter(j => isTerminalJobStatus(j.status) && !j.seen && (!type || j.type === type))
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
}

export function activeJobs(jobs){
  return Object.values(jobs).filter(j => j.status === JOB_STATUS.PENDING || j.status === JOB_STATUS.PROCESSING);
}
