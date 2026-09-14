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
  unit = '', qty = 0, referencePU = 0, origenPlano = null
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
    apuId: null, apuVersionId: null,
    matchConfidence: null, matchMethod: null,
    parametric: null,
    status: CATALOG_CONCEPTO_STATUS.PENDIENTE,
    statusError: null,
    batchId: null,
    createdAt: now, updatedAt: now, archivedAt: null
  };
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
