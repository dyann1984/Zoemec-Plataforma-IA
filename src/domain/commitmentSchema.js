/* Esquema de Comprometido (Fase E, Control Presupuestal): ordenes de
   compra, contratos y subcontratos. Deliberadamente SEPARADO de pagos
   (regla 3 del pedido: "no mezclar comprometido con pagado") -- un
   compromiso es dinero que YA se obligo a gastar (existe un documento
   firmado), independientemente de si ya se pago o no. */
import { uid } from '../utils/id.js';

export const COMMITMENT_TYPE = Object.freeze({
  ORDEN_COMPRA: 'ORDEN_COMPRA',
  CONTRATO: 'CONTRATO',
  SUBCONTRATO: 'SUBCONTRATO'
});

export const COMMITMENT_STATUS = Object.freeze({
  ACTIVO: 'ACTIVO',
  CERRADO: 'CERRADO',
  CANCELADO: 'CANCELADO'
});

const LEGAL_TRANSITIONS = Object.freeze({
  ACTIVO: ['CERRADO', 'CANCELADO'],
  CERRADO: [],
  CANCELADO: []
});

export function isLegalCommitmentTransition(from, to){
  if(from === to) return true;
  return (LEGAL_TRANSITIONS[from] || []).includes(to);
}

/* Solo los compromisos ACTIVO cuentan para "comprometido" en el agregado de
   Control Presupuestal (ver controlPresupuestalAggregation.js) -- uno
   CANCELADO nunca debio comprometer presupuesto, uno CERRADO ya se
   resolvio (tipicamente porque ya se facturo/pago por completo) y deja de
   ser un compromiso PENDIENTE, aunque su historial se conserva intacto
   (nunca se borra, solo cambia de estado). */
export function isActiveCommitment(commitment){
  return commitment?.status === COMMITMENT_STATUS.ACTIVO;
}

export function makeEmptyCommitment({
  id = null, projectId = null, conceptoId = null, capitulo = 'OTROS',
  tipo = COMMITMENT_TYPE.ORDEN_COMPRA, proveedor = '', monto = 0, fecha = null,
  referencia = ''
} = {}){
  const now = new Date().toISOString();
  return {
    id: id || ('CMT-' + uid()),
    projectId, conceptoId, capitulo,
    tipo, proveedor, monto: Number(monto) || 0,
    fecha: fecha || now, referencia,
    status: COMMITMENT_STATUS.ACTIVO,
    createdAt: now, updatedAt: now
  };
}

export function validateCommitment(commitment){
  const errors = [];
  if(!commitment || typeof commitment !== 'object') errors.push('El compromiso no tiene una forma valida.');
  if(!commitment?.projectId) errors.push('El compromiso debe pertenecer a un proyecto.');
  if(!commitment?.proveedor?.trim()) errors.push('El compromiso necesita un proveedor/contratista.');
  if(!(Number(commitment?.monto) > 0)) errors.push('El compromiso necesita un monto mayor a cero.');
  if(!Object.values(COMMITMENT_TYPE).includes(commitment?.tipo)) errors.push('tipo invalido.');
  if(!Object.values(COMMITMENT_STATUS).includes(commitment?.status)) errors.push('status invalido.');
  return { valid: errors.length === 0, errors };
}
