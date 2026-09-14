/* Cliente del Catalogo de conceptos (Fase D). Mismo transporte que el resto
   de la app (src/services/apiClient.js#apiPost/apiGetSafe), pero SIN el
   patron [value,setValue] de useCloudState/useAuthoritativeApus: a
   diferencia de esas entidades (cross-proyecto, con migracion legacy de un
   blob anterior), catalogConceptos nace YA autoritativo y siempre
   proyecto-scoped -- no hay nada que migrar ni diffear por id, cada accion
   de negocio (crear/editar/cambiar estado/asociar/archivar) tiene su propio
   endpoint explicito en server/api-lib/_route-catalogo-conceptos.mjs. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiPost, apiGetSafe } from '../../services/apiClient.js';

const PATH = '/api/catalogo-conceptos';

export function useCatalogConceptos(user, projectId){
  const [conceptos, setConceptos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const uid = user?.uid || null;
  const reqSeq = useRef(0);

  const reload = useCallback(async () => {
    if(!uid || !projectId){ setConceptos([]); return; }
    const seq = ++reqSeq.current;
    setLoading(true);
    const res = await apiGetSafe(`${PATH}?projectId=${encodeURIComponent(projectId)}`);
    if(seq !== reqSeq.current) return; // respuesta obsoleta (cambio de proyecto mientras cargaba): se descarta
    setLoading(false);
    if(!res){ setError('No se pudo cargar el catalogo de conceptos.'); return; }
    setError(null);
    setConceptos(res.conceptos || []);
  }, [uid, projectId]);

  useEffect(() => { reload(); }, [reload]);

  const upsertLocal = (concepto) => setConceptos(list => {
    const idx = list.findIndex(c => c.id === concepto.id);
    if(idx === -1) return [concepto, ...list];
    const next = [...list]; next[idx] = concepto; return next;
  });

  const create = async (items, { reason } = {}) => {
    const res = await apiPost(PATH, { action: 'create', projectId, conceptos: items, reason });
    setConceptos(list => [...(res.conceptos || []), ...list]);
    return res;
  };

  const update = async (id, patch) => {
    const res = await apiPost(PATH, { action: 'update', id, patch });
    upsertLocal(res.concepto);
    return res.concepto;
  };

  const setStatus = async (id, status, extra = {}) => {
    const res = await apiPost(PATH, { action: 'set-status', id, status, ...extra });
    upsertLocal(res.concepto);
    return res.concepto;
  };

  const associateApu = async (id, apuId, { matchConfidence, matchMethod } = {}) => {
    const res = await apiPost(PATH, { action: 'associate-apu', id, apuId, matchConfidence, matchMethod });
    upsertLocal(res.concepto);
    return res.concepto;
  };

  const archive = async (id) => {
    await apiPost(PATH, { action: 'archive', id });
    setConceptos(list => list.filter(c => c.id !== id));
  };

  return { conceptos, loading, error, reload, create, update, setStatus, associateApu, archive };
}
