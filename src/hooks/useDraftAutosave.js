/* P0 (correccion de regresion en produccion, "el trabajo se pierde al
   cambiar de pestana/modulo"): autosave + restauracion de borrador para
   formularios/flujos que hoy solo tienen useState local -- sin ningun
   mecanismo de persistencia, un cambio de modulo que desmonta el
   componente pierde TODO lo escrito, sin aviso.

   Deliberadamente NO reinventa infraestructura nueva: reusa el mismo
   primitivo ya probado y en produccion desde hace tiempo para el resto de
   la app (src/cloud.js#useCloudState -- clientes/presupuestos/catalogo ya
   lo usan). Mismas garantias, ya reales hoy:
   - Escritura LOCAL sincronica en cada cambio (localStorage) -- sobrevive
     cambiar de pestana/modulo, refresh, y cerrar/reabrir el navegador de
     inmediato, sin esperar ninguna red.
   - Sincroniza a la nube (users/{uid}/state/{key}, con debounce de 1.2s)
     -- sobrevive logout/login y cambio de dispositivo, siempre que el
     borrador pertenezca a ese usuario (namespaced por uid, tanto local
     como en Firestore -- reglas ya exigen isOwner(uid), ver firestore.rules).
   - El badge global de la topbar (CloudBadge, main.jsx) ya escucha el
     mismo evento 'zoemec-cloud' que dispara saveCloud -- "Guardando..."/
     "Guardado"/error ya son visibles sin construir nada nuevo ahi.

   Prefijo "draft:" en la clave real de Firestore/localStorage: un borrador
   NUNCA debe poder confundirse con (ni pisar) el blob de datos real que
   useCloudState ya guarda para otras claves (ej. 'zoemec-clients') -- son
   espacios de nombres completamente separados aposta.

   Nunca guarda secretos: quien use este hook debe pasar solo datos de
   formulario (texto, numeros, selecciones) -- nunca un idToken, password,
   ni ningun dato marcado como sensible en otra parte del codigo. Este
   modulo no lo valida (no tiene forma de saberlo), es responsabilidad de
   cada llamador. */
import { useCloudState, saveCloud } from '../cloud.js';
import { scopedKey } from '../utils/scopedStorage.js';

/* Exportada para poder probarla con node --test sin renderizar el hook
   (este proyecto no tiene renderHook/jsdom configurado -- ver
   src/hooks/useInstallPrompt.test.js -- los hooks que usan useState/
   useEffect de React no se prueban directamente aqui, solo su logica
   pura extraible). */
export function draftKey(flowType, entityId){
  return `draft:${flowType}:${entityId || 'new'}`;
}

/* value: el borrador actual (fallback si nunca se guardo nada, o si el
   usuario no ha iniciado sesion -- en ese caso el borrador vive SOLO en
   localStorage de esta maquina, exactamente igual que useCloudState). */
export function useDraftAutosave(user, flowType, entityId, fallback){
  const [value, setValue] = useCloudState(user, draftKey(flowType, entityId), fallback);
  return [value, setValue];
}

/* Se llama cuando el flujo real ya se guardo con exito por su mecanismo
   AUTORITATIVO propio (ej. POST /api/apus, o Survey.onSave) -- el borrador
   ya cumplio su proposito y debe desaparecer, para que la proxima vez que
   el usuario abra este flujo no vea un "restaurar borrador" de datos que
   ya estan guardados de verdad. Nunca lanza: limpiar un borrador es
   best-effort, un fallo aqui no debe bloquear ni ensuciar el flujo de
   guardado real que ya tuvo exito. */
export function clearDraftAutosave(user, flowType, entityId){
  const uid = user?.uid || null;
  const key = draftKey(flowType, entityId);
  try{
    const storageKey = scopedKey(key, uid);
    localStorage.removeItem(storageKey);
    localStorage.removeItem(storageKey + ':ts');
  }catch{ /* localStorage no disponible -- no bloquea la limpieza en la nube */ }
  if(uid) saveCloud(uid, key, null);
}
