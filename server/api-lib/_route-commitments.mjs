/* Comprometido (Fase E, Control Presupuestal): ordenes de compra, contratos,
   subcontratos. Mismo patron de identidad/autorizacion que
   _route-catalogo-conceptos.mjs. Documento actual (flujo de estado simple,
   ACTIVO/CERRADO/CANCELADO) + auditoria append-only `commitmentsAudit` --
   sin coleccion de versiones, un compromiso no se edita campo-por-campo
   despues de creado (regla 3 del pedido: nunca mezclar comprometido con
   pagado, y un compromiso mal capturado se cancela, nunca se reescribe). */
import { requireAuth } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { appendAudit } from './_decisionAudit.mjs';
import { loadOrgContext, assertOrgNotExpired, canAccessOrgScopedDoc } from './_orgGuard.mjs';
import { makeEmptyCommitment, validateCommitment, isLegalCommitmentTransition, COMMITMENT_STATUS } from '../../src/domain/commitmentSchema.js';

const COLLECTION = 'commitments';
const AUDIT_COLLECTION = 'commitmentsAudit';

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }

async function handleList(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  const { projectId } = req.query || {};
  if(!projectId) throw httpError(400, 'Falta projectId.');
  const db = getAdminDb();
  const query = orgContext
    ? db.collection(COLLECTION).where('organizationId', '==', orgContext.organizationId).where('projectId', '==', String(projectId))
    : db.collection(COLLECTION).where('ownerUid', '==', authz.uid).where('projectId', '==', String(projectId));
  const snap = await query.get();
  res.status(200).json({ commitments: snap.docs.map(d => d.data()) });
}

async function handleCreate(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { projectId, conceptoId, capitulo, tipo, proveedor, monto, fecha, referencia } = req.body || {};
  if(!projectId) throw httpError(400, 'Falta projectId.');
  const db = getAdminDb();

  // Si viene ligado a un concepto, se verifica pertenencia -- un compromiso
  // "suelto" (solo por capitulo, sin concepto especifico) tambien es valido
  // (seccion 3 del pedido: "concepto/capitulo").
  if(conceptoId){
    const conceptoSnap = await db.collection('catalogConceptos').doc(String(conceptoId)).get();
    if(!conceptoSnap.exists) throw httpError(404, 'El concepto no existe.');
    if(!canAccessOrgScopedDoc(conceptoSnap.data(), authz, orgContext)) throw httpError(403, 'Este concepto pertenece a otro usuario.');
    if(String(conceptoSnap.data().projectId) !== String(projectId)) throw httpError(400, 'El concepto no pertenece a este proyecto.');
  }

  const seed = makeEmptyCommitment({ projectId: String(projectId), conceptoId: conceptoId ? String(conceptoId) : null, capitulo, tipo, proveedor, monto, fecha, referencia });
  const { valid, errors } = validateCommitment(seed);
  if(!valid) throw httpError(400, `Compromiso invalido: ${errors.join(' ')}`);

  const now = new Date().toISOString();
  const doc = { ...seed, ownerUid: authz.uid, organizationId: orgContext ? orgContext.organizationId : null, createdAt: now, updatedAt: now };
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  await db.runTransaction(async (tx) => {
    tx.set(db.collection(COLLECTION).doc(doc.id), doc);
    appendAudit(tx, auditRef, {
      entryId: doc.id, action: 'COMMITMENT_CREATED', previousStatus: null, newStatus: doc.status,
      actor: authz.uid, actorEmail: authz.email, reason: null, source: 'api',
      projectId: doc.projectId, conceptoId: doc.conceptoId, organizationId: doc.organizationId, ownerUid: authz.uid
    });
  });
  res.status(201).json({ commitment: doc });
}

async function handleSetStatus(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id, status, reason } = req.body || {};
  if(!id || !status) throw httpError(400, 'Faltan id/status.');
  if(!Object.values(COMMITMENT_STATUS).includes(status)) throw httpError(400, `status desconocido: ${status}.`);
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'El compromiso no existe.');
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Este compromiso pertenece a otro usuario.');
    if(!isLegalCommitmentTransition(current.status, status)){
      throw httpError(409, `Transicion de estado no permitida: ${current.status} -> ${status}.`);
    }
    const next = { ...current, status, updatedAt: new Date().toISOString() };
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'COMMITMENT_STATUS_CHANGED', previousStatus: current.status, newStatus: status,
      actor: authz.uid, actorEmail: authz.email, reason: reason || null, source: 'api',
      projectId: next.projectId, conceptoId: next.conceptoId, organizationId: current.organizationId ?? null, ownerUid: authz.uid
    });
    return next;
  });
  res.status(200).json({ commitment: result });
}

const ACTIONS = { create: handleCreate, 'set-status': handleSetStatus };

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
    res.status(err.status || 400).json(body);
  }
}
