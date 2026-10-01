/* F4 -- Persistencia autoritativa de LEVANTAMIENTOS en el servidor
   (coleccion `levantamientos`), reemplazando al bloque comprimido por
   usuario (users/{uid}/state/zoemec-levantamientos) como fuente principal.
   Mismo patron que el resto de server/api-lib: identidad SIEMPRE del token
   (requireAuth), organizationId SIEMPRE de loadOrgContext, acceso por
   canAccessOrgScopedDoc + assertProjectAccess, auditoria append-only.

   El documento guarda el survey (espacios, elementos, captura inicial,
   evidencia) y cadLinks[spaceId] -> planoId: la GEOMETRIA vive una sola vez
   en planoTakeoffs (versionado). Nunca se guarda cadPlanos aqui, salvo el
   respaldo congelado de la migracion (legacyBackup), que no se usa.

   Concurrencia: `revision` entero + expectedRevision -> 409
   REVISION_CONFLICT (nunca sobrescribe en silencio la revision de otro). */
import { requireAuth } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { appendAudit } from './_decisionAudit.mjs';
import { loadOrgContext, assertOrgNotExpired, canAccessOrgScopedDoc, assertProjectAccess } from './_orgGuard.mjs';
import { validateSurvey } from '../../src/domain/levantamientoSchema.js';
import { surveyGeometryMode } from '../../src/domain/levantamientoCadLink.js';

const COLLECTION = 'levantamientos';
const AUDIT_COLLECTION = 'levantamientosAudit';
const MAX_DOC_JSON_BYTES = 900000;

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }

function toPublic(doc){
  return { ...doc.survey, id: doc.id, projectId: doc.projectId, revision: doc.revision, geometryMode: doc.geometryMode,
    createdBy: doc.createdBy, updatedBy: doc.updatedBy, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
    migratedFrom: doc.migratedFrom || null, migratedAt: doc.migratedAt || null, hasLegacyBackup: Boolean(doc.legacyBackup) };
}

async function handleList(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  const { id, projectId } = req.query || {};
  const db = getAdminDb();
  if(id){
    const snap = await db.collection(COLLECTION).doc(String(id)).get();
    if(!snap.exists){ res.status(200).json({ levantamiento: null }); return; }
    const doc = snap.data();
    if(!canAccessOrgScopedDoc(doc, authz, orgContext)) throw httpError(403, 'Este levantamiento pertenece a otra empresa.');
    res.status(200).json({ levantamiento: toPublic(doc) });
    return;
  }
  if(!projectId) throw httpError(400, 'Falta projectId.');
  await assertProjectAccess(db, authz, orgContext, projectId);
  const query = orgContext
    ? db.collection(COLLECTION).where('organizationId', '==', orgContext.organizationId).where('projectId', '==', String(projectId))
    : db.collection(COLLECTION).where('ownerUid', '==', authz.uid).where('projectId', '==', String(projectId));
  const snap = await query.get();
  res.status(200).json({ levantamientos: snap.docs.map(d => d.data()).filter(d => !d.archivedAt).map(toPublic) });
}

/* UPSERT: crea (revision 1) o guarda (revision+1 con expectedRevision). */
async function handleSave(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { survey, expectedRevision, migratedFrom = null, legacyBackup = null, reason = null } = req.body || {};
  if(!survey?.id || !survey?.projectId) throw httpError(400, 'Faltan survey.id/survey.projectId.');
  const db = getAdminDb();
  await assertProjectAccess(db, authz, orgContext, survey.projectId);
  // La geometria editada NUNCA viaja dentro del levantamiento (vive en planoTakeoffs).
  const { cadPlanos, revision: _r, geometryMode: _g, createdBy: _cb, updatedBy: _ub, migratedAt: _ma, hasLegacyBackup: _h, ...clean } = survey;
  const { valid, errors } = validateSurvey(clean);
  if(!valid) throw httpError(400, `Levantamiento invalido: ${errors.join(' ')}`);
  if(JSON.stringify(clean).length > MAX_DOC_JSON_BYTES) throw httpError(413, 'El levantamiento excede el tamano permitido.');
  const docRef = db.collection(COLLECTION).doc(String(clean.id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const actor = authz.email || authz.uid;
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const now = new Date().toISOString();
    if(!snap.exists){
      const doc = {
        id: String(clean.id), organizationId: orgContext ? orgContext.organizationId : null, ownerUid: authz.uid,
        projectId: String(clean.projectId), revision: 1, geometryMode: surveyGeometryMode(clean),
        survey: clean, createdBy: actor, updatedBy: actor, createdAt: now, updatedAt: now,
        migratedFrom: migratedFrom || null, migratedAt: migratedFrom ? now : null,
        legacyBackup: migratedFrom ? (legacyBackup || null) : null
      };
      tx.set(docRef, doc);
      appendAudit(tx, auditRef, { entryId: doc.id, action: migratedFrom ? 'LEVANTAMIENTO_MIGRADO' : 'LEVANTAMIENTO_CREADO', previousStatus: null, newStatus: 'rev1', actor: authz.uid, actorEmail: authz.email, reason, source: 'api', projectId: doc.projectId, organizationId: doc.organizationId, ownerUid: authz.uid });
      return { doc, created: true };
    }
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Este levantamiento pertenece a otra empresa.');
    if(String(current.projectId) !== String(clean.projectId)) throw httpError(400, 'Un levantamiento no puede cambiar de proyecto.');
    if(migratedFrom){ return { doc: current, created: false, alreadyMigrated: true }; } // migracion idempotente
    if(Number(expectedRevision) !== Number(current.revision)){
      const e = httpError(409, `Conflicto: el levantamiento ya esta en la revision ${current.revision} (tu partias de la ${expectedRevision}). Recarga para ver los cambios de otro usuario.`);
      e.code = 'REVISION_CONFLICT'; e.currentRevision = current.revision;
      throw e;
    }
    const doc = { ...current, survey: clean, revision: current.revision + 1, geometryMode: surveyGeometryMode(clean), updatedBy: actor, updatedAt: now };
    tx.set(docRef, doc);
    appendAudit(tx, auditRef, { entryId: doc.id, action: 'LEVANTAMIENTO_GUARDADO', previousStatus: `rev${current.revision}`, newStatus: `rev${doc.revision}`, actor: authz.uid, actorEmail: authz.email, reason, source: 'api', projectId: doc.projectId, organizationId: doc.organizationId ?? null, ownerUid: authz.uid });
    return { doc, created: false };
  });
  res.status(result.created ? 201 : 200).json({ levantamiento: toPublic(result.doc), alreadyMigrated: Boolean(result.alreadyMigrated) });
}

async function handleArchive(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id } = req.body || {};
  if(!id) throw httpError(400, 'Falta id.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'El levantamiento no existe.');
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Este levantamiento pertenece a otra empresa.');
    const next = { ...current, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: authz.email || authz.uid };
    tx.set(docRef, next);
    appendAudit(tx, auditRef, { entryId: next.id, action: 'LEVANTAMIENTO_ARCHIVADO', previousStatus: `rev${current.revision}`, newStatus: 'archivado', actor: authz.uid, actorEmail: authz.email, reason: null, source: 'api', projectId: next.projectId, organizationId: next.organizationId ?? null, ownerUid: authz.uid });
    return next;
  });
  res.status(200).json({ levantamiento: toPublic(result) });
}

const ACTIONS = { save: handleSave, archive: handleArchive };

export default async function handler(req, res){
  try{
    if(req.method === 'GET'){ await handleList(req, res); return; }
    if(req.method !== 'POST'){ res.status(405).json({ error: 'Metodo no permitido.' }); return; }
    const run = ACTIONS[req.body?.action];
    if(!run) throw httpError(400, `Accion no reconocida: "${req.body?.action}".`);
    await run(req, res);
  }catch(err){
    const body = { error: err.message || 'No se pudo completar la solicitud.' };
    if(err.code) body.code = err.code;
    if(err.currentRevision !== undefined) body.currentRevision = err.currentRevision;
    res.status(err.status || 400).json(body);
  }
}
