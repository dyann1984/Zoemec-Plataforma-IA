/* Composicion de una Orden de Cambio a partir de un cambio geometrico del
   CAD (Fase 2 del plan integral). Modulo puro, sin React ni Firebase.

   PROPOSITO (reglas 3, 4 y 8 del encargo):
   - Reutilizar changeOrderSchema.js -- este modulo NUNCA reimplementa la
     validacion, transiciones ni impacto economico (esos siguen viviendo en
     changeOrderSchema.js/computeChangeOrderEconomicImpact).
   - Componer descripcion determinista (regla 3 del encargo: "puede
     construirse automaticamente con datos deterministas").
   - Guardar trazabilidad estructurada (regla 4: "no debe depender solo de
     texto libre") en el campo `evidencia`, que el server acepta tal cual
     -- ver server/api-lib/_route-change-orders.mjs#handleCreate. `evidencia`
     es el unico canal aditivo para no modificar el schema del server, y
     tiene sentido semantico: la evidencia del origen del cambio es
     literalmente la geometria/plano/muro que lo motivo.
   - Detectar duplicados (regla 8) contra las OCs YA existentes del
     proyecto sobre el MISMO (conceptoId, origenElementoId), consultando
     `evidencia.origenElementoId` -- server-side deja pasar la creacion,
     pero este modulo bloquea client-side ANTES de disparar la red.

   Nota sobre `cantidadAnterior/pu` (regla 11 del encargo): el server SIEMPRE
   los recalcula en el momento de la creacion, leyendo el concepto y el
   APU reales (ver _route-change-orders.mjs#handleCreate lineas 81-103) --
   nunca acepta valores capturados a mano. Este modulo entrega valores de
   REFERENCIA para la UI (para poder mostrar "P.U. $748.15" antes de
   crear la OC), pero el server los reemplaza con los reales si difieren --
   lo cual es lo correcto: el numero contractual no puede depender de que
   el CAD tenga el APU sincronizado. */

import { computeChangeOrderEconomicImpact, CHANGE_ORDER_STATUS } from './changeOrderSchema.js';

/* Numero seguro con hasta N decimales */
function fmt(n, d = 3){
  const num = Number(n);
  if(!Number.isFinite(num)) return '0';
  return num.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/* Descripcion tecnica determinista para la OC. Nunca inventa texto libre --
   arma la frase con los datos reales de la geometria (elementLabel,
   propertyChanged, oldValue, newValue), la cantidad (unit), y el concepto.
   Reglas de brevedad: una sola frase, sin adjetivos. */
export function composeGeometryChangeDescription({
  elementLabel = 'elemento', propertyChanged = null, oldValue = null, newValue = null,
  cantidadAnterior = null, cantidadNueva = null, unit = '', conceptLabel = null
}){
  const parts = [];
  parts.push(`Modificacion geometrica detectada en ${elementLabel}.`);
  if(propertyChanged && oldValue != null && newValue != null){
    parts.push(`La ${propertyChanged} cambio de ${fmt(oldValue)} a ${fmt(newValue)} m`);
  }
  if(cantidadAnterior != null && cantidadNueva != null){
    const sep = parts[parts.length-1].endsWith('.') ? '' : ', ';
    parts[parts.length-1] = parts[parts.length-1] + `${sep}modificando la cantidad de ${fmt(cantidadAnterior)} a ${fmt(cantidadNueva)} ${unit}`.trim();
  }
  if(conceptLabel) parts.push(`Concepto contractual: ${conceptLabel}.`);
  return parts.join(' ').replace(/\s+\./g, '.').trim();
}

/* Motivo por defecto (mismo criterio de brevedad, siempre en la misma forma
   -- este texto viaja al campo obligatorio `motivo` de changeOrderSchema y
   es lo que ve la lista de OCs para triage rapido). */
export function composeGeometryChangeMotivo({ elementLabel = 'elemento' } = {}){
  return `Cambio geometrico en ${elementLabel}`;
}

/* Trazabilidad estructurada -- viaja en el campo `evidencia` del schema
   (ya persistido tal cual por _route-change-orders.mjs). NUNCA se toca a
   mano en el UI, siempre se genera desde datos deterministas del cambio. */
export function buildGeometryEvidence({
  origenElementoId, planoId = null, surveyId = null, spaceId = null,
  cadElementId = null, cadElementKind = null,
  propertyChanged = null, oldValue = null, newValue = null,
  geometrySnapshotBefore = null, geometrySnapshotAfter = null,
  requiresNewApu = false, requiresNewApuReason = null,
  createdBy = null, createdAt = null
}){
  return {
    generatedFrom: 'cad-geometry-change',
    origenElementoId: origenElementoId || null,
    planoId: planoId || null,
    surveyId: surveyId || null,
    spaceId: spaceId || null,
    cadElementId: cadElementId || null,
    cadElementKind: cadElementKind || null,
    propertyChanged, oldValue, newValue,
    geometrySnapshotBefore: geometrySnapshotBefore || null,
    geometrySnapshotAfter: geometrySnapshotAfter || null,
    requiresNewApu: !!requiresNewApu,
    requiresNewApuReason: requiresNewApuReason || null,
    createdBy: createdBy || null,
    createdAt: createdAt || new Date().toISOString()
  };
}

/* Impacto economico de referencia (para mostrar antes de crear la OC).
   Reusa computeChangeOrderEconomicImpact del schema -- nunca duplica la
   formula. */
export function computeReferenceImpact({ cantidadAnterior, cantidadNueva, pu }){
  return computeChangeOrderEconomicImpact({ cantidadAnterior, cantidadNueva, pu });
}

/* Payload listo para POST /api/change-orders con action=create. El server
   solo consume { projectId, conceptoId, motivo, descripcion, cantidadNueva,
   impactoTiempoDias, evidencia } -- todo lo demas es refetch server-side.
   Este helper garantiza que los campos que SI viajan (motivo/descripcion/
   evidencia/cantidadNueva) esten completos y con la forma correcta. */
export function buildChangeOrderPayload({
  projectId, conceptoId, cantidadNueva, motivo, descripcion, evidencia, impactoTiempoDias = 0
}){
  if(!projectId) throw new Error('projectId es obligatorio.');
  if(!conceptoId) throw new Error('conceptoId es obligatorio.');
  if(!(Number(cantidadNueva) >= 0)) throw new Error('cantidadNueva debe ser un numero >= 0.');
  if(!motivo?.trim()) throw new Error('motivo es obligatorio.');
  return {
    action: 'create',
    projectId, conceptoId,
    cantidadNueva: Number(cantidadNueva),
    motivo: String(motivo).trim(),
    descripcion: String(descripcion || '').trim(),
    impactoTiempoDias: Number(impactoTiempoDias) || 0,
    evidencia: evidencia || null
  };
}

/* Dedupe (regla 8 del encargo): busca en las OCs YA cargadas si hay una
   candidata que representa el mismo cambio. Regla:
     - Mismo conceptoId
     - Estado no terminal (BORRADOR o EN_REVISION) -- una OC APROBADA/
       RECHAZADA/CANCELADA es historico y NO bloquea la creacion de una
       nueva (regla contractual del schema: los estados terminales no se
       reabren)
     - Mismo `evidencia.origenElementoId` cuando existe: garantiza que se
       trata del MISMO elemento geometrico
     - Mismo `cantidadNueva` +/- tolerancia (mismo cambio, no un cambio
       distinto sobre el mismo elemento)
   Retorna { duplicate: null | changeOrder, staleDraft: null | changeOrder }.
   `staleDraft`: una OC en BORRADOR sobre el mismo (conceptoId, origen) con
   cantidadNueva DISTINTA -- caso de "la geometria se editó de nuevo,
   12.510 -> 13.20". El caller decide si actualizarla o crear revision
   (el schema NO permite mutar cantidadNueva de una OC ya creada -- ver
   _route-change-orders.mjs comentario en handleSetStatus -- asi que el
   flujo recomendado es cancelar el borrador viejo y crear uno nuevo). */
const QTY_TOLERANCE = 1e-3;

export function findDuplicateChangeOrder({ changeOrders, conceptoId, origenElementoId, cantidadNueva }){
  const list = Array.isArray(changeOrders) ? changeOrders : [];
  const openStates = new Set([CHANGE_ORDER_STATUS.BORRADOR, CHANGE_ORDER_STATUS.EN_REVISION]);
  const sameConcept = list.filter(o => String(o?.conceptoId) === String(conceptoId) && openStates.has(o?.status));
  const sameOrigin = origenElementoId
    ? sameConcept.filter(o => String(o?.evidencia?.origenElementoId || '') === String(origenElementoId))
    : sameConcept;
  const exactQty = sameOrigin.find(o => Math.abs(Number(o.cantidadNueva) - Number(cantidadNueva)) <= QTY_TOLERANCE);
  if(exactQty) return { duplicate: exactQty, staleDraft: null };
  const staleDraft = sameOrigin.find(o => o.status === CHANGE_ORDER_STATUS.BORRADOR) || null;
  return { duplicate: null, staleDraft };
}
