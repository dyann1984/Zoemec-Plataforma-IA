/* Esquema de Avance fisico (Fase E, Control Presupuestal): un LIBRO MAYOR
   (ledger) append-only de renglones de avance por concepto -- nunca un
   documento "estado actual" que se sobreescribe. Cada renglon YA trae
   usuario/timestamp/motivo (regla 12 del pedido: "toda modificacion debe
   registrar usuario, timestamp, valor anterior, valor nuevo, motivo"), asi
   que el propio renglon ES su auditoria -- no hace falta una coleccion de
   auditoria aparte, y dos usuarios registrando avance al mismo tiempo NUNCA
   pueden pisarse (cada uno agrega un renglon nuevo, no edita uno existente
   -- por eso este dominio no necesita expectedParentVersionId: no hay
   "version actual" que competir por escribir, solo una suma). */
import { uid } from '../utils/id.js';

/* cantidadEjecutadaAcumulada (la cantidad TOTAL ejecutada hasta este
   renglon, no solo el delta de este renglon) se calcula SIEMPRE a partir
   del historial real -- nunca se confia en lo que el formulario cree que
   es el acumulado, para que dos renglones capturados casi al mismo tiempo
   (con el acumulado local desactualizado en la pantalla de uno de los dos)
   nunca produzcan un acumulado incorrecto. Ver
   _route-progress.mjs#handleCreate: el servidor suma los deltas reales
   dentro de una transaccion antes de aceptar el renglon nuevo. */
export function sumProgressDeltas(entries, conceptoId){
  return (entries || [])
    .filter(e => e?.conceptoId === conceptoId)
    .reduce((sum, e) => sum + (Number(e?.delta) || 0), 0);
}

/* Guard explicito (regla 4 del pedido: "controles para no permitir valores
   imposibles sin advertencia"): un acumulado que superaria la cantidad
   contratada, o un delta negativo que dejaria el acumulado en negativo, NO
   se bloquean (puede ser una correccion real, ej. una remedicion que
   reduce el avance previamente sobreestimado) pero SI se marcan con una
   advertencia explicita -- nunca se ocultan ni se rechazan en silencio. */
export function evaluateProgressGuard({ previousAccumulated, delta, cantidadContratada }){
  const prev = Number(previousAccumulated) || 0;
  const d = Number(delta) || 0;
  const contratada = Number(cantidadContratada) || 0;
  const nextAccumulated = prev + d;
  const warnings = [];
  if(nextAccumulated < 0) warnings.push('EXCESO_NEGATIVO');
  if(contratada > 0 && nextAccumulated > contratada) warnings.push('EXCEDE_CONTRATADO');
  return { nextAccumulated, warnings, hasWarning: warnings.length > 0 };
}

export function makeProgressEntry({
  id = null, projectId = null, conceptoId = null, delta = 0, accumulated = 0,
  pu = 0, fecha = null, motivo = '', usuario = ''
} = {}){
  const now = new Date().toISOString();
  return {
    id: id || ('PROG-' + uid()),
    projectId, conceptoId,
    delta: Number(delta) || 0,
    accumulated: Number(accumulated) || 0,
    // P.U. del APU vigente AL MOMENTO de este renglon -- se congela aqui
    // (nunca un enlace vivo al APU) para que la Curva S y el historial
    // reflejen el valor real de ese momento, aunque el APU se vuelva a
    // generar despues con otro precio (mismo criterio que
    // apu.ubicacionEstructurada: snapshot, nunca referencia viva).
    pu: Number(pu) || 0,
    fecha: fecha || now, motivo, usuario,
    createdAt: now
  };
}

export function validateProgressEntry(entry){
  const errors = [];
  if(!entry || typeof entry !== 'object') errors.push('El renglon de avance no tiene una forma valida.');
  if(!entry?.projectId) errors.push('El renglon de avance debe pertenecer a un proyecto.');
  if(!entry?.conceptoId) errors.push('El renglon de avance debe referenciar un concepto.');
  if(!Number.isFinite(Number(entry?.delta)) || Number(entry?.delta) === 0) errors.push('El renglon de avance necesita una cantidad (delta) distinta de cero.');
  return { valid: errors.length === 0, errors };
}
