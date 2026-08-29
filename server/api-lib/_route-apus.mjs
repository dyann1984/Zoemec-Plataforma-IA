/* Persistencia autoritativa de APU + versionado inmutable (Fase 7).
   Reemplaza, SOLO para esta entidad, el patron anterior de
   users/{uid}/state (blob gzip con TODOS los APUs del usuario en un solo
   documento -- ver src/cloud.js#useCloudState) por un documento real por
   APU (`apus/{id}`) mas una version inmutable por cada guardado
   (`apuVersions/{id}__V{n}`), nunca sobreescrita.

   Reusa SIN reimplementar el motor de versionado puro ya probado
   (src/domain/apuVersioning.js#createApuVersion/restoreApuVersion, que a su
   vez usa finalizeProfessionalAPU de apuProfessional.js) -- el servidor
   nunca calcula un numero de version ni un snapshot a mano. Para calcular
   el SIGUIENTE numero de version sin tener que leer TODO el historial
   (que puede crecer sin limite), se le pasa a createApuVersion un historial
   sintetico de un solo elemento con el `currentVersion` guardado en el
   documento del APU -- createApuVersion solo necesita el maximo numero de
   version visto, que es exactamente ese.

   Identidad SIEMPRE del token verificado (requireAuth); ownerUid nunca del
   body. Cada usuario administra solo sus propios APUs (mismo criterio que
   projects.mjs -- no hay bypass de admin, nadie lo pidio).

   Reubicado fuera de api/ en el parche de compatibilidad con Vercel Hobby
   (consolidacion de funciones serverless) -- ver api/gateway.mjs y
   VERCEL_HOBBY_COMPAT.md. Contenido/logica identicos a la version original
   en api/apus.mjs, solo cambiaron las rutas relativas de import. */
import { requireAuth } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { appendAudit } from './_decisionAudit.mjs';
import { createApuVersion, restoreApuVersion } from '../../src/domain/apuVersioning.js';

const COLLECTION = 'apus';
const VERSIONS_COLLECTION = 'apuVersions';
const AUDIT_COLLECTION = 'apuAudit';

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }
function versionDocId(apuId, version){
  return `${String(apuId).replace(/[^a-zA-Z0-9_-]/g, '_')}__${String(version)}`;
}

async function handleList(req, res){
  const authz = await requireAuth(req);
  const { id, projectId } = req.query || {};
  const db = getAdminDb();
  if(id){
    const snap = await db.collection(COLLECTION).doc(String(id)).get();
    if(!snap.exists){ res.status(200).json({ apu: null, versions: [] }); return; }
    const apu = snap.data();
    if(apu.ownerUid !== authz.uid) throw httpError(403, 'Este APU pertenece a otro usuario.');
    const versionsSnap = await db.collection(VERSIONS_COLLECTION).where('apuId', '==', String(id)).get();
    const versions = versionsSnap.docs.map(d => d.data()).sort((a, b) => Number(a.version.replace(/\D/g, '')) - Number(b.version.replace(/\D/g, '')));
    res.status(200).json({ apu, versions });
    return;
  }
  // Sin id ni projectId: lista TODOS los APUs del usuario (equivalente al
  // `rawApus` cross-proyecto de main.jsx -- el filtrado por proyecto activo
  // ya lo hace useProjectScoped en el cliente, este endpoint solo necesita
  // devolver "todos los mios", igual que antes hacia useCloudState).
  let query = db.collection(COLLECTION).where('ownerUid', '==', authz.uid);
  if(projectId) query = query.where('projectId', '==', String(projectId));
  const snap = await query.get();
  // Mismo criterio que projects.mjs: "Borrar" en la UI (main.jsx#Projects/
  // el boton "Borrar" de un APU) mapea a action:archive, nunca a un borrado
  // duro -- la version/auditoria se conserva, solo desaparece de la lista.
  const apus = snap.docs.map(d => d.data()).filter(a => !a.archivedAt);
  res.status(200).json({ apus });
}

/* CREATE (regla 3 del plan): primera version real del APU. `apu` es el
   objeto completo tal como lo tiene el editor en ese momento -- se procesa
   con el MISMO createApuVersion que usa el guardado normal (historial
   vacio -> V1). Idempotente por id (igual que projects.mjs), necesario
   para reintentos de la migracion transparente. */
async function handleCreate(req, res){
  const authz = await requireAuth(req);
  const { id, projectId, apu, reason } = req.body || {};
  if(!id || !apu) throw httpError(400, 'Faltan id/apu.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(snap.exists){
      const existing = snap.data();
      if(existing.ownerUid !== authz.uid) throw httpError(409, 'Ya existe un APU con ese id perteneciente a otro usuario.');
      return { apu: existing, version: null }; // idempotente: reintento de migracion no duplica
    }
    let built;
    try{ built = createApuVersion(apu, [], { user: authz.email || authz.uid, reason: reason || 'Version inicial' }); }
    catch(err){ throw httpError(400, `No se pudo procesar el APU: ${err.message}`); }
    const entry = built.history[built.history.length - 1];
    const now = new Date().toISOString();
    const apuDoc = {
      id: String(id), ownerUid: authz.uid, projectId: projectId || null,
      currentVersion: entry.version, snapshot: built.apu,
      createdAt: now, updatedAt: now
    };
    const versionDoc = { ...entry, id: versionDocId(id, entry.version), apuId: String(id), ownerUid: authz.uid, createdAt: now };
    tx.set(docRef, apuDoc);
    tx.set(db.collection(VERSIONS_COLLECTION).doc(versionDoc.id), versionDoc);
    appendAudit(tx, auditRef, {
      entryId: apuDoc.id, action: 'APU_CREATED', previousStatus: null, newStatus: entry.version,
      actor: authz.uid, actorEmail: authz.email, reason: reason || null, source: 'api',
      projectId: apuDoc.projectId, apuId: apuDoc.id, organizationId: null, ownerUid: authz.uid
    });
    return { apu: apuDoc, version: versionDoc };
  });
  res.status(201).json(result);
}

/* SAVE-VERSION (regla 3/5 del plan): crea una version NUEVA e inmutable,
   nunca sobreescribe una version anterior. Transaccion: lee el estado
   ACTUAL del APU (nunca el que trajo un GET previo del cliente), calcula la
   siguiente version con el motor real, escribe la version + actualiza el
   puntero "actual" atomicamente -- mismo patron que handleApprove en
   api/technical-memory.mjs.

   FIX Fase 9 (hallazgo F-004, P1 -- control de concurrencia optimista):
   antes esta funcion no sabia ni le importaba de que version PARTIA el
   cliente -- dos guardados concurrentes desde la misma base (dos pestañas,
   dos dispositivos) simplemente creaban V2 y V3 en secuencia, y el segundo
   pisaba en silencio cual era la version "vigente" sin que el primer
   guardado se enterara (lost update, confirmado real con una PoC). Ahora
   `expectedParentVersionId` es OBLIGATORIO: el cliente declara de que
   version cree que esta partiendo. Si `current.currentVersion` (el valor
   REAL, leido dentro de la misma transaccion) no coincide, se rechaza con
   409/VERSION_CONFLICT ANTES de calcular o escribir nada -- nunca se crea
   una version nueva ni se mueve el puntero "actual" en ese caso. */
async function handleSaveVersion(req, res){
  const authz = await requireAuth(req);
  const { id, apu, reason, expectedParentVersionId } = req.body || {};
  if(!id || !apu) throw httpError(400, 'Faltan id/apu.');
  if(!expectedParentVersionId) throw httpError(400, 'Falta expectedParentVersionId: indica de que version parte este guardado para poder detectar conflictos de concurrencia.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'El APU no existe. Crealo primero con action=create.');
    const current = snap.data();
    if(current.ownerUid !== authz.uid) throw httpError(403, 'Este APU pertenece a otro usuario.');
    if(current.currentVersion !== expectedParentVersionId){
      const conflict = httpError(409, `Conflicto de version: esperabas partir de ${expectedParentVersionId}, pero la version vigente en el servidor ya es ${current.currentVersion} (alguien mas -- u otra pestaña/dispositivo -- guardo una version mas reciente). Recarga la version vigente antes de reintentar.`);
      conflict.code = 'VERSION_CONFLICT';
      conflict.currentVersion = current.currentVersion;
      throw conflict;
    }
    let built;
    try{ built = createApuVersion(apu, [{ version: current.currentVersion }], { user: authz.email || authz.uid, reason: reason || 'Guardado manual' }); }
    catch(err){ throw httpError(400, `No se pudo procesar el APU: ${err.message}`); }
    const entry = built.history[built.history.length - 1];
    const now = new Date().toISOString();
    const nextApuDoc = { ...current, currentVersion: entry.version, snapshot: built.apu, updatedAt: now };
    const versionDoc = { ...entry, id: versionDocId(id, entry.version), apuId: String(id), ownerUid: authz.uid, createdAt: now };
    tx.set(docRef, nextApuDoc);
    tx.set(db.collection(VERSIONS_COLLECTION).doc(versionDoc.id), versionDoc);
    appendAudit(tx, auditRef, {
      entryId: nextApuDoc.id, action: 'APU_VERSION_SAVED', previousStatus: current.currentVersion, newStatus: entry.version,
      actor: authz.uid, actorEmail: authz.email, reason: reason || null, source: 'api',
      projectId: nextApuDoc.projectId, apuId: nextApuDoc.id, organizationId: null, ownerUid: authz.uid
    });
    return { apu: nextApuDoc, version: versionDoc };
  });
  res.status(200).json(result);
}

/* RESTORE-VERSION: reusa restoreApuVersion (que a su vez llama a
   createApuVersion) -- restaurar NUNCA borra ni reescribe la version
   restaurada ni las que quedaron en medio, crea una version NUEVA cuyo
   snapshot es identico al de la version elegida (misma semantica que ya
   tenia apuVersioning.js en memoria, ahora persistida). */
async function handleRestoreVersion(req, res){
  const authz = await requireAuth(req);
  const { id, version } = req.body || {};
  if(!id || !version) throw httpError(400, 'Faltan id/version a restaurar.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const targetRef = db.collection(VERSIONS_COLLECTION).doc(versionDocId(id, version));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const [snap, targetSnap] = await Promise.all([tx.get(docRef), tx.get(targetRef)]);
    if(!snap.exists) throw httpError(404, 'El APU no existe.');
    const current = snap.data();
    if(current.ownerUid !== authz.uid) throw httpError(403, 'Este APU pertenece a otro usuario.');
    if(!targetSnap.exists) throw httpError(404, `La version ${version} no existe para este APU.`);
    const targetEntry = targetSnap.data();
    let built;
    try{ built = restoreApuVersion(targetEntry, [{ version: current.currentVersion }], { user: authz.email || authz.uid }); }
    catch(err){ throw httpError(400, err.message); }
    const entry = built.history[built.history.length - 1];
    const now = new Date().toISOString();
    const nextApuDoc = { ...current, currentVersion: entry.version, snapshot: built.apu, updatedAt: now };
    const versionDoc = { ...entry, id: versionDocId(id, entry.version), apuId: String(id), ownerUid: authz.uid, createdAt: now };
    tx.set(docRef, nextApuDoc);
    tx.set(db.collection(VERSIONS_COLLECTION).doc(versionDoc.id), versionDoc);
    appendAudit(tx, auditRef, {
      entryId: nextApuDoc.id, action: 'APU_VERSION_RESTORED', previousStatus: current.currentVersion, newStatus: entry.version,
      actor: authz.uid, actorEmail: authz.email, reason: `Restauracion de ${version}`, source: 'api',
      projectId: nextApuDoc.projectId, apuId: nextApuDoc.id, organizationId: null, ownerUid: authz.uid
    });
    return { apu: nextApuDoc, version: versionDoc };
  });
  res.status(200).json(result);
}

/* ARCHIVE (regla equivalente a "Borrar" en la UI, ver main.jsx linea 2446):
   nunca borra el documento ni sus versiones -- solo lo saca de la lista por
   defecto (handleList arriba). El historial de versiones sigue existiendo
   y sigue siendo consultable via GET ?id= directo. */
async function handleArchive(req, res){
  const authz = await requireAuth(req);
  const { id } = req.body || {};
  if(!id) throw httpError(400, 'Falta id del APU a archivar.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'El APU no existe.');
    const current = snap.data();
    if(current.ownerUid !== authz.uid) throw httpError(403, 'Este APU pertenece a otro usuario.');
    const next = { ...current, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'APU_ARCHIVED', previousStatus: current.currentVersion, newStatus: current.currentVersion,
      actor: authz.uid, actorEmail: authz.email, reason: null, source: 'api',
      projectId: next.projectId, apuId: next.id, organizationId: null, ownerUid: authz.uid
    });
    return next;
  });
  res.status(200).json({ apu: result });
}

/* LINK-PROJECT (Fase 8 Parte 2, cierre del gap "APU sin projectId"): vincula
   un APU legacy (creado antes de que professionalApu estampara projectId al
   nacer, ver main.jsx) a un proyecto real del MISMO dueno. Nunca adivina --
   el llamador (useAuthoritativeApus.js) solo invoca esto cuando ya decidio,
   con criterio explicito documentado (un unico proyecto sin ambiguedad), o
   cuando el propio usuario elige el proyecto en la UI. Verifica AMBAS
   pertenencias (APU y proyecto) antes de escribir -- nunca vincula un APU a
   un proyecto ajeno ni al reves. Idempotente: volver a vincular al mismo
   proyecto no falla ni duplica auditoria de forma distinta a cualquier otra
   actualizacion. */
async function handleLinkProject(req, res){
  const authz = await requireAuth(req);
  const { id, projectId } = req.body || {};
  if(!id || !projectId) throw httpError(400, 'Faltan id/projectId.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const projectRef = db.collection('projects').doc(String(projectId));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const [snap, projectSnap] = await Promise.all([tx.get(docRef), tx.get(projectRef)]);
    if(!snap.exists) throw httpError(404, 'El APU no existe.');
    const current = snap.data();
    if(current.ownerUid !== authz.uid) throw httpError(403, 'Este APU pertenece a otro usuario.');
    if(!projectSnap.exists) throw httpError(404, 'El proyecto destino no existe.');
    if(projectSnap.data().ownerUid !== authz.uid) throw httpError(403, 'El proyecto destino pertenece a otro usuario.');
    const next = { ...current, projectId: String(projectId), updatedAt: new Date().toISOString() };
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'APU_PROJECT_LINKED', previousStatus: current.projectId || null, newStatus: next.projectId,
      actor: authz.uid, actorEmail: authz.email, reason: null, source: 'api',
      projectId: next.projectId, apuId: next.id, organizationId: null, ownerUid: authz.uid
    });
    return next;
  });
  res.status(200).json({ apu: result });
}

const ACTIONS = { create: handleCreate, 'save-version': handleSaveVersion, 'restore-version': handleRestoreVersion, archive: handleArchive, 'link-project': handleLinkProject };

export default async function handler(req, res){
  try{
    if(req.method === 'GET'){ await handleList(req, res); return; }
    if(req.method !== 'POST'){ res.status(405).json({ error: 'Metodo no permitido.' }); return; }
    const action = req.body?.action;
    const run = ACTIONS[action];
    if(!run) throw httpError(400, `Accion no reconocida: "${action}".`);
    await run(req, res);
  }catch(err){
    // FIX Fase 9 (hallazgo F-004): propaga err.code/err.currentVersion (ej.
    // VERSION_CONFLICT) al cliente cuando existen -- sin esto el cliente solo
    // puede distinguir un conflicto real de cualquier otro error 4xx leyendo
    // el texto del mensaje, lo que es fragil y evita que la UI muestre un
    // estado de conflicto explicito en vez de un error generico.
    const body = { error: err.message || 'No se pudo completar la solicitud.' };
    if(err.code) body.code = err.code;
    if(err.currentVersion) body.currentVersion = err.currentVersion;
    res.status(err.status || 400).json(body);
  }
}
