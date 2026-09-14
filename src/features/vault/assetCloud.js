/* Cliente del ciclo de vida del activo (Fase G). CapEx y plan de
   renovacion vienen YA calculados en la misma respuesta de GET (el
   servidor los recalcula en vivo sobre los componentes, sin
   almacenamiento propio -- ver _route-assets.mjs). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiPost, apiGetSafe } from '../../services/apiClient.js';

export function useAsset(user, projectId){
  const [asset, setAsset] = useState(null);
  const [components, setComponents] = useState([]);
  const [capex, setCapex] = useState([]);
  const [renewalPlan, setRenewalPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const uid = user?.uid || null;
  const reqSeq = useRef(0);

  const reload = useCallback(async () => {
    if(!uid || !projectId){ setAsset(null); setComponents([]); setCapex([]); setRenewalPlan(null); return; }
    const seq = ++reqSeq.current;
    setLoading(true);
    const res = await apiGetSafe(`/api/assets?projectId=${encodeURIComponent(projectId)}`);
    if(seq !== reqSeq.current) return;
    setLoading(false);
    if(!res){ setError('No se pudo cargar el Activo.'); return; }
    setError(null);
    setAsset(res.asset); setComponents(res.components || []); setCapex(res.capex || []); setRenewalPlan(res.renewalPlan);
  }, [uid, projectId]);

  useEffect(() => { reload(); }, [reload]);

  const createFromProject = async (fields) => {
    const res = await apiPost('/api/assets', { action: 'create-from-project', projectId, ...fields });
    await reload();
    return res.asset;
  };

  const addComponent = async (fields) => {
    const res = await apiPost('/api/assets', { action: 'add-component', assetId: projectId, ...fields });
    await reload();
    return res.component;
  };

  return { asset, components, capex, renewalPlan, loading, error, reload, createFromProject, addComponent };
}
