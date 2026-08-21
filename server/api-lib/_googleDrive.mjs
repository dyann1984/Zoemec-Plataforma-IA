/* Integracion real con Google Drive (API v3), usada por
   api/google-drive-list.mjs y api/google-drive-import.mjs.

   Credenciales: una sola cuenta de Google (no es OAuth por usuario, como
   OneDrive). Se autoriza UNA vez fuera de esta app (ej. con el "OAuth
   Playground" de Google o un script local), se obtiene un refresh_token de
   larga duracion, y ese token se guarda en Vercel. El folder compartido
   (repositorio tecnico real) debe estar compartido con la cuenta de Google
   que genero ese refresh_token (o, si se usa cuenta de servicio, compartido
   con el correo client_email de esa cuenta de servicio - ver nota abajo).

   Variables de entorno requeridas:
     GOOGLE_DRIVE_CLIENT_ID
     GOOGLE_DRIVE_CLIENT_SECRET
     GOOGLE_DRIVE_REFRESH_TOKEN
     GOOGLE_DRIVE_FOLDER_ID (carpeta raiz del repositorio tecnico)

   Alternativa con cuenta de servicio (si se prefiere no depender de un
   refresh_token de usuario): crear una cuenta de servicio en Google Cloud,
   descargar su JSON, y compartir la carpeta de Drive con el "client_email"
   de esa cuenta de servicio (permiso de Lector basta para listar/leer). En
   ese caso, en vez de GOOGLE_DRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN se usaria
   el JSON de la cuenta de servicio con un JWT firmado (google-auth-library),
   lo cual requiere agregar esa dependencia; no se implementa aqui para no
   sumar una libreria nueva sin necesidad, pero queda documentado como ruta
   alterna si se prefiere ese modelo en vez del refresh_token compartido. */

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function hasGoogleDriveCredentials(){
  return Boolean(
    process.env.GOOGLE_DRIVE_CLIENT_ID &&
    process.env.GOOGLE_DRIVE_CLIENT_SECRET &&
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN
  );
}

export function defaultFolderId(){
  return process.env.GOOGLE_DRIVE_FOLDER_ID || '';
}

let cachedToken = null; // { accessToken, expiresAt } — vive mientras la funcion serverless siga "caliente"

export async function getGoogleDriveAccessToken(){
  if(!hasGoogleDriveCredentials()){
    const error = new Error('Google Drive no esta configurado en este servidor (faltan GOOGLE_DRIVE_CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN).');
    error.status = 501;
    throw error;
  }
  if(cachedToken && cachedToken.expiresAt > Date.now() + 30000){
    return cachedToken.accessToken;
  }
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_DRIVE_CLIENT_ID,
    client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
    grant_type: 'refresh_token'
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await res.json().catch(() => null);
  if(!res.ok || !data?.access_token){
    const error = new Error(data?.error_description || 'Google rechazo el refresh token de Drive.');
    error.status = 502;
    throw error;
  }
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000) };
  return cachedToken.accessToken;
}

export async function driveFetch(path, { accessToken, ...init } = {}){
  const token = accessToken || await getGoogleDriveAccessToken();
  const res = await fetch(`${DRIVE_FILES_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) }
  });
  return res;
}

/* Los IDs reales de Drive solo usan letras, digitos, "-" y "_" (asi los emite
   la API). Cualquier otro caracter (comillas, espacios) en un folderId que
   venga del cliente es, por definicion, invalido — y antes se interpolaba
   sin validar dentro de una query de Drive ("'${targetFolder}' in parents"),
   lo que permitia romper la sintaxis de esa query con un folderId como
   "x' or trashed=false or '". */
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,120}$/;

export function isValidDriveId(id){
  return typeof id === 'string' && DRIVE_ID_RE.test(id);
}

/* Antes cualquier usuario con acceso a Biblioteca podia pedir listar
   CUALQUIER carpeta visible para la cuenta de Google compartida cambiando
   folderId, no solo el repositorio tecnico previsto en
   GOOGLE_DRIVE_FOLDER_ID. Esto confirma que la carpeta pedida es la raiz
   autorizada o un descendiente de ella, recorriendo "parents" hacia arriba
   con un limite de saltos para no encadenar llamadas indefinidamente. Si no
   hay carpeta raiz configurada, no hay arbol que restringir (mismo
   comportamiento que antes en ese caso). */
export async function isWithinAuthorizedTree(folderId, rootId, { maxHops = 12 } = {}){
  if(!rootId) return true;
  if(folderId === rootId) return true;
  let current = folderId;
  for(let hop = 0; hop < maxHops; hop++){
    const res = await driveFetch(`/${current}?fields=id,parents`);
    const data = await res.json().catch(() => null);
    if(!res.ok || !data) return false;
    const parents = Array.isArray(data.parents) ? data.parents : [];
    if(!parents.length) return false;
    if(parents.includes(rootId)) return true;
    current = parents[0];
  }
  return false;
}

/* Ruta original (breadcrumb) para trazabilidad de Biblioteca (RC4): antes
   solo se guardaba el nombre del archivo, nunca la carpeta de origen. Sube
   por "parents" desde el archivo hasta la raiz autorizada, igual que
   isWithinAuthorizedTree pero acumulando el NOMBRE de cada carpeta (no solo
   el id). Limite de saltos para no encadenar llamadas indefinidamente si el
   arbol esta mal formado. */
export async function buildDriveBreadcrumb(fileId, rootId, { maxHops = 12 } = {}){
  if(!rootId) return [];
  const names = [];
  let current = fileId;
  for(let hop = 0; hop < maxHops; hop++){
    const res = await driveFetch(`/${current}?fields=id,name,parents`);
    const data = await res.json().catch(() => null);
    if(!res.ok || !data) break;
    const parents = Array.isArray(data.parents) ? data.parents : [];
    if(!parents.length) break;
    const parentId = parents[0];
    const parentRes = await driveFetch(`/${parentId}?fields=id,name`);
    const parentData = await parentRes.json().catch(() => null);
    if(!parentRes.ok || !parentData) break;
    names.unshift(parentData.name);
    if(parentId === rootId) break;
    current = parentId;
  }
  return names;
}

export function isGoogleNativeDoc(mimeType = ''){
  return String(mimeType).startsWith('application/vnd.google-apps.');
}

/* Mapa minimo de exportacion para los formatos nativos de Google que
   razonablemente pueden aparecer en un repositorio tecnico (Docs/Sheets). */
export const GOOGLE_EXPORT_MIME = {
  'application/vnd.google-apps.spreadsheet': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  'application/vnd.google-apps.document': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
  'application/vnd.google-apps.presentation': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' }
};
