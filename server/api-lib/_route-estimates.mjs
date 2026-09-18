/* Estimaciones de obra (Fase E, Control Presupuestal). Mismo patron de
   identidad/autorizacion que _route-catalogo-conceptos.mjs. Documento actual
   (BORRADOR -> AUTORIZADA, terminal) + auditoria append-only
   `estimatesAudit` -- una estimacion autorizada nunca se vuelve a editar
   (corregirla significa capturar una nueva, mismo principio que
   change-orders). Deliberadamente SIN logica fiscal de Mexico (ver
   src/domain/estimateSchema.js): retencion/amortizacion/deducciones son
   porcentajes/montos que el usuario declara, nunca una tasa legal inventada.

   P.U. de cada renglon SIEMPRE se resuelve server-side del APU vigente del
   concepto en ese momento (igual que change-orders/progress) -- nunca se
   confia en el numero que el formulario cree que es. */
import { requireAuth } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { appendAudit } from './_decisionAudit.mjs';
import { loadOrgContext, assertOrgNotExpired, canAccessOrgScopedDoc } from './_orgGuard.mjs';
import { isOrgManagerRole } from '../../src/domain/organization.js';
import { makeEmptyEstimate, validateEstimate, isLegalEstimateTransition, ESTIMATE_STATUS } from '../../src/domain/estimateSchema.js';
import { calcAPUv2 } from '../../src/lib/apuCalc.js';

const COLLECTION = 'estimates';
const AUDIT_COLLECTION = 'estimatesAudit';

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }

function assertCanAuthorize(authz, orgContext){
  if(!orgContext) return;
  if(!isOrgManagerRole(orgContext.member.role)) throw httpError(403, 'Autorizar una estimacion requiere ser el responsable de la empresa.');
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
  res.status(200).json({ estimates: snap.docs.map(d => d.data()) });
}

async function nextNumero(db, projectId){
  const snap = await db.collection(COLLECTION).where('projectId', '==', String(projectId)).get();
  return snap.size + 1;
}

/* Resuelve P.U. real de cada renglon (del APU asociado al concepto, mismo
   criterio que PresupuestoModule.jsx) y descarta renglones cuyo concepto no
   pertenece a este proyecto/usuario -- nunca se factura un concepto ajeno. */
async function resolveConceptos(db, authz, orgContext, projectId, conceptosInput){
  const resolved = [];
  const rejected = [];
  for(const line of (Array.isArray(conceptosInput) ? conceptosInput : [])){
    if(!line?.conceptoId){ rejected.push({ input: line, reason: 'Falta conceptoId.' }); continue; }
    const conceptoSnap = await db.collection('catalogConceptos').doc(String(line.conceptoId)).get();
    if(!conceptoSnap.exists){ rejected.push({ input: line, reason: 'El concepto no existe.' }); continue; }
    const concepto = conceptoSnap.data();
    if(!canAccessOrgScopedDoc(concepto, authz, orgContext)){ rejected.push({ input: line, reason: 'El concepto pertenece a otro usuario.' }); continue; }
    if(String(concepto.projectId) !== String(projectId)){ rejected.push({ input: line, reason: 'El concepto no pertenece a este proyecto.' }); continue; }
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
    resolved.push({ conceptoId: String(line.conceptoId), clave: concepto.clave, concept: concepto.concept, unit: concepto.unit, cantidadPeriodo: Number(line.cantidadPeriodo) || 0, pu });
  }
  return { resolved, rejected };
}

async function handleCreate(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { projectId, periodoDesde, periodoHasta, conceptos, retencionPct, amortizacionPct, deducciones } = req.body || {};
  if(!projectId) throw httpError(400, 'Falta projectId.');
  const db = getAdminDb();

  const { resolved, rejected } = await resolveConceptos(db, authz, orgContext, projectId, conceptos);
  if(!resolved.length) throw httpError(400, `Ningun concepto valido para la estimacion. Motivos: ${JSON.stringify(rejected)}`);

  const numero = await nextNumero(db, projectId);
  const seed = makeEmptyEstimate({ numero, projectId: String(projectId), periodoDesde, periodoHasta, conceptos: resolved, retencionPct, amortizacionPct, deducciones });
  const { valid, errors } = validateEstimate(seed);
  if(!valid) throw httpError(400, `Estimacion invalida: ${errors.join(' ')}`);

  const now = new Date().toISOString();
  const doc = { ...seed, ownerUid: authz.uid, organizationId: orgContext ? orgContext.organizationId : null, createdAt: now, updatedAt: now };
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  await db.runTransaction(async (tx) => {
    tx.set(db.collection(COLLECTION).doc(doc.id), doc);
    appendAudit(tx, auditRef, {
      entryId: doc.id, action: 'ESTIMATE_CREATED', previousStatus: null, newStatus: doc.status,
      actor: authz.uid, actorEmail: authz.email, reason: null, source: 'api',
      projectId: doc.projectId, conceptoId: null, organizationId: doc.organizationId, ownerUid: authz.uid
    });
  });
  res.status(201).json({ estimate: doc, rejected });
}

async function handleSetStatus(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id, status, reason } = req.body || {};
  if(!id || !status) throw httpError(400, 'Faltan id/status.');
  if(!Object.values(ESTIMATE_STATUS).includes(status)) throw httpError(400, `status desconocido: ${status}.`);
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'La estimacion no existe.');
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Esta estimacion pertenece a otro usuario.');
    if(!isLegalEstimateTransition(current.status, status)){
      throw httpError(409, `Transicion de estado no permitida: ${current.status} -> ${status}.`);
    }
    if(status === ESTIMATE_STATUS.AUTORIZADA) assertCanAuthorize(authz, orgContext);
    const now = new Date().toISOString();
    const next = {
      ...current, status, updatedAt: now,
      authorizedBy: status === ESTIMATE_STATUS.AUTORIZADA ? (authz.email || authz.uid) : current.authorizedBy,
      authorizedAt: status === ESTIMATE_STATUS.AUTORIZADA ? now : current.authorizedAt
    };
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'ESTIMATE_STATUS_CHANGED', previousStatus: current.status, newStatus: status,
      actor: authz.uid, actorEmail: authz.email, reason: reason || null, source: 'api',
      projectId: next.projectId, conceptoId: null, organizationId: current.organizationId ?? null, ownerUid: authz.uid
    });
    return next;
  });
  res.status(200).json({ estimate: result });
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
