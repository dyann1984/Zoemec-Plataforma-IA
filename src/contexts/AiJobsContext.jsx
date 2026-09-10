import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db, firebaseReady } from '../firebase.js';
import {
  activeJobs as activeJobsOf,
  createJob,
  isTerminalJobStatus,
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
  markJobSeen,
  unseenJobsOfType,
} from '../domain/aiJobQueue.js';
import { addToIndex, deleteJobFromCloud, loadRecentJobsFromCloud, markInterruptedOnLoad, saveJobToCloud } from '../lib/aiJobsCloud.js';
import { createServerJob, subscribeToRecentServerJobs } from '../lib/serverJobsCloud.js';
import { loadSeenServerJobIds, markServerJobSeen } from '../lib/serverJobsSeen.js';

/* Registro global de trabajos de IA de larga duracion (generar APU, analizar
   plano/Takeoff). Se monta UNA sola vez en la raiz de la app (ver
   src/main.jsx, junto a I18nProvider/ThemeProvider), asi que sobrevive
   cualquier cambio de modulo/pantalla: si el usuario navega mientras un job
   sigue en curso, este Provider (no el componente de pantalla) sigue
   sosteniendo la promesa y actualizando el estado del job cuando resuelva.

   Las pantallas que inician trabajo (APU, PlanoTakeoff) siguen siendo
   responsables de aplicar el resultado a SU estado local cuando estan
   montadas (para no tocar su logica de identidad/guardado ya probada en
   produccion); este contexto solo garantiza que el resultado no se pierda
   si no lo estan.

   DOS MECANISMOS DE JOB CONVIVEN AQUI (Fase 2 de la auditoria agrega el
   segundo, sin quitar el primero):

   A) Jobs "client-driven" (startJob/beginJob/completeJob/failJob, Fase 1):
      la llamada a OpenAI la hace EL NAVEGADOR (fetch directo). Este
      Provider guarda el resultado (espejo en Firestore, users/{uid}/state/
      aiJob:{id}) para que sobreviva un refresh/reapertura -- pero la
      llamada EN VUELO muere si la pestana se cierra a la mitad, como
      cualquier fetch del navegador. Sigue en uso por Takeoff/Visual AI.

   B) Jobs "server-driven" (startServerJob, Fase 2 -- ver
      server/api-lib/_route-jobs.mjs): la llamada a OpenAI la hace EL
      SERVIDOR (Vercel Function + waitUntil), disparada por un POST que
      responde de inmediato con un jobId. El documento
      users/{uid}/jobs/{jobId} es de SOLO LECTURA para el cliente
      (firestore.rules) -- este Provider solo escucha (onSnapshot, nunca
      polling) via UN listener compartido (subscribeToRecentServerJobs) en
      vez de un listener por job. Usado hoy por generacion de APU con IA
      (generateAI en main.jsx). Ver el informe de la Fase 2 para el detalle
      de por que esto SI sobrevive cerrar la pestana/apagar el equipo
      (dentro del maxDuration configurado) y las limitaciones reales que
      quedan (duracion maxima de la funcion, sin cola/reintentos
      duraderos). */
const AiJobsContext = createContext(null);

function mapServerJobToLocal(raw, { label, seen }){
  const status = raw.status === 'queued' ? 'pending' : raw.status;
  return {
    id: raw.id,
    type: raw.type,
    label: label ?? '',
    payload: raw.payload ?? null,
    status,
    result: raw.result ?? null,
    error: raw.error ?? null,
    progressCode: raw.progressCode || null,
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
    startedAt: raw.startedAt || null,
    finishedAt: raw.completedAt || null,
    seen: Boolean(seen),
    origin: 'server',
  };
}

export function AiJobsProvider({ children }){
  const [jobs, setJobs] = useState({});
  const [uid, setUid] = useState(null);
  const seqRef = useRef(0);
  const uidRef = useRef(null);
  const labelsRef = useRef({});
  const seenRef = useRef(new Set());
  const waitersRef = useRef(new Map());
  useEffect(() => { uidRef.current = uid; }, [uid]);

  useEffect(() => {
    if(!firebaseReady) return undefined;
    return onAuthStateChanged(auth, (fbUser) => setUid(fbUser?.uid || null));
  }, []);

  // Hidratacion: al iniciar sesion (o recargar con sesion ya activa), trae
  // los jobs recientes de Firestore y los mezcla al store en memoria. Un job
  // que quedo "processing" de una sesion anterior (pestana cerrada/recargada
  // a la mitad) se reclasifica antes de mostrarse -- ver comentario de
  // cabecera. Nunca pisa un job que YA existe en memoria de esta sesion
  // (evita una condicion de carrera con un job recien iniciado localmente).
  useEffect(() => {
    if(!firebaseReady || !uid) return;
    let alive = true;
    (async () => {
      const cloudJobs = await loadRecentJobsFromCloud(db, uid);
      if(!alive || !cloudJobs.length) return;
      setJobs(prev => {
        const next = { ...prev };
        for(const raw of cloudJobs){
          if(!raw?.id || next[raw.id]) continue;
          next[raw.id] = markInterruptedOnLoad(raw);
        }
        return next;
      });
    })();
    return () => { alive = false; };
  }, [uid]);

  // Jobs server-side (mecanismo B): UN solo listener compartido para los
  // jobs recientes del usuario -- nunca un listener por job, para
  // mantenerlo barato (ver informe de costos de la Fase 2). Cualquier job
  // nuevo (startServerJob) aparece aqui solo, en el siguiente snapshot: no
  // hace falta suscribirse individualmente a cada uno.
  useEffect(() => {
    if(!firebaseReady || !uid) return undefined;
    seenRef.current = loadSeenServerJobIds(uid);
    const unsub = subscribeToRecentServerJobs(db, uid, (rawJobs) => {
      setJobs(prev => {
        const next = { ...prev };
        for(const raw of rawJobs){
          if(!raw?.id) continue;
          const wasTerminal = prev[raw.id] && isTerminalJobStatus(prev[raw.id].status);
          const label = labelsRef.current[raw.id] ?? prev[raw.id]?.label;
          const mapped = mapServerJobToLocal(raw, { label, seen: seenRef.current.has(raw.id) });
          next[raw.id] = mapped;
          if(isTerminalJobStatus(mapped.status) && !wasTerminal){
            const title = mapped.label || 'Proceso';
            window.zoemecNotify?.(
              mapped.status === 'completed' ? `${title}: listo.` : `${title}: ${mapped.error || 'no se pudo completar.'}`,
              mapped.status === 'completed' ? 'success' : 'error'
            );
          }
          // Resuelve a quien este esperando este job puntual (ver
          // waitForJob) -- fuera del updater de setJobs a proposito (no
          // debe repetirse si React reintenta el updater).
          if(isTerminalJobStatus(mapped.status)){
            const waiters = waitersRef.current.get(raw.id);
            if(waiters?.length){ waiters.forEach(fn => fn(mapped)); waitersRef.current.delete(raw.id); }
          }
        }
        return next;
      });
    }, (err) => { console.error('[AiJobsContext] server jobs listener error', err); });
    return () => { unsub(); };
  }, [uid]);

  const persist = useCallback((job) => {
    const currentUid = uidRef.current;
    if(!firebaseReady || !currentUid || !job) return;
    // JSON round-trip: quita undefined (Firestore rechaza setDoc con
    // cualquier valor undefined anidado) sin tener que sanear a mano cada
    // forma de resultado distinta que pueda traer cada tipo de job.
    let safe;
    try{ safe = JSON.parse(JSON.stringify(job)); }catch{ return; }
    saveJobToCloud(db, currentUid, safe);
  }, []);

  const startJob = useCallback((type, label, runner) => {
    const id = `${type}-${Date.now()}-${++seqRef.current}`;
    const initial = markJobProcessing(createJob({ id, type, label }));
    setJobs(prev => ({ ...prev, [id]: initial }));
    persist(initial);
    addToIndex(db, uidRef.current, id);
    Promise.resolve()
      .then(() => runner())
      .then(result => {
        setJobs(prev => {
          if(!prev[id]) return prev;
          const next = markJobCompleted(prev[id], result);
          persist(next);
          return { ...prev, [id]: next };
        });
        window.zoemecNotify?.(label ? `${label}: listo.` : 'Proceso completado.', 'success');
      })
      .catch(error => {
        setJobs(prev => {
          if(!prev[id]) return prev;
          const next = markJobFailed(prev[id], error);
          persist(next);
          return { ...prev, [id]: next };
        });
        window.zoemecNotify?.(label ? `${label}: ${error?.message || 'no se pudo completar.'}` : (error?.message || 'Un proceso en segundo plano fallo.'), 'error');
      });
    return id;
  }, [persist]);

  /* Job server-side (mecanismo B, Fase 2): POST /api/jobs, que responde con
     el jobId de inmediato -- la ejecucion real sigue en el servidor
     (waitUntil) sin depender de que esta pestana siga abierta. `label` se
     guarda solo localmente (el documento del job no lo trae) para mostrarlo
     en el banner de recuperacion y el centro de "Procesos". */
  const startServerJob = useCallback(async (type, label, { payload, idempotencyKey, projectId } = {}) => {
    const key = idempotencyKey || `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const { jobId } = await createServerJob({ type, payload, idempotencyKey: key, projectId });
    labelsRef.current[jobId] = label;
    setJobs(prev => (prev[jobId] ? prev : {
      ...prev,
      [jobId]: mapServerJobToLocal({ id: jobId, type, status: 'processing', createdAt: Date.now(), updatedAt: Date.now() }, { label, seen: false }),
    }));
    return jobId;
  }, []);

  const consumeJob = useCallback((id) => {
    setJobs(prev => (prev[id] ? { ...prev, [id]: markJobSeen(prev[id]) } : prev));
    if(jobs[id]?.origin === 'server'){
      seenRef.current.add(id);
      markServerJobSeen(uidRef.current, id);
    }else if(uidRef.current){
      deleteJobFromCloud(db, uidRef.current, id);
    }
  }, [jobs]);

  /* Variante de bajo nivel para pantallas que ya tienen su propio try/catch
     (ej. generateAI en la pantalla APU): registran el job al empezar y lo
     cierran ellas mismas en el punto exacto donde hoy hacen setState, sin
     tener que mover su pipeline completo a un "runner" externo. El job
     sirve como respaldo -- si la pantalla se desmonto antes de que la
     promesa resolviera, el resultado queda aqui (nunca se pierde) en vez de
     unicamente en el useState local que ya no existe. */
  const beginJob = useCallback((type, label) => {
    const id = `${type}-${Date.now()}-${++seqRef.current}`;
    const initial = markJobProcessing(createJob({ id, type, label }));
    setJobs(prev => ({ ...prev, [id]: initial }));
    persist(initial);
    addToIndex(db, uidRef.current, id);
    return id;
  }, [persist]);

  const completeJob = useCallback((id, result, { notify = true, label } = {}) => {
    setJobs(prev => {
      if(!prev[id]) return prev;
      const next = markJobCompleted(prev[id], result);
      persist(next);
      return { ...prev, [id]: next };
    });
    if(notify) window.zoemecNotify?.((label || jobs[id]?.label) ? `${label || jobs[id]?.label}: listo.` : 'Proceso completado.', 'success');
  }, [jobs, persist]);

  const failJob = useCallback((id, error, { notify = true, label } = {}) => {
    setJobs(prev => {
      if(!prev[id]) return prev;
      const next = markJobFailed(prev[id], error);
      persist(next);
      return { ...prev, [id]: next };
    });
    if(notify) window.zoemecNotify?.(`${label || jobs[id]?.label || 'Proceso'}: ${error?.message || 'no se pudo completar.'}`, 'error');
  }, [jobs, persist]);

  const getJob = useCallback((id) => jobs[id] || null, [jobs]);
  const getUnseen = useCallback((type) => unseenJobsOfType(jobs, type), [jobs]);

  /* Deja a un llamador (ej. generateAI) esperar el resultado de un job
     server-side como si fuera un fetch normal -- await startServerJob(...)
     seguido de await waitForJob(jobId) -- sin que el resto de su logica
     (enriquecimiento de precios, identidad, aplicar al formulario) tenga
     que saber que el resultado en realidad llego por un listener de
     Firestore y no por la respuesta HTTP. Se resuelve con el job mapeado
     completo (status/result/error); el llamador decide que hacer con cada
     status, igual que antes decidia con try/catch sobre el fetch. */
  const waitForJob = useCallback((jobId) => new Promise((resolve) => {
    const existing = jobs[jobId];
    if(existing && isTerminalJobStatus(existing.status)){ resolve(existing); return; }
    const list = waitersRef.current.get(jobId) || [];
    list.push(resolve);
    waitersRef.current.set(jobId, list);
  }), [jobs]);

  const value = useMemo(() => ({
    jobs,
    startJob,
    startServerJob,
    waitForJob,
    beginJob,
    completeJob,
    failJob,
    consumeJob,
    getJob,
    getUnseen,
    activeJobs: activeJobsOf(jobs),
  }), [jobs, startJob, startServerJob, waitForJob, beginJob, completeJob, failJob, consumeJob, getJob, getUnseen]);

  return <AiJobsContext.Provider value={value}>{children}</AiJobsContext.Provider>;
}

export function useAiJobs(){
  const ctx = useContext(AiJobsContext);
  if(!ctx) throw new Error('useAiJobs debe usarse dentro de <AiJobsProvider>');
  return ctx;
}
