/* Ordenes de cambio (Fase E, Control Presupuestal). Mismo patron de
   identidad/autorizacion que _route-catalogo-conceptos.mjs (requireAuth
   siempre del token, organizationId siempre de loadOrgContext, nunca del
   body). Documento actual + auditoria append-only (`changeOrdersAudit`) --
   una orden de cambio es un flujo de ESTADOS (BORRADOR/EN_REVISION/
   APROBADA/RECHAZADA/CANCELADA), no un documento que se edita
   campo-por-campo con historial de versiones como `presupuestos`.

   Reglas de negocio que este archivo hace cumplir SIEMPRE server-side
   (nunca confia en lo que mande el cliente):
   - cantidadAnterior/P.U. se leen del concepto/APU REALES en el momento de
     crear la orden -- nunca el numero que el formulario cree que es.
   - impactoEconomico se calcula con computeChangeOrderEconomicImpact
     (dominio puro), nunca se acepta un valor capturado a mano.
   - Aprobar/rechazar requiere ser responsable de la empresa (org) o ser el
     dueno individual (sin organizacion) -- igual criterio que
     requireCompanyManager en el resto de la app.
   - Solo una orden APROBADA existe para que controlPresupuestalAggregation.js
     la cuente -- el presupuesto VIGENTE se mueve, el BASELINE (presupuestos.js)
     nunca se toca (regla 2 del pedido). */
import { requireAuth } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { appendAudit } from './_decisionAudit.mjs';
import { loadOrgContext, assertOrgNotExpired, canAccessOrgScopedDoc } from './_orgGuard.mjs';
import { isOrgManagerRole } from '../../src/domain/organization.js';
import { makeEmptyChangeOrder, validateChangeOrder, isLegalChangeOrderTransition, CHANGE_ORDER_STATUS } from '../../src/domain/changeOrderSchema.js';
import { calcAPUv2 } from '../../src/lib/apuCalc.js';

const COLLECTION = 'changeOrders';
const AUDIT_COLLECTION = 'changeOrdersAudit';

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }

function assertCanDecide(authz, orgContext){
  if(!orgContext) return; // dueno individual: control total sobre sus propios documentos
  if(!isOrgManagerRole(orgContext.member.role)) throw httpError(403, 'Aprobar o rechazar una orden de cambio requiere ser el responsable de la empresa.');
}

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
  res.status(200).json({ changeOrders: snap.docs.map(d => d.data()) });
}

/* Folio secuencial legible (CO-001, CO-002...) -- se asigna contando las
   ordenes YA existentes del proyecto en este momento. Con la cadencia real
   de captura de ordenes de cambio (un puñado por proyecto, nunca cientos
   simultaneos) el riesgo teorico de colision por dos creaciones exactamente
   concurrentes es aceptable; un folio duplicado no corrompe nada (el `id`
   real del documento sigue siendo unico) y quedaria visible de inmediato
   para corregirse a mano. */
async function nextFolio(db, projectId){
  const snap = await db.collection(COLLECTION).where('projectId', '==', String(projectId)).get();
  return `CO-${String(snap.size + 1).padStart(3, '0')}`;
}

async function handleCreate(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { projectId, conceptoId, motivo, descripcion, cantidadNueva, impactoTiempoDias, evidencia } = req.body || {};
  if(!projectId || !conceptoId) throw httpError(400, 'Faltan projectId/conceptoId.');
  const db = getAdminDb();

  const conceptoSnap = await db.collection('catalogConceptos').doc(String(conceptoId)).get();
  if(!conceptoSnap.exists) throw httpError(404, 'El concepto no existe.');
  const concepto = conceptoSnap.data();
  if(!canAccessOrgScopedDoc(concepto, authz, orgContext)) throw httpError(403, 'Este concepto pertenece a otro usuario.');
  if(String(concepto.projectId) !== String(projectId)) throw httpError(400, 'El concepto no pertenece a este proyecto.');

  // cantidadAnterior = cantidad base del concepto + deltas de ordenes YA
  // aprobadas (nunca solo la cantidad original del catalogo, para que
  // ordenes de cambio sucesivas se encadenen sobre lo VIGENTE real).
  const priorApprovedSnap = await db.collection(COLLECTION)
    .where('conceptoId', '==', String(conceptoId)).where('status', '==', CHANGE_ORDER_STATUS.APROBADA).get();
  const cantidadAnterior = priorApprovedSnap.docs.reduce(
    (sum, d) => sum + (Number(d.data().cantidadNueva) - Number(d.data().cantidadAnterior)),
    Number(concepto.qty) || 0
  );

  // P.U. real del APU vinculado al concepto (nunca un valor capturado a
  // mano) -- sin APU vinculado todavia, el impacto economico es 0 (no hay
  // precio con que costear el cambio, sigue siendo una orden valida pero
  // sin impacto $ hasta que el concepto tenga un APU). El contenido real
  // del APU (materials/labor/calculated) vive en `apus/{id}.snapshot`
  // -- ver _route-apus.mjs ("snapshot: built.apu") -- nunca en el
  // documento envoltorio directamente.
  let pu = 0;
  if(concepto.apuId){
    const apuSnap = await db.collection('apus').doc(String(concepto.apuId)).get();
    if(apuSnap.exists){
      const snapshot = apuSnap.data().snapshot || {};
      const totals = snapshot.calculated || calcAPUv2(snapshot);
      pu = Number(totals?.pu) || 0;
    }
  }

  const seed = makeEmptyChangeOrder({
    projectId: String(projectId), conceptoId: String(conceptoId), clave: concepto.clave, concept: concepto.concept, unit: concepto.unit,
    motivo, descripcion, cantidadAnterior, cantidadNueva, pu, impactoTiempoDias, evidencia: evidencia || null
  });
  const { valid, errors } = validateChangeOrder(seed);
  if(!valid) throw httpError(400, `Orden de cambio invalida: ${errors.join(' ')}`);

  const folio = await nextFolio(db, projectId);
  const now = new Date().toISOString();
  const doc = { ...seed, folio, ownerUid: authz.uid, organizationId: orgContext ? orgContext.organizationId : null, createdAt: now, updatedAt: now };
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  await db.runTransaction(async (tx) => {
    tx.set(db.collection(COLLECTION).doc(doc.id), doc);
    appendAudit(tx, auditRef, {
      entryId: doc.id, action: 'CHANGE_ORDER_CREATED', previousStatus: null, newStatus: doc.status,
      actor: authz.uid, actorEmail: authz.email, reason: motivo || null, source: 'api',
      projectId: doc.projectId, conceptoId: doc.conceptoId, organizationId: doc.organizationId, ownerUid: authz.uid
    });
  });
  res.status(201).json({ changeOrder: doc });
}

/* set-status: unico camino para mover el estado -- valida la transicion
   (isLegalChangeOrderTransition) y, si el destino es APROBADA/RECHAZADA,
   exige derechos de aprobacion. Nunca permite editar cantidadNueva/pu aqui
   -- corregir esos numeros de una orden ya enviada significa crear una
   orden nueva, nunca mutar la existente (mismo principio de "nunca
   reescribir el pasado" que el resto de la app). */
async function handleSetStatus(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id, status, reason } = req.body || {};
  if(!id || !status) throw httpError(400, 'Faltan id/status.');
  if(!Object.values(CHANGE_ORDER_STATUS).includes(status)) throw httpError(400, `status desconocido: ${status}.`);
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'La orden de cambio no existe.');
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Esta orden de cambio pertenece a otro usuario.');
    if(!isLegalChangeOrderTransition(current.status, status)){
      throw httpError(409, `Transicion de estado no permitida: ${current.status} -> ${status}.`);
    }
    if(status === CHANGE_ORDER_STATUS.APROBADA || status === CHANGE_ORDER_STATUS.RECHAZADA){
      assertCanDecide(authz, orgContext);
    }
    const now = new Date().toISOString();
    const next = {
      ...current, status, updatedAt: now,
      approvedBy: (status === CHANGE_ORDER_STATUS.APROBADA || status === CHANGE_ORDER_STATUS.RECHAZADA) ? (authz.email || authz.uid) : current.approvedBy,
      decidedAt: (status === CHANGE_ORDER_STATUS.APROBADA || status === CHANGE_ORDER_STATUS.RECHAZADA) ? now : current.decidedAt,
      decisionReason: reason || current.decisionReason
    };
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'CHANGE_ORDER_STATUS_CHANGED', previousStatus: current.status, newStatus: status,
      actor: authz.uid, actorEmail: authz.email, reason: reason || null, source: 'api',
      projectId: next.projectId, conceptoId: next.conceptoId, organizationId: current.organizationId ?? null, ownerUid: authz.uid
    });
    return next;
  });
  res.status(200).json({ changeOrder: result });
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
