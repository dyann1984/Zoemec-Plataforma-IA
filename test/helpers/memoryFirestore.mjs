/* Firestore en memoria, minimo, para probar el nucleo server-side
   (_orgLibraryCore.mjs, _apuContextResolver.mjs, _apuGenerateCore.mjs) sin
   emulador ni credenciales. Solo implementa lo que esos modulos usan:
   collection().doc().get/set/update, collection().where('==').get(),
   subcolecciones via doc().collection(), collection().add() y db.batch().
   No pretende emular reglas de seguridad (eso lo cubre
   test/orgLibrary.rules.test.mjs contra el emulador real). */
let autoId = 0;
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function createMemoryFirestore(seed = {}){
  const store = new Map(); // path -> data

  function docRef(path){
    const id = path.split('/').pop();
    return {
      id, path,
      async get(){
        const data = store.get(path);
        return { exists: data !== undefined, id, data: () => clone(data) };
      },
      async set(data){ store.set(path, clone(data)); },
      async update(patch){
        if(!store.has(path)) throw new Error(`No document to update: ${path}`);
        store.set(path, { ...store.get(path), ...clone(patch) });
      },
      collection(name){ return collectionRef(`${path}/${name}`); }
    };
  }

  function query(colPath, filters){
    return {
      where(field, op, value){ return query(colPath, [...filters, { field, op, value }]); },
      limit(){ return query(colPath, filters); },
      async get(){
        const prefix = colPath + '/';
        const docs = [...store.entries()]
          .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
          .filter(([, data]) => filters.every(f => {
            const v = data?.[f.field];
            if(f.op === '==') return v === f.value;
            if(f.op === 'in') return Array.isArray(f.value) && f.value.includes(v);
            throw new Error(`Operador no soportado en memoryFirestore: ${f.op}`);
          }))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([p, data]) => ({ id: p.split('/').pop(), data: () => clone(data), ref: docRef(p) }));
        return { docs, size: docs.length, empty: docs.length === 0 };
      }
    };
  }

  function collectionRef(colPath){
    return {
      ...query(colPath, []),
      doc(id){ return docRef(`${colPath}/${id || `AUTO${++autoId}`}`); },
      async add(data){ const ref = docRef(`${colPath}/AUTO${++autoId}`); await ref.set(data); return ref; }
    };
  }

  const db = {
    collection: collectionRef,
    doc: docRef,
    batch(){
      const ops = [];
      return {
        set(ref, data){ ops.push(() => ref.set(data)); },
        update(ref, patch){ ops.push(() => ref.update(patch)); },
        async commit(){ for(const op of ops) await op(); }
      };
    },
    async runTransaction(fn){
      const tx = {
        get: ref => ref.get(),
        set: (ref, data) => { store.set(ref.path, clone(data)); },
        update: (ref, patch) => { store.set(ref.path, { ...store.get(ref.path), ...clone(patch) }); }
      };
      return fn(tx);
    },
    // Utilidades de prueba
    _dump(prefix = ''){ return [...store.entries()].filter(([p]) => p.startsWith(prefix)).map(([p, d]) => ({ path: p, ...clone(d) })); },
    _set(path, data){ store.set(path, clone(data)); }
  };
  Object.entries(seed).forEach(([path, data]) => store.set(path, clone(data)));
  return db;
}
