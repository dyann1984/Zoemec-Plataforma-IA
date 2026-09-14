/* Esquema de Pago (Fase E, Control Presupuestal). Un pago afecta SOLO
   `pagado`, nunca `ejecutado` (regla 7 del pedido) -- son dimensiones
   distintas por diseno: ejecutado viene de avance fisico real
   (progressEntrySchema.js), pagado viene de dinero que de verdad salio.
   Un pago SIN estimacionId es valido (no se rechaza) pero genera una
   alerta explicita ("pago sin estimacion", ver controlPresupuestalAlerts.js)
   -- nunca se le exige a la fuerza una relacion que quiza no exista
   todavia (anticipo, pago directo a un proveedor menor, etc). */
import { uid } from '../utils/id.js';

export const PAYMENT_METHOD = Object.freeze({
  TRANSFERENCIA: 'TRANSFERENCIA',
  CHEQUE: 'CHEQUE',
  EFECTIVO: 'EFECTIVO',
  OTRO: 'OTRO'
});

export function makePayment({
  id = null, projectId = null, estimacionId = null, monto = 0, fecha = null,
  proveedor = '', referencia = '', metodo = PAYMENT_METHOD.TRANSFERENCIA, evidencia = null, usuario = ''
} = {}){
  const now = new Date().toISOString();
  return {
    id: id || ('PAY-' + uid()),
    projectId, estimacionId,
    monto: Number(monto) || 0,
    fecha: fecha || now, proveedor, referencia, metodo, evidencia, usuario,
    createdAt: now
  };
}

/* Guard explicito (regla 16: "Pagado <= estimado, salvo excepcion
   documentada"): NUNCA bloquea un pago mayor al estimado (puede ser un
   anticipo real, o una estimacion capturada despues del pago) -- solo
   marca la excepcion para que quede visible, nunca oculta. */
export function evaluatePaymentGuard({ montoPago, totalEstimado, totalPagadoPrevio }){
  const pago = Number(montoPago) || 0;
  const estimado = Number(totalEstimado);
  const pagadoPrevio = Number(totalPagadoPrevio) || 0;
  if(!Number.isFinite(estimado)) return { exceedsEstimate: false, reason: 'SIN_ESTIMACION' };
  const exceeds = (pagadoPrevio + pago) > estimado;
  return { exceedsEstimate: exceeds, reason: exceeds ? 'PAGADO_MAYOR_A_ESTIMADO' : null };
}

export function validatePayment(payment){
  const errors = [];
  if(!payment || typeof payment !== 'object') errors.push('El pago no tiene una forma valida.');
  if(!payment?.projectId) errors.push('El pago debe pertenecer a un proyecto.');
  if(!(Number(payment?.monto) > 0)) errors.push('El pago necesita un monto mayor a cero.');
  if(!payment?.proveedor?.trim()) errors.push('El pago necesita un proveedor/contratista.');
  return { valid: errors.length === 0, errors };
}
