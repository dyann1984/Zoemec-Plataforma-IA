/* Pagos (Fase E, Control Presupuestal). Ledger append-only, mismo criterio
   que progressEntries -- un pago nunca se edita, solo se agrega (corregirlo
   significa registrar un ajuste nuevo). Un pago afecta SOLO `pagado`, nunca
   `ejecutado` (regla 7 del pedido, ver src/domain/paymentSchema.js). Sin
   estimacionId es valido (queda sin prorratear a ningun concepto, ver
   controlPresupuestalAggregation.js#allocatePayments) -- nunca se rechaza ni
   se le inventa una estimacion a la fuerza. */
import { requireAuth } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { loadOrgContext, assertOrgNotExpired, canAccessOrgScopedDoc } from './_orgGuard.mjs';
import { makePayment, validatePayment, evaluatePaymentGuard } from '../../src/domain/paymentSchema.js';

const COLLECTION = 'payments';

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
  res.status(200).json({ payments: snap.docs.map(d => d.data()) });
}

async function handleCreate(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { projectId, estimacionId, monto, fecha, proveedor, referencia, metodo, evidencia } = req.body || {};
  if(!projectId) throw httpError(400, 'Falta projectId.');
  const db = getAdminDb();

  // totalEstimado se deja `undefined` (nunca `null`) cuando no hay
  // estimacionId -- evaluatePaymentGuard usa Number.isFinite para decidir
  // "sin estimacion contra que comparar", y Number(null) es 0 (finito),
  // lo cual marcaria erroneamente CUALQUIER pago sin estimacion como que
  // excede un estimado fantasma de $0.
  let totalEstimado;
  let totalPagadoPrevio = 0;
  if(estimacionId){
    const estimateSnap = await db.collection('estimates').doc(String(estimacionId)).get();
    if(!estimateSnap.exists) throw httpError(404, 'La estimacion referenciada no existe.');
    const estimate = estimateSnap.data();
    if(!canAccessOrgScopedDoc(estimate, authz, orgContext)) throw httpError(403, 'La estimacion referenciada pertenece a otro usuario.');
    if(String(estimate.projectId) !== String(projectId)) throw httpError(400, 'La estimacion no pertenece a este proyecto.');
    totalEstimado = Number(estimate.totalEstimado) || 0;
    const priorPaymentsSnap = await db.collection(COLLECTION).where('estimacionId', '==', String(estimacionId)).get();
    totalPagadoPrevio = priorPaymentsSnap.docs.reduce((s, d) => s + (Number(d.data().monto) || 0), 0);
  }

  const guard = evaluatePaymentGuard({ montoPago: monto, totalEstimado, totalPagadoPrevio });
  const seed = makePayment({
    projectId: String(projectId), estimacionId: estimacionId ? String(estimacionId) : null,
    monto, fecha, proveedor, referencia, metodo, evidencia, usuario: authz.email || authz.uid
  });
  const { valid, errors } = validatePayment(seed);
  if(!valid) throw httpError(400, `Pago invalido: ${errors.join(' ')}`);

  const doc = {
    ...seed, ownerUid: authz.uid, organizationId: orgContext ? orgContext.organizationId : null,
    exceedsEstimate: guard.exceedsEstimate, exceedsEstimateReason: guard.reason
  };
  await db.collection(COLLECTION).doc(doc.id).set(doc);
  res.status(201).json({ payment: doc });
}

const ACTIONS = { create: handleCreate };

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
