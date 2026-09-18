/* Persistencia autoritativa del Presupuesto + versionado inmutable (Fase D).
   Mismo patron exacto que server/api-lib/_route-apus.mjs (documento actual
   `presupuestos/{id}` con `currentVersion`, version inmutable por cada
   guardado `presupuestoVersions/{id}__V{n}`, auditoria append-only
   `presupuestoAudit`, control de concurrencia optimista con
   `expectedParentVersionId` obligatorio en save-version), pero usando
   src/domain/presupuestoVersioning.js en vez de apuVersioning.js -- un
   snapshot de Presupuesto ya viene agregado por
   src/domain/presupuestoAggregation.js#aggregatePresupuesto, no hay nada
   "APU" que finalizar aqui (ver presupuestoVersioning.js para el porque de
   no reusar apuVersioning.js directamente).

   Agrega UNA accion nueva sobre el patron de _route-apus.mjs: approve-baseline,
   que fija `baselineVersion` UNA SOLA VEZ (rechaza con 409 si ya estaba
   fijado) -- el primer presupuesto aprobado se vuelve Baseline y nunca se
   reasigna; save-version sigue avanzando `currentVersion` despues sin tocar
   `baselineVersion`. Esta es la base que leera la futura fase de Control
   Presupuestal (diff baselineVersion vs currentVersion) -- nada mas de esa
   fase se construye aqui. */
import { requireAuth } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { appendAudit } from './_decisionAudit.mjs';
import { createPresupuestoVersion, restorePresupuestoVersion } from '../../src/domain/presupuestoVersioning.js';
import { loadOrgContext, assertOrgNotExpired, canAccessOrgScopedDoc } from './_orgGuard.mjs';

const COLLECTION = 'presupuestos';
const VERSIONS_COLLECTION = 'presupuestoVersions';
const AUDIT_COLLECTION = 'presupuestoAudit';

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }
function versionDocId(presupuestoId, version){
  return `${String(presupuestoId).replace(/[^a-zA-Z0-9_-]/g, '_')}__${String(version)}`;
}

async function handleList(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  const { id, projectId } = req.query || {};
  const db = getAdminDb();
  if(id){
    const snap = await db.collection(COLLECTION).doc(String(id)).get();
    if(!snap.exists){ res.status(200).json({ presupuesto: null, versions: [] }); return; }
    const presupuesto = snap.data();
    if(!canAccessOrgScopedDoc(presupuesto, authz, orgContext)) throw httpError(403, 'Este presupuesto pertenece a otro usuario.');
    const versionsSnap = await db.collection(VERSIONS_COLLECTION).where('presupuestoId', '==', String(id)).get();
    const versions = versionsSnap.docs.map(d => d.data()).sort((a, b) => Number(a.version.replace(/\D/g, '')) - Number(b.version.replace(/\D/g, '')));
    res.status(200).json({ presupuesto, versions });
    return;
  }
  if(!projectId) throw httpError(400, 'Falta id o projectId.');
  let query = orgContext
    ? db.collection(COLLECTION).where('organizationId', '==', orgContext.organizationId).where('projectId', '==', String(projectId))
    : db.collection(COLLECTION).where('ownerUid', '==', authz.uid).where('projectId', '==', String(projectId));
  const snap = await query.get();
  const presupuestos = snap.docs.map(d => d.data()).filter(p => !p.archivedAt);
  res.status(200).json({ presupuestos });
}

/* CREATE: primera version real del presupuesto. Idempotente por id, mismo
   criterio que _route-apus.mjs (reintento no duplica). */
async function handleCreate(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id, projectId, snapshot, reason } = req.body || {};
  if(!id || !projectId || !snapshot) throw httpError(400, 'Faltan id/projectId/snapshot.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const organizationId = orgContext ? orgContext.organizationId : null;
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(snap.exists){
      const existing = snap.data();
      if(!canAccessOrgScopedDoc(existing, authz, orgContext)) throw httpError(409, 'Ya existe un presupuesto con ese id perteneciente a otro usuario.');
      return { presupuesto: existing, version: null };
    }
    const built = createPresupuestoVersion(snapshot, [], { user: authz.email || authz.uid, reason: reason || 'Version inicial' });
    const entry = built.history[built.history.length - 1];
    const now = new Date().toISOString();
    const presupuestoDoc = {
      id: String(id), ownerUid: authz.uid, organizationId, projectId: String(projectId),
      currentVersion: entry.version, baselineVersion: null, snapshot: built.snapshot,
      createdAt: now, updatedAt: now
    };
    const versionDoc = { ...entry, id: versionDocId(id, entry.version), presupuestoId: String(id), ownerUid: authz.uid, organizationId, createdAt: now };
    tx.set(docRef, presupuestoDoc);
    tx.set(db.collection(VERSIONS_COLLECTION).doc(versionDoc.id), versionDoc);
    appendAudit(tx, auditRef, {
      entryId: presupuestoDoc.id, action: 'PRESUPUESTO_CREATED', previousStatus: null, newStatus: entry.version,
      actor: authz.uid, actorEmail: authz.email, reason: reason || null, source: 'api',
      projectId: presupuestoDoc.projectId, presupuestoId: presupuestoDoc.id, organizationId, ownerUid: authz.uid
    });
    return { presupuesto: presupuestoDoc, version: versionDoc };
  });
  res.status(201).json(result);
}

/* SAVE-VERSION: crea una version NUEVA e inmutable, nunca sobreescribe.
   Mismo control de concurrencia optimista que _route-apus.mjs
   (`expectedParentVersionId` obligatorio, 409/VERSION_CONFLICT si no
   coincide con el currentVersion real leido dentro de la transaccion).
   `baselineVersion` se copia tal cual del documento actual -- save-version
   JAMAS lo modifica, solo approve-baseline puede fijarlo. */
async function handleSaveVersion(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id, snapshot, reason, expectedParentVersionId } = req.body || {};
  if(!id || !snapshot) throw httpError(400, 'Faltan id/snapshot.');
  if(!expectedParentVersionId) throw httpError(400, 'Falta expectedParentVersionId: indica de que version parte este guardado para poder detectar conflictos de concurrencia.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'El presupuesto no existe. Crealo primero con action=create.');
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Este presupuesto pertenece a otro usuario.');
    if(current.currentVersion !== expectedParentVersionId){
      const conflict = httpError(409, `Conflicto de version: esperabas partir de ${expectedParentVersionId}, pero la version vigente en el servidor ya es ${current.currentVersion}.`);
      conflict.code = 'VERSION_CONFLICT';
      conflict.currentVersion = current.currentVersion;
      throw conflict;
    }
    const built = createPresupuestoVersion(snapshot, [{ version: current.currentVersion }], { user: authz.email || authz.uid, reason: reason || 'Guardado manual' });
    const entry = built.history[built.history.length - 1];
    const now = new Date().toISOString();
    const nextDoc = { ...current, currentVersion: entry.version, snapshot: built.snapshot, updatedAt: now };
    const versionDoc = { ...entry, id: versionDocId(id, entry.version), presupuestoId: String(id), ownerUid: authz.uid, organizationId: current.organizationId ?? null, createdAt: now };
    tx.set(docRef, nextDoc);
    tx.set(db.collection(VERSIONS_COLLECTION).doc(versionDoc.id), versionDoc);
    appendAudit(tx, auditRef, {
      entryId: nextDoc.id, action: 'PRESUPUESTO_VERSION_SAVED', previousStatus: current.currentVersion, newStatus: entry.version,
      actor: authz.uid, actorEmail: authz.email, reason: reason || null, source: 'api',
      projectId: nextDoc.projectId, presupuestoId: nextDoc.id, organizationId: current.organizationId ?? null, ownerUid: authz.uid
    });
    return { presupuesto: nextDoc, version: versionDoc };
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
    if(!snap.exists) throw httpError(404, 'El presupuesto no existe.');
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Este presupuesto pertenece a otro usuario.');
    if(!targetSnap.exists) throw httpError(404, `La version ${version} no existe para este presupuesto.`);
    const targetEntry = targetSnap.data();
    const built = restorePresupuestoVersion(targetEntry, [{ version: current.currentVersion }], { user: authz.email || authz.uid });
    const entry = built.history[built.history.length - 1];
    const now = new Date().toISOString();
    const nextDoc = { ...current, currentVersion: entry.version, snapshot: built.snapshot, updatedAt: now };
    const versionDoc = { ...entry, id: versionDocId(id, entry.version), presupuestoId: String(id), ownerUid: authz.uid, organizationId: current.organizationId ?? null, createdAt: now };
    tx.set(docRef, nextDoc);
    tx.set(db.collection(VERSIONS_COLLECTION).doc(versionDoc.id), versionDoc);
    appendAudit(tx, auditRef, {
      entryId: nextDoc.id, action: 'PRESUPUESTO_VERSION_RESTORED', previousStatus: current.currentVersion, newStatus: entry.version,
      actor: authz.uid, actorEmail: authz.email, reason: `Restauracion de ${version}`, source: 'api',
      projectId: nextDoc.projectId, presupuestoId: nextDoc.id, organizationId: current.organizationId ?? null, ownerUid: authz.uid
    });
    return { presupuesto: nextDoc, version: versionDoc };
  });
  res.status(200).json(result);
}

/* APPROVE-BASELINE: fija baselineVersion UNA SOLA VEZ. Si ya estaba fijado,
   rechaza con 409 -- nunca reasigna el Baseline (regla explicita del
   producto: "el primer presupuesto aprobado se convierte en Baseline, no
   se sobreescribe despues"). No mueve currentVersion ni crea una version
   nueva -- solo estampa el puntero sobre la version vigente en ese momento. */
async function handleApproveBaseline(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id } = req.body || {};
  if(!id) throw httpError(400, 'Falta id del presupuesto a aprobar como Baseline.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'El presupuesto no existe.');
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Este presupuesto pertenece a otro usuario.');
    if(current.baselineVersion){
      const conflict = httpError(409, `Este presupuesto ya tiene un Baseline aprobado (${current.baselineVersion}): no puede reasignarse.`);
      conflict.code = 'BASELINE_ALREADY_SET';
      throw conflict;
    }
    const next = { ...current, baselineVersion: current.currentVersion, updatedAt: new Date().toISOString() };
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'PRESUPUESTO_BASELINE_APPROVED', previousStatus: null, newStatus: next.baselineVersion,
      actor: authz.uid, actorEmail: authz.email, reason: null, source: 'api',
      projectId: next.projectId, presupuestoId: next.id, organizationId: current.organizationId ?? null, ownerUid: authz.uid
    });
    return next;
  });
  res.status(200).json({ presupuesto: result });
}

async function handleArchive(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id } = req.body || {};
  if(!id) throw httpError(400, 'Falta id del presupuesto a archivar.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'El presupuesto no existe.');
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Este presupuesto pertenece a otro usuario.');
    const next = { ...current, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'PRESUPUESTO_ARCHIVED', previousStatus: current.currentVersion, newStatus: current.currentVersion,
      actor: authz.uid, actorEmail: authz.email, reason: null, source: 'api',
      projectId: next.projectId, presupuestoId: next.id, organizationId: current.organizationId ?? null, ownerUid: authz.uid
    });
    return next;
  });
  res.status(200).json({ presupuesto: result });
}

const ACTIONS = {
  create: handleCreate, 'save-version': handleSaveVersion, 'restore-version': handleRestoreVersion,
  'approve-baseline': handleApproveBaseline, archive: handleArchive
};

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
