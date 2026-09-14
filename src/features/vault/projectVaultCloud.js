/* Cliente del Project Vault (Fase F). Un unico GET agregador
   (/api/project-vault, ver server/api-lib/_route-project-vault.mjs) en vez
   de que la UI dispare 15 llamadas sueltas -- exactamente la seccion 14 del
   pedido. `generateDnaVersion` llama a la ruta separada de Construction DNA
   y recarga el Vault completo despues (el snapshot vigente del DNA vive
   dentro de la respuesta del Vault). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiPost, apiGetSafe } from '../../services/apiClient.js';

export function useProjectVault(user, projectId){
  const [vault, setVault] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatingDna, setGeneratingDna] = useState(false);
  const uid = user?.uid || null;
  const reqSeq = useRef(0);

  const reload = useCallback(async () => {
    if(!uid || !projectId){ setVault(null); return; }
    const seq = ++reqSeq.current;
    setLoading(true);
    const res = await apiGetSafe(`/api/project-vault?projectId=${encodeURIComponent(projectId)}`);
    if(seq !== reqSeq.current) return; // respuesta obsoleta (cambio de proyecto mientras cargaba)
    setLoading(false);
    if(!res){ setError('No se pudo cargar el Project Vault.'); return; }
    setError(null);
    setVault(res);
  }, [uid, projectId]);

  useEffect(() => { reload(); }, [reload]);

  const generateDnaVersion = async (reason) => {
    setGeneratingDna(true);
    try{
      const res = await apiPost('/api/construction-dna', { action: 'generate', projectId, reason });
      await reload();
      return res;
    } finally {
      setGeneratingDna(false);
    }
  };

  return { vault, loading, error, reload, generateDnaVersion, generatingDna };
}
