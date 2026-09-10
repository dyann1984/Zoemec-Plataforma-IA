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

   NIVEL REAL DE PERSISTENCIA (auditoria explicita, ver src/lib/aiJobsCloud.js
   para el detalle tecnico):
   - Cambiar de modulo/ruta dentro de la app: SI sobrevive (este Provider
     nunca se desmonta -- estado en memoria de React, intacto).
   - Cambiar de pestana del navegador / minimizar la ventana: SI sobrevive
     (el proceso de JS de la pestana sigue vivo; los navegadores pueden
     limitar timers en segundo plano pero no matan el estado ni el fetch en
     curso).
   - Refrescar la pagina (F5) o cerrar y volver a abrir ZOEMEC: el ESTADO Y
     RESULTADO de un job que ya alcanzo a terminar (completed/failed) SI se
     recupera -- se espeja a Firestore (users/{uid}/state/aiJob:{id}) en cada
     cambio y se rehidrata al montar. Un job que seguia "processing" en el
     momento exacto del refresh/cierre NO puede reclamar que sigue en curso
     de verdad: la llamada HTTP a /api/generate-apu (o /api/visual-ai) muere
     junto con la pestana como cualquier fetch del navegador -- eso lo
     reclasifica honestamente a "failed" al rehidratar (markInterruptedOnLoad)
     en vez de dejarlo "processing" para siempre o fingir que termino.
     Sobrevivir tambien la llamada EN VUELO durante un cierre de pestana
     requeriria mover la ejecucion de la IA a un proceso que no dependa de la
     conexion del navegador (ej. un job real server-side con Firestore como
     cola) -- cambio de arquitectura de backend, fuera de alcance de esta
     ronda; el codigo esta preparado para conectarse a eso despues (mismo
     jobId/status ya modelado) sin otro rediseno del lado del cliente. */
const AiJobsContext = createContext(null);

export function AiJobsProvider({ children }){
  const [jobs, setJobs] = useState({});
  const [uid, setUid] = useState(null);
  const seqRef = useRef(0);
  const uidRef = useRef(null);
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

  const consumeJob = useCallback((id) => {
    setJobs(prev => (prev[id] ? { ...prev, [id]: markJobSeen(prev[id]) } : prev));
    if(uidRef.current) deleteJobFromCloud(db, uidRef.current, id);
  }, []);

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

  const value = useMemo(() => ({
    jobs,
    startJob,
    beginJob,
    completeJob,
    failJob,
    consumeJob,
    getJob,
    getUnseen,
    activeJobs: activeJobsOf(jobs),
  }), [jobs, startJob, beginJob, completeJob, failJob, consumeJob, getJob, getUnseen]);

  return <AiJobsContext.Provider value={value}>{children}</AiJobsContext.Provider>;
}

export function useAiJobs(){
  const ctx = useContext(AiJobsContext);
  if(!ctx) throw new Error('useAiJobs debe usarse dentro de <AiJobsProvider>');
  return ctx;
}
