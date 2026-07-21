/* ====================================================================
   ZOEMEC · Conexion real con OneDrive (Microsoft Graph, OAuth2 + PKCE)
   ---------------------------------------------------------------------
   No hay ningun dato simulado aqui: es el flujo real de autorizacion de
   Microsoft Identity Platform (authorization code + PKCE, sin exponer
   client secret en el navegador). Sin VITE_ONEDRIVE_CLIENT_ID configurado
   en este entorno, isOneDriveConfigured() regresa false y el boton de
   "Conectar" debe mostrar ese estado honestamente en vez de simular una
   conexion exitosa. El intercambio del "code" por tokens ocurre en el
   servidor (api/onedrive.mjs), que es el unico lugar donde puede vivir
   el client secret de la app registrada en Azure AD.
   ==================================================================== */
const CLIENT_ID = import.meta.env.VITE_ONEDRIVE_CLIENT_ID || '';
const TENANT = import.meta.env.VITE_ONEDRIVE_TENANT_ID || 'common';
const SCOPES = 'offline_access User.Read Files.Read Files.Read.All';
const AUTH_BASE = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0`;
const VERIFIER_KEY = 'zoemec-onedrive-verifier';
const STATE_KEY = 'zoemec-onedrive-state';

export function isOneDriveConfigured(){
  return Boolean(CLIENT_ID);
}

function toBase64Url(bytes){
  let str = '';
  bytes.forEach(b => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomToken(len = 64){
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes).slice(0, len);
}
async function pkceChallenge(verifier){
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

/* Redirige de verdad al login de Microsoft. Si CLIENT_ID no esta configurado,
   lanza un error honesto en vez de fingir que abrio una sesion. */
export async function startOneDriveConnect(){
  if(!isOneDriveConfigured()){
    throw new Error('OneDrive no esta configurado en este entorno: falta VITE_ONEDRIVE_CLIENT_ID. Registra la app en Azure AD y configura la variable en Vercel.');
  }
  const verifier = randomToken(64);
  const state = randomToken(24);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const redirectUri = `${window.location.origin}${window.location.pathname}`;
  const challenge = await pkceChallenge(verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });
  window.location.href = `${AUTH_BASE}/authorize?${params.toString()}`;
}

/* Se llama al cargar la app: si la URL trae ?code=...&state=... (Microsoft
   redirigio de vuelta tras un login real), intercambia el code por tokens
   en el servidor y limpia la URL. Si no hay parametros de OneDrive, no hace
   nada (caso normal de cualquier otra carga de pantalla). */
export function consumeOneDriveRedirect(){
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error');
  if(!code && !oauthError) return null;
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('session_state');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  window.history.replaceState({}, '', url.toString());
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if(oauthError) return { error: oauthError };
  if(!verifier || state !== expectedState) return { error: 'La sesion de conexion con OneDrive expiro o no coincide. Intenta de nuevo.' };
  return { code, verifier, redirectUri: `${url.origin}${url.pathname}` };
}
