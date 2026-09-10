/* Traduccion de errores tecnicos (Firebase, fetch, servicios internos) a
   mensajes que un usuario final puede entender, sin exponer detalles de
   infraestructura (nombres de variables de entorno, stack traces, CORS),
   y en el idioma activo de la app (ver src/i18n). */

const FIREBASE_CODE_TO_KEY = [
  ['unauthorized-continue-uri', 'unauthorizedContinueUri'],
  ['unauthorized-domain', 'unauthorizedDomain'],
  ['email-already-in-use', 'emailAlreadyInUse'],
  ['invalid-credential', 'invalidCredential'],
  ['user-not-found', 'userNotFound'],
  ['wrong-password', 'wrongPassword'],
  ['weak-password', 'weakPassword'],
  ['invalid-email', 'invalidEmail'],
  ['user-disabled', 'userDisabled'],
  ['too-many-requests', 'tooManyRequests'],
  ['requires-recent-login', 'requiresRecentLogin'],
  ['expired-action-code', 'expiredActionCode'],
  ['invalid-action-code', 'invalidActionCode'],
  ['network', 'network'],
  ['permission-denied', 'permissionDenied'],
];

/* FIX (incidente produccion, hallazgo "clasificacion de permission-denied
   demasiado generica"): antes, CUALQUIER error cuyo .code contuviera el
   substring "permission-denied" se etiquetaba como "permisos de Firestore",
   sin importar si en realidad venia de Auth, Storage, una Cloud Function
   callable, o una llamada REST cruda a una API de Google. Eso puede mostrarle
   al usuario un mensaje que culpa a Firestore cuando el problema real es de
   otra capa. classifyErrorOrigin() distingue por el prefijo real que cada
   SDK de Firebase usa en error.code (Auth: "auth/...", Storage:
   "storage/...", Functions callable: "functions/..."); el codigo de
   Firestore NO lleva prefijo (es "permission-denied" a secas). Una llamada
   REST cruda (fetch directo a *.googleapis.com, sin pasar por un SDK)
   normalmente no trae ninguno de estos prefijos y reporta el status en
   mayusculas ("PERMISSION_DENIED") en vez de en el formato de los SDKs --
   eso se clasifica aparte como "rest" en vez de asumirse Firestore por
   default. */
export function classifyErrorOrigin(error){
  const code = String(error?.code || '');
  const status = String(error?.status || '').toUpperCase();
  if(code.startsWith('auth/')) return 'auth';
  if(code.startsWith('storage/')) return 'storage';
  if(code.startsWith('functions/')) return 'functions';
  if(code === 'permission-denied') return 'firestore';
  if(code === 'PERMISSION_DENIED' || status === 'PERMISSION_DENIED') return 'rest';
  return 'unknown';
}

const PERMISSION_DENIED_KEY_BY_ORIGIN = {
  firestore: 'permissionDeniedFirestore',
  auth: 'permissionDeniedAuth',
  storage: 'permissionDeniedStorage',
  functions: 'permissionDeniedFunctions',
  rest: 'permissionDeniedRest',
  unknown: 'permissionDeniedRest',
};

/* t: funcion useI18n().t (o cualquier (key)=>string). Si no se provee (por
   ejemplo, codigo que todavia corre fuera de I18nProvider), cae al texto en
   espanol de siempre -- nunca truena por falta de t. */
export function firebaseMessage(error, t){
  const code = String(error?.code || '');
  const match = FIREBASE_CODE_TO_KEY.find(([needle]) => code.includes(needle));
  let key = match ? match[1] : 'generic';
  // Un "PERMISSION_DENIED" crudo (REST, sin pasar por ningun SDK) no trae el
  // formato en minusculas-con-guion que espera FIREBASE_CODE_TO_KEY -- sin
  // esto, caeria en "generic" y se perderia la senal de que fue un rechazo
  // de permisos.
  const isUnmatchedRestDenial = !match && classifyErrorOrigin(error) === 'rest';
  if(key === 'permissionDenied' || isUnmatchedRestDenial){
    key = PERMISSION_DENIED_KEY_BY_ORIGIN[classifyErrorOrigin(error)];
  }
  if(typeof t === 'function'){
    const translated = t(`auth.errors.${key}`);
    // translate() (src/i18n/i18nStorage.js) cae de vuelta a la propia key si
    // no encuentra la traduccion -- nunca debe llegar eso al usuario.
    if(translated && translated !== `auth.errors.${key}`) return translated;
  }
  return FALLBACK_ES[key] || error?.message || FALLBACK_ES.generic;
}

const FALLBACK_ES = {
  unauthorizedContinueUri: 'Error de configuracion del dominio de verificacion. Contacta a soporte ZOEMEC.',
  unauthorizedDomain: 'Este dominio no esta autorizado en Firebase Authentication. Pide al administrador que lo agregue en Authentication > Settings > Authorized domains.',
  emailAlreadyInUse: 'Ese correo ya esta registrado. Inicia sesion.',
  invalidCredential: 'Los datos de acceso no son validos. Verifica tu correo y tu contrasena.',
  userNotFound: 'No encontramos una cuenta registrada con ese correo.',
  wrongPassword: 'La contrasena es incorrecta.',
  weakPassword: 'La contrasena debe tener minimo 6 caracteres.',
  invalidEmail: 'Ese correo no tiene un formato valido.',
  userDisabled: 'Esta cuenta fue deshabilitada. Contacta al administrador de ZOEMEC.',
  tooManyRequests: 'Demasiados intentos seguidos. Espera unos minutos e intenta de nuevo.',
  requiresRecentLogin: 'Por seguridad, vuelve a iniciar sesion para completar esta accion.',
  expiredActionCode: 'Este enlace de verificacion ya expiro.',
  invalidActionCode: 'Este enlace ya fue utilizado o no es valido.',
  network: 'No hay conexion con Firebase. Revisa internet y vuelve a intentar.',
  permissionDenied: 'No se pudo completar la operacion por permisos de Firestore. Intenta de nuevo o contacta al administrador.',
  permissionDeniedFirestore: 'No se pudo completar la operacion por permisos de Firestore. Intenta de nuevo o contacta al administrador.',
  permissionDeniedAuth: 'No se pudo completar la operacion de inicio de sesion por un permiso denegado. Intenta de nuevo o contacta al administrador.',
  permissionDeniedStorage: 'No se pudo completar la operacion por permisos de almacenamiento de archivos. Intenta de nuevo o contacta al administrador.',
  permissionDeniedFunctions: 'No se pudo completar la operacion (permiso denegado por el servicio). Intenta de nuevo o contacta al administrador.',
  permissionDeniedRest: 'No se pudo completar la operacion (permiso denegado). Intenta de nuevo o contacta al administrador.',
  generic: 'No se pudo conectar con Firebase. Intenta de nuevo en unos minutos.',
};

/* Los endpoints /api/* devuelven a veces el detalle tecnico exacto (nombre de la
   variable de entorno faltante) para facilitar el diagnostico en Vercel. Esa cadena
   nunca debe llegar al usuario final: se sustituye por un mensaje comercial. */
export function friendlyServiceError(err, fallback='Servicio temporalmente no disponible. Intenta de nuevo en unos minutos.'){
  const msg = String(err?.message || '').trim();
  if(!msg) return fallback;
  if(/API_KEY|ACCESS_TOKEN|SERVICE_ACCOUNT|PRIVATE_KEY|CLIENT_EMAIL|process\.env|\bVercel\b|\.env\b/i.test(msg)){
    return 'Servicio temporalmente no configurado. Intenta mas tarde o contacta a soporte.';
  }
  /* Un token OAuth expirado/revocado (Google Drive, OneDrive o cualquier
     integracion futura basada en token) nunca debe mostrarse en el idioma e
     ID tecnico crudo que devuelve el proveedor (ej. Google: "Token has been
     expired or revoked.", "invalid_grant"). El llamador (ej. GoogleDrivePanel
     en main.jsx) decide si ademas ofrece un boton de reconexion segun el rol
     del usuario; esta funcion solo garantiza que el texto sea profesional y
     este en espanol en cualquier punto donde se use. */
  if(/token.*(expired|revoked|invalid)|invalid_grant|expired.*token|revoked.*token/i.test(msg)){
    return 'La sesion de esta integracion expiro. Vuelve a conectarla para continuar.';
  }
  /* Red de seguridad: si por alguna otra ruta llega un error crudo de parseo
     (JSON.parse/SyntaxError/fetch), nunca se muestra tal cual al usuario. */
  if(/unexpected (end of|token)|json\.parse|syntaxerror|failed to fetch|networkerror/i.test(msg)){
    return 'El servicio no respondio correctamente. Intenta de nuevo en unos minutos.';
  }
  /* Un error de CORS (subida directa del navegador bloqueada) nunca debe
     mostrarse tal cual: es ruido tecnico para el usuario final. */
  if(/cors|cross-origin|preflight|access-control-allow-origin|err_failed/i.test(msg)){
    return 'No se pudo completar la operación en este entorno. Intenta de nuevo o contacta a soporte.';
  }
  return msg;
}
