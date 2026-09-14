/* Project Vault (Fase F): agregador SERVER-SIDE de solo lectura. Une, en
   UNA sola respuesta, lo que hoy vive repartido en ~20 colecciones YA
   existentes (proyecto, catalogo, APUs, presupuesto, Control Presupuestal
   completo de Fase E, planos, evidencia, exportaciones y sus auditorias) --
   NUNCA copia esos datos a una coleccion nueva, solo los lee, agrega y
   consolida en memoria en cada peticion (seccion 14 del pedido: evitar 15
   llamadas seriales desde React; consultas en paralelo via Promise.all,
   un solo round-trip HTTP).

   Reusa SIN reimplementar: aggregatePresupuesto (Fase D),
   aggregateControlPresupuestal/computeControlPresupuestalAlerts (Fase E),
   runProjectConfidence/runProjectBidRisk/computeBidReadiness (motores YA
   existentes, nunca duplicados), y los modulos puros nuevos de esta fase
   (projectDataQuality, projectHealth, projectVaultAlerts,
   projectVaultTimeline, projectVaultBaselineComparison).

   Ninguna llamada a OpenAI/Price Intelligence ocurre aqui -- todas las
   funciones que este route invoca son PURAS sobre datos ya persistidos,
   nunca disparan una peticion a un proveedor externo (auditado antes de
   escribir este archivo). */
import { requireAuth } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { loadOrgContext, canAccessOrgScopedDoc } from './_orgGuard.mjs';
import { buildProjectLocationSnapshot, hasAnyLocation } from '../../src/domain/geography.js';
import { aggregatePresupuesto } from '../../src/domain/presupuestoAggregation.js';
import { aggregateControlPresupuestal } from '../../src/domain/controlPresupuestalAggregation.js';
import { computeControlPresupuestalAlerts } from '../../src/domain/controlPresupuestalAlerts.js';
import { runProjectConfidence } from '../../src/domain/apuConfidence.js';
import { runProjectBidRisk } from '../../src/domain/bidRisk.js';
import { computeBidReadiness } from '../../src/domain/bidReadiness.js';
import { computeProjectDataQuality } from '../../src/domain/projectDataQuality.js';
import { computeProjectHealth } from '../../src/domain/projectHealth.js';
import { consolidateProjectVaultAlerts } from '../../src/domain/projectVaultAlerts.js';
import { buildProjectVaultTimeline } from '../../src/domain/projectVaultTimeline.js';
import { compareBaselineVsActual } from '../../src/domain/projectVaultBaselineComparison.js';
import { calcAPUv2 } from '../../src/lib/apuCalc.js';

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }

function flattenApu(doc){
  return { ...(doc.snapshot || {}), id: doc.id, projectId: doc.projectId ?? doc.snapshot?.projectId ?? null };
}

function tsToIso(v){
  if(!v) return null;
  if(typeof v.toDate === 'function') return v.toDate().toISOString();
  if(typeof v === 'string') return v;
  return null;
}

function latestByUpdatedAt(list){
  return (list || []).slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0] || null;
}

async function fetchAll(db, collection, orgFilter, projectId){
  const snap = await orgFilter(db.collection(collection)).where('projectId', '==', String(projectId)).get();
  return snap.docs.map(d => d.data());
}

/* Cada registro de auditoria/ledger se normaliza a un shape comun ANTES de
   entrar a projectVaultTimeline.js (dominio puro, nunca conoce Firestore
   Timestamp) -- ver el comentario de ese archivo. */
function auditToTimelineRecords(records, source){
  return (records || []).map(r => ({
    source, action: r.action, previousStatus: r.previousStatus ?? null, newStatus: r.newStatus ?? null,
    at: tsToIso(r.timestamp), actor: r.actorEmail || r.actor || null,
    meta: { folio: r.folio || null }
  }));
}

async function handleGet(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  const { projectId } = req.query || {};
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
    planoTakeoffsRaw, evidenceItemsRaw, exportEventsRaw, constructionDnaPointerSnap,
    apuAudit, projectAudit, planoTakeoffAudit, presupuestoAudit, changeOrdersAudit, catalogConceptosAudit, estimatesAudit, commitmentsAudit
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
    db.collection('constructionDna').doc(String(projectId)).get(),
    fetchAll(db, 'apuAudit', orgFilter, projectId),
    fetchAll(db, 'projectAudit', orgFilter, projectId),
    fetchAll(db, 'planoTakeoffAudit', orgFilter, projectId),
    fetchAll(db, 'presupuestoAudit', orgFilter, projectId),
    fetchAll(db, 'changeOrdersAudit', orgFilter, projectId),
    fetchAll(db, 'catalogConceptosAudit', orgFilter, projectId),
    fetchAll(db, 'estimatesAudit', orgFilter, projectId),
    fetchAll(db, 'commitmentsAudit', orgFilter, projectId)
  ]);

  const catalogConceptos = catalogConceptosRaw.filter(c => !c.archivedAt);
  const planoTakeoffs = planoTakeoffsRaw.filter(p => !p.archivedAt);
  const apusFlat = apuDocs.map(flattenApu);
  const apuByConcepto = new Map(apusFlat.map(a => [a.id, a]));
  const presupuesto = latestByUpdatedAt(presupuestosList.filter(p => !p.archivedAt));

  const presupuestoRows = catalogConceptos.map(c => {
    const apu = c.apuId ? apuByConcepto.get(c.apuId) : null;
    const totals = apu ? (apu.calculated || calcAPUv2(apu)) : null;
    return { conceptoId: c.id, clave: c.clave, capitulo: c.capitulo, concept: c.concept, unit: c.unit, qty: c.qty, apuId: c.apuId || null, pu: totals?.pu ?? 0, direct: totals?.direct ?? 0 };
  });

  const controlPresupuestal = aggregateControlPresupuestal({ presupuestoRows, changeOrders, commitments, progressEntries, estimates, payments });
  const controlPresupuestalAlerts = computeControlPresupuestalAlerts({ aggregation: controlPresupuestal, changeOrders, payments });
  const confidenceProject = apusFlat.length ? runProjectConfidence(apusFlat) : null;
  const bidRiskProject = apusFlat.length ? runProjectBidRisk(apusFlat) : null;
  const bidReadiness = computeBidReadiness(apusFlat, { riskProject: bidRiskProject, confidenceProject });

  const documentosCount = evidenceItemsRaw.length + exportEventsRaw.length;
  const responsablesCount = new Set([...changeOrders.map(c => c.approvedBy), ...estimates.map(e => e.authorizedBy)].filter(Boolean)).size;
  const { ubicacionEstructurada } = buildProjectLocationSnapshot(project);

  const dataQuality = computeProjectDataQuality({
    hasUbicacion: hasAnyLocation(ubicacionEstructurada), planosCount: planoTakeoffs.length,
    presupuestoHasBaseline: Boolean(presupuesto?.baselineVersion), apusCount: apuDocs.length,
    confidenceProject, avanceCount: progressEntries.length, documentosCount, responsablesCount
  });

  const health = computeProjectHealth({
    apusFlat, confidenceProject, bidRiskProject, controlPresupuestalTotals: controlPresupuestal.totals,
    controlPresupuestalAlerts, changeOrders, progressEntries, dataQuality, documentosCount
  });

  const vaultAlerts = consolidateProjectVaultAlerts({ controlPresupuestalAlerts, bidRiskProject, confidenceProject });
  const baselineComparison = compareBaselineVsActual({ presupuesto, controlPresupuestalTotals: controlPresupuestal.totals, controlPresupuestalRows: controlPresupuestal.rows, changeOrders });

  const timelineRecords = [
    ...auditToTimelineRecords(projectAudit, 'PROYECTO'),
    ...auditToTimelineRecords(planoTakeoffAudit, 'PLANO'),
    ...auditToTimelineRecords(catalogConceptosAudit, 'CATALOGO'),
    ...auditToTimelineRecords(apuAudit, 'APU'),
    ...auditToTimelineRecords(presupuestoAudit, 'PRESUPUESTO'),
    ...auditToTimelineRecords(changeOrdersAudit, 'ORDEN_CAMBIO'),
    ...auditToTimelineRecords(commitmentsAudit, 'COMPROMISO'),
    ...auditToTimelineRecords(estimatesAudit, 'ESTIMACION'),
    ...progressEntries.map(p => ({ source: 'AVANCE', action: 'PROGRESS_ENTRY_CREATED', at: p.fecha || p.createdAt || null, actor: p.usuario || null, meta: { motivo: p.motivo || null } })),
    ...payments.map(p => ({ source: 'PAGO', action: 'PAYMENT_CREATED', at: p.fecha || p.createdAt || null, actor: p.usuario || null, meta: { proveedor: p.proveedor || null } })),
    ...exportEventsRaw.map(e => ({ source: 'EXPORTACION', action: 'EXPORT_EVENT', at: tsToIso(e.timestamp) || e.createdAt || null, actor: e.actorEmail || null, meta: { scope: e.scope || null, format: e.format || null } }))
  ];
  const timeline = buildProjectVaultTimeline(timelineRecords, { limit: 50 });

  const lastUpdatedFor = (source) => timelineRecords.filter(r => r.source === source && r.at).sort((a, b) => new Date(b.at) - new Date(a.at))[0] || null;

  // "Cuantificacion" y "Catalogo" leen la MISMA fuente (catalogConceptos) --
  // no existe una coleccion de cuantificacion separada en este codebase
  // (auditado antes de esta fase): un concepto de catalogo YA lleva su
  // cantidad cuantificada. Se presentan como 2 lentes sobre el mismo dato
  // real, nunca como 2 fuentes distintas.
  const catalogoUpdate = lastUpdatedFor('CATALOGO');
  const apuUpdate = lastUpdatedFor('APU');
  const planoUpdate = lastUpdatedFor('PLANO');
  const presupuestoUpdate = lastUpdatedFor('PRESUPUESTO');

  const sections = [
    { key: 'planos', label: 'Planos', count: planoTakeoffs.length, lastUpdatedAt: planoUpdate?.at || null, lastUpdatedBy: planoUpdate?.actor || null, status: planoTakeoffs.length ? 'CON_DATOS' : 'SIN_DATOS', alertsCount: 0 },
    { key: 'evidencia', label: 'Evidencia', count: evidenceItemsRaw.length, lastUpdatedAt: null, lastUpdatedBy: null, status: evidenceItemsRaw.length ? 'CON_DATOS' : 'SIN_DATOS', alertsCount: 0 },
    { key: 'modelos3d', label: 'Modelos 3D', count: 0, lastUpdatedAt: null, lastUpdatedBy: null, status: 'SIN_DATOS', alertsCount: 0, note: 'ZOEMEC todavia no persiste modelos 3D vinculados al proyecto.' },
    { key: 'cuantificacion', label: 'Cuantificación', count: catalogConceptos.filter(c => Number(c.qty) > 0).length, lastUpdatedAt: catalogoUpdate?.at || null, lastUpdatedBy: catalogoUpdate?.actor || null, status: catalogConceptos.length ? 'CON_DATOS' : 'SIN_DATOS', alertsCount: 0 },
    { key: 'catalogo', label: 'Catálogo', count: catalogConceptos.length, lastUpdatedAt: catalogoUpdate?.at || null, lastUpdatedBy: catalogoUpdate?.actor || null, status: catalogConceptos.length ? 'CON_DATOS' : 'SIN_DATOS', alertsCount: 0 },
    { key: 'apu', label: 'APU', count: apuDocs.length, lastUpdatedAt: apuUpdate?.at || null, lastUpdatedBy: apuUpdate?.actor || null, status: apuDocs.length ? 'CON_DATOS' : 'SIN_DATOS', alertsCount: vaultAlerts.filter(a => a.apuId).length },
    { key: 'presupuesto', label: 'Presupuesto', count: presupuesto ? 1 : 0, lastUpdatedAt: presupuestoUpdate?.at || presupuesto?.updatedAt || null, lastUpdatedBy: presupuestoUpdate?.actor || null, status: presupuesto ? (presupuesto.baselineVersion ? 'BASELINE_APROBADO' : 'SIN_BASELINE') : 'SIN_DATOS', alertsCount: 0 },
    { key: 'explosiones', label: 'Explosiones', count: apuDocs.length, lastUpdatedAt: apuUpdate?.at || null, lastUpdatedBy: apuUpdate?.actor || null, status: apuDocs.length ? 'CON_DATOS' : 'SIN_DATOS', alertsCount: 0, note: 'Se calcula bajo demanda a partir de los APUs -- no tiene almacenamiento propio.' },
    { key: 'controlPresupuestal', label: 'Control Presupuestal', count: changeOrders.length + commitments.length + progressEntries.length + estimates.length + payments.length, lastUpdatedAt: presupuesto?.baselineVersion ? (presupuestoUpdate?.at || null) : null, lastUpdatedBy: null, status: presupuesto?.baselineVersion ? 'CON_DATOS' : 'SIN_BASELINE', alertsCount: controlPresupuestalAlerts.length },
    { key: 'ordenesCambio', label: 'Órdenes de cambio', count: changeOrders.length, lastUpdatedAt: lastUpdatedFor('ORDEN_CAMBIO')?.at || null, lastUpdatedBy: lastUpdatedFor('ORDEN_CAMBIO')?.actor || null, status: changeOrders.length ? 'CON_DATOS' : 'SIN_DATOS', alertsCount: changeOrders.filter(c => c.status === 'EN_REVISION').length },
    { key: 'avance', label: 'Avance', count: progressEntries.length, lastUpdatedAt: lastUpdatedFor('AVANCE')?.at || null, lastUpdatedBy: lastUpdatedFor('AVANCE')?.actor || null, status: progressEntries.length ? 'CON_DATOS' : 'SIN_DATOS', alertsCount: progressEntries.filter(p => p.hasWarning).length },
    { key: 'estimaciones', label: 'Estimaciones', count: estimates.length, lastUpdatedAt: lastUpdatedFor('ESTIMACION')?.at || null, lastUpdatedBy: lastUpdatedFor('ESTIMACION')?.actor || null, status: estimates.length ? 'CON_DATOS' : 'SIN_DATOS', alertsCount: 0 },
    { key: 'pagos', label: 'Pagos', count: payments.length, lastUpdatedAt: lastUpdatedFor('PAGO')?.at || null, lastUpdatedBy: lastUpdatedFor('PAGO')?.actor || null, status: payments.length ? 'CON_DATOS' : 'SIN_DATOS', alertsCount: payments.filter(p => p.exceedsEstimate).length },
    { key: 'documentos', label: 'Documentos', count: documentosCount, lastUpdatedAt: lastUpdatedFor('EXPORTACION')?.at || null, lastUpdatedBy: lastUpdatedFor('EXPORTACION')?.actor || null, status: documentosCount ? 'CON_DATOS' : 'SIN_DATOS', alertsCount: 0 },
    { key: 'riesgos', label: 'Riesgos', count: vaultAlerts.length, lastUpdatedAt: null, lastUpdatedBy: null, status: vaultAlerts.some(a => a.priority === 'CRITICA') ? 'CRITICO' : (vaultAlerts.length ? 'ATENCION' : 'SALUDABLE'), alertsCount: vaultAlerts.length },
    { key: 'auditoria', label: 'Auditoría', count: timelineRecords.length, lastUpdatedAt: timeline[0]?.at || null, lastUpdatedBy: timeline[0]?.actor || null, status: timelineRecords.length ? 'CON_DATOS' : 'SIN_DATOS', alertsCount: 0 }
  ];

  const resumenEjecutivo = {
    name: project.name || null, client: project.client || null, ubicacion: project.ubicacion || null,
    tipoDeObra: null, etapa: project.status || null, fechaInicio: null, fechaObjetivo: null, superficie: null,
    presupuestoBaseline: controlPresupuestal.totals.baseline || null,
    presupuestoVigente: controlPresupuestal.totals.vigente || null,
    ejecutado: controlPresupuestal.totals.ejecutado || null,
    pagado: controlPresupuestal.totals.pagado || null,
    forecast: controlPresupuestal.totals.eac || null,
    avanceFisicoPct: controlPresupuestal.totals.avanceFisicoPct,
    avanceFinancieroPct: controlPresupuestal.totals.avanceFinancieroPct,
    confidence: confidenceProject ? { averageScore: confidenceProject.averageScore, high: confidenceProject.high, medium: confidenceProject.medium, low: confidenceProject.low, insufficientEvidence: confidenceProject.insufficientEvidence } : null,
    bidRisk: bidRiskProject ? { critical: bidRiskProject.critical, high: bidRiskProject.high, medium: bidRiskProject.medium, low: bidRiskProject.low, estimatedExposure: bidRiskProject.estimatedExposure } : null,
    bidReadiness: { score: bidReadiness.score, status: bidReadiness.status },
    health: { score: health.score, level: health.level, label: health.label }
  };

  res.status(200).json({
    project: { id: project.id, name: project.name, client: project.client, ubicacion: project.ubicacion, status: project.status, moneda: project.moneda },
    resumenEjecutivo, health, dataQuality, alerts: vaultAlerts, timeline, baselineComparison, sections,
    constructionDna: constructionDnaPointerSnap.exists ? constructionDnaPointerSnap.data() : null,
    bidReadiness
  });
}

export default async function handler(req, res){
  try{
    if(req.method !== 'GET'){ res.status(405).json({ error: 'Metodo no permitido.' }); return; }
    await handleGet(req, res);
  }catch(err){
    const body = { error: err.message || 'No se pudo completar la solicitud.' };
    if(err.code) body.code = err.code;
    res.status(err.status || 400).json(body);
  }
}
