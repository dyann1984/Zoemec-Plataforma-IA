/* Sesion de usuario: lectura/creacion de perfil en Firestore y construccion
   de la sesion normalizada que consume el resto de la app. Capa de
   infraestructura (habla con Firebase) que aplica las reglas puras de
   src/domain/permissions.js. */
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase.js';
import { startOneDriveConnect } from '../lib/onedrive.js';
import { getDeviceId } from '../utils/localStorage.js';
import { isAdminUser, userInitials } from '../domain/permissions.js';

export async function loadOrCreateProfile(fbUser, fallbackName='Usuario ZOEMEC'){
  const userRef = doc(db, 'users', fbUser.uid);
  const snap = await getDoc(userRef);
  if(snap.exists()) return { uid: fbUser.uid, ...snap.data() };
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
  await setDoc(userRef, profile, { merge:true });
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
