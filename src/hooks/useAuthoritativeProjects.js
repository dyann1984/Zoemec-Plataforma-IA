/* Persistencia autoritativa de Proyecto (Fase 7). Mismo contrato
   [value, setValue] que useCloudState (src/cloud.js) para que main.jsx no
   tenga que cambiar como consume `projects` -- pero ahora cada alta/edicion/
   baja pasa por api/projects.mjs (validado, auditado, transaccional) en vez
   de escribirse directo a un blob de Firestore desde el navegador.

   useCloudState se REUSA tal cual (no se reimplementa cache local/offline):
   este hook solo le agrega, por encima, la sincronizacion autoritativa:
   1. Al detectar sesion: trae la lista real del servidor. Si ya hay datos
      ahi, esos son la fuente de verdad (reemplazan lo que hubiera local).
   2. Si el servidor esta vacio pero existe un blob legado (el que ya
      escribia useCloudState antes de Fase 7), lo MIGRA una sola vez -- cada
      proyecto legado se crea via la API (idempotente por id, nunca
      duplica). El blob legado nunca se borra ni se modifica.
   3. Cada `setProjects(next)` calcula que cambio (alta/edicion/baja por id)
      contra el valor anterior y dispara la llamada correspondiente en
      segundo plano (create/update/archive) -- "eliminar" en la UI
      (Projects#remove en main.jsx) se traduce a archive, nunca a un
      borrado duro (se conserva auditoria/historial). */
import { useEffect, useRef } from 'react';
import { useCloudState, loadCloud } from '../cloud.js';
import { apiPost, apiGetSafe } from '../services/apiClient.js';

const CLOUD_KEY = 'zoemec-projects';

function diffProjects(prev, next){
  const prevIds = new Set(prev.map(p => p.id));
  const nextIds = new Set(next.map(p => p.id));
  const created = next.filter(p => !prevIds.has(p.id));
  const removed = prev.filter(p => !nextIds.has(p.id));
  const updated = next.filter(p => {
    if(!prevIds.has(p.id) || removed.some(r => r.id === p.id)) return false;
    const before = prev.find(b => b.id === p.id);
    return JSON.stringify(before) !== JSON.stringify(p);
  });
  return { created, updated, removed };
}

export function useAuthoritativeProjects(user, fallback = []){
  const [projects, setProjectsLocal] = useCloudState(user, CLOUD_KEY, fallback);
  const uid = user?.uid || null;
  const valueRef = useRef(projects);
  valueRef.current = projects;
  const bootstrappedForUid = useRef(null);

  useEffect(() => {
    if(!uid || bootstrappedForUid.current === uid) return;
    bootstrappedForUid.current = uid;
    let alive = true;
    (async () => {
      const res = await apiGetSafe('/api/projects');
      if(!alive || !res) return;
      const authoritative = res.projects || [];
      if(authoritative.length){ setProjectsLocal(authoritative); return; }
      // Servidor vacio: puede ser una cuenta nueva, o una cuenta anterior a
      // Fase 7 con datos solo en el blob legado -- se lee ese blob
      // DIRECTAMENTE (loadCloud, no el estado de useCloudState) para no
      // depender de en que orden terminen los dos efectos async.
      const legacyCloud = await loadCloud(uid, CLOUD_KEY);
      const legacy = legacyCloud?.value?.length ? legacyCloud.value : valueRef.current;
      if(!alive || !legacy?.length) return;
      for(const project of legacy){
        try{ await apiPost('/api/projects', { action: 'create', ...project, migratedFrom: 'legacy-blob' }); }
        catch{ /* se reintenta la proxima vez que cargue la sesion */ }
      }
      const after = await apiGetSafe('/api/projects');
      if(alive) setProjectsLocal(after?.projects?.length ? after.projects : legacy);
    })();
    return () => { alive = false; };
  }, [uid]);

  const setProjects = (next) => {
    const before = valueRef.current;
    const resolved = typeof next === 'function' ? next(before) : next;
    valueRef.current = resolved;
    setProjectsLocal(resolved);
    if(!uid) return;
    const { created, updated, removed } = diffProjects(before, resolved);
    created.forEach(p => apiPost('/api/projects', { action: 'create', ...p }).catch(() => {}));
    updated.forEach(p => apiPost('/api/projects', { action: 'update', ...p }).catch(() => {}));
    removed.forEach(p => apiPost('/api/projects', { action: 'archive', id: p.id }).catch(() => {}));
  };

  return [projects, setProjects];
}
