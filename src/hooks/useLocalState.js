import { useState } from 'react';
import { scopedKey } from '../utils/scopedStorage.js';

function readKey(key, fallback){
  try { const raw = localStorage.getItem(key); return raw != null ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

/* uid es opcional: si se omite, la clave se namespacea con la sesion activa
   (ver src/utils/scopedStorage.js). Si se pasa explicito (ej. Library,
   NotificationBell via prop user), se usa ese uid sin depender del store global. */
export function useLocalState(baseKey, fallback, uid){
  const key = scopedKey(baseKey, uid);
  // Patron de "ajustar estado durante el render" (documentado por React) para
  // resetear el valor en cuanto la clave cambia (cambio de usuario), sin el
  // parpadeo de un frame con datos del usuario anterior que tendria un efecto.
  const [state, setState] = useState(() => ({ key, value: readKey(key, fallback) }));
  if(state.key !== key){
    setState({ key, value: readKey(key, fallback) });
  }
  const save = (next) => setState(prev => {
    const v = typeof next === 'function' ? next(prev.value) : next;
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* almacenamiento no disponible */ }
    return { key, value: v };
  });
  return [state.value, save];
}
