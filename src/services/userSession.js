/* Sesion de usuario: lectura/creacion de perfil en Firestore y construccion
   de la sesion normalizada que consume el resto de la app. Capa de
   infraestructura (habla con Firebase) que aplica las reglas puras de
   src/domain/permissions.js. */
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase.js';
import { startOneDriveConnect } from '../lib/onedrive.js';
import { getDeviceId } from '../utils/localStorage.js';
import { isAdminUser, userInitials } from '../domain/permissions.js';
import { normalizeUserProfile } from '../domain/userProfile.js';
import { logLoginTrace, errInfo, isPermissionDeniedCode } from './loginDiagnostics.js';

/* DIAGNOSTICO TEMPORAL (incidente produccion "permission-denied" al iniciar
   sesion): antes, cualquier fallo aqui (en el getDoc o en el setDoc) se
   volvia indistinguible para quien llama -- login() solo veia "esto truena"
   y caia a fallbackProfile() sin saber si fue el GET, el CREATE, ni con que
   codigo real. Ahora se loguea la etapa exacta y se relanza el MISMO error
   sin modificarlo, para no cambiar el comportamiento existente (el try/catch
   de quien llama lo sigue atrapando igual que antes). `tracer` (ver
   src/services/loginDiagnostics.js) es opcional: si login()/la restauracion
   de sesion ya crearon uno para este intento, sus etapas (PROFILE_GET,
   PROFILE_CREATE, PROFILE_NORMALIZE) quedan bajo el MISMO traceId; sin
   tracer, cae a logLoginTrace() (sin traceId) para no romper llamadores que
   todavia no lo pasen. Borrar junto con src/services/loginDiagnostics.js
   cuando se cierre el incidente.

   Perfiles legacy (hallazgo del incidente): un documento users/{uid} creado
   por una version anterior de ZOEMEC (o manualmente) puede no traer
   role/plan/active, o traerlos con un tipo incorrecto. Antes eso se
   devolvia tal cual, y CUALQUIER escritura posterior a ese documento
   (ej. el sync de companyName en main.jsx) tronaba con permission-denied,
   porque la regla de "update" de Firestore exige que role/plan/active
   permanezcan iguales entre el documento existente y el resultante -- una
   comparacion que nunca puede ser cierta si el campo no existe. Ahora se
   normaliza SIEMPRE en memoria (normalizeUserProfile, logica pura y
   probada por separado) para que el login nunca dependa de que el backfill
   en Firestore tenga exito; el backfill mismo se intenta best-effort (si
   falla -- ej. mientras firestore.rules todavia no incluye la regla que lo
   permite -- se loguea y se continua con el perfil normalizado en memoria,
   nunca se bloquea el login por esto). */
export async function loadOrCreateProfile(fbUser, fallbackName='Usuario ZOEMEC', { tracer } = {}){
  const trace = (stage, extra) => (tracer ? tracer.trace(stage, extra) : logLoginTrace(stage, extra));
  const userRef = doc(db, 'users', fbUser.uid);
  let snap;
  try{
    snap = await getDoc(userRef);
  }catch(getError){
    trace(isPermissionDeniedCode(getError?.code) ? 'PROFILE_GET_PERMISSION_DENIED' : 'PROFILE_GET_OTHER_ERROR', errInfo(getError));
    throw getError;
  }
  if(snap.exists()){
    const raw = { uid: fbUser.uid, ...snap.data() };
    const { profile, needsNormalization, patch } = normalizeUserProfile(raw, fbUser);
    if(!needsNormalization){
      return profile;
    }
    // Se conserva esta traza (a diferencia del resto del camino feliz,
    // recortado post-incidente): detectar un perfil legacy es poco
    // frecuente y vale la pena poder monitorear cuantas cuentas siguen
    // necesitando este backfill.
    trace('PROFILE_GET_FOUND_LEGACY', { fields: Object.keys(patch) });
    try{
      await setDoc(userRef, { ...patch, updatedAt: serverTimestamp() }, { merge:true });
      trace('PROFILE_NORMALIZE_WRITE_SUCCESS', { fields: Object.keys(patch) });
    }catch(normalizeError){
      // Nunca bloquea el login: el perfil normalizado en memoria ya es
      // valido y seguro, con o sin el backfill persistido.
      trace(isPermissionDeniedCode(normalizeError?.code) ? 'PROFILE_NORMALIZE_WRITE_PERMISSION_DENIED' : 'PROFILE_NORMALIZE_WRITE_OTHER_ERROR', errInfo(normalizeError));
    }
    return profile;
  }
  const profile = {
    uid: fbUser.uid,
    name: fbUser.displayName || fallbackName || fbUser.email?.split('@')[0] || 'Usuario ZOEMEC',
    email: fbUser.email,
    role: 'user',
    plan: 'Gratis',
    active: true,
    apusCreated: 0,
    deviceId: getDeviceId(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  try{
    await setDoc(userRef, profile, { merge:true });
  }catch(createError){
    trace(isPermissionDeniedCode(createError?.code) ? 'PROFILE_CREATE_PERMISSION_DENIED' : 'PROFILE_CREATE_OTHER_ERROR', errInfo(createError));
    throw createError;
  }
  return profile;
}

/* Si Firestore no responde (red, permisos, indice) la sesion de Firebase Auth
   ya es valida y no debe perderse: se arma un perfil minimo desde el propio
   fbUser para que isAdminUser() todavia pueda reconocer admin por correo/claims
   sin depender de que el documento de Firestore se haya podido leer. */
export function fallbackProfile(fbUser, deviceId){
  return {
    uid: fbUser.uid,
    name: fbUser.displayName || fbUser.email?.split('@')[0] || 'Usuario ZOEMEC',
    email: fbUser.email,
    role: 'user',
    plan: 'Gratis',
    active: true,
    apusCreated: 0,
    deviceId: deviceId || getDeviceId()
  };
}

export function buildSession(profile, fbUser, claims=null){
  const name = profile?.name || fbUser?.displayName || fbUser?.email?.split('@')?.[0] || 'Usuario ZOEMEC';
  const role = profile?.role || 'user';
  const email = profile?.email || fbUser?.email;
  const isAdmin = isAdminUser({ email, claims }, profile);
  if(import.meta.env.DEV){
    console.log('[ZOEMEC][admin-check]', { email, roleDetectado: role, isAdmin });
  }
  return {
    uid: profile?.uid || fbUser?.uid,
    name,
    email,
    role: isAdmin ? 'admin' : role,
    isAdmin,
    plan: isAdmin ? (profile?.plan || 'Empresa') : (profile?.plan || 'Gratis'),
    active: profile?.active !== false,
    initials: userInitials(name, email),
    deviceId: profile?.deviceId || getDeviceId(),
    apusCreated: Number(profile?.apusCreated || 0)
  };
}

/* Conexion real con OneDrive (OAuth2 + PKCE contra Microsoft Identity Platform,
   ver src/lib/onedrive.js). Sin VITE_ONEDRIVE_CLIENT_ID configurado, el intento
   falla con un mensaje honesto en vez de simular una conexion exitosa. */
export async function connectOneDrive(){
  try{
    await startOneDriveConnect();
  }catch(err){
    window.zoemecNotify?.(err.message || 'No se pudo iniciar la conexion con OneDrive.', 'error');
  }
}
