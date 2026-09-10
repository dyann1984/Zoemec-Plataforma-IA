import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

/* Fase 8: `import.meta.env` es una inyeccion de Vite -- bajo `node --test`
   plano (sin Vite) simplemente no existe (undefined), y leer una propiedad
   de undefined truena antes de que corra una sola linea de la prueba. Antes
   de esta fase ningun test de Node importaba este archivo (los tests de
   Firestore usan @firebase/rules-unit-testing directo, nunca este singleton
   -- ver test/apuBatchQueueCloud.test.mjs); el nuevo Dossier APU Auditable
   (apuDossierData.js) es el primero en llamar a src/services/apiClient.js
   desde codigo que TAMBIEN se ejecuta bajo Node puro en sus pruebas. El
   fallback a {} nunca cambia el comportamiento real en Vite (ahi
   import.meta.env siempre es un objeto real) -- solo evita el crash fuera
   de Vite, dejando que cada campo caiga a su valor por defecto de siempre. */
const env = import.meta.env || {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyDDsrzynvKAAZKtGDm3Q6pBHrhCiMGMTKI',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'zoemec-plataforma-ia.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'zoemec-plataforma-ia',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'zoemec-plataforma-ia.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '129018954093',
  appId: env.VITE_FIREBASE_APP_ID || '1:129018954093:web:da5a1d98d4f9552b389a64',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || 'G-C5BXRBCQQ0'
};

export const firebaseReady = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

/* Dominio publico real de ZOEMEC (Vercel, no Firebase Hosting). Se usa como
   destino de los enlaces de verificacion de correo -- ver
   emailActionCodeSettings mas abajo -- para que el usuario nunca aterrice en
   la pagina generica de Firebase (https://<authDomain>/__/auth/action). Debe
   estar en Firebase Console > Authentication > Settings > Authorized
   domains, o sendEmailVerification lanzara auth/unauthorized-continue-uri. */
export const APP_PUBLIC_URL = env.VITE_PUBLIC_APP_URL || 'https://zoemecia.com';

/* handleCodeInApp:true hace que Firebase mande el enlace de verificacion
   DIRECTO a esta URL (con ?mode=verifyEmail&oobCode=... en query), no al
   action handler generico de Firebase -- así ZOEMEC controla la pantalla
   completa (ver VerifyEmailScreen en src/main.jsx). El catch-all de
   vercel.json ya reenvia cualquier ruta a index.html, asi que la SPA recibe
   esos parametros sin importar la ruta. */
export const emailActionCodeSettings = {
  url: APP_PUBLIC_URL + '/',
  handleCodeInApp: true,
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);

/* Solo para desarrollo/pruebas locales: conecta a los emuladores de Firebase en vez
   del proyecto real cuando VITE_USE_FIREBASE_EMULATOR=true, para no escribir datos
   de prueba en el Firestore/Auth de produccion. Nunca se activa en el build de Vercel. */
if(env.DEV && env.VITE_USE_FIREBASE_EMULATOR === 'true' && !globalThis.__zoemecEmulatorConnected){
  globalThis.__zoemecEmulatorConnected = true;
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings:true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}
