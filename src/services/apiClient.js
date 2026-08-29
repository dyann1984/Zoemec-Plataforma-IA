/* Cliente HTTP hacia las funciones serverless de /api/*: agrega el token de
   Firebase Auth vigente, y nunca deja que un JSON vacio o mal formado llegue
   como excepcion cruda a la UI. Capa de infraestructura: no conoce reglas de
   negocio, solo transporte. */
import { auth } from '../firebase.js';

export async function authHeaders(){
  const headers = {'Content-Type':'application/json'};
  const token = await auth?.currentUser?.getIdToken?.();
  if(token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function httpErrorMessage(status, fallback){
  if(status === 401) return 'Sesion expirada o no autenticada. Vuelve a iniciar sesion.';
  if(status === 403) return 'No tienes permiso para completar esta accion.';
  if(status === 429) return 'Demasiadas solicitudes en poco tiempo. Espera unos segundos y vuelve a intentar.';
  if(status >= 500) return 'El servicio no esta disponible en este momento. Intenta de nuevo en unos minutos.';
  return fallback;
}

/* Lee una respuesta fetch como JSON sin arriesgar "Unexpected end of JSON input":
   primero lee el texto crudo, valida que no este vacio y solo entonces intenta
   JSON.parse. Un cuerpo vacio o mal formado (504/502 de la plataforma, corte de
   red a media respuesta, etc.) regresa un error saneado en vez de una excepcion
   de parseo cruda visible para el usuario. */
export async function readJsonSafe(res){
  let text = '';
  try{ text = await res.text(); }catch{ text = ''; }
  if(!text || !text.trim()) return { error: httpErrorMessage(res.status, `El servidor no respondio contenido (HTTP ${res.status}).`) };
  try{ return JSON.parse(text); }
  catch{ return { error: httpErrorMessage(res.status, `El servidor respondio un formato invalido (HTTP ${res.status}).`) }; }
}

export async function apiPost(path, body){
  const res = await fetch(path, {
    method:'POST',
    headers:await authHeaders(),
    body:JSON.stringify(body || {})
  });
  const data = await readJsonSafe(res);
  if(!res.ok){
    // FIX Fase 9 (hallazgo F-004): propaga data.code/data.currentVersion (ej.
    // VERSION_CONFLICT de api/apus.mjs#handleSaveVersion) al Error lanzado --
    // antes se perdian, obligando a cualquier llamador a adivinar el tipo de
    // error leyendo el texto del mensaje.
    const err = new Error(data.error || 'No se pudo completar la solicitud.');
    if(data.code) err.code = data.code;
    if(data.currentVersion) err.currentVersion = data.currentVersion;
    throw err;
  }
  return data;
}

/* No lanza: se usa para indicadores de estado donde un endpoint no disponible
   (ej. servidor local de desarrollo, que no espeja /api/status) debe leerse
   como "no disponible" en vez de romper la interfaz. */
export async function apiGetSafe(path){
  try{
    const res = await fetch(path, { headers:await authHeaders() });
    if(!res.ok) return null;
    return await res.json();
  }catch{
    return null;
  }
}

export function aiServerUrl(path=''){ return path; }
