// F4-QA -- shim de 'firebase/auth': sesion QA fija por pestaña (sin contraseñas,
// sin Firebase real). ?qa=MGR-1 | COL-1 elige el usuario; el token es el que
// verifica el shim de Firebase Admin del arnes (tok-{uid}).
const USERS = {
  'MGR-1': { email: 'mgr@harness.test', displayName: 'QA Manager' },
  'COL-1': { email: 'col@harness.test', displayName: 'QA Colaborador' }
};
function pickUid(){
  try{
    const p = new URLSearchParams(location.search).get('qa');
    if(p && USERS[p]) sessionStorage.setItem('zoemec-qa-user', p);
    return sessionStorage.getItem('zoemec-qa-user') || 'MGR-1';
  }catch{ return 'MGR-1'; }
}
function makeUser(uid){
  const u = USERS[uid];
  const token = `tok-${uid}`;
  return {
    uid, email: u.email, displayName: u.displayName, emailVerified: true, isAnonymous: false, providerData: [{ providerId: 'password' }],
    metadata: {}, getIdToken: async () => token,
    getIdTokenResult: async () => ({ token, claims: {}, signInProvider: 'password' }),
    reload: async () => {}
  };
}
let signedOut = false;
const listeners = new Set();
const auth = {
  get currentUser(){ return signedOut ? null : makeUser(pickUid()); },
  languageCode: 'es'
};
export function getAuth(){ return auth; }
export function connectAuthEmulator(){}
export function onAuthStateChanged(a, cb){
  listeners.add(cb);
  setTimeout(() => cb(auth.currentUser), 0);
  return () => listeners.delete(cb);
}
export const onIdTokenChanged = onAuthStateChanged;
export async function signOut(){ signedOut = true; listeners.forEach(cb => cb(null)); }
export async function getIdTokenResult(user){ return user.getIdTokenResult(); }
const unsupported = name => async () => { throw Object.assign(new Error(`${name} no disponible en el servidor QA (sesion fija).`), { code: 'auth/operation-not-supported-in-this-environment' }); };
export const signInWithEmailAndPassword = unsupported('signInWithEmailAndPassword');
export const createUserWithEmailAndPassword = unsupported('createUserWithEmailAndPassword');
export const signInWithPopup = unsupported('signInWithPopup');
export async function sendEmailVerification(){}
export async function applyActionCode(){}
export async function updateProfile(){}
export function getAdditionalUserInfo(){ return null; }
export class GoogleAuthProvider{ setCustomParameters(){} addScope(){} }
