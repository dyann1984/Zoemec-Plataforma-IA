/* Cliente de Project Sentinel (Fase G). `list` (GET) es una lectura pura
   -- nunca dispara una reevaluacion; `evaluate` es la unica accion que
   recalcula y persiste (el usuario la dispara explicitamente, ej. boton
   "Analizar ahora"). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiPost, apiGetSafe } from '../../services/apiClient.js';

export function useSentinel(user, projectId){
  const [alerts, setAlerts] = useState([]);
  const [healthTrend, setHealthTrend] = useState({ scoresLabel: '', points: [], dimensionChanges: [] });
  const [loading, setLoading] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState(null);
  const uid = user?.uid || null;
  const reqSeq = useRef(0);

  const reload = useCallback(async () => {
    if(!uid || !projectId){ setAlerts([]); return; }
    const seq = ++reqSeq.current;
    setLoading(true);
    const res = await apiGetSafe(`/api/sentinel?projectId=${encodeURIComponent(projectId)}`);
    if(seq !== reqSeq.current) return;
    setLoading(false);
    if(!res){ setError('No se pudo cargar Project Sentinel.'); return; }
    setError(null);
    setAlerts(res.alerts || []);
    setHealthTrend(res.healthTrend || { scoresLabel: '', points: [], dimensionChanges: [] });
  }, [uid, projectId]);

  useEffect(() => { reload(); }, [reload]);

  const evaluate = async () => {
    setEvaluating(true);
    try{
      const res = await apiPost('/api/sentinel', { action: 'evaluate', projectId });
      setAlerts(res.alerts || []);
      await reload();
      return res;
    } finally {
      setEvaluating(false);
    }
  };

  const setStatus = async (id, status, comment) => {
    const res = await apiPost('/api/sentinel', { action: 'set-status', id, status, comment });
    setAlerts(list => list.map(a => a.id === res.alert.id ? res.alert : a));
    return res.alert;
  };

  return { alerts, healthTrend, loading, evaluating, error, reload, evaluate, setStatus };
}
