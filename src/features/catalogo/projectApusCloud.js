/* Lista de APUs del proyecto activo, SIEMPRE fresca desde el servidor (Fase
   D.1 -- hallazgo de QA real en navegador: Catalogo/Presupuesto recibian
   `rawApus` como prop desde main.jsx#useAuthoritativeApus, que es el cache
   de sesion pensado para el editor de APU -- un APU creado por
   generateApuForConcepto.js/persistGeneratedApu (POST /api/apus directo,
   sin pasar por setApus) nunca aparecia ahi hasta recargar la pagina
   completa, asi que Presupuesto mostraba P.U./Confianza/Bid Risk en $0/"—"
   para un concepto que el Catalogo YA marcaba GENERADO. Catalogo y
   Presupuesto ahora piden su propia copia (GET /api/apus?projectId=) y la
   refrescan explicitamente despues de cada accion que crea/asocia un
   APU -- nunca dependen de que main.jsx se entere primero. */
import { useCallback, useEffect, useState } from 'react';
import { apiGetSafe } from '../../services/apiClient.js';

// Mismo criterio que useAuthoritativeApus.js#unwrap: el servidor guarda cada
// APU envuelto ({id, projectId, currentVersion, snapshot, ...}) -- el resto
// de la app espera el APU PLANO (materials/labor/... al nivel raiz).
function unwrap(doc){
  return {
    ...doc.snapshot,
    id: doc.id,
    projectId: doc.projectId ?? doc.snapshot?.projectId ?? null,
    currentVersion: doc.currentVersion ?? null,
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
    archivedAt: doc.archivedAt ?? null
  };
}

export function useProjectApus(user, projectId){
  const [apus, setApus] = useState([]);
  const [loading, setLoading] = useState(false);
  const uid = user?.uid || null;

  const reload = useCallback(async () => {
    if(!uid || !projectId){ setApus([]); return; }
    setLoading(true);
    const res = await apiGetSafe(`/api/apus?projectId=${encodeURIComponent(projectId)}`);
    setLoading(false);
    if(!res) return;
    setApus((res.apus || []).map(unwrap));
  }, [uid, projectId]);

  useEffect(() => { reload(); }, [reload]);

  return { apus, loading, reload };
}
