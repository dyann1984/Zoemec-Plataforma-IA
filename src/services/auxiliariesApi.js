/* Cliente Firestore directo para auxiliares (Fase B -- Cuantificador
   Parametrico ZOEMEC). Mismo criterio que src/services/evidenceItemsApi.js:
   escritura DIRECTA del cliente (las reglas de firestore.rules son la
   barrera real de aislamiento por organizationId), nunca pasa por un
   endpoint server-side (no hay ninguna decision de negocio que proteger
   aqui, y Vercel Hobby ya esta al limite de 12 funciones). */
import { collection, doc, setDoc, getDocs, query, where, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase.js';

export async function saveAuxiliary(aux){
  await setDoc(doc(db, 'auxiliares', aux.id), aux, { merge: true });
}

export async function listGlobalAuxiliaries(){
  try{
    const snap = await getDocs(query(collection(db, 'auxiliares'), where('organizationId', '==', null)));
    return snap.docs.map(d => d.data());
  }catch{ return []; }
}

export async function listOrgAuxiliaries(organizationId){
  if(!organizationId) return [];
  try{
    const snap = await getDocs(query(collection(db, 'auxiliares'), where('organizationId', '==', organizationId)));
    return snap.docs.map(d => d.data());
  }catch{ return []; }
}

export function deleteAuxiliary(id){
  if(!id) return Promise.resolve();
  return deleteDoc(doc(db, 'auxiliares', id)).catch(() => {});
}
