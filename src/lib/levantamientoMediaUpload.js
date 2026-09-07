/* Subida/borrado de video/fotos capturados con la camara para Levantamiento
   IA (Fase 2B, "Escanear con celular"). Acoplado a firebase/storage -- por
   eso, siguiendo la misma convencion que levantamientoModelLoader.js en
   Fase 2A, no tiene test unitario con node --test: se verifica en Preview
   subiendo un video/foto reales.

   Decision de arquitectura clave (ver plan de Fase 2B): esto sube DIRECTO
   del navegador a Firebase Storage con el SDK cliente, nunca a traves de
   una funcion serverless de Vercel -- el unico codigo de subida que existia
   antes de esta fase (api/upload-library.mjs, api/visual-ai.mjs) esta
   documentadamente limitado a MAX_UPLOAD_BYTES=15MB ("limite practico de
   body en funciones serverless"), inviable para video. Subir directo
   tambien da progreso real de subida gratis via el evento 'state_changed'
   de uploadBytesResumable. */
import { ref, uploadBytesResumable, deleteObject } from 'firebase/storage';
import { storage } from '../firebase.js';
import { uid } from '../utils/id.js';

/* Sube un Blob/File a levantamiento-media/{uid}/{surveyId}/{kind}/{fileId}/
   {fileName} -- ruta separada por kind a proposito (ver storage.rules,
   permite un tope de tamano distinto para video vs foto sin inspeccionar
   el mimeType). Nunca rechaza sin capturar: cualquier fallo de red/permiso
   se traduce a {ok:false, reason, message}, mismo contrato que loadModel3D
   en Fase 2A -- la UI del wizard nunca debe ver una excepcion cruda. */
export function uploadScanMedia({ blob, uid: userUid, surveyId, kind, mimeType, fileName, onProgress }){
  return new Promise(resolve => {
    const fileId = uid();
    const safeName = fileName || `${fileId}.${kind === 'video' ? 'webm' : 'jpg'}`;
    const storagePath = `levantamiento-media/${userUid}/${surveyId}/${kind}/${fileId}/${safeName}`;
    const storageRef = ref(storage, storagePath);
    const task = uploadBytesResumable(storageRef, blob, { contentType: mimeType || 'application/octet-stream' });
    task.on(
      'state_changed',
      snapshot => { onProgress?.(snapshot.totalBytes ? snapshot.bytesTransferred / snapshot.totalBytes : 0); },
      err => {
        const code = err?.code || '';
        const reason = code.includes('unauthorized') || code.includes('permission')
          ? 'permiso_denegado'
          : code.includes('quota')
            ? 'cuota_excedida'
            : 'error_de_red';
        resolve({ ok: false, reason, message: err?.message || 'No se pudo subir el archivo.' });
      },
      () => { resolve({ ok: true, storagePath, sizeBytes: blob.size }); }
    );
  });
}

/* Borrado best-effort -- mismo patron que Biblioteca (main.jsx:
   deleteObject(ref(storage, target.storagePath)).catch(()=>{})). Se usa
   tanto al eliminar un item individual en el wizard como al cancelar (se
   intenta borrar todo lo ya subido en esa sesion) y al borrar un
   levantamiento completo desde LevantamientoModule. Nunca lanza: si el
   objeto ya no existe o el usuario perdio conexion, simplemente no hace
   nada -- no bloquea el resto del flujo por un borrado que fallo. */
export function deleteScanMedia(storagePath){
  if(!storagePath) return Promise.resolve();
  return deleteObject(ref(storage, storagePath)).catch(() => {});
}
