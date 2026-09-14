/* Project Sentinel (Fase G). Motor de vigilancia proactiva -- NUNCA
   recalcula Project Health/Confidence/Bid Risk/Control Presupuestal desde
   cero cuando ya hay resultados vigentes en esta misma peticion: los
   calcula UNA vez (igual que _route-project-vault.mjs) y los reusa tanto
   para las alertas como para el snapshot de salud. `evaluate` es la unica
   accion que recalcula y persiste (deduplicando por identidad estable,
   ver sentinelDeduplication.js); `list` (GET) es una lectura pura, nunca
   dispara una reevaluacion -- abrir el Sentinel Dashboard nunca crea
   alertas nuevas por si solo. */
import { requireAuth } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { appendAudit } from './_decisionAudit.mjs';
import { loadOrgContext, assertOrgNotExpired, canAccessOrgScopedDoc } from './_orgGuard.mjs';
import { buildProjectLocationSnapshot, hasAnyLocation } from '../../src/domain/geography.js';
import { aggregatePresupuesto } from '../../src/domain/presupuestoAggregation.js';
import { aggregateControlPresupuestal } from '../../src/domain/controlPresupuestalAggregation.js';
import { computeControlPresupuestalAlerts } from '../../src/domain/controlPresupuestalAlerts.js';
import { runProjectConfidence } from '../../src/domain/apuConfidence.js';
import { runProjectBidRisk } from '../../src/domain/bidRisk.js';
import { computeProjectDataQuality } from '../../src/domain/projectDataQuality.js';
import { computeProjectHealth } from '../../src/domain/projectHealth.js';
import { computeExplosionData } from '../../src/domain/explosionData.js';
import { computeResourceOverconsumption } from '../../src/domain/resourceOverconsumption.js';
import { evaluateSentinelRules } from '../../src/domain/sentinelRules.js';
import { reconcileSentinelAlerts } from '../../src/domain/sentinelDeduplication.js';
import { isLegalSentinelAlertTransition } from '../../src/domain/sentinelAlertSchema.js';
import { shouldRecordHealthSnapshot, makeHealthSnapshot, summarizeHealthTrend } from '../../src/domain/projectHealthHistory.js';
import { computeWarrantyStatus } from '../../src/domain/assetComponentSchema.js';
import { calcAPUv2 } from '../../src/lib/apuCalc.js';

const ALERTS_COLLECTION = 'sentinelAlerts';
const ALERTS_AUDIT_COLLECTION = 'sentinelAlertsAudit';
const HEALTH_HISTORY_COLLECTION = 'healthHistory';

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }
function flattenApu(doc){ return { ...(doc.snapshot || {}), id: doc.id, projectId: doc.projectId ?? doc.snapshot?.projectId ?? null }; }

/* Las reglas de sentinelRules.js copian campos crudos de documentos reales
   (ej. changeOrder.impactoEconomico) que en registros mas viejos/sembrados
   a mano pueden no existir -- Firestore rechaza `undefined` en cualquier
   campo (a diferencia de `null`, que si acepta). Se sanitiza UNA vez aqui,
   en el unico punto de escritura, en vez de blindar cada regla individual
   contra el mismo problema. */
function sanitizeForFirestore(value){
  if(value === undefined) return null;
  if(value === null || typeof value !== 'object') return value;
  if(Array.isArray(value)) return value.map(sanitizeForFirestore);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeForFirestore(v)]));
}

async function fetchAll(db, collection, orgFilter, projectId){
  const snap = await orgFilter(db.collection(collection)).where('projectId', '==', String(projectId)).get();
  return snap.docs.map(d => d.data());
}

async function handleList(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  const { projectId } = req.query || {};
  if(!projectId) throw httpError(400, 'Falta projectId.');
  const db = getAdminDb();
  const projectSnap = await db.collection('projects').doc(String(projectId)).get();
  if(!projectSnap.exists) throw httpError(404, 'El proyecto no existe.');
  if(!canAccessOrgScopedDoc(projectSnap.data(), authz, orgContext)) throw httpError(403, 'Este proyecto pertenece a otro usuario.');

  const orgFilter = orgContext
    ? (q) => q.where('organizationId', '==', orgContext.organizationId)
    : (q) => q.where('ownerUid', '==', authz.uid);
  const [alerts, healthHistoryRaw] = await Promise.all([
    fetchAll(db, ALERTS_COLLECTION, orgFilter, projectId),
    fetchAll(db, HEALTH_HISTORY_COLLECTION, orgFilter, projectId)
  ]);
  res.status(200).json({ alerts, healthTrend: summarizeHealthTrend(healthHistoryRaw) });
}

/* EVALUATE: recorre el bundle completo (mismo criterio de fetch en
   paralelo que _route-project-vault.mjs), calcula candidatas
   (sentinelRules.js), reconcilia contra lo YA persistido
   (sentinelDeduplication.js) y escribe en un solo batch. */
async function handleEvaluate(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { projectId } = req.body || {};
  if(!projectId) throw httpError(400, 'Falta projectId.');
  const db = getAdminDb();

  const projectSnap = await db.collection('projects').doc(String(projectId)).get();
  if(!projectSnap.exists) throw httpError(404, 'El proyecto no existe.');
  const project = projectSnap.data();
  if(!canAccessOrgScopedDoc(project, authz, orgContext)) throw httpError(403, 'Este proyecto pertenece a otro usuario.');

  const orgFilter = orgContext
    ? (q) => q.where('organizationId', '==', orgContext.organizationId)
    : (q) => q.where('ownerUid', '==', authz.uid);

  const [
    catalogConceptosRaw, apuDocs, presupuestosList, changeOrders, commitments, progressEntries, estimates, payments,
    planoTakeoffsRaw, evidenceItemsRaw, exportEventsRaw, existingAlerts, healthHistoryRaw, assetSnap
  ] = await Promise.all([
    fetchAll(db, 'catalogConceptos', orgFilter, projectId),
    fetchAll(db, 'apus', orgFilter, projectId),
    fetchAll(db, 'presupuestos', orgFilter, projectId),
    fetchAll(db, 'changeOrders', orgFilter, projectId),
    fetchAll(db, 'commitments', orgFilter, projectId),
    fetchAll(db, 'progressEntries', orgFilter, projectId),
    fetchAll(db, 'estimates', orgFilter, projectId),
    fetchAll(db, 'payments', orgFilter, projectId),
    fetchAll(db, 'planoTakeoffs', orgFilter, projectId),
    fetchAll(db, 'evidenceItems', orgFilter, projectId),
    fetchAll(db, 'exportEvents', orgFilter, projectId),
    fetchAll(db, ALERTS_COLLECTION, orgFilter, projectId),
    fetchAll(db, HEALTH_HISTORY_COLLECTION, orgFilter, projectId),
    db.collection('assets').doc(String(projectId)).get()
  ]);

  const catalogConceptos = catalogConceptosRaw.filter(c => !c.archivedAt);
  const apusFlat = apuDocs.map(flattenApu);
  const apuByConcepto = new Map(apusFlat.map(a => [a.id, a]));
  const presupuesto = presupuestosList.filter(p => !p.archivedAt).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0] || null;

  const presupuestoRows = catalogConceptos.map(c => {
    const apu = c.apuId ? apuByConcepto.get(c.apuId) : null;
    const totals = apu ? (apu.calculated || calcAPUv2(apu)) : null;
    return { conceptoId: c.id, clave: c.clave, capitulo: c.capitulo, concept: c.concept, unit: c.unit, qty: c.qty, apuId: c.apuId || null, pu: totals?.pu ?? 0, direct: totals?.direct ?? 0 };
  });
  const controlPresupuestal = aggregateControlPresupuestal({ presupuestoRows, changeOrders, commitments, progressEntries, estimates, payments });
  const controlPresupuestalAlerts = computeControlPresupuestalAlerts({ aggregation: controlPresupuestal, changeOrders, payments });
  const confidenceProject = apusFlat.length ? runProjectConfidence(apusFlat) : null;
  const bidRiskProject = apusFlat.length ? runProjectBidRisk(apusFlat) : null;

  const documentosCount = evidenceItemsRaw.length + exportEventsRaw.length;
  const responsablesCount = new Set([...changeOrders.map(c => c.approvedBy), ...estimates.map(e => e.authorizedBy)].filter(Boolean)).size;
  const { ubicacionEstructurada } = buildProjectLocationSnapshot(project);
  const dataQuality = computeProjectDataQuality({
    hasUbicacion: hasAnyLocation(ubicacionEstructurada), planosCount: planoTakeoffsRaw.filter(p => !p.archivedAt).length,
    presupuestoHasBaseline: Boolean(presupuesto?.baselineVersion), apusCount: apuDocs.length,
    confidenceProject, avanceCount: progressEntries.length, documentosCount, responsablesCount
  });

  // apuId -> % avance fisico del CONCEPTO que usa ese APU (para
  // resourceOverconsumption.js -- ver el porque en ese archivo).
  const avanceFisicoPctByApuId = new Map();
  controlPresupuestal.rows.forEach(r => {
    const concepto = catalogConceptos.find(c => c.id === r.conceptoId);
    if(concepto?.apuId != null && r.avanceFisicoPct != null) avanceFisicoPctByApuId.set(concepto.apuId, r.avanceFisicoPct);
  });
  const explosionData = apuDocs.length ? computeExplosionData(apuDocs) : { materials: [], labor: [], machinery: { maquinaria: [], equipo: [] } };
  const explosionRows = [...(explosionData.materials || []), ...(explosionData.labor || []), ...(explosionData.machinery?.maquinaria || []), ...(explosionData.machinery?.equipo || [])];
  const overconsumptionRows = computeResourceOverconsumption({ explosionRows, avanceFisicoPctByApuId });

  const health = computeProjectHealth({
    apusFlat, confidenceProject, bidRiskProject, controlPresupuestalTotals: controlPresupuestal.totals,
    controlPresupuestalAlerts, changeOrders, progressEntries, dataQuality, documentosCount
  });

  const sortedHealthHistory = [...healthHistoryRaw].filter(h => h.at).sort((a, b) => new Date(b.at) - new Date(a.at));
  const previousHealthSnapshot = sortedHealthHistory[0] || null;

  let componentsWithWarrantyStatus = [];
  if(assetSnap.exists){
    const asset = assetSnap.data();
    if(canAccessOrgScopedDoc(asset, authz, orgContext)){
      const componentsSnap = await orgFilter(db.collection('assetComponents')).where('assetId', '==', String(projectId)).get();
      componentsWithWarrantyStatus = componentsSnap.docs.map(d => d.data()).filter(c => !c.archivedAt).map(c => ({ ...c, ...computeWarrantyStatus(c) }));
    }
  }

  const candidates = evaluateSentinelRules({
    projectId: String(projectId), controlPresupuestalRows: controlPresupuestal.rows, controlPresupuestalTotals: controlPresupuestal.totals,
    controlPresupuestalAlerts, bidRiskProject, confidenceProject, changeOrders, estimates, payments, dataQuality,
    overconsumptionRows, health, previousHealthSnapshot, componentsWithWarrantyStatus
  });

  const { toCreate, toUpdate, toAutoResolve } = reconcileSentinelAlerts(candidates, existingAlerts);
  const now = new Date().toISOString();
  const organizationId = orgContext ? orgContext.organizationId : null;
  const batch = db.batch();
  [...toCreate, ...toUpdate, ...toAutoResolve].forEach(alert => {
    const docRef = db.collection(ALERTS_COLLECTION).doc(alert.id);
    batch.set(docRef, sanitizeForFirestore({ ...alert, ownerUid: authz.uid, organizationId }));
  });
  toCreate.forEach(a => {
    batch.set(db.collection(ALERTS_AUDIT_COLLECTION).doc(), {
      entryId: a.id, action: 'SENTINEL_ALERT_CREATED', previousStatus: null, newStatus: a.status,
      actor: 'system', actorEmail: authz.email, reason: null, source: 'api',
      projectId: a.projectId, organizationId, ownerUid: authz.uid, timestamp: now
    });
  });
  toAutoResolve.forEach(a => {
    batch.set(db.collection(ALERTS_AUDIT_COLLECTION).doc(), {
      entryId: a.id, action: 'SENTINEL_ALERT_AUTO_RESOLVED', previousStatus: 'NUEVA', newStatus: 'RESUELTA',
      actor: 'system', actorEmail: authz.email, reason: a.resolution, source: 'api',
      projectId: a.projectId, organizationId, ownerUid: authz.uid, timestamp: now
    });
  });

  let healthHistoryEntry = null;
  if(shouldRecordHealthSnapshot(previousHealthSnapshot, health)){
    healthHistoryEntry = { ...makeHealthSnapshot({ projectId: String(projectId), health, at: now }), id: db.collection(HEALTH_HISTORY_COLLECTION).doc().id, ownerUid: authz.uid, organizationId };
    batch.set(db.collection(HEALTH_HISTORY_COLLECTION).doc(healthHistoryEntry.id), sanitizeForFirestore(healthHistoryEntry));
  }

  await batch.commit();

  const unchanged = existingAlerts.filter(a => !toUpdate.some(u => u.identity === a.identity) && !toAutoResolve.some(u => u.identity === a.identity));
  res.status(200).json({
    alerts: [...toCreate, ...toUpdate, ...toAutoResolve, ...unchanged],
    created: toCreate.length, updated: toUpdate.length, autoResolved: toAutoResolve.length,
    health, healthHistoryRecorded: Boolean(healthHistoryEntry)
  });
}

async function handleSetStatus(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id, status, comment } = req.body || {};
  if(!id || !status) throw httpError(400, 'Faltan id/status.');
  const db = getAdminDb();
  const docRef = db.collection(ALERTS_COLLECTION).doc(String(id));
  const auditRef = db.collection(ALERTS_AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'La alerta no existe.');
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Esta alerta pertenece a otro usuario.');
    if(!isLegalSentinelAlertTransition(current.status, status)) throw httpError(409, `Transicion de estado no permitida: ${current.status} -> ${status}.`);
    const now = new Date().toISOString();
    const isResolving = status === 'RESUELTA' || status === 'DESCARTADA';
    const next = {
      ...current, status, updatedAt: now, comment: comment ?? current.comment,
      resolvedAt: isResolving ? now : current.resolvedAt,
      resolvedBy: isResolving ? (authz.email || authz.uid) : current.resolvedBy,
      resolution: isResolving ? (comment || (status === 'RESUELTA' ? 'Resuelta manualmente.' : 'Descartada manualmente.')) : current.resolution
    };
    tx.set(docRef, sanitizeForFirestore(next));
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'SENTINEL_ALERT_STATUS_CHANGED', previousStatus: current.status, newStatus: status,
      actor: authz.uid, actorEmail: authz.email, reason: comment || null, source: 'api',
      projectId: next.projectId, organizationId: current.organizationId ?? null, ownerUid: authz.uid
    });
    return next;
  });
  res.status(200).json({ alert: result });
}

const ACTIONS = { evaluate: handleEvaluate, 'set-status': handleSetStatus };

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
