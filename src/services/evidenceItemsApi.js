/* Cliente Firestore directo para evidenceItems (P0 -- persistencia real de
   metadata de evidencia de Levantamiento IA). Escritura DIRECTA del
   cliente (mismo criterio que Biblioteca -- ver firestore.rules#library):
   nunca pasa por un endpoint server-side porque no hay ninguna decision de
   negocio que proteger aqui, solo "yo, dueno autenticado, subi este
   archivo a MI propia ruta de Storage" -- las reglas ya son la barrera
   real (ownerUid==request.auth.uid, campos de identidad inmutables tras
   crear). Nunca sube ni lee el blob/File -- solo metadata + storagePath. */
import { collection, doc, setDoc, getDocs, query, where, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase.js';
import { makeEvidenceItem, buildGalleryFromEvidenceItems } from '../domain/evidenceItem.js';

/* Se llama DOS veces por archivo: al empezar la subida (status:'uploading',
   para que un refresh a medio subir al menos sepa que ese id existe) y de
   nuevo al terminar (status:'uploaded'|'error') -- ambas veces con
   {merge:true} sobre el MISMO id, nunca crea un documento nuevo por
   intento. Best-effort: un fallo aqui nunca debe bloquear el flujo real de
   captura (la subida a Storage ya tuvo exito o fallo por su cuenta antes
   de llegar aqui) -- se traga el error, nunca lo propaga. */
export async function recordEvidenceItem(fields){
  try{
    const item = makeEvidenceItem(fields);
    await setDoc(doc(db, 'evidenceItems', item.id), item, { merge: true });
  }catch{ /* metadata es un respaldo de recuperacion, nunca la barrera real de que el archivo exista en Storage */ }
}

/* ownerUid es obligatorio (no opcional): las reglas de Firestore para
   `list` no pueden evaluar con seguridad un campo de resource.data que no
   sea parte de los `where` de la propia consulta (resource.data ahi
   resuelve al valor por defecto de .get(), no al dato real -- confirmado
   diagnosticando este bug: la regla evaluaba `false` para un documento que
   SI tenia el ownerUid correcto). Filtrar tambien por ownerUid en la
   consulta hace que ese campo si sea parte del `where`, y de paso coincide
   exactamente con el unico uso real de esta funcion hoy: reconstruir la
   propia galeria de un borrador, nunca la de otra persona. */
export async function fetchEvidenceItemsForSurvey(surveyId, ownerUid){
  if(!surveyId || !ownerUid) return [];
  try{
    const snap = await getDocs(query(collection(db, 'evidenceItems'), where('surveyId', '==', surveyId), where('ownerUid', '==', ownerUid)));
    return buildGalleryFromEvidenceItems(snap.docs.map(d => d.data()));
  }catch{
    return [];
  }
}

export function deleteEvidenceItem(id){
  if(!id) return Promise.resolve();
  return deleteDoc(doc(db, 'evidenceItems', id)).catch(() => {});
}
