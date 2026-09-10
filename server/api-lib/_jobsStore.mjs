/* Persistencia server-side de jobs de IA de larga duracion (generar APU con
   IA, y en el futuro Takeoff). Vive en users/{uid}/jobs/{jobId} -- coleccion
   dedicada (no el bucket generico users/{uid}/state usado por
   apuBatchQueueCloud.js / aiJobsCloud.js) porque el cliente NUNCA escribe
   aqui directo: solo lee (ver firestore.rules) el progreso que el SERVIDOR
   (este modulo, via Admin SDK) va publicando. Nunca se usa el SDK de
   cliente para escribir un job -- toda escritura pasa por
   _route-jobs.mjs. */

const JOBS_SUBCOLLECTION = 'jobs';
// Ventana de deduplicacion: un POST /api/jobs repetido con el mismo
// idempotencyKey (doble clic, reintento de red del propio navegador) dentro
// de esta ventana reutiliza el job ya creado en vez de lanzar un segundo
// job real (y consumir cupo de plan / cuota de OpenAI dos veces).
const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000;

function jobsCollection(db, uid){
  return db.collection('users').doc(uid).collection(JOBS_SUBCOLLECTION);
}

/* Sin orderBy combinado con el where (evita depender de un indice
   compuesto): se trae como mucho un punado de candidatos (limit) y se
   elige el mas reciente en JS. El volumen esperado de jobs con la MISMA
   idempotencyKey en la ventana es minimo (0 o 1 en el caso normal, nunca
   una coleccion grande), asi que traer varios y comparar en memoria es
   seguro y evita configuracion de indices adicional en Firestore. */
export async function findRecentJobByIdempotencyKey(db, uid, idempotencyKey){
  if(!idempotencyKey) return null;
  const cutoff = Date.now() - IDEMPOTENCY_WINDOW_MS;
  const snap = await jobsCollection(db, uid).where('idempotencyKey', '==', idempotencyKey).limit(10).get();
  if(snap.empty) return null;
  let best = null;
  snap.forEach(doc => {
    const data = doc.data();
    if(Number(data.createdAt || 0) < cutoff) return;
    if(!best || Number(data.createdAt || 0) > Number(best.createdAt || 0)) best = { id: doc.id, ...data };
  });
  return best;
}

export async function createJob(db, { uid, type, projectId = null, payload, idempotencyKey }){
  const ref = jobsCollection(db, uid).doc();
  const now = Date.now();
  const job = {
    uid,
    type,
    projectId,
    status: 'queued',
    payload: payload ?? null,
    result: null,
    error: null,
    errorCode: null,
    attempts: 0,
    progressCode: 'JOB_QUEUED',
    idempotencyKey: idempotencyKey || null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
  };
  await ref.set(job);
  return { id: ref.id, ...job };
}

export async function updateJob(db, uid, jobId, patch){
  await jobsCollection(db, uid).doc(jobId).set({ ...patch, updatedAt: Date.now() }, { merge: true });
}

export async function getJob(db, uid, jobId){
  const snap = await jobsCollection(db, uid).doc(jobId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}
