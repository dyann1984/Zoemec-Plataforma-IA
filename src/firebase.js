// Configura Firebase cuando tengas tus llaves reales.
// Por ahora la app funciona en modo local/demo con localStorage.
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

export const firebaseReady = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
