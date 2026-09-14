/* Avance fisico (Fase E, Control Presupuestal): libro mayor append-only de
   renglones de avance por concepto -- ver src/domain/progressEntrySchema.js
   para el porque de no usar el patron de version-por-guardado aqui (cada
   renglon es su propia auditoria, dos capturas concurrentes nunca se pisan
   porque ninguna edita un documento existente). Unicas acciones: `create`
   (agrega un renglon) y `list` (historial completo de un proyecto) -- no hay
   `update`/`delete`: corregir un avance mal capturado significa agregar un
   renglon con delta negativo, nunca reescribir el pasado (mismo principio
   que change-orders/commitments). */
import { requireAuth } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { loadOrgContext, assertOrgNotExpired, canAccessOrgScopedDoc } from './_orgGuard.mjs';
import { makeProgressEntry, validateProgressEntry, sumProgressDeltas, evaluateProgressGuard } from '../../src/domain/progressEntrySchema.js';
import { CHANGE_ORDER_STATUS } from '../../src/domain/changeOrderSchema.js';
import { calcAPUv2 } from '../../src/lib/apuCalc.js';

const COLLECTION = 'progressEntries';

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
  res.status(200).json({ progressEntries: snap.docs.map(d => d.data()) });
}

/* cantidadContratada = cantidad VIGENTE del concepto (qty base + deltas de
   ordenes de cambio APROBADA) -- misma definicion exacta que `cantidadVigente`
   en controlPresupuestalAggregation.js, para que el guard de "excede lo
   contratado" use la misma cantidad que el resto del modulo muestra. */
async function resolveCantidadContratada(db, authz, orgContext, concepto){
  const changeOrdersSnap = await db.collection('changeOrders')
    .where('conceptoId', '==', concepto.id).where('status', '==', CHANGE_ORDER_STATUS.APROBADA).get();
  const deltaQty = changeOrdersSnap.docs.reduce((s, d) => s + (Number(d.data().cantidadNueva) - Number(d.data().cantidadAnterior)), 0);
  return (Number(concepto.qty) || 0) + deltaQty;
}

async function handleCreate(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { projectId, conceptoId, delta, fecha, motivo } = req.body || {};
  if(!projectId || !conceptoId) throw httpError(400, 'Faltan projectId/conceptoId.');
  const db = getAdminDb();

  const conceptoSnap = await db.collection('catalogConceptos').doc(String(conceptoId)).get();
  if(!conceptoSnap.exists) throw httpError(404, 'El concepto no existe.');
  const concepto = conceptoSnap.data();
  if(!canAccessOrgScopedDoc(concepto, authz, orgContext)) throw httpError(403, 'Este concepto pertenece a otro usuario.');
  if(String(concepto.projectId) !== String(projectId)) throw httpError(400, 'El concepto no pertenece a este proyecto.');

  // El contenido real del APU (materials/labor/calculated) vive en
  // `apus/{id}.snapshot` -- ver _route-apus.mjs ("snapshot: built.apu") --
  // nunca en el documento envoltorio directamente.
  let pu = 0;
  if(concepto.apuId){
    const apuSnap = await db.collection('apus').doc(String(concepto.apuId)).get();
    if(apuSnap.exists){
      const snapshot = apuSnap.data().snapshot || {};
      const totals = snapshot.calculated || calcAPUv2(snapshot);
      pu = Number(totals?.pu) || 0;
    }
  }

  const [cantidadContratada, existingEntriesSnap] = await Promise.all([
    resolveCantidadContratada(db, authz, orgContext, { id: String(conceptoId), qty: concepto.qty }),
    db.collection(COLLECTION).where('conceptoId', '==', String(conceptoId)).get()
  ]);
  const existingEntries = existingEntriesSnap.docs.map(d => d.data());
  const previousAccumulated = sumProgressDeltas(existingEntries, String(conceptoId));
  const guard = evaluateProgressGuard({ previousAccumulated, delta, cantidadContratada });

  const seed = makeProgressEntry({
    projectId: String(projectId), conceptoId: String(conceptoId), delta,
    accumulated: guard.nextAccumulated, pu, fecha, motivo, usuario: authz.email || authz.uid
  });
  const { valid, errors } = validateProgressEntry(seed);
  if(!valid) throw httpError(400, `Renglon de avance invalido: ${errors.join(' ')}`);

  const doc = {
    ...seed, ownerUid: authz.uid, organizationId: orgContext ? orgContext.organizationId : null,
    warnings: guard.warnings, hasWarning: guard.hasWarning
  };
  await db.collection(COLLECTION).doc(doc.id).set(doc);
  res.status(201).json({ progressEntry: doc });
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
