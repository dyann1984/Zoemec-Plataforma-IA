// F4-QA -- shim de 'firebase/firestore' (subconjunto que usa ZOEMEC): cada
// operacion va a /__qa/fs del servidor QA, que la ejecuta sobre el MISMO
// Firestore en memoria que usan las rutas /api reales. No aplica reglas de
// seguridad (limitacion documentada del QA).
const SENT = '__qaSentinel';
const DB = { __qaDb: true };
let seq = 0;
const autoId = () => `QA${Date.now().toString(36)}${(++seq).toString(36)}`;

export function getFirestore(){ return DB; }
export function initializeFirestore(){ return DB; }
export function connectFirestoreEmulator(){}

const join = (base, segs) => [base, ...segs].filter(Boolean).join('/').replace(/\/+/g, '/');
export function collection(parent, ...segs){
  const path = join(parent?.__qaDb ? '' : parent.path, segs);
  return { type: 'collection', path, id: path.split('/').pop(), constraints: [] };
}
export function doc(parent, ...segs){
  if(parent?.type === 'collection' && segs.length === 0) segs = [autoId()];
  const path = join(parent?.__qaDb ? '' : parent.path, segs);
  const parentPath = path.split('/').slice(0, -1).join('/');
  return { type: 'document', path, id: path.split('/').pop(), parent: { type: 'collection', path: parentPath, id: parentPath.split('/').pop() } };
}
export function query(col, ...cs){ return { ...col, constraints: [...(col.constraints || []), ...cs.filter(Boolean)] }; }
export const where = (field, op, value) => ({ kind: 'where', field: field?.__qaField || field, op, value });
export const orderBy = (field, dir = 'asc') => ({ kind: 'orderBy', field: field?.__qaField || field, dir });
export const limit = n => ({ kind: 'limit', n });
export const documentId = () => ({ __qaField: '__name__' });
export const serverTimestamp = () => ({ [SENT]: 'ts' });
export const deleteField = () => ({ [SENT]: 'del' });
export const increment = n => ({ [SENT]: 'inc', n });
export const arrayUnion = (...items) => ({ [SENT]: 'union', items });

async function call(body){
  const r = await fetch('/__qa/fs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if(!r.ok) throw Object.assign(new Error(j.error || 'QA Firestore error'), { code: j.code || 'unknown' });
  return j;
}
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function snap(path, data){
  return {
    id: path.split('/').pop(), ref: doc(DB, path), metadata: { fromCache: false, hasPendingWrites: false },
    exists: () => data != null, data: () => (data == null ? undefined : structuredClone(data)), get: f => getPath(data, f)
  };
}
export async function getDoc(ref){ const { data } = await call({ op: 'get', path: ref.path }); return snap(ref.path, data); }
export const getDocFromServer = getDoc;
export async function getDocs(q){
  const { docs } = await call({ op: 'query', path: q.path, constraints: q.constraints || [] });
  const list = docs.map(d => snap(d.path, d.data));
  return { docs: list, size: list.length, empty: list.length === 0, forEach: fn => list.forEach(fn) };
}
export const getDocsFromServer = getDocs;
export async function getCountFromServer(q){ const { docs } = await call({ op: 'query', path: q.path, constraints: q.constraints || [] }); return { data: () => ({ count: docs.length }) }; }
export async function setDoc(ref, data, opts){ await call({ op: 'set', path: ref.path, data, merge: Boolean(opts?.merge) }); }
export async function updateDoc(ref, data){ await call({ op: 'update', path: ref.path, data }); }
export async function addDoc(col, data){ const ref = doc(col); await setDoc(ref, data); return ref; }
export async function deleteDoc(ref){ await call({ op: 'delete', path: ref.path }); }
export function writeBatch(){
  const ops = [];
  const b = {
    set(ref, data, opts){ ops.push({ op: 'set', path: ref.path, data, merge: Boolean(opts?.merge) }); return b; },
    update(ref, data){ ops.push({ op: 'update', path: ref.path, data }); return b; },
    delete(ref){ ops.push({ op: 'delete', path: ref.path }); return b; },
    async commit(){ await call({ op: 'batch', ops }); }
  };
  return b;
}
export async function runTransaction(db, fn){
  const b = writeBatch();
  const tx = { get: getDoc, set: (r, d, o) => { b.set(r, d, o); return tx; }, update: (r, d) => { b.update(r, d); return tx; }, delete: r => { b.delete(r); return tx; } };
  const out = await fn(tx); await b.commit(); return out;
}
export function onSnapshot(){ return () => {}; }
export class Timestamp{
  constructor(s, ns){ this.seconds = s; this.nanoseconds = ns; }
  static now(){ return Timestamp.fromMillis(Date.now()); }
  static fromMillis(ms){ return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
  static fromDate(d){ return Timestamp.fromMillis(d.getTime()); }
  toDate(){ return new Date(this.seconds * 1000 + this.nanoseconds / 1e6); }
  toMillis(){ return this.toDate().getTime(); }
}
