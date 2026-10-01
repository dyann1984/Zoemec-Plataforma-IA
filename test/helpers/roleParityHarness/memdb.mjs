// Firestore en memoria con semantica suficiente para las rutas ejercitadas:
// get/set(merge)/update/delete, FieldValue.increment/serverTimestamp,
// where(==,in,array-contains) sobre rutas con puntos, limit, orderBy (no-op),
// transacciones y batch. Solo infraestructura: no contiene reglas de ZOEMEC.
let autoId = 0;
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const SENT = Symbol.for('harness.fieldvalue');

export const FieldValue = {
  increment: n => ({ [SENT]: 'inc', n }),
  serverTimestamp: () => ({ [SENT]: 'ts' }),
  delete: () => ({ [SENT]: 'del' }),
  arrayUnion: (...items) => ({ [SENT]: 'union', items })
};
const isSent = v => v && typeof v === 'object' && v[SENT];
const isPlain = v => v && typeof v === 'object' && !Array.isArray(v) && !isSent(v);

function resolveValue(existing, v){
  if(isSent(v)){
    if(v[SENT] === 'inc') return (Number(existing) || 0) + v.n;
    if(v[SENT] === 'ts') return new Date().toISOString();
    if(v[SENT] === 'union') return [...new Set([...(Array.isArray(existing) ? existing : []), ...v.items])];
    return undefined;
  }
  if(isPlain(v)){
    const out = {};
    for(const [k, x] of Object.entries(v)){ const r = resolveValue(undefined, x); if(r !== undefined) out[k] = r; }
    return out;
  }
  return clone(v);
}
function deepMerge(existing, patch){
  const out = isPlain(existing) ? { ...existing } : {};
  for(const [k, v] of Object.entries(patch || {})){
    if(isSent(v) && v[SENT] === 'del'){ delete out[k]; continue; }
    if(isPlain(v)) out[k] = deepMerge(out[k], v);
    else { const r = resolveValue(out[k], v); if(r !== undefined) out[k] = r; }
  }
  return out;
}
function expandDotted(patch){
  const out = {};
  for(const [k, v] of Object.entries(patch || {})){
    if(!k.includes('.')){ out[k] = v; continue; }
    const parts = k.split('.'); let cur = out;
    parts.slice(0, -1).forEach(p => { cur[p] = isPlain(cur[p]) ? cur[p] : {}; cur = cur[p]; });
    cur[parts.at(-1)] = v;
  }
  return out;
}
const getPath = (obj, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), obj);

export function createMemDb(seed = {}){
  const store = new Map();
  const writeSet = (path, data, opts = {}) => {
    store.set(path, opts.merge ? deepMerge(store.get(path), data) : deepMerge(undefined, data));
  };
  const writeUpdate = (path, patch) => {
    if(!store.has(path)){ const e = new Error(`NOT_FOUND: no document to update: ${path}`); e.code = 5; throw e; }
    store.set(path, deepMerge(store.get(path), expandDotted(patch)));
  };
  function snapFor(path){
    const data = store.get(path);
    return { exists: data !== undefined, id: path.split('/').pop(), ref: docRef(path), data: () => clone(data), get: f => getPath(clone(data), f) };
  }
  function docRef(path){
    return {
      id: path.split('/').pop(), path,
      async get(){ return snapFor(path); },
      async set(data, opts){ writeSet(path, data, opts); },
      async update(patch){ writeUpdate(path, patch); },
      async delete(){ store.delete(path); },
      collection(name){ return collectionRef(`${path}/${name}`); }
    };
  }
  function query(colPath, filters, max){
    return {
      where(field, op, value){ return query(colPath, [...filters, { field, op, value }], max); },
      orderBy(){ return query(colPath, filters, max); },
      limit(n){ return query(colPath, filters, n); },
      async get(){
        const prefix = colPath + '/';
        let docs = [...store.keys()]
          .filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
          .sort()
          .filter(p => filters.every(f => {
            const v = getPath(store.get(p), f.field);
            if(f.op === '==') return JSON.stringify(v) === JSON.stringify(f.value);
            if(f.op === 'in') return Array.isArray(f.value) && f.value.includes(v);
            if(f.op === 'array-contains') return Array.isArray(v) && v.includes(f.value);
            throw new Error(`Operador no soportado en memdb: ${f.op}`);
          }))
          .map(snapFor);
        if(max) docs = docs.slice(0, max);
        return { docs, size: docs.length, empty: docs.length === 0, forEach: fn => docs.forEach(fn) };
      }
    };
  }
  function collectionRef(colPath){
    return {
      ...query(colPath, [], null),
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
        set(ref, data, opts){ ops.push(() => writeSet(ref.path, data, opts)); },
        update(ref, patch){ ops.push(() => writeUpdate(ref.path, patch)); },
        delete(ref){ ops.push(() => store.delete(ref.path)); },
        async commit(){ ops.forEach(op => op()); }
      };
    },
    // Transacciones SERIALIZADAS: Firestore real reintenta una transaccion
    // cuando otra modifico lo que leyo (equivalente a serializarlas). Sin
    // esto, dos lecturas concurrentes del contador de rate limit pasarian
    // ambas -- un falso positivo del arnes, no del producto.
    runTransaction(fn){
      const run = txQueue.then(() => runTx(fn));
      txQueue = run.catch(() => {});
      return run;
    },
    _get: path => clone(store.get(path)),
    _dump: (prefix = '') => [...store.entries()].filter(([p]) => p.startsWith(prefix)).map(([p, d]) => ({ path: p, ...clone(d) }))
  };
  let txQueue = Promise.resolve();
  async function runTx(fn){
    {
      const ops = [];
      const tx = {
        get: refOrQuery => refOrQuery.get(),
        set: (ref, data, opts) => { ops.push(() => writeSet(ref.path, data, opts)); return tx; },
        update: (ref, patch) => { ops.push(() => writeUpdate(ref.path, patch)); return tx; },
        delete: ref => { ops.push(() => store.delete(ref.path)); return tx; }
      };
      const result = await fn(tx);
      ops.forEach(op => op());
      return result;
    }
  }
  Object.entries(seed).forEach(([p, d]) => store.set(p, clone(d)));
  return db;
}
