/* Logica PURA de control optimista de concurrencia para escritura en
   OneDrive (gap real reportado en QA: uploadFile en api/onedrive.mjs
   escribia directo sobre `:/content` sin comparar version remota,
   arriesgando "el mas reciente gana" en silencio si dos lados cambiaban el
   mismo archivo). Sin fetch, sin Firebase -- solo decide que headers
   enviar y como interpretar la respuesta de Microsoft Graph, para poder
   probarlo sin red real (no hay credenciales de OneDrive en este entorno,
   ver reporte de QA "Estado actual de OAuth y permisos").

   Contrato con api/onedrive.mjs#uploadFile:
   - Sin `resolution` (caso normal): si el llamador declara `remoteEtag`
     (el ultimo que SI vio), se envia If-Match -- Microsoft Graph responde
     409/412 si alguien mas escribio el archivo desde entonces. NUNCA se
     sobrescribe en ese caso: el handler debe leer la metadata remota
     ACTUAL y responder con un estado CONFLICTO explicito, sin llamar a
     esta escritura.
   - `resolution:'local'`: el humano ya eligio conservar su version -- se
     sube sin If-Match (fuerza la escritura), nunca automatico.
   - `resolution:'remote'`: el humano eligio conservar lo remoto -- el
     handler ni siquiera debe invocar la escritura (ver api/onedrive.mjs),
     solo reportar la metadata remota tal cual.
   - `resolution:'version'`: el humano eligio guardar AMBOS -- el contenido
     local se sube bajo un nombre nuevo (uploadFileName), nunca pisa el
     remoto. */

export const CONFLICT_HTTP_STATUSES = Object.freeze([409, 412]);

export function isConflictStatus(httpStatus){
  return CONFLICT_HTTP_STATUSES.includes(httpStatus);
}

export function buildUploadHeaders({ accessToken, remoteEtag, resolution }){
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/octet-stream' };
  // 'local'/'version' son resoluciones EXPLICITAS de un conflicto ya
  // detectado (el humano ya decidio) -- forzar la escritura sin condicion
  // es lo pedido, no un atajo automatico.
  if(remoteEtag && resolution !== 'local' && resolution !== 'version') headers['If-Match'] = remoteEtag;
  return headers;
}

/* Nombre real a usar para la subida: 'version' (guardar ambos) sube el
   contenido local bajo un nombre NUEVO, nunca reemplaza el archivo remoto
   -- ambas versiones sobreviven. `now` es inyectable para pruebas
   deterministas. */
export function uploadFileName(safeName, resolution, now = new Date()){
  if(resolution !== 'version') return safeName;
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const dot = safeName.lastIndexOf('.');
  if(dot <= 0) return `${safeName} (conflicto ${stamp})`;
  return `${safeName.slice(0, dot)} (conflicto ${stamp})${safeName.slice(dot)}`;
}
