import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDDsrzynvKAAZKtGDm3Q6pBHrhCiMGMTKI',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'zoemec-plataforma-ia.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'zoemec-plataforma-ia',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'zoemec-plataforma-ia.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '129018954093',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:129018954093:web:da5a1d98d4f9552b389a64',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-C5BXRBCQQ0'
};

export const firebaseReady = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);

/* Solo para desarrollo/pruebas locales: conecta a los emuladores de Firebase en vez
   del proyecto real cuando VITE_USE_FIREBASE_EMULATOR=true, para no escribir datos
   de prueba en el Firestore/Auth de produccion. Nunca se activa en el build de Vercel. */
if(import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true' && !globalThis.__zoemecEmulatorConnected){
  globalThis.__zoemecEmulatorConnected = true;
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings:true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}
