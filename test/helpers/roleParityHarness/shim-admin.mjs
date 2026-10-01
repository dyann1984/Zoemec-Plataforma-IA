// Shim de server/api-lib/_firebaseAdmin.mjs: mismo contrato exportado,
// respaldado por la base en memoria del arnes (globalThis.__HARNESS.db) y un
// verificador de tokens que mapea token -> decoded (como verifyIdToken).
import { FieldValue as FV } from './memdb.mjs';

export function hasAdminCredentials(){ return true; }
export function getAdminDb(){ return globalThis.__HARNESS.db; }
export function getAdminAuth(){
  return {
    async verifyIdToken(token){
      const decoded = globalThis.__HARNESS.tokens[token];
      if(!decoded){ const e = new Error('Firebase ID token invalido (harness).'); e.code = 'auth/argument-error'; throw e; }
      return { ...decoded };
    },
    async getUser(uid){ return { uid }; }
  };
}
export function getAdminStorage(){ throw new Error('Storage no disponible en el arnes.'); }
export const FieldValue = FV;
