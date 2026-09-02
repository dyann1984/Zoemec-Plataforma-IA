/* Traduccion de errores tecnicos (Firebase, fetch, servicios internos) a
   mensajes que un usuario final puede entender, sin exponer detalles de
   infraestructura (nombres de variables de entorno, stack traces, CORS). */

export function firebaseMessage(error){
  const code = error?.code || '';
  /* Un dominio no autorizado es un problema de configuracion (Firebase Auth >
     Authorized domains), no una credencial invalida: mostrar "correo o
     contrasena incorrectos" aqui confundiria al usuario para intentar de nuevo
     con otra contrasena cuando el problema es del dominio, no de la cuenta. */
  if(code.includes('unauthorized-domain')) return 'Este dominio no esta autorizado en Firebase Authentication. Pide al administrador que lo agregue en Authentication > Settings > Authorized domains.';
  if(code.includes('email-already-in-use')) return 'Ese correo ya esta registrado. Inicia sesion.';
  if(code.includes('invalid-credential')) return 'Los datos de acceso no son validos. Verifica tu correo y tu contrasena.';
  if(code.includes('user-not-found')) return 'No encontramos una cuenta registrada con ese correo.';
  if(code.includes('wrong-password')) return 'La contrasena es incorrecta.';
  if(code.includes('weak-password')) return 'La contrasena debe tener minimo 6 caracteres.';
  if(code.includes('network')) return 'No hay conexion con Firebase. Revisa internet y vuelve a intentar.';
  if(code.includes('permission-denied')) return 'No se pudo completar la operacion por permisos de Firestore. Intenta de nuevo o contacta al administrador.';
  return error?.message || 'No se pudo conectar con Firebase.';
}

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
