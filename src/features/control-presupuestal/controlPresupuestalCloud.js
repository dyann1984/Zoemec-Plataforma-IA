/* Cliente de Control Presupuestal (Fase E). Mismo transporte que
   catalogConceptosCloud.js/presupuestoCloud.js (apiPost/apiGetSafe) contra
   las 5 rutas nuevas: _route-change-orders.mjs, _route-commitments.mjs,
   _route-progress.mjs, _route-estimates.mjs, _route-payments.mjs. Cada
   entidad es un flujo de estado simple (change-orders/commitments/estimates)
   o un ledger append-only puro (progress/payments) -- ninguna necesita el
   patron [currentVersion/expectedParentVersionId] de presupuestoCloud.js,
   ver los comentarios de los propios esquemas de dominio para el porque. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiPost, apiGetSafe } from '../../services/apiClient.js';

function useSimpleCollection({ path, listKey, itemKey }){
  return function useEntity(user, projectId){
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const uid = user?.uid || null;
    const reqSeq = useRef(0);

    const reload = useCallback(async () => {
      if(!uid || !projectId){ setItems([]); return; }
      const seq = ++reqSeq.current;
      setLoading(true);
      const res = await apiGetSafe(`${path}?projectId=${encodeURIComponent(projectId)}`);
      if(seq !== reqSeq.current) return;
      setLoading(false);
      if(!res){ setError('No se pudo cargar la informacion.'); return; }
      setError(null);
      setItems(res[listKey] || []);
    }, [uid, projectId]);

    useEffect(() => { reload(); }, [reload]);

    const upsertLocal = (item) => setItems(list => {
      const idx = list.findIndex(x => x.id === item.id);
      if(idx === -1) return [item, ...list];
      const next = [...list]; next[idx] = item; return next;
    });

    const create = async (body) => {
      const res = await apiPost(path, { action: 'create', projectId, ...body });
      upsertLocal(res[itemKey]);
      return res[itemKey];
    };

    const setStatus = async (id, status, extra = {}) => {
      const res = await apiPost(path, { action: 'set-status', id, status, ...extra });
      upsertLocal(res[itemKey]);
      return res[itemKey];
    };

    return { items, loading, error, reload, create, setStatus };
  };
}

export const useChangeOrders = useSimpleCollection({ path: '/api/change-orders', listKey: 'changeOrders', itemKey: 'changeOrder' });
export const useCommitments = useSimpleCollection({ path: '/api/commitments', listKey: 'commitments', itemKey: 'commitment' });
export const useEstimates = useSimpleCollection({ path: '/api/estimates', listKey: 'estimates', itemKey: 'estimate' });

// progress/payments son ledgers puros -- sin set-status (no hay estado que
// transicionar, solo agregar renglones nuevos).
function useLedgerCollection({ path, listKey, itemKey }){
  return function useEntity(user, projectId){
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const uid = user?.uid || null;
    const reqSeq = useRef(0);

    const reload = useCallback(async () => {
      if(!uid || !projectId){ setItems([]); return; }
      const seq = ++reqSeq.current;
      setLoading(true);
      const res = await apiGetSafe(`${path}?projectId=${encodeURIComponent(projectId)}`);
      if(seq !== reqSeq.current) return;
      setLoading(false);
      if(!res){ setError('No se pudo cargar la informacion.'); return; }
      setError(null);
      setItems(res[listKey] || []);
    }, [uid, projectId]);

    useEffect(() => { reload(); }, [reload]);

    const create = async (body) => {
      const res = await apiPost(path, { action: 'create', projectId, ...body });
      setItems(list => [res[itemKey], ...list]);
      return res[itemKey];
    };

    return { items, loading, error, reload, create };
  };
}

export const useProgressEntries = useLedgerCollection({ path: '/api/progress', listKey: 'progressEntries', itemKey: 'progressEntry' });
export const usePayments = useLedgerCollection({ path: '/api/payments', listKey: 'payments', itemKey: 'payment' });
