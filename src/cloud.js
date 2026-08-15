/* ====================================================================
   ZOEMEC · Sincronización de datos con Firestore
   - Cada bloque de datos (clientes, presupuestos, APUs, catálogo...)
     se guarda comprimido (gzip) en users/{uid}/state/{clave}.
   - localStorage sigue siendo el respaldo offline: si no hay sesión
     o no hay internet, todo funciona igual que antes.
   - Regla de conflicto: gana el más reciente (updatedAt).
   ==================================================================== */
import { useEffect, useRef, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';
import { db, firebaseReady } from './firebase.js';
import { scopedKey } from './utils/scopedStorage.js';

/* --- utilidades base64 <-> bytes --- */
function toB64(u8){
  let s = '';
  const CH = 0x8000;
  for(let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
function fromB64(str){
  const bin = atob(str);
  const u8 = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/* --- estado de sincronización para la insignia de la topbar --- */
export function emitCloud(status, message){
  try { window.dispatchEvent(new CustomEvent('zoemec-cloud', { detail: { status, message } })); } catch {}
}

/* --- escritura con debounce por clave (evita spamear Firestore) --- */
const timers = {};
export function saveCloud(uid, key, value){
  if(!firebaseReady || !uid) return;
  clearTimeout(timers[key]);
  emitCloud('saving');
  timers[key] = setTimeout(async () => {
    try{
      const json = JSON.stringify(value ?? null);
      const z = toB64(gzipSync(strToU8(json)));
      if(z.length > 950000){
        emitCloud('error', `"${key}" supera el límite de 1 MB de Firestore incluso comprimido.`);
        return;
      }
      await setDoc(doc(db, 'users', uid, 'state', key), { z, updatedAt: Date.now(), v: 1 });
      emitCloud('ok');
    }catch(e){
      emitCloud('error', e?.message || 'No se pudo guardar en la nube.');
    }
  }, 1200);
}

export async function loadCloud(uid, key){
  if(!firebaseReady || !uid) return null;
  try{
    const snap = await getDoc(doc(db, 'users', uid, 'state', key));
    if(!snap.exists()) return null;
    const d = snap.data();
    if(!d?.z) return null;
    const json = strFromU8(gunzipSync(fromB64(d.z)));
    return { value: JSON.parse(json), updatedAt: Number(d.updatedAt) || 0 };
  }catch(e){
    emitCloud('error', e?.message || 'No se pudo leer de la nube.');
    return null;
  }
}

/* --- hook principal: localStorage + nube ---
   Uso: const [clients, setClients] = useCloudState(user, 'zoemec-clients', []);
   - Al iniciar: lee localStorage (arranque instantáneo).
   - Al detectar sesión: baja la versión de la nube; adopta la más reciente
     y sube la local si la nube está vacía o vieja.
   - Cada setX: guarda local al instante y en la nube con debounce.       */
function readLocalScoped(storageKey, fallback){
  try { const raw = localStorage.getItem(storageKey); return raw != null ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

export function useCloudState(user, key, fallback){
  const uid = user?.uid || null;
  // storageKey namespacea la CACHE local por uid (zoemec:{uid}:{key}); la clave
  // en Firestore (users/{uid}/state/{key}) ya estaba aislada por el propio path,
  // asi que loadCloud/saveCloud siguen recibiendo "key" sin cambios. Sin este
  // namespace, en un navegador compartido el Usuario B leia (y podia terminar
  // subiendo a su propia cuenta) los datos locales que dejo el Usuario A.
  const storageKey = scopedKey(key, uid);

  // Patron de "ajustar estado durante el render" (documentado por React): si
  // storageKey cambia (cambio de sesion), se resetea el valor ANTES de pintar,
  // sin el parpadeo de un frame mostrando datos del usuario anterior.
  const [state, setState] = useState(() => ({ storageKey, value: readLocalScoped(storageKey, fallback) }));
  if(state.storageKey !== storageKey){
    setState({ storageKey, value: readLocalScoped(storageKey, fallback) });
  }
  const value = state.value;

  const uidRef = useRef(uid);
  uidRef.current = uid;
  const storageKeyRef = useRef(storageKey);
  storageKeyRef.current = storageKey;
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if(!uid) return;
    let alive = true;
    (async () => {
      const cloud = await loadCloud(uid, key);
      if(!alive) return;
      const localTs = Number(localStorage.getItem(storageKey + ':ts')) || 0;
      if(cloud && cloud.updatedAt >= localTs){
        try {
          localStorage.setItem(storageKey, JSON.stringify(cloud.value));
          localStorage.setItem(storageKey + ':ts', String(cloud.updatedAt));
        } catch {}
        setState({ storageKey, value: cloud.value ?? fallback });
        emitCloud('ok');
      } else {
        const raw = localStorage.getItem(storageKey);
        if(raw != null){
          try { saveCloud(uid, key, JSON.parse(raw)); } catch {}
        }
      }
    })();
    return () => { alive = false; };
  }, [uid, key, storageKey]);

  // No hacer el guardado local/nube dentro del actualizador funcional de setValue:
  // saveCloud -> emitCloud -> dispatchEvent dispara sincronicamente el setState de
  // CloudBadge, y React no permite actualizar un componente mientras renderiza otro
  // (warning "Cannot update a component while rendering a different component").
  const save = (next) => {
    const v = typeof next === 'function' ? next(valueRef.current) : next;
    valueRef.current = v;
    setState({ storageKey: storageKeyRef.current, value: v });
    try {
      localStorage.setItem(storageKeyRef.current, JSON.stringify(v));
      localStorage.setItem(storageKeyRef.current + ':ts', String(Date.now()));
    } catch {}
    if(uidRef.current) saveCloud(uidRef.current, key, v);
  };

  return [value, save];
}
