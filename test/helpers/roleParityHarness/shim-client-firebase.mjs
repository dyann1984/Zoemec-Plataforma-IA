// Shim de src/firebase.js: el "navegador" del rol activo. authHeaders()
// (src/services/apiClient.js, real) pide el token a auth.currentUser.
export const firebaseConfig = {};
export const firebaseReady = true;
export const APP_PUBLIC_URL = 'http://harness.local';
export const emailActionCodeSettings = {};
export const firebaseApp = {};
export const auth = {
  get currentUser(){
    const t = globalThis.__HARNESS?.currentToken;
    return t ? { uid: globalThis.__HARNESS.tokens[t]?.uid, getIdToken: async () => t } : null;
  }
};
export const db = {};
export const storage = {};
