/* Construye elementos DETECTADO_VECTORIAL (Fase B) a partir de una corrida
   de muro ya agrupada por planoVectorGeometry.js#groupSegmentsIntoWalls y la
   escala YA RESUELTA por resolveScale(). Reusa el MISMO shape de elemento
   que _planoValidate.mjs/planoReview.js (cantidadPropuesta/unidad/
   confianzaIA/fuenteEscala/estado/...) para que enforceScaleRule,
   applyPlanoElementReview y la tabla de revision existentes funcionen sin
   cambios -- solo se agregan campos nuevos (`id`, `origin`, `geometry`,
   `dimension`), nunca se quita ninguno de los que RC4 ya validaba. */
import { uid } from '../utils/id.js';
import { ESCALA_FUENTES, PLANO_ELEMENT_ORIGIN, PLANO_ELEMENT_STATES, enforceScaleRule } from './planoReview.js';

/* Confianza de un muro DETECTADO_VECTORIAL: no es una estimacion de IA (no
   hay modelo involucrado), es la certeza de que ESA geometria existe
   literalmente en el PDF -- deliberadamente alta y CONSTANTE (95, nunca
   100: la incertidumbre restante es si el trazo realmente representa un
   muro y no, por ejemplo, un eje o un mueble, cosa que solo confirma un
   humano). Documentado aqui para que quede claro que "confianzaIA" en un
   elemento VECTOR_DETECTED no es una metrica de IA, es el mismo campo
   reutilizado por compatibilidad con la tabla/validador existentes. */
export const VECTOR_WALL_CONFIDENCE = 95;

export function buildVectorWallElement(wall, { resolvedScale, fileName = '' } = {}){
  const scale = resolvedScale?.realUnitsPerPdfPoint;
  const validScale = Number.isFinite(scale) && scale > 0;
  const longitudReal = validScale ? Number((wall.lengthPt * scale).toFixed(3)) : null;

  const element = {
    id: `vec-${uid()}`,
    tipo: 'muro',
    descripcion: `Muro detectado por geometria vectorial (pagina ${wall.page ?? 1})`,
    cantidadPropuesta: longitudReal,
    unidad: validScale ? 'm' : '',
    confianzaIA: VECTOR_WALL_CONFIDENCE,
    pagina: wall.page ?? 1,
    evidencia: `Trazo vectorial real de ${wall.lengthPt.toFixed(1)}pt extraido del PDF (${wall.segments.length} segmento(s) colineales conectados).`,
    fuenteEscala: validScale ? resolvedScale.fuente : ESCALA_FUENTES.NO_DETERMINADA,
    observaciones: resolvedScale?.evidencia || '',
    estado: PLANO_ELEMENT_STATES.DETECTADO_VECTORIAL,
    cantidadOriginalIA: longitudReal,
    unidadOriginalIA: validScale ? 'm' : '',
    descripcionOriginalIA: `Muro detectado por geometria vectorial (pagina ${wall.page ?? 1})`,
    cantidadCorregida: null,
    unidadCorregida: null,
    descripcionCorregida: null,
    validatedBy: null,
    validatedAt: null,
    motivo: '',
    // Campos aditivos Fase B (ver encabezado del modulo):
    origin: PLANO_ELEMENT_ORIGIN.VECTOR_DETECTED,
    geometry: { kind: 'segments', segments: wall.segments, bbox: wall.bbox },
    dimension: { longitud: longitudReal },
    fileName,
    correctedBy: null,
    correctedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  return enforceScaleRule(element);
}

/* Recalcula un elemento VECTOR_DETECTED existente con una escala NUEVA (ej.
   el usuario acaba de calibrar manualmente 2 puntos, punto 3 del pedido) --
   reusa la geometria REAL ya guardada (geometry.segments), nunca vuelve a
   pedirle nada al PDF/servidor. Un elemento de origen AI_APPROXIMATION sin
   evidencia propia (cantidadPropuesta ya null) NO se puede "arreglar"
   recalibrando: nunca inventa una cantidad que la IA nunca midio, se
   regresa tal cual. */
export function recalibrateVectorElement(element, resolvedScale){
  if(element?.origin !== PLANO_ELEMENT_ORIGIN.VECTOR_DETECTED || element?.geometry?.kind !== 'segments') return element;
  // Un elemento que un humano YA revisó (VALIDADO/CORREGIDO/RECHAZADO) nunca
  // se recalcula en silencio por una calibracion posterior -- esa decision
  // humana es definitiva hasta que el propio humano la reabra.
  const notYetReviewed = element.estado === PLANO_ELEMENT_STATES.DETECTADO_VECTORIAL || element.estado === PLANO_ELEMENT_STATES.REQUIERE_REVISION;
  if(!notYetReviewed) return element;
  const lengthPt = element.geometry.segments.reduce((sum, s) => sum + Math.hypot(s.x2 - s.x1, s.y2 - s.y1), 0);
  const scale = resolvedScale?.realUnitsPerPdfPoint;
  const validScale = Number.isFinite(scale) && scale > 0;
  const longitudReal = validScale ? Number((lengthPt * scale).toFixed(3)) : null;
  const updated = {
    ...element,
    estado: PLANO_ELEMENT_STATES.DETECTADO_VECTORIAL,
    cantidadPropuesta: longitudReal,
    unidad: validScale ? 'm' : '',
    fuenteEscala: validScale ? resolvedScale.fuente : ESCALA_FUENTES.NO_DETERMINADA,
    cantidadOriginalIA: longitudReal,
    unidadOriginalIA: validScale ? 'm' : '',
    dimension: { longitud: longitudReal },
    observaciones: resolvedScale?.evidencia || element.observaciones,
    updatedAt: new Date().toISOString()
  };
  return enforceScaleRule(updated);
}

/* Campo PRINCIPAL de `dimension` que representa a `cantidadCorregida` para
   cada tipo de elemento -- necesario porque applyPlanoElementReview
   (planoReview.js, RC4) es generico y solo conoce un numero plano
   (cantidadCorregida), nunca el `dimension` estructurado de Fase B. Sin
   esta tabla, corregir un muro actualizaria cantidadCorregida pero
   planoQuantification.js seguiria sumando el `dimension.longitud` VIEJO --
   bug real detectado en QA manual (corregir un muro de 3.5m a 3.65m no
   cambiaba el total de "Muros" en el resumen). */
const PRIMARY_DIMENSION_FIELD_BY_TIPO = Object.freeze({
  muro: 'longitud', trabe: 'longitud', eje: 'longitud', cota: 'longitud',
  piso: 'area', losa: 'area', plafon: 'area', habitacion: 'area',
  puerta: 'piezas', ventana: 'piezas', columna: 'piezas'
});

/* Dimension EFECTIVA de un elemento: si el usuario lo corrigio
   (cantidadCorregida != null), esa cifra reemplaza el campo principal de
   `dimension` segun su tipo -- nunca se inventa a que campo corresponde
   para un tipo sin mapeo conocido ('otro'), en ese caso se conserva
   `dimension` tal cual. Unica fuente de verdad para mostrar Y cuantificar
   un elemento: la UI (PlanoTakeoffWorkspace) y planoQuantification.js deben
   usar SIEMPRE esta funcion, nunca leer `dimension` directo cuando pueda
   haber una correccion humana encima. */
export function resolveEffectiveDimension(el){
  const base = el?.dimension || {};
  if(el?.cantidadCorregida == null) return base;
  const field = PRIMARY_DIMENSION_FIELD_BY_TIPO[el?.tipo];
  if(!field) return base;
  return { ...base, [field]: Number(el.cantidadCorregida) };
}

/* Adjunta metadatos de trazabilidad Fase B a un elemento ya validado por el
   validador existente de IA (_planoValidate.mjs#validateElement) -- nunca
   reemplaza esa validacion, solo agrega origin/id/geometry/dimension/
   timestamps encima del elemento YA aceptado como estructuralmente valido. */
export function attachAiOrigin(validatedElement, { bbox = null, fileName = '' } = {}){
  const now = new Date().toISOString();
  return {
    ...validatedElement,
    id: `ai-${uid()}`,
    origin: PLANO_ELEMENT_ORIGIN.AI_APPROXIMATION,
    geometry: bbox ? { kind: 'bbox', bbox } : null,
    dimension: validatedElement.cantidadPropuesta != null
      ? (validatedElement.unidad === 'm' ? { longitud: validatedElement.cantidadPropuesta }
        : validatedElement.unidad === 'm²' ? { area: validatedElement.cantidadPropuesta }
        : { piezas: validatedElement.cantidadPropuesta })
      : null,
    fileName,
    correctedBy: null,
    correctedAt: null,
    createdAt: now,
    updatedAt: now
  };
}
