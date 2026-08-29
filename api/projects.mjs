/* Persistencia autoritativa de Proyecto (Fase 7). Reemplaza, SOLO para esta
   entidad, el patron anterior de users/{uid}/state (blob gzip via
   useCloudState -- ver src/cloud.js): un documento real por proyecto en vez
   de un arreglo completo en un solo blob, validado y auditado server-side
   en vez de escrito directo por el cliente.

   Identidad SIEMPRE del token verificado (requireAuth) -- ownerUid nunca se
   lee del body. Autorizacion: cada usuario administra solo sus propios
   proyectos (no es un recurso de moderacion como Memoria Tecnica, no hay
   bypass de admin para editar proyectos ajenos -- nadie lo pidio, no se
   inventa). */
import { requireAuth } from '../server/api-lib/_authGuard.mjs';
import { getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';
import { appendAudit } from '../server/api-lib/_decisionAudit.mjs';

const COLLECTION = 'projects';
const AUDIT_COLLECTION = 'projectAudit';

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }

// La cartera visible del usuario nunca incluye proyectos archivados (regla
// equivalente a "eliminar" en la UI, ver Projects#remove en main.jsx --
// mapea a action:archive, nunca a un borrado duro de Firestore: se conserva
// la auditoria/version en vez de perder el trabajo del usuario).
async function handleList(req, res){
  const authz = await requireAuth(req);
  const db = getAdminDb();
  // ?id= (Fase 8 Parte 2): un solo proyecto por id, para la portada del
  // dossier de proyecto (nombre/cliente) -- mismo criterio de ownership que
  // el resto del endpoint, nunca expone un proyecto de otro usuario.
  const { id } = req.query || {};
  if(id){
    const snap = await db.collection(COLLECTION).doc(String(id)).get();
    if(!snap.exists){ res.status(200).json({ project: null }); return; }
    const project = snap.data();
    if(project.ownerUid !== authz.uid) throw httpError(403, 'Este proyecto pertenece a otro usuario.');
    res.status(200).json({ project });
    return;
  }
  const snap = await db.collection(COLLECTION).where('ownerUid', '==', authz.uid).get();
  const projects = snap.docs.map(d => d.data()).filter(p => !p.archivedAt);
  res.status(200).json({ projects });
}

/* CREATE (regla 3/6 del plan -- idempotente por id, necesario para que la
   migracion transparente desde el blob legado pueda reintentar sin
   duplicar): si el id ya existe y es del mismo dueno, se devuelve tal cual
   esta (upsert silencioso); si existe de OTRO dueno, es un conflicto real. */
async function handleCreate(req, res){
  const authz = await requireAuth(req);
  const { id, name, client, ubicacion, moneda, budget, progress, status, migratedFrom } = req.body || {};
  if(!id || !name) throw httpError(400, 'Faltan id/name del proyecto.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(snap.exists){
      const existing = snap.data();
      if(existing.ownerUid !== authz.uid) throw httpError(409, 'Ya existe un proyecto con ese id perteneciente a otro usuario.');
      return existing; // idempotente: reintento de migracion/creacion no duplica
    }
    const now = new Date().toISOString();
    const next = {
      id: String(id), ownerUid: authz.uid,
      name: String(name), client: client || null, ubicacion: ubicacion || null,
      moneda: moneda || 'MXN', budget: Number(budget) || 0, progress: Number(progress) || 0,
      status: status || 'Anteproyecto', archivedAt: null,
      migratedFrom: migratedFrom || null,
      createdAt: now, updatedAt: now
    };
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'PROJECT_CREATED', previousStatus: null, newStatus: next.status,
      actor: authz.uid, actorEmail: authz.email, reason: migratedFrom ? `Migrado desde ${migratedFrom}` : null, source: 'api',
      projectId: next.id, apuId: null, organizationId: null, ownerUid: authz.uid
    });
    return next;
  });
  res.status(201).json({ project: result });
}

/* UPDATE: merge parcial sobre campos propios del proyecto (nunca id/ownerUid/
   createdAt). No requiere transaccion de estado (no hay una maquina de
   transiciones que validar aqui, a diferencia de Memoria Tecnica) pero si
   valida dueno real dentro de una transaccion para evitar TOCTOU. */
async function handleUpdate(req, res){
  const authz = await requireAuth(req);
  const { id, ...changes } = req.body || {};
  if(!id) throw httpError(400, 'Falta id del proyecto a actualizar.');
  delete changes.ownerUid; delete changes.createdAt; delete changes.migratedFrom;
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'El proyecto no existe.');
    const current = snap.data();
    if(current.ownerUid !== authz.uid) throw httpError(403, 'Este proyecto pertenece a otro usuario.');
    const next = { ...current, ...changes, id: current.id, ownerUid: current.ownerUid, updatedAt: new Date().toISOString() };
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'PROJECT_UPDATED', previousStatus: current.status, newStatus: next.status,
      actor: authz.uid, actorEmail: authz.email, reason: null, source: 'api',
      projectId: next.id, apuId: null, organizationId: null, ownerUid: authz.uid
    });
    return next;
  });
  res.status(200).json({ project: result });
}

async function handleArchive(req, res){
  const authz = await requireAuth(req);
  const { id } = req.body || {};
  if(!id) throw httpError(400, 'Falta id del proyecto a archivar.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'El proyecto no existe.');
    const current = snap.data();
    if(current.ownerUid !== authz.uid) throw httpError(403, 'Este proyecto pertenece a otro usuario.');
    const next = { ...current, status: 'Archivado', archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'PROJECT_ARCHIVED', previousStatus: current.status, newStatus: next.status,
      actor: authz.uid, actorEmail: authz.email, reason: null, source: 'api',
      projectId: next.id, apuId: null, organizationId: null, ownerUid: authz.uid
    });
    return next;
  });
  res.status(200).json({ project: result });
}

const ACTIONS = { create: handleCreate, update: handleUpdate, archive: handleArchive };

export default async function handler(req, res){
  try{
    if(req.method === 'GET'){ await handleList(req, res); return; }
    if(req.method !== 'POST'){ res.status(405).json({ error: 'Metodo no permitido.' }); return; }
    const action = req.body?.action;
    const run = ACTIONS[action];
    if(!run) throw httpError(400, `Accion no reconocida: "${action}".`);
    await run(req, res);
  }catch(err){
    res.status(err.status || 400).json({ error: err.message || 'No se pudo completar la solicitud.' });
  }
}
