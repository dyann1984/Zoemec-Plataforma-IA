/* Adapter de Firestore para Memoria Tecnica (Fase 4, regla 12 del spec).
   Implementa el MISMO contrato que technicalMemoryRepository.js#createInMemoryMemoryRepository
   (list/getById/save/saveMany) -- cualquier codigo que orqueste memoria
   puede recibir uno u otro sin cambiar su logica.

   Colección: 'technicalMemory' (plana, mismo criterio que 'library'/'users'/
   'payments' en api/*.mjs -- ver getAdminDb() en _firebaseAdmin.mjs).

   IMPORTANTE: este archivo usa firebase-admin (igual que el resto de
   server/api-lib), por eso vive fuera de src/domain (que debe poder
   ejecutarse sin red/credenciales). Nunca se ejecuta contra produccion
   desde esta fase -- solo se prueba contra el emulador local (ver
   test/technicalMemoryFirestoreAdapter.test.mjs, corrido via
   `npm run test:memory`, que levanta y apaga el emulador). Escribir/leer
   contra el proyecto real requiere credenciales reales que esta fase no usa. */
import { getAdminDb, FieldValue } from './_firebaseAdmin.mjs';
import { assertImplementsMemoryRepository } from '../../src/domain/technicalMemoryRepository.js';

const COLLECTION = 'technicalMemory';

export function createFirestoreMemoryRepository(){
  const db = getAdminDb();
  const col = db.collection(COLLECTION);
  return assertImplementsMemoryRepository({
    async list(query = {}){
      let ref = col;
      if(query.scope) ref = ref.where('scope', '==', query.scope);
      if(query.type) ref = ref.where('type', '==', query.type);
      if(query.status) ref = ref.where('status', '==', query.status);
      const snap = await ref.get();
      return snap.docs.map(doc => doc.data());
    },
    async getById(id){
      const doc = await col.doc(id).get();
      return doc.exists ? doc.data() : null;
    },
    async save(entry){
      if(!entry?.id) throw new Error('save() requiere entry.id.');
      await col.doc(entry.id).set({ ...entry, updatedAt: FieldValue.serverTimestamp() });
      return entry;
    },
    async saveMany(entries = []){
      const batch = db.batch();
      entries.forEach(entry => {
        if(!entry?.id) throw new Error('saveMany() requiere entry.id en cada entrada.');
        batch.set(col.doc(entry.id), { ...entry, updatedAt: FieldValue.serverTimestamp() });
      });
      await batch.commit();
      return entries;
    }
  });
}
