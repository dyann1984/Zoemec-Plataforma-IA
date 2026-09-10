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

/* t: funcion useI18n().t (o cualquier (key)=>string). Si no se provee (por
   ejemplo, codigo que todavia corre fuera de I18nProvider), cae al texto en
   espanol de siempre -- nunca truena por falta de t. */
export function firebaseMessage(error, t){
  const code = String(error?.code || '');
  const match = FIREBASE_CODE_TO_KEY.find(([needle]) => code.includes(needle));
  const key = match ? match[1] : 'generic';
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
