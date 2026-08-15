/* Namespacing de localStorage por usuario. Antes varias claves (zoemec-apus,
   zoemec-projects, zoemec-biblioteca, zoemec-zoe-thread, etc.) se leian/escribian
   en localStorage SIN prefijo de uid: en un navegador compartido, el Usuario B
   podia ver momentaneamente (o incluso sobreescribir en Firestore, via
   useCloudState) los datos locales que dejo el Usuario A. Firestore ya estaba
   bien aislado (users/{uid}/state/{clave}); el hueco era solo esta capa cache.

   activeUid es el respaldo para hooks que no reciben el uid directo como prop
   (ej. NotificationBell, Assistant): se actualiza de forma sincrona en cada
   cambio de sesion (login/logout/onAuthStateChanged) desde src/main.jsx, ANTES
   de que React vuelva a renderizar, asi que siempre esta al dia cuando un
   componente la lee durante su propio render. */
let activeUid = null;

export function setActiveUid(uid){
  activeUid = uid || null;
}

export function getActiveUid(){
  return activeUid;
}

export function scopedKey(baseKey, uid){
  const id = uid !== undefined ? (uid || null) : activeUid;
  return `zoemec:${id || 'guest'}:${baseKey}`;
}
