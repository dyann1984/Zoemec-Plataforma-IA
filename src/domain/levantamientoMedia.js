/* Captura visual de video/fotos para Levantamiento IA (Fase 2B, "Escanear con
   celular"). Modulo puro, sin React/DOM/Firebase/MediaRecorder -- mismo
   espiritu que levantamientoImportConversion.js: solo constantes y funciones
   deterministas, testeables con node --test sin mocks de navegador.

   Separacion de dominio (misma regla que el resto de Levantamiento IA): este
   archivo NO sabe pedir permiso de camara ni grabar (eso vive en
   src/lib/cameraCapture.js) ni subir a Storage (eso vive en
   src/lib/levantamientoMediaUpload.js) -- solo valida limites y arma el
   descriptor plano que se guarda en survey.scanMedia.

   v1 es deliberadamente honesto sobre su alcance (ver plan de Fase 2B): esto
   SOLO captura y almacena video/fotos. No genera geometria, no genera
   medidas, no produce ningun Space. hasAudio siempre es false en v1 -- la
   arquitectura deja el campo listo para un futuro toggle opcional "Narrar
   recorrido" sin tener que cambiar la forma del descriptor. */
import { uid } from '../utils/id.js';

export const SCAN_MEDIA_KIND = Object.freeze({ VIDEO: 'video', PHOTO: 'photo' });

export const MAX_SCAN_VIDEO_BYTES = 200 * 1024 * 1024;
export const MAX_SCAN_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_SCAN_DURATION_SECONDS = 180;
export const MAX_SCAN_ITEMS = 20;

/* Activacion real del flujo (mismo mecanismo que SURVEY_IMPORT_FORMATS[*].status
   en Fase 2A): permanece false hasta el ultimo commit de la fase, cuando el
   flujo completo ya este probado y verificado en Preview. NewSurveyModal.jsx
   lee esta bandera para decidir si "Escanear con celular" es un boton real o
   sigue deshabilitado -- nunca se quita `disabled` a mano antes de esto. */
export const PHONE_SCAN_AVAILABLE = false;

function toFiniteNumber(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* Valida un archivo/clip ya capturado contra los limites de arriba, antes de
   intentar subirlo. `currentCount` (opcional) es cuantos items ya tiene el
   levantamiento en esta sesion -- permite rechazar el item #21 sin tener que
   conocer el resto del estado del wizard. Nunca lanza: siempre regresa
   {valid, errors}, igual que validateImportFile en Fase 2A. */
export function validateScanMediaFile({ kind, sizeBytes, durationSeconds = null, currentCount = 0 }){
  const errors = [];
  if(kind !== SCAN_MEDIA_KIND.VIDEO && kind !== SCAN_MEDIA_KIND.PHOTO){
    errors.push('tipo_invalido');
    return { valid: false, errors };
  }
  if(Number(currentCount) >= MAX_SCAN_ITEMS){
    errors.push('excede_maximo_items');
  }
  const size = toFiniteNumber(sizeBytes);
  const maxBytes = kind === SCAN_MEDIA_KIND.VIDEO ? MAX_SCAN_VIDEO_BYTES : MAX_SCAN_PHOTO_BYTES;
  if(size === null || size <= 0 || size > maxBytes){
    errors.push('excede_tamano_maximo');
  }
  if(kind === SCAN_MEDIA_KIND.VIDEO){
    const duration = toFiniteNumber(durationSeconds);
    if(duration !== null && duration > MAX_SCAN_DURATION_SECONDS){
      errors.push('excede_duracion_maxima');
    }
  }
  return { valid: errors.length === 0, errors };
}

/* Descriptor plano y JSON-safe de un item de media -- lo unico que se
   persiste en survey.scanMedia. Nunca incluye el Blob/File original ni una
   downloadURL firmada larga (esa se regenera al vuelo con getDownloadURL,
   ver hallazgo del limite de 950KB de saveCloud en el plan de Fase 2B). */
export function buildScanMediaItem({ kind, storagePath, mimeType, sizeBytes, durationSeconds = null, capturedAt = Date.now() }){
  return {
    id: 'MED-' + uid(),
    kind: kind === SCAN_MEDIA_KIND.PHOTO ? SCAN_MEDIA_KIND.PHOTO : SCAN_MEDIA_KIND.VIDEO,
    storagePath: storagePath || '',
    mimeType: mimeType || '',
    sizeBytes: toFiniteNumber(sizeBytes) || 0,
    durationSeconds: kind === SCAN_MEDIA_KIND.VIDEO ? (toFiniteNumber(durationSeconds) || 0) : null,
    hasAudio: false,
    capturedAt: toFiniteNumber(capturedAt) || Date.now()
  };
}

/* Elige el mimeType de video preferido entre los que el navegador ya
   confirmo soportar (MediaRecorder.isTypeSupported -- esa llamada real vive
   en cameraCapture.js, no testeable sin navegador). Pura logica de orden de
   preferencia: mp4/H.264 primero (mejor compatibilidad de reproduccion
   universal), luego webm con el mejor codec disponible. */
const VIDEO_MIME_PREFERENCE = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export function pickPreferredVideoMimeType(candidates){
  const list = Array.isArray(candidates) ? candidates : [];
  for(const preferred of VIDEO_MIME_PREFERENCE){
    if(list.includes(preferred)) return preferred;
  }
  return list[0] || null;
}
