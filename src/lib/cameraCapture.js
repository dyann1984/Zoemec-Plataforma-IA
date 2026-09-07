/* Captura de camara (getUserMedia/MediaRecorder/canvas) para Levantamiento
   IA (Fase 2B, "Escanear con celular"). Acoplado a APIs del navegador -- por
   eso, siguiendo la misma convencion que levantamientoModelLoader.js en
   Fase 2A, no tiene test unitario con node --test: se verifica en Preview
   con una camara real (conceder permiso, denegar, dispositivo sin camara).

   Responsabilidad UNICA: pedir el stream de camara, grabar/pausar/detener,
   y capturar un frame como foto. NUNCA sabe de Firebase Storage (eso vive
   en levantamientoMediaUpload.js) ni de la forma del Survey (eso vive en
   levantamientoMedia.js). Video-only en v1 -- audio:false siempre, por
   decision explicita del usuario (ver plan de Fase 2B): `withAudio` ya
   existe como parametro para que agregar despues el toggle opcional
   "Narrar recorrido" sea cambiar un valor, no reescribir esta funcion. */
import { pickPreferredVideoMimeType } from '../domain/levantamientoMedia.js';

/* Pide el stream de camara. Nunca lanza: cualquier fallo de getUserMedia se
   traduce a una razon reconocible por la UI, nunca un error crudo del
   navegador. `facingMode:'environment'` (camara trasera) es el default en
   ambos Android/iOS -- ver auditoria de compatibilidad en el plan. */
export async function getCameraStream({ facingMode = 'environment', withAudio = false } = {}){
  if(typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia){
    return { ok: false, reason: 'no_soportado' };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: withAudio });
    return { ok: true, stream };
  } catch(err){
    const name = err?.name || '';
    if(name === 'NotAllowedError' || name === 'SecurityError') return { ok: false, reason: 'permiso_denegado' };
    if(name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return { ok: false, reason: 'sin_camara' };
    if(name === 'NotReadableError' || name === 'TrackStartError') return { ok: false, reason: 'camara_en_uso' };
    return { ok: false, reason: 'error_desconocido' };
  }
}

/* Libera la camara -- debe llamarse SIEMPRE al desmontar el wizard o al
   cancelar, igual disciplina que disposeLoadedModel en Fase 2A: una camara
   encendida que nadie apaga es un bug de privacidad, no solo de memoria. */
export function stopStreamTracks(stream){
  stream?.getTracks().forEach(track => track.stop());
}

export function isMediaRecorderSupported(){
  return typeof MediaRecorder !== 'undefined';
}

const VIDEO_MIME_CANDIDATES = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

/* Feature-detection real (MediaRecorder.isTypeSupported) -- la fragmentacion
   de codecs entre Chrome/Android (webm) y iOS Safari 14.3+ (solo mp4/H.264
   de forma confiable) se resuelve probando cada candidato y delegando la
   eleccion final a pickPreferredVideoMimeType (pura, testeada). Regresa null
   si ninguno esta soportado -- el llamador debe ocultar Grabar en ese caso. */
export function pickSupportedVideoMimeType(){
  if(!isMediaRecorderSupported()) return null;
  const supported = VIDEO_MIME_CANDIDATES.filter(type => MediaRecorder.isTypeSupported(type));
  return pickPreferredVideoMimeType(supported);
}

/* Lee la duracion de un archivo de video existente (rama "subir video
   existente" del wizard, que no pasa por MediaRecorder). Usa un <video>
   offscreen temporal -- unico modo confiable de leer metadata de un
   archivo de video en el navegador sin una libreria de parsing. */
export function readVideoDurationSeconds(file){
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const videoEl = document.createElement('video');
    videoEl.preload = 'metadata';
    videoEl.onloadedmetadata = () => {
      const duration = Number.isFinite(videoEl.duration) ? videoEl.duration : null;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    videoEl.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    videoEl.src = url;
  });
}

/* Dibuja el frame actual del <video> en un canvas offscreen del mismo
   tamano real (videoWidth/videoHeight, no el tamano CSS mostrado) y lo
   exporta como Blob JPEG. Sin fragmentacion de formato entre plataformas
   (a diferencia del video, canvas.toBlob('image/jpeg') es universal). */
export function capturePhotoBlobFromVideoElement(videoEl, quality = 0.85){
  return new Promise((resolve, reject) => {
    if(!videoEl || !videoEl.videoWidth || !videoEl.videoHeight){
      reject(new Error('El video de la camara aun no tiene un frame disponible.'));
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if(blob) resolve(blob);
      else reject(new Error('No se pudo generar la foto.'));
    }, 'image/jpeg', quality);
  });
}
