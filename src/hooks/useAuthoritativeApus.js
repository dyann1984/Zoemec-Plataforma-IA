/* Persistencia autoritativa de APU (Fase 7). Mismo contrato [value,
   setValue] que useCloudState/useAuthoritativeProjects, para que `rawApus`
   en main.jsx (el arreglo cross-proyecto de TODOS los APUs del usuario,
   que useProjectScoped ya filtra client-side por proyecto activo) siga
   funcionando sin cambios en el resto del archivo.

   Diferencia deliberada con useAuthoritativeProjects: aqui `setApus` SOLO
   dispara altas (create) y bajas (archive) automaticas por diff de ids --
   NUNCA crea una version nueva solo porque el contenido de un APU ya
   presente cambio. El versionado real (crear V2, V3...) es responsabilidad
   EXPLICITA de ProfessionalApuEditor.jsx#saveVersion (con estado visible
   guardando/guardado/error) -- si este hook tambien reaccionara a cambios
   de contenido, cada guardado terminaria creando DOS versiones para la
   misma edicion (una del editor, otra de aqui), duplicando el historial. */
import { useEffect, useRef } from 'react';
import { useCloudState, loadCloud } from '../cloud.js';
import { apiPost, apiGetSafe } from '../services/apiClient.js';

const CLOUD_KEY = 'zoemec-apus';

// El servidor guarda cada APU envuelto ({id, ownerUid, projectId,
// currentVersion, snapshot, ...}) -- el resto de la app espera el APU
// PLANO (mismo shape que siempre, con materials/labor/... al nivel raiz).
function unwrap(doc){
  return { ...doc.snapshot, id: doc.id, projectId: doc.projectId ?? doc.snapshot?.projectId ?? null };
}

function diffApus(prev, next){
  const prevIds = new Set(prev.map(a => a.id));
  const nextIds = new Set(next.map(a => a.id));
  const created = next.filter(a => !prevIds.has(a.id));
  const removed = prev.filter(a => !nextIds.has(a.id));
  return { created, removed };
}

/* Cierre del gap "APU sin projectId" (Fase 8 Parte 2, seccion 11 del spec):
   en el bootstrap, un APU legacy sin projectId se vincula automaticamente
   SOLO si el usuario tiene exactamente UN proyecto (sin ambiguedad posible
   -- mismo criterio "nunca adivinar" que la migracion transparente de
   blobs de Fase 7). Con 0 o mas de 1 proyecto, nunca se elige uno al azar:
   se marca `projectLinkRequired:true` EN MEMORIA (nunca persistido, nunca
   un campo nuevo en el servidor) para que la UI (main.jsx, lista "Mis APU
   guardados") ofrezca vincularlo manualmente. Un fallo de red al vincular
   automaticamente tambien cae a `projectLinkRequired` -- nunca se reintenta
   en silencio ni se bloquea el resto del bootstrap. */
export async function autoLinkOrphans(authoritative){
  const orphans = authoritative.filter(a => !a.projectId);
  if(!orphans.length) return authoritative;
  const projectsRes = await apiGetSafe('/api/projects');
  const projects = projectsRes?.projects || [];
  if(projects.length !== 1){
    return authoritative.map(a => (a.projectId ? a : { ...a, projectLinkRequired: true }));
  }
  const onlyProjectId = projects[0].id;
  const resolved = await Promise.all(orphans.map(async apu => {
    try{
      await apiPost('/api/apus', { action: 'link-project', id: apu.id, projectId: onlyProjectId });
      return { ...apu, projectId: onlyProjectId };
    }catch{
      return { ...apu, projectLinkRequired: true };
    }
  }));
  const resolvedById = new Map(resolved.map(a => [a.id, a]));
  return authoritative.map(a => resolvedById.get(a.id) || a);
}

export function useAuthoritativeApus(user, fallback = []){
  const [apus, setApusLocal] = useCloudState(user, CLOUD_KEY, fallback);
  const uid = user?.uid || null;
  const valueRef = useRef(apus);
  valueRef.current = apus;
  const bootstrappedForUid = useRef(null);

  useEffect(() => {
    if(!uid || bootstrappedForUid.current === uid) return;
    bootstrappedForUid.current = uid;
    let alive = true;
    (async () => {
      const res = await apiGetSafe('/api/apus');
      if(!alive || !res) return;
      const authoritative = (res.apus || []).map(unwrap);
      if(authoritative.length){ setApusLocal(await autoLinkOrphans(authoritative)); return; }
      const legacyCloud = await loadCloud(uid, CLOUD_KEY);
      const legacy = legacyCloud?.value?.length ? legacyCloud.value : valueRef.current;
      if(!alive || !legacy?.length) return;
      for(const apu of legacy){
        try{ await apiPost('/api/apus', { action: 'create', id: apu.id, projectId: apu.projectId || null, apu, reason: 'Migracion automatica desde almacenamiento anterior' }); }
        catch{ /* se reintenta la proxima vez que cargue la sesion */ }
      }
      const after = await apiGetSafe('/api/apus');
      if(alive) setApusLocal(after?.apus?.length ? after.apus.map(unwrap) : legacy);
    })();
    return () => { alive = false; };
  }, [uid]);

  const setApus = (next) => {
    const before = valueRef.current;
    const resolved = typeof next === 'function' ? next(before) : next;
    valueRef.current = resolved;
    setApusLocal(resolved);
    if(!uid) return;
    const { created, removed } = diffApus(before, resolved);
    created.forEach(apu => apiPost('/api/apus', { action: 'create', id: apu.id, projectId: apu.projectId || null, apu }).catch(() => {}));
    removed.forEach(apu => apiPost('/api/apus', { action: 'archive', id: apu.id }).catch(() => {}));
  };

  // Vinculo manual (UI, caso ambiguo: 0 o >1 proyectos -- el usuario elige).
  // Mismo endpoint que el auto-link; nunca duplica ni pierde el APU si ya
  // estaba vinculado (idempotente, ver api/apus.mjs#handleLinkProject).
  const linkProject = async (apuId, projectId) => {
    if(!apuId || !projectId) return;
    await apiPost('/api/apus', { action: 'link-project', id: apuId, projectId });
    const resolved = valueRef.current.map(a => (a.id === apuId ? { ...a, projectId, projectLinkRequired: false } : a));
    valueRef.current = resolved;
    setApusLocal(resolved);
  };

  return [apus, setApus, linkProject];
}
