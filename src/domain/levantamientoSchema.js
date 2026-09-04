/* Esquema de datos para Levantamiento IA (Fase 1): captura de condiciones
   fisicas de obra que alimentara, en fases posteriores, Takeoff/Plano ->
   Cuantificacion -> Conceptos -> APU -> Presupuesto.

   Modulo puro (sin React/DOM). Sigue el mismo patron aditivo que
   src/domain/apuSchema.js: define forma de datos y factories, no logica de
   calculo (eso vive en src/lib/levantamientoCalc.js) ni de persistencia (eso
   se conecta en main.jsx con useCloudState + useProjectScoped, igual que
   apus/budgets/catalog).

   IMPORTANTE (portado sobre origin/main): ZOEMEC ya tiene un motor de
   Takeoff real -- src/domain/planoReview.js (estados PLANO_ELEMENT_STATES,
   TIPOS_ELEMENTO, toApuSeed) + src/domain/planoTakeoffStore.js -- para
   cuantificacion 2D extraida de un plano subido (IA o trazo manual). Este
   modulo NO es un motor de Takeoff paralelo: es la captura de espacios/
   elementos de Levantamiento IA (medicion directa en obra, L x A x H), que en
   Fase 3 debera alimentar el MISMO gate (applyPlanoElementReview/toApuSeed)
   antes de llegar a APU -- nunca un segundo camino. Por eso ELEMENT_TYPE usa
   el mismo vocabulario en espanol que TIPOS_ELEMENTO (muro/piso/plafon/
   puerta/ventana/columna/trabe/otro), mas 'abertura' que Levantamiento IA
   necesita y Takeoff hoy no distingue.

   Trazabilidad (seccion 9 del sprint original): cada Element referencia su
   Space via spaceId, y cada Space vive dentro de un Survey (array
   survey.spaces). La cadena Element -> Cuantificacion -> Concepto -> APU se
   construye en Fase 3, reusando planoReview.js. */
import { uid } from '../utils/id.js';

export const SURVEY_SOURCE_TYPE = Object.freeze({
  MANUAL: 'manual',
  IMPORT_3D: '3d_import',
  MOBILE_SCAN: 'mobile_scan'
});

export const SURVEY_STATUS = Object.freeze({
  DRAFT: 'borrador',
  PROCESSING: 'procesando',
  PROCESSED: 'procesado',
  WITH_OBSERVATIONS: 'con_observaciones',
  ERROR: 'error'
});

/* Tipos de elemento constructivo. Alineado deliberadamente con
   TIPOS_ELEMENTO de src/domain/planoReview.js (mismo vocabulario en espanol)
   para que un elemento de Levantamiento IA sea compatible sin traduccion con
   el gate de revision de Takeoff en Fase 3. 'abertura' es la unica adicion:
   Takeoff hoy no la distingue de 'otro'. */
export const ELEMENT_TYPE = Object.freeze({
  WALL: 'muro',
  FLOOR: 'piso',
  CEILING: 'plafon',
  DOOR: 'puerta',
  WINDOW: 'ventana',
  OPENING: 'abertura',
  COLUMN: 'columna',
  BEAM: 'trabe',
  OTHER: 'otro'
});

function toNum(v){
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/* Elemento constructivo (puerta, ventana, muro individual, etc.) dentro de un
   Space. width/height/length/quantity son entradas crudas del usuario; area
   se recalcula con src/lib/levantamientoCalc.js (computeElementArea), nunca
   se confia en un area capturada a mano. */
export function makeEmptyElement({ type = ELEMENT_TYPE.OTHER, width = 0, height = 0, length = 0, quantity = 1, material = '', notes = '' } = {}){
  return {
    id: 'ELM-' + uid(),
    type,
    width: toNum(width),
    height: toNum(height),
    length: toNum(length),
    quantity: toNum(quantity) || 1,
    area: 0,
    material,
    notes
  };
}

/* Espacio/ambiente (room) dentro de un Survey. length/width/height son la
   captura manual minima (seccion 4B); floorArea/ceilingArea/perimeter/
   wallGrossArea/wallNetArea/volume se derivan siempre via
   src/lib/levantamientoCalc.js (computeSpaceGeometry), nunca se editan a
   mano. */
export function makeEmptySpace({ name = '', length = 0, width = 0, height = 0 } = {}){
  return {
    id: 'SPC-' + uid(),
    name,
    length: toNum(length),
    width: toNum(width),
    height: toNum(height),
    floorArea: 0,
    ceilingArea: 0,
    perimeter: 0,
    wallGrossArea: 0,
    doorsArea: 0,
    windowsArea: 0,
    wallNetArea: 0,
    volume: 0,
    elements: []
  };
}

/* Levantamiento (survey). Pertenece siempre a un proyecto (projectId) --
   sigue el mismo patron que apus/budgets/catalog: el objeto lleva su propio
   projectId y useProjectScoped() en main.jsx filtra la vista activa, no hay
   subcoleccion Firestore por proyecto. */
export function makeEmptySurvey({ projectId = null, name = '', description = '', sourceType = SURVEY_SOURCE_TYPE.MANUAL } = {}){
  const now = Date.now();
  return {
    id: 'LEV-' + uid(),
    projectId,
    name,
    description,
    sourceType,
    status: SURVEY_STATUS.DRAFT,
    spaces: [],
    createdAt: now,
    updatedAt: now
  };
}

export function validateSurvey(survey){
  const errors = [];
  if(!survey || typeof survey !== 'object') errors.push('El levantamiento no tiene una forma valida.');
  if(!survey?.name?.trim()) errors.push('El levantamiento necesita un nombre.');
  if(!survey?.projectId) errors.push('El levantamiento debe pertenecer a un proyecto.');
  if(!Object.values(SURVEY_SOURCE_TYPE).includes(survey?.sourceType)) errors.push('sourceType invalido.');
  if(!Array.isArray(survey?.spaces)) errors.push('El levantamiento debe tener un arreglo de espacios (spaces).');
  return { valid: errors.length === 0, errors };
}

/* Misma logica de filtrado que useProjectScoped (src/main.jsx), extraida
   como funcion pura para poder testear la relacion levantamiento-proyecto
   sin montar React. */
export function filterSurveysByProject(list, projectId){
  const scopeKey = projectId ?? null;
  return (list || []).filter(s => (s?.projectId ?? null) === scopeKey);
}
