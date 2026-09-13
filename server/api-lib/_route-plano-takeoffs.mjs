/* Persistencia autoritativa de un Plano Takeoff (Fase B, punto 11): migra el
   takeoff manual de localStorage (ver src/domain/planoTakeoffStore.js, RC4)
   a un documento real por plano (`planoTakeoffs/{id}`) + una version
   inmutable por cada guardado (`planoTakeoffVersions/{id}__V{n}`, nunca
   sobreescrita) + auditoria append-only (`planoTakeoffAudit`) -- EXACTO
   mismo patron ya probado de `apus`/`apuVersions`/`apuAudit`
   (_route-apus.mjs): mismo control de concurrencia optimista
   (expectedParentVersionId), misma identidad siempre del token verificado
   (requireAuth), mismo organizationId derivado server-side
   (loadOrgContext) -- NUNCA del body del cliente (punto 12 del pedido).

   Reusa createPlanoTakeoffVersion/restorePlanoTakeoffVersion
   (planoTakeoffVersioning.js) igual que _route-apus.mjs reusa
   apuVersioning.js -- ningun motor de version nuevo. */
import { requireAuth } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { appendAudit } from './_decisionAudit.mjs';
import { createPlanoTakeoffVersion, restorePlanoTakeoffVersion } from '../../src/domain/planoTakeoffVersioning.js';
import { loadOrgContext, assertOrgNotExpired, canAccessOrgScopedDoc } from './_orgGuard.mjs';

const COLLECTION = 'planoTakeoffs';
const VERSIONS_COLLECTION = 'planoTakeoffVersions';
const AUDIT_COLLECTION = 'planoTakeoffAudit';

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }
function versionDocId(id, version){ return `${String(id).replace(/[^a-zA-Z0-9_-]/g, '_')}__${String(version)}`; }

async function handleList(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  const { id, projectId } = req.query || {};
  const db = getAdminDb();
  if(id){
    const snap = await db.collection(COLLECTION).doc(String(id)).get();
    if(!snap.exists){ res.status(200).json({ planoTakeoff: null, versions: [] }); return; }
    const planoTakeoff = snap.data();
    if(!canAccessOrgScopedDoc(planoTakeoff, authz, orgContext)) throw httpError(403, 'Este plano pertenece a otro usuario.');
    const versionsSnap = await db.collection(VERSIONS_COLLECTION).where('planoTakeoffId', '==', String(id)).get();
    const versions = versionsSnap.docs.map(d => d.data()).sort((a, b) => Number(a.version.replace(/\D/g, '')) - Number(b.version.replace(/\D/g, '')));
    res.status(200).json({ planoTakeoff, versions });
    return;
  }
  let query = orgContext
    ? db.collection(COLLECTION).where('organizationId', '==', orgContext.organizationId)
    : db.collection(COLLECTION).where('ownerUid', '==', authz.uid);
  if(projectId) query = query.where('projectId', '==', String(projectId));
  const snap = await query.get();
  const planoTakeoffs = snap.docs.map(d => d.data()).filter(p => !p.archivedAt);
  res.status(200).json({ planoTakeoffs });
}

async function handleCreate(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id, projectId, fileName, fileHash, mimeType, numPages, snapshot, reason } = req.body || {};
  if(!id || !snapshot) throw httpError(400, 'Faltan id/snapshot.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const organizationId = orgContext ? orgContext.organizationId : null;
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(snap.exists){
      const existing = snap.data();
      if(!canAccessOrgScopedDoc(existing, authz, orgContext)) throw httpError(409, 'Ya existe un plano con ese id perteneciente a otro usuario.');
      return { planoTakeoff: existing, version: null }; // idempotente
    }
    let built;
    try{ built = createPlanoTakeoffVersion(snapshot, [], { user: authz.email || authz.uid, reason: reason || 'Version inicial' }); }
    catch(err){ throw httpError(400, `No se pudo procesar el plano: ${err.message}`); }
    const entry = built.history[built.history.length - 1];
    const now = new Date().toISOString();
    const doc = {
      id: String(id), ownerUid: authz.uid, organizationId, projectId: projectId || null,
      fileName: fileName || '', fileHash: fileHash || null, mimeType: mimeType || '', numPages: numPages || 1,
      currentVersion: entry.version, snapshot: built.snapshot,
      createdAt: now, updatedAt: now
    };
    const versionDoc = { ...entry, id: versionDocId(id, entry.version), planoTakeoffId: String(id), ownerUid: authz.uid, organizationId, createdAt: now };
    tx.set(docRef, doc);
    tx.set(db.collection(VERSIONS_COLLECTION).doc(versionDoc.id), versionDoc);
    appendAudit(tx, auditRef, {
      entryId: doc.id, action: 'PLANO_TAKEOFF_CREATED', previousStatus: null, newStatus: entry.version,
      actor: authz.uid, actorEmail: authz.email, reason: reason || null, source: 'api',
      projectId: doc.projectId, planoTakeoffId: doc.id, organizationId, ownerUid: authz.uid
    });
    return { planoTakeoff: doc, version: versionDoc };
  });
  res.status(201).json(result);
}

/* SAVE-VERSION: autosave real (punto 11). Igual criterio de concurrencia
   optimista que _route-apus.mjs -- dos pestañas/dispositivos guardando el
   mismo plano nunca pisan en silencio la version vigente. */
async function handleSaveVersion(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id, snapshot, reason, expectedParentVersionId } = req.body || {};
  if(!id || !snapshot) throw httpError(400, 'Faltan id/snapshot.');
  if(!expectedParentVersionId) throw httpError(400, 'Falta expectedParentVersionId.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'El plano no existe. Crealo primero con action=create.');
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Este plano pertenece a otro usuario.');
    if(current.currentVersion !== expectedParentVersionId){
      const conflict = httpError(409, `Conflicto de version: esperabas partir de ${expectedParentVersionId}, pero la version vigente ya es ${current.currentVersion}.`);
      conflict.code = 'VERSION_CONFLICT';
      conflict.currentVersion = current.currentVersion;
      throw conflict;
    }
    let built;
    try{ built = createPlanoTakeoffVersion(snapshot, [{ version: current.currentVersion }], { user: authz.email || authz.uid, reason: reason || 'Autosave' }); }
    catch(err){ throw httpError(400, `No se pudo procesar el plano: ${err.message}`); }
    const entry = built.history[built.history.length - 1];
    const now = new Date().toISOString();
    const nextDoc = { ...current, currentVersion: entry.version, snapshot: built.snapshot, updatedAt: now };
    const versionDoc = { ...entry, id: versionDocId(id, entry.version), planoTakeoffId: String(id), ownerUid: authz.uid, organizationId: current.organizationId ?? null, createdAt: now };
    tx.set(docRef, nextDoc);
    tx.set(db.collection(VERSIONS_COLLECTION).doc(versionDoc.id), versionDoc);
    appendAudit(tx, auditRef, {
      entryId: nextDoc.id, action: 'PLANO_TAKEOFF_VERSION_SAVED', previousStatus: current.currentVersion, newStatus: entry.version,
      actor: authz.uid, actorEmail: authz.email, reason: reason || null, source: 'api',
      projectId: nextDoc.projectId, planoTakeoffId: nextDoc.id, organizationId: current.organizationId ?? null, ownerUid: authz.uid
    });
    return { planoTakeoff: nextDoc, version: versionDoc };
  });
  res.status(200).json(result);
}

async function handleRestoreVersion(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id, version } = req.body || {};
  if(!id || !version) throw httpError(400, 'Faltan id/version a restaurar.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const targetRef = db.collection(VERSIONS_COLLECTION).doc(versionDocId(id, version));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const [snap, targetSnap] = await Promise.all([tx.get(docRef), tx.get(targetRef)]);
    if(!snap.exists) throw httpError(404, 'El plano no existe.');
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Este plano pertenece a otro usuario.');
    if(!targetSnap.exists) throw httpError(404, `La version ${version} no existe para este plano.`);
    let built;
    try{ built = restorePlanoTakeoffVersion(targetSnap.data(), [{ version: current.currentVersion }], { user: authz.email || authz.uid }); }
    catch(err){ throw httpError(400, err.message); }
    const entry = built.history[built.history.length - 1];
    const now = new Date().toISOString();
    const nextDoc = { ...current, currentVersion: entry.version, snapshot: built.snapshot, updatedAt: now };
    const versionDoc = { ...entry, id: versionDocId(id, entry.version), planoTakeoffId: String(id), ownerUid: authz.uid, organizationId: current.organizationId ?? null, createdAt: now };
    tx.set(docRef, nextDoc);
    tx.set(db.collection(VERSIONS_COLLECTION).doc(versionDoc.id), versionDoc);
    appendAudit(tx, auditRef, {
      entryId: nextDoc.id, action: 'PLANO_TAKEOFF_VERSION_RESTORED', previousStatus: current.currentVersion, newStatus: entry.version,
      actor: authz.uid, actorEmail: authz.email, reason: `Restauracion de ${version}`, source: 'api',
      projectId: nextDoc.projectId, planoTakeoffId: nextDoc.id, organizationId: current.organizationId ?? null, ownerUid: authz.uid
    });
    return { planoTakeoff: nextDoc, version: versionDoc };
  });
  res.status(200).json(result);
}

async function handleArchive(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id } = req.body || {};
  if(!id) throw httpError(400, 'Falta id del plano a archivar.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'El plano no existe.');
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Este plano pertenece a otro usuario.');
    const next = { ...current, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'PLANO_TAKEOFF_ARCHIVED', previousStatus: current.currentVersion, newStatus: current.currentVersion,
      actor: authz.uid, actorEmail: authz.email, reason: null, source: 'api',
      projectId: next.projectId, planoTakeoffId: next.id, organizationId: current.organizationId ?? null, ownerUid: authz.uid
    });
    return next;
  });
  res.status(200).json({ planoTakeoff: result });
}

const ACTIONS = { create: handleCreate, 'save-version': handleSaveVersion, 'restore-version': handleRestoreVersion, archive: handleArchive };

export default async function handler(req, res){
  try{
    if(req.method === 'GET'){ await handleList(req, res); return; }
    if(req.method !== 'POST'){ res.status(405).json({ error: 'Metodo no permitido.' }); return; }
    const action = req.body?.action;
    const run = ACTIONS[action];
    if(!run) throw httpError(400, `Accion no reconocida: "${action}".`);
    await run(req, res);
  }catch(err){
    const body = { error: err.message || 'No se pudo completar la solicitud.' };
    if(err.code) body.code = err.code;
    if(err.currentVersion) body.currentVersion = err.currentVersion;
    res.status(err.status || 400).json(body);
  }
}
