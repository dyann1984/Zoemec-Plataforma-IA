/* Cliente del Presupuesto (Fase D). Mismo transporte que catalogConceptosCloud.js
   (apiPost/apiGetSafe) contra server/api-lib/_route-presupuestos.mjs. A
   diferencia de catalogConceptos, un Presupuesto SI es versionado
   (currentVersion/baselineVersion) -- este hook expone `saveVersion` con
   `expectedParentVersionId` obligatorio (mismo control de concurrencia
   optimista que el resto de la app) y `approveBaseline` (set-once). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiPost, apiGetSafe } from '../../services/apiClient.js';

const PATH = '/api/presupuestos';

export function usePresupuesto(user, projectId){
  const [presupuesto, setPresupuesto] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const uid = user?.uid || null;
  const reqSeq = useRef(0);

  const reloadList = useCallback(async () => {
    if(!uid || !projectId){ setPresupuesto(null); return; }
    const seq = ++reqSeq.current;
    setLoading(true);
    const res = await apiGetSafe(`${PATH}?projectId=${encodeURIComponent(projectId)}`);
    if(seq !== reqSeq.current) return;
    setLoading(false);
    const list = res?.presupuestos || [];
    // El Presupuesto vigente de un proyecto es, por convencion de esta fase,
    // el unico no archivado mas reciente -- Fase D no soporta multiples
    // presupuestos paralelos por proyecto (eso es alcance de Control
    // Presupuestal, fuera de esta fase).
    const latest = list.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0] || null;
    setPresupuesto(latest);
    if(latest) reloadVersions(latest.id);
  }, [uid, projectId]);

  const reloadVersions = useCallback(async (id) => {
    const res = await apiGetSafe(`${PATH}?id=${encodeURIComponent(id)}`);
    setVersions(res?.versions || []);
  }, []);

  useEffect(() => { reloadList(); }, [reloadList]);

  const create = async (id, snapshot, { reason } = {}) => {
    const res = await apiPost(PATH, { action: 'create', id, projectId, snapshot, reason });
    setPresupuesto(res.presupuesto);
    return res.presupuesto;
  };

  const saveVersion = async (snapshot, { reason } = {}) => {
    if(!presupuesto) throw new Error('No hay presupuesto para guardar.');
    const res = await apiPost(PATH, { action: 'save-version', id: presupuesto.id, snapshot, reason, expectedParentVersionId: presupuesto.currentVersion });
    setPresupuesto(res.presupuesto);
    await reloadVersions(res.presupuesto.id);
    return res.presupuesto;
  };

  const restoreVersion = async (version) => {
    if(!presupuesto) return;
    const res = await apiPost(PATH, { action: 'restore-version', id: presupuesto.id, version });
    setPresupuesto(res.presupuesto);
    await reloadVersions(res.presupuesto.id);
    return res.presupuesto;
  };

  const approveBaseline = async () => {
    if(!presupuesto) return;
    const res = await apiPost(PATH, { action: 'approve-baseline', id: presupuesto.id });
    setPresupuesto(res.presupuesto);
    return res.presupuesto;
  };

  return { presupuesto, versions, loading, reload: reloadList, create, saveVersion, restoreVersion, approveBaseline };
}
