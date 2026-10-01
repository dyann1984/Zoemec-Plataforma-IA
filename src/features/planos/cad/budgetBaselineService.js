/* Cliente de deteccion de baseline y creacion de OC desde CAD (Fase 2 del
   plan integral). Solo red -- toda la logica de decision (baseline
   aprobado, duplicados, descripcion, evidencia) vive en modulos puros de
   src/domain (budgetBaselineLookup.js, changeOrderFromGeometry.js).

   Reutiliza los endpoints EXISTENTES sin extender el server:
   - /api/presupuestos?projectId=... (ya soporta list por proyecto, ver
     server/api-lib/_route-presupuestos.mjs#handleList)
   - /api/change-orders?projectId=... (list) y POST action=create (ya
     acepta el campo `evidencia` como objeto arbitrario, ver
     _route-change-orders.mjs#handleCreate).

   Cache: NO se cachea a proposito -- el baseline puede cambiar entre una
   sesion del usuario (otra persona aprueba un presupuesto), y el UI
   siempre pregunta antes de disparar la creacion de OC, asi que una
   consulta fresca por interaccion es lo mas seguro. */
import { apiGetSafe, apiPost } from '../../../services/apiClient.js';

export async function listProjectPresupuestos(projectId){
  if(!projectId) return [];
  const res = await apiGetSafe(`/api/presupuestos?projectId=${encodeURIComponent(projectId)}`);
  return Array.isArray(res?.presupuestos) ? res.presupuestos : [];
}

export async function listProjectChangeOrders(projectId){
  if(!projectId) return [];
  const res = await apiGetSafe(`/api/change-orders?projectId=${encodeURIComponent(projectId)}`);
  return Array.isArray(res?.changeOrders) ? res.changeOrders : [];
}

export async function createChangeOrder(payload){
  const res = await apiPost('/api/change-orders', payload);
  return res?.changeOrder || null;
}
