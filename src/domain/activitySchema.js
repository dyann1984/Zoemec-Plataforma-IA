/* Esquema de Actividad de Obra (Fase 3 del plan integral). Puro, sin
   React ni Firebase. Mismo idioma que catalogConceptoSchema.js/
   changeOrderSchema.js -- factories, validate, estados con transiciones
   legales.

   PROPOSITO: representar una actividad del programa de obra que se
   deriva de un concepto (catalogo) + APU (rendimiento). NUNCA duplica
   informacion que puede referenciarse por ID (regla 2 del encargo):
   - conceptoId (autoritativo del concepto/unidad/importe)
   - apuId (autoritativo del rendimiento/cuadrilla)
   - presupuestoId (autoritativo de la cantidad contractual y P.U.)
   La actividad guarda solo lo que le es propio (fechas, duracion editada,
   avance planificado, responsable, dependencias, origen). Cantidades y
   precios se resuelven en el momento leyendo los documentos autoritativos
   -- mismo criterio que cadTakeoff.conceptQuantityFromModel (Fase 1).

   ESTADOS y transiciones -- flujo lineal simple para Fase 3 (no CPM):
     BORRADOR -> PLANIFICADA -> EN_PROCESO -> TERMINADA
                                        \-> DETENIDA
     CUALQUIERA -> CANCELADA (excepto TERMINADA)
   TERMINADA es terminal; cancelar una actividad terminada seria borrar
   avance real, se prohibe. */
import { uid } from '../utils/id.js';

export const ACTIVITY_STATUS = Object.freeze({
  BORRADOR: 'BORRADOR',
  PLANIFICADA: 'PLANIFICADA',
  EN_PROCESO: 'EN_PROCESO',
  TERMINADA: 'TERMINADA',
  DETENIDA: 'DETENIDA',
  CANCELADA: 'CANCELADA'
});

const LEGAL_TRANSITIONS = Object.freeze({
  BORRADOR: ['PLANIFICADA', 'CANCELADA'],
  PLANIFICADA: ['EN_PROCESO', 'DETENIDA', 'CANCELADA'],
  EN_PROCESO: ['TERMINADA', 'DETENIDA'],
  DETENIDA: ['EN_PROCESO', 'CANCELADA'],
  TERMINADA: [],
  CANCELADA: []
});

export function isLegalActivityTransition(from, to){
  if(from === to) return true;
  return (LEGAL_TRANSITIONS[from] || []).includes(to);
}

export const ACTIVITY_ORIGIN = Object.freeze({
  CATALOG: 'CATALOG',          // generada desde presupuesto/catalogo
  MANUAL: 'MANUAL',            // creada a mano por el usuario
  APU_TEMPLATE: 'APU_TEMPLATE' // desde plantilla APU sin renglon de presupuesto
});

export const DEPENDENCY_TYPE = Object.freeze({
  FS: 'FS' // Finish-to-Start es lo unico soportado en Fase 3 (regla 8)
  // SS/FF/SF quedan como espacio para fases futuras sin migrar datos.
});

/* Predecessora: { activityId, type, lag }.
   lag en dias laborables (positivo = espera despues de FS; negativo =
   overlap, no soportado todavia y se ignora con warning). */
export function makePredecessor({ activityId, type = DEPENDENCY_TYPE.FS, lag = 0 } = {}){
  return { activityId: String(activityId || ''), type: type === DEPENDENCY_TYPE.FS ? DEPENDENCY_TYPE.FS : DEPENDENCY_TYPE.FS, lag: Number(lag) || 0 };
}

export function makeEmptyActivity({
  id = null, projectId = null, conceptoId = null, apuId = null, presupuestoId = null,
  chapterId = null, name = '', unit = '',
  cantidad = 0, rendimiento = null, cuadrilla = 1,
  duracion = null, fechaInicio = null, fechaFin = null,
  responsable = null, predecessoras = [],
  status = ACTIVITY_STATUS.BORRADOR,
  origen = ACTIVITY_ORIGIN.MANUAL,
  origenElementoId = null, // Fase 1 -- puente al elemento CAD que originó la cantidad
  rendimientoFuente = null, // 'APU' | 'MANUAL' | 'HISTORICO' | null
  notas = ''
} = {}){
  const now = new Date().toISOString();
  return {
    id: id || ('ACT-' + uid()),
    projectId, conceptoId, apuId, presupuestoId, chapterId,
    name: String(name || '').trim(),
    unit: String(unit || '').trim(),
    cantidad: Number(cantidad) || 0,
    rendimiento: rendimiento == null ? null : Number(rendimiento),
    cuadrilla: Number(cuadrilla) || 1,
    duracion: duracion == null ? null : Number(duracion),
    fechaInicio: fechaInicio ? String(fechaInicio) : null,
    fechaFin: fechaFin ? String(fechaFin) : null,
    responsable,
    predecessoras: (predecessoras || []).map(makePredecessor),
    status,
    origen,
    origenElementoId,
    rendimientoFuente,
    // duracionEditadaManual (regla 20 del encargo): true si el usuario ya
    // edito la duracion a mano -- una OC aprobada que cambie la cantidad
    // NUNCA sobreescribe una duracion editada, solo sugiere la nueva.
    duracionEditadaManual: false,
    // cantidadVigenteSnapshot: ultima cantidad contractual+OC vigente
    // conocida por la actividad. Cuando cambia (por OC aprobada nueva) se
    // detecta divergencia y se sugiere actualizar (regla 20).
    cantidadVigenteSnapshot: null,
    notas,
    createdAt: now,
    updatedAt: now
  };
}

export function validateActivity(activity){
  const errors = [];
  if(!activity || typeof activity !== 'object') errors.push('La actividad no tiene una forma valida.');
  if(!activity?.projectId) errors.push('La actividad debe pertenecer a un proyecto.');
  if(!activity?.name?.trim()) errors.push('La actividad necesita un nombre.');
  if(!Object.values(ACTIVITY_STATUS).includes(activity?.status)) errors.push('status invalido.');
  if(activity?.rendimiento != null && !(Number(activity.rendimiento) > 0)) errors.push('rendimiento debe ser mayor a cero cuando se declara.');
  if(activity?.cantidad != null && Number(activity.cantidad) < 0) errors.push('cantidad no puede ser negativa.');
  if(!Array.isArray(activity?.predecessoras)) errors.push('predecessoras debe ser un arreglo.');
  return { valid: errors.length === 0, errors };
}
