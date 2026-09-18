/* Esquema de Orden de cambio (Fase E, Control Presupuestal). Mismo idioma
   puro que catalogConceptoSchema.js -- sin React ni Firebase, testeable sin
   montar nada. Persistencia real via server/api-lib/_route-change-orders.mjs
   (coleccion `changeOrders`, doc actual + `changeOrdersAudit` append-only --
   una orden de cambio es un flujo de estados, no un documento editable con
   version-por-guardado como `presupuestos`, asi que no necesita
   `changeOrdersVersions`: el AUDIT ya registra cada transicion con quien,
   cuando y por que). */
import { uid } from '../utils/id.js';

export const CHANGE_ORDER_STATUS = Object.freeze({
  BORRADOR: 'BORRADOR',
  EN_REVISION: 'EN_REVISION',
  APROBADA: 'APROBADA',
  RECHAZADA: 'RECHAZADA',
  CANCELADA: 'CANCELADA'
});

/* Solo BORRADOR/EN_REVISION son editables; APROBADA/RECHAZADA/CANCELADA son
   terminales -- una orden aprobada ya modifico el presupuesto vigente
   (regla 2 del pedido: "nunca el baseline"), reabrirla despues corromperia
   esa trazabilidad. Corregir una orden ya decidida significa crear una
   orden NUEVA, nunca editar la anterior (mismo principio que
   apuVersioning.js: el historial nunca se reescribe). */
const LEGAL_TRANSITIONS = Object.freeze({
  BORRADOR: ['EN_REVISION', 'CANCELADA'],
  EN_REVISION: ['APROBADA', 'RECHAZADA', 'CANCELADA'],
  APROBADA: [],
  RECHAZADA: [],
  CANCELADA: []
});

export function isLegalChangeOrderTransition(from, to){
  if(from === to) return true;
  return (LEGAL_TRANSITIONS[from] || []).includes(to);
}

export function isTerminalChangeOrderStatus(status){
  return status === CHANGE_ORDER_STATUS.APROBADA || status === CHANGE_ORDER_STATUS.RECHAZADA || status === CHANGE_ORDER_STATUS.CANCELADA;
}

/* impactoEconomico: SIEMPRE calculado aqui, nunca capturado a mano -- misma
   regla que el resto de la app (el servidor/la capa pura decide el numero,
   el formulario solo captura los insumos). (cantidadNueva - cantidadAnterior)
   x P.U. -- positivo = mas presupuesto, negativo = ahorro. P.U. viene del
   APU asociado al concepto (nunca se reinventa un precio nuevo aqui). */
export function computeChangeOrderEconomicImpact({ cantidadAnterior, cantidadNueva, pu }){
  const anterior = Number(cantidadAnterior) || 0;
  const nueva = Number(cantidadNueva) || 0;
  const unitPrice = Number(pu) || 0;
  return (nueva - anterior) * unitPrice;
}

export function makeEmptyChangeOrder({
  id = null, folio = null, projectId = null, conceptoId = null, clave = '', concept = '',
  unit = '', motivo = '', descripcion = '', cantidadAnterior = 0, cantidadNueva = 0, pu = 0,
  impactoTiempoDias = 0, evidencia = null
} = {}){
  const now = new Date().toISOString();
  return {
    id: id || ('CO-' + uid()),
    folio,
    projectId, conceptoId, clave, concept, unit,
    motivo, descripcion,
    cantidadAnterior: Number(cantidadAnterior) || 0,
    cantidadNueva: Number(cantidadNueva) || 0,
    pu: Number(pu) || 0,
    impactoEconomico: computeChangeOrderEconomicImpact({ cantidadAnterior, cantidadNueva, pu }),
    impactoTiempoDias: Number(impactoTiempoDias) || 0,
    evidencia,
    status: CHANGE_ORDER_STATUS.BORRADOR,
    createdAt: now, updatedAt: now,
    approvedBy: null, decidedAt: null, decisionReason: null
  };
}

export function validateChangeOrder(order){
  const errors = [];
  if(!order || typeof order !== 'object') errors.push('La orden de cambio no tiene una forma valida.');
  if(!order?.projectId) errors.push('La orden de cambio debe pertenecer a un proyecto.');
  if(!order?.conceptoId) errors.push('La orden de cambio debe referenciar un concepto del catalogo.');
  if(!order?.motivo?.trim()) errors.push('La orden de cambio necesita un motivo.');
  if(order?.cantidadAnterior === order?.cantidadNueva) errors.push('La cantidad nueva debe ser distinta de la cantidad anterior.');
  if(!Object.values(CHANGE_ORDER_STATUS).includes(order?.status)) errors.push('status invalido.');
  return { valid: errors.length === 0, errors };
}
