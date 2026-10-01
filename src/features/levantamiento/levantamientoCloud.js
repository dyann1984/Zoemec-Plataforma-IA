/* F4 -- Levantamientos del proyecto desde el SERVIDOR (/api/levantamientos),
   con MIGRACION PEREZOSA del bloque local por usuario.

   Migracion (por levantamiento, idempotente):
     legado en bloque local (users/{uid}/state/zoemec-levantamientos)
       -> prepareLegacyMigration (puro, no muta el original)
       -> verifyMigration (nada se pierde)
       -> crea un plano por cada survey.cadPlanos[spaceId] (planoTakeoffs)
       -> guarda el levantamiento en el servidor con migratedFrom + legacyBackup
     El bloque local NO se borra (rollback logico durante V1): simplemente
     deja de ser la fuente principal.

   Guardado: el estado local se actualiza al instante (optimista) y se envia
   al servidor con debounce, UN envio a la vez, con expectedRevision. 409
   REVISION_CONFLICT -> se recarga la version del servidor y se avisa. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGetSafe, apiPost } from '../../services/apiClient.js';
import { prepareLegacyMigration, verifyMigration, LEGACY_SOURCE } from '../../domain/levantamientoCadLink.js';
import { createPlano, loadPlano } from '../planos/cadPlanoCloud.js';

export async function listServerSurveys(projectId){
  const data = await apiGetSafe(`/api/levantamientos?projectId=${encodeURIComponent(projectId)}`);
  return Array.isArray(data?.levantamientos) ? data.levantamientos : null;
}

export async function saveServerSurvey(survey, { expectedRevision = null, reason = null } = {}){
  const res = await apiPost('/api/levantamientos', { action: 'save', survey, expectedRevision, reason });
  return res.levantamiento;
}

export async function archiveServerSurvey(id){
  const res = await apiPost('/api/levantamientos', { action: 'archive', id });
  return res.levantamiento;
}

/* Migra UN levantamiento legado. Devuelve el levantamiento del servidor. */
export async function migrateLegacySurvey(legacySurvey, { user = null } = {}){
  const migrated = prepareLegacyMigration(legacySurvey);
  const errors = verifyMigration(legacySurvey, migrated);
  if(errors.length) throw new Error(`Migracion rechazada (${legacySurvey.id}): ${errors.join('; ')}`);
  for(const p of migrated.planos){
    const existing = await loadPlano(p.planoId);
    if(!existing){
      await createPlano({ planoId: p.planoId, projectId: legacySurvey.projectId, fileName: `${legacySurvey.name || legacySurvey.id} · ${(legacySurvey.spaces || []).find(s => s.id === p.spaceId)?.name || p.spaceId}`,
        mimeType: 'application/x-zoemec-survey', cadModel: p.cadModel, sourceKind: 'SURVEY', surveyId: legacySurvey.id, spaceId: p.spaceId, reason: 'Migracion desde almacenamiento local' });
    }
  }
  const res = await apiPost('/api/levantamientos', { action: 'save', survey: migrated.survey, migratedFrom: LEGACY_SOURCE, legacyBackup: migrated.legacyBackup, reason: `Migracion automatica${user?.email ? ` (${user.email})` : ''}` });
  return res.levantamiento;
}

export function useProjectSurveys(user, projectId, legacySurveys = []){
  const [surveys, setSurveys] = useState([]);
  const [status, setStatus] = useState({ loading: false, error: null, migrated: 0, migrationErrors: [] });
  const surveysRef = useRef(surveys);
  surveysRef.current = surveys;
  const timers = useRef({});
  const chains = useRef({});
  const legacyRef = useRef(legacySurveys);
  legacyRef.current = legacySurveys;
  const attemptedRef = useRef(new Set());
  const uid = user?.uid || null;
  // F4-QA: solo el uid dispara recargas (el objeto `user` cambia de identidad
  // varias veces durante el login y provocaba 3 GET + migraciones en paralelo).
  const userRef = useRef(user);
  userRef.current = user;
  const inFlightRef = useRef(null);

  const reload = useCallback(async () => {
    if(!uid || !projectId){ setSurveys([]); return; }
    const key = `${uid}:${projectId}`;
    if(inFlightRef.current?.key === key) return inFlightRef.current.promise;
    const run = (async () => {
      setStatus(s => ({ ...s, loading: true, error: null }));
      let list = await listServerSurveys(projectId);
      if(list === null){ setStatus(s => ({ ...s, loading: false, error: 'No se pudieron cargar los levantamientos del servidor.' })); return; }
      // Migracion perezosa de los legados de ESTE proyecto que aun no estan en el servidor.
      const onServer = new Set(list.map(s => s.id));
      const pending = (legacyRef.current || []).filter(s => s?.id && (s.projectId ?? null) === projectId && !onServer.has(s.id));
      pending.forEach(s => attemptedRef.current.add(s.id)); // un intento por sesion (sin bucles si falla)
      let migrated = 0; const migrationErrors = [];
      for(const legacy of pending){
        try{ await migrateLegacySurvey(legacy, { user: userRef.current }); migrated++; }
        catch(err){ migrationErrors.push({ id: legacy.id, name: legacy.name, error: err.message }); }
      }
      if(migrated) list = (await listServerSurveys(projectId)) || list;
      setSurveys(list);
      // El aviso de migracion se ACUMULA por proyecto: una recarga posterior
      // sin pendientes no lo borra (F4-QA: el aviso se perdia en una carrera).
      setStatus(s => {
        const same = s.projectKey === key;
        return { loading: false, error: null, projectKey: key,
          migrated: (same ? s.migrated || 0 : 0) + migrated,
          migrationErrors: [...(same ? s.migrationErrors || [] : []), ...migrationErrors] };
      });
    })();
    inFlightRef.current = { key, promise: run };
    try{ return await run; }finally{ if(inFlightRef.current?.promise === run) inFlightRef.current = null; }
  }, [uid, projectId]);

  useEffect(() => { reload(); }, [reload]);

  // El bloque local puede llegar DESPUES de la primera carga (se lee de
  // Firestore/localStorage de forma asincrona): si trae levantamientos de
  // este proyecto que aun no estan en el servidor, se migra una sola vez.
  useEffect(() => {
    if(!uid || !projectId || status.loading) return;
    const onServer = new Set(surveysRef.current.map(s => s.id));
    const fresh = (legacySurveys || []).filter(s => s?.id && (s.projectId ?? null) === projectId && !onServer.has(s.id) && !attemptedRef.current.has(s.id));
    if(!fresh.length) return;
    fresh.forEach(s => attemptedRef.current.add(s.id));
    (inFlightRef.current?.promise || Promise.resolve()).catch(() => {}).then(() => reload());
  }, [legacySurveys, uid, projectId, status.loading, reload]);

  const flush = useCallback((id) => {
    const run = async () => {
      const current = surveysRef.current.find(s => s.id === id);
      if(!current) return;
      try{
        const saved = await saveServerSurvey(current, { expectedRevision: current.revision ?? null });
        setSurveys(list => list.map(s => s.id === id ? { ...s, revision: saved.revision, geometryMode: saved.geometryMode, updatedBy: saved.updatedBy, updatedAt: saved.updatedAt } : s));
      }catch(err){
        if(err?.status === 409){
          window.zoemecNotify?.('Otro usuario guardó este levantamiento antes que tú: se cargó su versión más reciente. Revisa y vuelve a aplicar tu cambio si hace falta.', 'error');
          const fresh = await apiGetSafe(`/api/levantamientos?id=${encodeURIComponent(id)}`);
          if(fresh?.levantamiento) setSurveys(list => list.map(s => s.id === id ? fresh.levantamiento : s));
        }else{
          window.zoemecNotify?.(`No se pudo guardar el levantamiento: ${err.message}`, 'error');
        }
      }
    };
    chains.current[id] = (chains.current[id] || Promise.resolve()).then(run, run);
    return chains.current[id];
  }, []);

  const update = useCallback((next, { immediate = false } = {}) => {
    setSurveys(list => list.map(s => s.id === next.id ? { ...next, revision: s.revision } : s));
    surveysRef.current = surveysRef.current.map(s => s.id === next.id ? { ...next, revision: s.revision } : s);
    clearTimeout(timers.current[next.id]);
    if(immediate) return flush(next.id);
    timers.current[next.id] = setTimeout(() => flush(next.id), 800);
    return null;
  }, [flush]);

  const create = useCallback(async (survey) => {
    const saved = await saveServerSurvey({ ...survey, projectId }, { expectedRevision: null, reason: 'Nuevo levantamiento' });
    setSurveys(list => [saved, ...list]);
    return saved;
  }, [projectId]);

  const remove = useCallback(async (id) => {
    await archiveServerSurvey(id);
    setSurveys(list => list.filter(s => s.id !== id));
  }, []);

  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout); }, []);

  return { surveys, status, reload, create, update, remove };
}
