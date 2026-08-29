/* ZOEMEC MEMORIA TECNICA -- interfaz de repositorio (regla 12 del spec).
   Investigacion previa (ver server/api-lib/_firebaseAdmin.mjs y los
   endpoints en api/*.mjs): el proyecto NO tiene hoy un patron de
   "repository" generico -- cada endpoint llama getAdminDb() y hace
   db.collection('x')... directo. Esta fase introduce el contrato explicito
   (interfaz) que cualquier adapter debe cumplir, mas UN adapter real:
   in-memory (abajo, para dominio/tests, sin I/O). El adapter de Firestore
   real vive aparte, en server/api-lib/_technicalMemoryFirestoreAdapter.mjs
   (usa firebase-admin, necesita el emulador o credenciales -- por eso no
   esta en src/domain, que debe poder correr en cualquier entorno sin red).

   Contrato (MemoryRepository):
     list({ scope?, type?, status?, subject?, context? }) -> Promise<entry[]>
     getById(id) -> Promise<entry|null>
     save(entry) -> Promise<entry>            // upsert por entry.id
     saveMany(entries) -> Promise<entry[]>     // upsert en lote

   Ningun metodo hace merge parcial ni mutacion in-place -- cada `save`
   reemplaza el documento completo (mismo principio de "nunca update
   destructivo silencioso" que ya usa apuVersioning.js: quien llama decide
   el objeto completo a persistir, normalmente el resultado de
   approveMemoryEntry/rejectMemoryEntry/supersedeMemoryEntry). */

export function assertImplementsMemoryRepository(adapter){
  ['list', 'getById', 'save', 'saveMany'].forEach(method => {
    if(typeof adapter?.[method] !== 'function') throw new Error(`El adapter de memoria no implementa el metodo requerido "${method}".`);
  });
  return adapter;
}

function matchesQuery(entry, query = {}){
  if(query.scope && entry.scope !== query.scope) return false;
  if(query.type && entry.type !== query.type) return false;
  if(query.status && entry.status !== query.status) return false;
  return true;
}

/* Adapter IN-MEMORY: real (no un mock disfrazado), pensado para dominio y
   pruebas -- se pierde al terminar el proceso, nunca se presenta como
   persistencia de produccion. Cumple el mismo contrato que el adapter de
   Firestore para que el codigo que orquesta memoria (futura capa de API)
   pueda intercambiar uno por otro sin cambiar su logica. */
export function createInMemoryMemoryRepository(seed = []){
  const store = new Map(seed.map(entry => [entry.id, entry]));
  return assertImplementsMemoryRepository({
    async list(query = {}){
      return [...store.values()].filter(entry => matchesQuery(entry, query));
    },
    async getById(id){
      return store.get(id) || null;
    },
    async save(entry){
      if(!entry?.id) throw new Error('save() requiere entry.id.');
      store.set(entry.id, entry);
      return entry;
    },
    async saveMany(entries = []){
      entries.forEach(entry => {
        if(!entry?.id) throw new Error('saveMany() requiere entry.id en cada entrada.');
        store.set(entry.id, entry);
      });
      return entries;
    }
  });
}
