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
   construye en Fase 3, reusando planoReview.js.

   Separacion de dominio (Fase 1.5): este archivo SOLO define forma de datos.
   La geometria derivada (muros M-01..M-04, posicion de aberturas dentro de
   un muro) vive en src/domain/surveyGeometryModel.js -- nunca aqui ni en
   Plano/Takeoff. Levantamiento -> geometria; Plano/Takeoff -> cuantificacion;
   Concepto -> APU -> costo. Ningun nivel calcula lo que le corresponde a otro. */
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

/* Muros canonicos de un Space rectangular (Fase 1.5): M-01..M-04, en el
   mismo orden que produce computeSpaceWalls (src/lib/levantamientoCalc.js).
   wallId de un Element referencia uno de estos ids -- ver mas abajo. */
export const WALL_IDS = Object.freeze(['M-01', 'M-02', 'M-03', 'M-04']);

/* Elemento constructivo (puerta, ventana, muro individual, etc.) dentro de un
   Space. width/height/length/quantity son entradas crudas del usuario; area
   se recalcula con src/lib/levantamientoCalc.js (computeElementArea), nunca
   se confia en un area capturada a mano.

   wallId/offset/sillHeight (Fase 1.5, seccion 3 del sprint): ubican una
   puerta/ventana dentro del Space para poder dibujarla en el plano 2D y
   posicionarla en el modelo 3D. Los tres son OPCIONALES y con default nulo/
   cero a proposito: un levantamiento guardado antes de Fase 1.5 no los trae,
   y src/domain/surveyGeometryModel.js#resolveOpening le asigna una posicion
   razonable (con una advertencia visible en la UI) sin necesidad de migrar
   datos ni de mutar el elemento guardado -- NUNCA una migracion destructiva.
   wallId debe ser uno de WALL_IDS (o null); offset es la distancia en metros
   desde el inicio del muro; sillHeight es la altura en metros desde el piso
   hasta el borde inferior de la abertura (ventanas; las puertas usan 0). */
export function makeEmptyElement({ type = ELEMENT_TYPE.OTHER, width = 0, height = 0, length = 0, quantity = 1, material = '', notes = '', wallId = null, offset = 0, sillHeight = 0 } = {}){
  return {
    id: 'ELM-' + uid(),
    type,
    width: toNum(width),
    height: toNum(height),
    length: toNum(length),
    quantity: toNum(quantity) || 1,
    area: 0,
    material,
    notes,
    wallId: WALL_IDS.includes(wallId) ? wallId : null,
    offset: toNum(offset),
    sillHeight: toNum(sillHeight)
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
/* importMeta (Fase 2A, opcional, default null): metadatos planos y
   JSON-safe del archivo 3D importado (formato/nombre/tamano/mallas/
   triangulos/factor de escala/fecha) cuando sourceType es IMPORT_3D --
   nunca el File ni el THREE.Object3D original, solo lo que
   buildSurveyImportMeta (src/domain/levantamientoImportConversion.js)
   produce. null para levantamientos manuales, igual que siempre.

   scanMedia (Fase 2B, opcional, default []): array plano y JSON-safe de
   descriptores de video/fotos capturados con la camara cuando sourceType es
   MOBILE_SCAN -- cada item viene de buildScanMediaItem
   (src/domain/levantamientoMedia.js), nunca el Blob original ni una
   downloadURL firmada (esa se regenera al vuelo desde storagePath). []
   para cualquier otro sourceType.

   id (opcional): normalmente se genera aqui mismo. PhoneScanSurveyForm.jsx
   es la unica excepcion -- necesita conocer el id del levantamiento ANTES
   de guardarlo (para subir cada foto/video a Storage en cuanto se captura,
   bajo esa misma ruta), asi que lo pre-genera con uid() y lo pasa aqui para
   que el survey final quede con el id que ya usaron las rutas de Storage. */
/* stylePreferences (Fase 2 -- puente hacia Propuesta con IA): null = el
   usuario nunca abrio el panel "Estilo y materiales" (comportamiento previo
   a esta fase, intacto). Cuando SI lo abre, PhoneScanSurveyForm/
   Import3DSurveyForm guardan aqui el resultado de
   normalizeStylePreferences (ver evidenceStylePreferences.js) -- este
   archivo no valida su contenido, esa normalizacion ya la hizo el llamador. */
export function makeEmptySurvey({ id = null, projectId = null, name = '', description = '', sourceType = SURVEY_SOURCE_TYPE.MANUAL, importMeta = null, scanMedia = [], stylePreferences = null } = {}){
  const now = Date.now();
  return {
    id: id || ('LEV-' + uid()),
    projectId,
    name,
    description,
    sourceType,
    importMeta,
    scanMedia,
    stylePreferences,
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
