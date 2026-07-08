import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

export const firebaseConfig = {
  apiKey: 'AIzaSyDDsrzynvKAAZKtGDm3Q6pBHrhCiMGMTKI',
  authDomain: 'zoemec-plataforma-ia.firebaseapp.com',
  projectId: 'zoemec-plataforma-ia',
  storageBucket: 'zoemec-plataforma-ia.firebasestorage.app',
  messagingSenderId: '129018954093',
  appId: '1:129018954093:web:da5a1d98d4f9552b389a64',
  measurementId: 'G-C5BXRBCQQ0'
};

export const firebaseReady = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);
