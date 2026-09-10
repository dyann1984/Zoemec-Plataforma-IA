import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  activeJobs as activeJobsOf,
  createJob,
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
  markJobSeen,
  unseenJobsOfType,
} from '../domain/aiJobQueue.js';

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
   si no lo estan. */
const AiJobsContext = createContext(null);

export function AiJobsProvider({ children }){
  const [jobs, setJobs] = useState({});
  const seqRef = useRef(0);

  const startJob = useCallback((type, label, runner) => {
    const id = `${type}-${Date.now()}-${++seqRef.current}`;
    setJobs(prev => ({ ...prev, [id]: markJobProcessing(createJob({ id, type, label })) }));
    Promise.resolve()
      .then(() => runner())
      .then(result => {
        setJobs(prev => (prev[id] ? { ...prev, [id]: markJobCompleted(prev[id], result) } : prev));
        window.zoemecNotify?.(label ? `${label}: listo.` : 'Proceso completado.', 'success');
      })
      .catch(error => {
        setJobs(prev => (prev[id] ? { ...prev, [id]: markJobFailed(prev[id], error) } : prev));
        window.zoemecNotify?.(label ? `${label}: ${error?.message || 'no se pudo completar.'}` : (error?.message || 'Un proceso en segundo plano fallo.'), 'error');
      });
    return id;
  }, []);

  const consumeJob = useCallback((id) => {
    setJobs(prev => (prev[id] ? { ...prev, [id]: markJobSeen(prev[id]) } : prev));
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
    setJobs(prev => ({ ...prev, [id]: markJobProcessing(createJob({ id, type, label })) }));
    return id;
  }, []);

  const completeJob = useCallback((id, result, { notify = true, label } = {}) => {
    setJobs(prev => (prev[id] ? { ...prev, [id]: markJobCompleted(prev[id], result) } : prev));
    if(notify) window.zoemecNotify?.((label || jobs[id]?.label) ? `${label || jobs[id]?.label}: listo.` : 'Proceso completado.', 'success');
  }, [jobs]);

  const failJob = useCallback((id, error, { notify = true, label } = {}) => {
    setJobs(prev => (prev[id] ? { ...prev, [id]: markJobFailed(prev[id], error) } : prev));
    if(notify) window.zoemecNotify?.(`${label || jobs[id]?.label || 'Proceso'}: ${error?.message || 'no se pudo completar.'}`, 'error');
  }, [jobs]);

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
