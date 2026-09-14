/* Esquema del Catalogo de conceptos (Fase D). Mismo idioma que
   src/domain/levantamientoSchema.js#makeEmptySurvey/validateSurvey --
   funciones puras, sin React ni Firebase, para poder testear la forma del
   documento sin montar nada. Persistencia real via
   server/api-lib/_route-catalogo-conceptos.mjs (coleccion `catalogConceptos`,
   un documento por concepto -- ver plan Fase D: sin coleccion de versiones,
   el concepto es esencialmente estatico, solo lleva auditoria append-only). */
import { uid } from '../utils/id.js';
import { normalizeCapitulo } from './presupuestoCapitulos.js';

export const CATALOG_CONCEPTO_STATUS = Object.freeze({
  PENDIENTE: 'PENDIENTE',
  GENERANDO: 'GENERANDO',
  GENERADO: 'GENERADO',
  ASOCIADO: 'ASOCIADO',
  ERROR: 'ERROR',
  REQUIERE_REVISION: 'REQUIERE_REVISION'
});

/* Transiciones legales (mismo criterio que apuBatchQueue.js#ITEM_STATUS,
   pero para el estado DURABLE del concepto, no el estado efimero del lote):
   un concepto solo puede "empezar a generar" desde PENDIENTE o ERROR
   (reintento), y solo puede llegar a un estado terminal (GENERADO/
   ASOCIADO/ERROR/REQUIERE_REVISION) desde GENERANDO o directamente por una
   accion explicita del usuario (ASOCIADO se alcanza desde cualquier estado
   no terminal via "Asociar APU existente", nunca sobreescribe un concepto
   ya GENERADO/ASOCIADO sin que el usuario lo pida). */
const LEGAL_TRANSITIONS = Object.freeze({
  PENDIENTE: ['GENERANDO', 'ASOCIADO'],
  GENERANDO: ['GENERADO', 'REQUIERE_REVISION', 'ERROR', 'ASOCIADO'],
  ERROR: ['GENERANDO', 'ASOCIADO'],
  REQUIERE_REVISION: ['GENERANDO', 'ASOCIADO', 'GENERADO'],
  GENERADO: ['ASOCIADO', 'GENERANDO'],
  ASOCIADO: ['GENERANDO']
});

export function isLegalStatusTransition(from, to){
  if(from === to) return true;
  return (LEGAL_TRANSITIONS[from] || []).includes(to);
}

export function makeEmptyCatalogConcepto({
  id = null, projectId = null, clave = '', capitulo = 'OTROS', concept = '',
  unit = '', qty = 0, referencePU = 0, origenPlano = null, origenElementoId = null
} = {}){
  const now = new Date().toISOString();
  return {
    id: id || ('CAT-' + uid()),
    projectId,
    clave, concept, unit,
    capitulo: normalizeCapitulo(capitulo),
    qty: Number(qty) || 0,
    referencePU: Number(referencePU) || 0,
    ubicacion: null, ubicacionEstructurada: null,
    origenPlano,
    // Identidad ESTABLE del elemento de origen (ej. `${planoTakeoffId}:${elementId}`
    // o `${visualRequestId}:${elementId}`) -- unica forma de deduplicar
    // "Agregar al catalogo" repetido sobre el mismo elemento (ver
    // _route-catalogo-conceptos.mjs#findExistingByOrigenElementoId). null
    // para conceptos sin origen de plano (captura manual): esos siempre
    // crean uno nuevo, no hay identidad contra la cual deduplicar.
    origenElementoId,
    apuId: null, apuVersionId: null,
    matchConfidence: null, matchMethod: null,
    parametric: null,
    status: CATALOG_CONCEPTO_STATUS.PENDIENTE,
    statusError: null,
    batchId: null,
    createdAt: now, updatedAt: now, archivedAt: null
  };
}

// Umbral por encima del cual un concepto en GENERANDO se considera
// huerfano (ver catalogConceptosCloud.js#useCatalogConceptos y el comentario
// ahi -- mismo criterio de fondo que AiJobsContext.jsx#markInterruptedOnLoad,
// aplicado al estado DURABLE del concepto en vez de al registro efimero de
// jobs). Exportado (no solo uso interno) para poder testear la regla sin
// montar React ni hacer red real.
export const STALE_GENERANDO_MS = 3 * 60 * 1000;

/* Pura: dado el arreglo de conceptos ya leido del servidor y el instante
   actual, decide cuales GENERANDO llevan demasiado tiempo sin resolver y
   deben reclasificarse a ERROR (nunca a otro estado -- un concepto huerfano
   siempre queda "retryable", jamas se le inventa un GENERADO). Retorna
   {conceptos, reclassified} -- `conceptos` es el arreglo COMPLETO con los
   reemplazos ya aplicados (mismo orden, mismos objetos para los que no
   cambiaron), `reclassified` son solo los que cambiaron (para que el
   llamador sepa a cuales avisarle al servidor). */
export function reclassifyStaleGenerando(conceptos, now = Date.now(), thresholdMs = STALE_GENERANDO_MS){
  const reclassified = [];
  const next = (conceptos || []).map(c => {
    if(c?.status !== CATALOG_CONCEPTO_STATUS.GENERANDO) return c;
    const updatedAtMs = new Date(c.updatedAt || 0).getTime();
    const age = now - (Number.isFinite(updatedAtMs) ? updatedAtMs : 0);
    if(age < thresholdMs) return c;
    const reclassifiedConcepto = {
      ...c, status: CATALOG_CONCEPTO_STATUS.ERROR,
      statusError: 'Generación interrumpida (proceso no terminó de reportar su resultado). Reintenta.'
    };
    reclassified.push(reclassifiedConcepto);
    return reclassifiedConcepto;
  });
  return { conceptos: next, reclassified };
}

export function validateCatalogConcepto(concepto){
  const errors = [];
  if(!concepto || typeof concepto !== 'object') errors.push('El concepto no tiene una forma valida.');
  if(!concepto?.projectId) errors.push('El concepto debe pertenecer a un proyecto.');
  if(!concepto?.concept?.trim()) errors.push('El concepto necesita una descripcion.');
  if(!concepto?.unit?.trim()) errors.push('El concepto necesita una unidad.');
  if(!(Number(concepto?.qty) > 0)) errors.push('El concepto necesita una cantidad mayor a cero.');
  if(!Object.values(CATALOG_CONCEPTO_STATUS).includes(concepto?.status)) errors.push('status invalido.');
  return { valid: errors.length === 0, errors };
}
