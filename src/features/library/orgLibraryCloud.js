/* Cliente de la biblioteca EMPRESARIAL (/api/org-library, P0 paridad ADMIN
   vs COLLABORATOR). Solo red: RBAC y resolucion viven en el servidor.
   A diferencia de apiGetSafe, los errores NO se ocultan -- una falla de
   permisos debe verse como tal, nunca como "biblioteca vacia". */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiPost, authHeaders, readJsonSafe } from '../../services/apiClient.js';

const PATH = '/api/org-library';

async function apiGet(path){
  const res = await fetch(path, { headers: await authHeaders() });
  const data = await readJsonSafe(res);
  if(!res.ok){
    const err = new Error(data?.error || `No se pudo leer la biblioteca empresarial (HTTP ${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function useOrgLibrary(user, organizationId, { projectId = null } = {}){
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if(!user?.uid || !organizationId){ setEntries([]); setError(''); return; }
    const mine = ++seq.current;
    setLoading(true); setError('');
    try{
      const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
      const data = await apiGet(`${PATH}${qs}`);
      if(mine === seq.current) setEntries(Array.isArray(data?.entries) ? data.entries : []);
    }catch(err){
      if(mine === seq.current){ setEntries([]); setError(err.message); }
    }finally{
      if(mine === seq.current) setLoading(false);
    }
  }, [user?.uid, organizationId, projectId]);
  useEffect(() => { reload(); }, [reload]);
  return { entries, loading, error, reload };
}

export async function createOrgLibraryEntries(entries, { projectId = null } = {}){
  return apiPost(PATH, { action: 'create', entries, projectId });
}
export async function updateOrgLibraryEntry(id, patch){
  const res = await apiPost(PATH, { action: 'update', id, patch });
  return res?.entry || null;
}
export async function archiveOrgLibraryEntry(id){
  const res = await apiPost(PATH, { action: 'archive', id });
  return res?.entry || null;
}
/* rows: catalogo PERSONAL del propio usuario (blob zoemec-catalogo). Solo
   se envia cuando el usuario pulsa explicitamente "Copiar a biblioteca de
   empresa"; el blob personal nunca se modifica. */
export async function previewPersonalImport(rows, { region = '' } = {}){
  const res = await apiPost(PATH, { action: 'import-preview', rows, region });
  return res?.preview || null;
}
export async function commitPersonalImport(rows, { region = '', applyUpdates = false } = {}){
  const res = await apiPost(PATH, { action: 'import-commit', rows, region, applyUpdates });
  return res?.result || null;
}
/* Contexto que usaria la IA para este proyecto (sin llamar a la IA). */
export async function fetchApuContextPreview({ projectId = null, concept = '', includeCatalog = false } = {}){
  const res = await apiPost(PATH, { action: 'context-preview', projectId, concept, includeCatalog });
  return res?.context || null;
}
