/* F4 -- Persistencia del CAD con semantica correcta:
     AUTOSAVE  = borrador vigente (save-draft, debounced; NO crea version)
     CHECKPOINT = "Guardar version" (save-version, version inmutable)
   Un guardado a la vez; el siguiente sale con la revision que devolvio el
   anterior. 409 REVISION_CONFLICT -> estado 'conflict' (nunca se pisa la
   revision de otro usuario). persistNow(model) vacia el borrador pendiente y
   guarda YA (lo usan los generadores: el servidor valida contra la geometria
   persistida, asi que primero debe estar guardada). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { saveDraft, saveCheckpoint, isRevisionConflict } from './cadPlanoCloud.js';

export function useCadDraftPersistence({ buildSnapshot, debounceMs = 800, onSaved = null } = {}){
  const [saveState, setSaveState] = useState({ status: 'idle' });
  const planoRef = useRef({ planoId: null, revision: null, currentVersion: null });
  const pendingRef = useRef(null);
  const timerRef = useRef(null);
  const chainRef = useRef(Promise.resolve());
  const buildRef = useRef(buildSnapshot);
  buildRef.current = buildSnapshot;

  const bind = useCallback((planoId, revision, currentVersion = null) => {
    planoRef.current = { planoId, revision: revision ?? null, currentVersion };
    pendingRef.current = null;
    if(timerRef.current) clearTimeout(timerRef.current);
    setSaveState(planoId ? { status: 'saved', revision, version: currentVersion } : { status: 'idle' });
  }, []);

  const run = useCallback((task) => {
    const next = chainRef.current.then(task, task);
    chainRef.current = next.catch(() => {});
    return next;
  }, []);

  const writeDraft = useCallback(async (model) => {
    const { planoId, revision } = planoRef.current;
    if(!planoId || revision == null) return null;
    setSaveState(s => ({ ...s, status: 'saving' }));
    try{
      const doc = await saveDraft({ planoId, snapshot: buildRef.current(model), expectedRevision: revision });
      planoRef.current = { ...planoRef.current, revision: doc.revision, currentVersion: doc.currentVersion };
      setSaveState({ status: 'saved', revision: doc.revision, version: doc.currentVersion, dirty: doc.dirtySinceVersion, at: Date.now() });
      onSaved?.(doc);
      return doc;
    }catch(err){
      if(isRevisionConflict(err)){
        setSaveState({ status: 'conflict', message: 'Otro usuario guardó una revisión más reciente de este plano. Recarga para ver sus cambios; tus cambios locales no se guardaron.', currentRevision: err.currentRevision });
      }else{
        setSaveState({ status: 'error', message: err?.message || 'No se pudo guardar el plano.' });
      }
      throw err;
    }
  }, [onSaved]);

  const onModelChange = useCallback((model) => {
    pendingRef.current = model;
    if(timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const m = pendingRef.current; pendingRef.current = null;
      if(m) run(() => writeDraft(m)).catch(() => {});
    }, debounceMs);
  }, [debounceMs, run, writeDraft]);

  const persistNow = useCallback(async (model) => {
    if(timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = null;
    const doc = await run(() => writeDraft(model));
    return doc?.revision ?? planoRef.current.revision;
  }, [run, writeDraft]);

  const checkpoint = useCallback(async (model, reason = 'Checkpoint manual') => {
    if(timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = null;
    return run(async () => {
      const { planoId, revision } = planoRef.current;
      if(!planoId) return null;
      setSaveState(s => ({ ...s, status: 'saving' }));
      try{
        const doc = await saveCheckpoint({ planoId, snapshot: buildRef.current(model), expectedRevision: revision, reason });
        planoRef.current = { ...planoRef.current, revision: doc.revision, currentVersion: doc.currentVersion };
        setSaveState({ status: 'saved', revision: doc.revision, version: doc.currentVersion, dirty: false, at: Date.now() });
        onSaved?.(doc);
        return doc;
      }catch(err){
        setSaveState(isRevisionConflict(err)
          ? { status: 'conflict', message: 'Otro usuario guardó una revisión más reciente. Recarga antes de crear la versión.', currentRevision: err.currentRevision }
          : { status: 'error', message: err?.message || 'No se pudo guardar la versión.' });
        throw err;
      }
    });
  }, [run, onSaved]);

  useEffect(() => () => { if(timerRef.current) clearTimeout(timerRef.current); }, []);

  const saveLabel = {
    saving: 'Guardando…',
    saved: `Guardado · rev. ${saveState.revision ?? '—'}${saveState.version ? ` · última versión ${saveState.version}` : ''}${saveState.dirty ? ' (cambios sin versión)' : ''}`,
    conflict: saveState.message,
    error: saveState.message
  }[saveState.status] || null;

  return { bind, onModelChange, persistNow, checkpoint, saveState, saveLabel, getRevision: () => planoRef.current.revision, getPlanoId: () => planoRef.current.planoId };
}
