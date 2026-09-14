/* Ciclo de vida del activo (Fase G, secciones 11-16). Un `asset` solo se
   crea cuando el proyecto se marca como terminado/entregado
   (action=create-from-project) -- nunca duplica los datos del proyecto,
   solo lo referencia (`projectId`) junto con la version de Construction
   DNA vigente en ese momento. CapEx (capexProjection.js) y el plan de
   renovacion (renewalPlan.js) se calculan EN VIVO sobre los componentes ya
   guardados en cada GET -- no tienen almacenamiento propio, para no
   duplicar un calculo que ya es barato y puro. */
import { requireAuth } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { appendAudit } from './_decisionAudit.mjs';
import { loadOrgContext, assertOrgNotExpired, canAccessOrgScopedDoc } from './_orgGuard.mjs';
import { makeEmptyAsset, validateAsset } from '../../src/domain/assetSchema.js';
import { makeEmptyAssetComponent, validateAssetComponent, computeWarrantyStatus } from '../../src/domain/assetComponentSchema.js';
import { computeCapexProjection } from '../../src/domain/capexProjection.js';
import { buildRenewalPlan } from '../../src/domain/renewalPlan.js';
import { buildComponentTraceability } from '../../src/domain/assetTraceability.js';

const ASSETS_COLLECTION = 'assets';
const COMPONENTS_COLLECTION = 'assetComponents';
const ASSETS_AUDIT_COLLECTION = 'assetsAudit';
const COMPONENTS_AUDIT_COLLECTION = 'assetComponentsAudit';

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }

async function handleGet(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  const { projectId, inflationRatePctPerYear } = req.query || {};
  if(!projectId) throw httpError(400, 'Falta projectId.');
  const db = getAdminDb();
  const assetSnap = await db.collection(ASSETS_COLLECTION).doc(String(projectId)).get();
  if(!assetSnap.exists){ res.status(200).json({ asset: null, components: [], capex: [], renewalPlan: null }); return; }
  const asset = assetSnap.data();
  if(!canAccessOrgScopedDoc(asset, authz, orgContext)) throw httpError(403, 'Este activo pertenece a otro usuario.');

  const orgFilter = orgContext
    ? (q) => q.where('organizationId', '==', orgContext.organizationId)
    : (q) => q.where('ownerUid', '==', authz.uid);
  const componentsSnap = await orgFilter(db.collection(COMPONENTS_COLLECTION)).where('assetId', '==', String(projectId)).get();
  const components = componentsSnap.docs.map(d => d.data()).filter(c => !c.archivedAt).map(c => ({ ...c, ...computeWarrantyStatus(c) }));

  const rate = inflationRatePctPerYear != null && inflationRatePctPerYear !== '' ? Number(inflationRatePctPerYear) : null;
  const capex = computeCapexProjection(components.map(c => ({ id: c.id, nombre: c.nombre, fechaInstalacion: c.fechaInstalacion, vidaUtilAnios: c.vidaUtilAnios, costo: c.costo })), { inflationRatePctPerYear: rate });
  const renewalPlan = buildRenewalPlan(capex);

  res.status(200).json({ asset, components, capex, renewalPlan });
}

/* CREATE-FROM-PROJECT: el proyecto se marca como terminado como EFECTO de
   esta accion (status='Entregado' + fechaEntrega) -- es la unica forma de
   marcar un proyecto como terminado en esta fase, para que un `asset`
   nunca exista sin que el proyecto tambien refleje su entrega. Idempotente
   por id=projectId (reintento no duplica, mismo criterio que
   _route-presupuestos.mjs#handleCreate). */
async function handleCreateFromProject(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { projectId, nombre, ubicacion, superficie } = req.body || {};
  if(!projectId) throw httpError(400, 'Falta projectId.');
  const db = getAdminDb();
  const projectRef = db.collection('projects').doc(String(projectId));
  const assetRef = db.collection(ASSETS_COLLECTION).doc(String(projectId));
  const dnaSnap = await db.collection('constructionDna').doc(String(projectId)).get();
  const constructionDnaVersion = dnaSnap.exists ? dnaSnap.data().currentVersion : null;
  const auditRef = db.collection(ASSETS_AUDIT_COLLECTION).doc();
  const organizationId = orgContext ? orgContext.organizationId : null;

  const result = await db.runTransaction(async (tx) => {
    const [projectSnap, assetSnap] = await Promise.all([tx.get(projectRef), tx.get(assetRef)]);
    if(!projectSnap.exists) throw httpError(404, 'El proyecto no existe.');
    const project = projectSnap.data();
    if(!canAccessOrgScopedDoc(project, authz, orgContext)) throw httpError(403, 'Este proyecto pertenece a otro usuario.');
    if(assetSnap.exists){
      if(!canAccessOrgScopedDoc(assetSnap.data(), authz, orgContext)) throw httpError(409, 'Ya existe un activo para este proyecto perteneciente a otro usuario.');
      return { asset: assetSnap.data(), created: false };
    }
    const now = new Date().toISOString();
    const seed = makeEmptyAsset({
      id: String(projectId), projectId: String(projectId),
      nombre: nombre || project.name, ubicacion: ubicacion || project.ubicacion || null,
      fechaEntrega: now, superficie: superficie ?? null, constructionDnaVersion
    });
    const { valid, errors } = validateAsset(seed);
    if(!valid) throw httpError(400, `Activo invalido: ${errors.join(' ')}`);
    const assetDoc = { ...seed, ownerUid: authz.uid, organizationId, createdAt: now, updatedAt: now };
    tx.set(assetRef, assetDoc);
    tx.set(projectRef, { ...project, status: 'Entregado', fechaEntrega: now, updatedAt: now });
    appendAudit(tx, auditRef, {
      entryId: assetDoc.id, action: 'ASSET_CREATED_FROM_PROJECT', previousStatus: null, newStatus: 'ACTIVO',
      actor: authz.uid, actorEmail: authz.email, reason: null, source: 'api',
      projectId: assetDoc.projectId, organizationId, ownerUid: authz.uid
    });
    return { asset: assetDoc, created: true };
  });
  res.status(result.created ? 201 : 200).json(result);
}

async function handleAddComponent(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { assetId, tipo, nombre, fechaInstalacion, fabricante, modelo, proveedor, garantiaMeses, garantiaVigenciaHasta, vidaUtilAnios, costo, documentoGarantiaUrl, trazabilidad } = req.body || {};
  if(!assetId) throw httpError(400, 'Falta assetId.');
  const db = getAdminDb();
  const assetSnap = await db.collection(ASSETS_COLLECTION).doc(String(assetId)).get();
  if(!assetSnap.exists) throw httpError(404, 'El activo no existe.');
  const asset = assetSnap.data();
  if(!canAccessOrgScopedDoc(asset, authz, orgContext)) throw httpError(403, 'Este activo pertenece a otro usuario.');

  const seed = makeEmptyAssetComponent({
    assetId: String(assetId), projectId: asset.projectId, tipo, nombre, fechaInstalacion, fabricante, modelo,
    proveedor, garantiaMeses, garantiaVigenciaHasta, vidaUtilAnios, costo, documentoGarantiaUrl, trazabilidad
  });
  const { valid, errors } = validateAssetComponent(seed);
  if(!valid) throw httpError(400, `Componente invalido: ${errors.join(' ')}`);

  const docRef = db.collection(COMPONENTS_COLLECTION).doc();
  const now = new Date().toISOString();
  const organizationId = orgContext ? orgContext.organizationId : null;
  const doc = { ...seed, id: docRef.id, ownerUid: authz.uid, organizationId, createdAt: now, updatedAt: now };
  const auditRef = db.collection(COMPONENTS_AUDIT_COLLECTION).doc();
  await db.runTransaction(async (tx) => {
    tx.set(docRef, doc);
    appendAudit(tx, auditRef, {
      entryId: doc.id, action: 'ASSET_COMPONENT_CREATED', previousStatus: null, newStatus: null,
      actor: authz.uid, actorEmail: authz.email, reason: null, source: 'api',
      projectId: asset.projectId, organizationId, ownerUid: authz.uid
    });
  });
  res.status(201).json({ component: { ...doc, ...computeWarrantyStatus(doc) } });
}

/* TRACEABILITY (seccion 17): resuelve la cadena Activo -> Componente ->
   Construction DNA -> APU -> Concepto -> Proyecto para UN componente,
   siguiendo `trazabilidad` (capturada al registrar el componente, ver
   handleAddComponent). Si el componente no trae trazabilidad, la cadena
   simplemente es mas corta -- nunca se inventa un eslabon. */
async function handleTraceability(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  const { componentId } = req.query || {};
  if(!componentId) throw httpError(400, 'Falta componentId.');
  const db = getAdminDb();
  const componentSnap = await db.collection(COMPONENTS_COLLECTION).doc(String(componentId)).get();
  if(!componentSnap.exists) throw httpError(404, 'El componente no existe.');
  const component = componentSnap.data();
  if(!canAccessOrgScopedDoc(component, authz, orgContext)) throw httpError(403, 'Este componente pertenece a otro usuario.');

  const [assetSnap, apuSnap, conceptoSnap, projectSnap, dnaVersionSnap] = await Promise.all([
    db.collection(ASSETS_COLLECTION).doc(String(component.assetId)).get(),
    component.trazabilidad?.apuId ? db.collection('apus').doc(String(component.trazabilidad.apuId)).get() : null,
    component.trazabilidad?.conceptoId ? db.collection('catalogConceptos').doc(String(component.trazabilidad.conceptoId)).get() : null,
    component.projectId ? db.collection('projects').doc(String(component.projectId)).get() : null,
    component.trazabilidad?.constructionDnaVersion
      ? db.collection('constructionDnaVersions').doc(`${String(component.projectId).replace(/[^a-zA-Z0-9_-]/g, '_')}__${component.trazabilidad.constructionDnaVersion}`).get()
      : null
  ]);
  const chain = buildComponentTraceability(component, {
    asset: assetSnap.exists ? assetSnap.data() : null,
    constructionDnaVersion: dnaVersionSnap?.exists ? dnaVersionSnap.data() : null,
    apu: apuSnap?.exists ? { ...apuSnap.data().snapshot, id: apuSnap.id } : null,
    concepto: conceptoSnap?.exists ? conceptoSnap.data() : null,
    project: projectSnap?.exists ? projectSnap.data() : null
  });
  res.status(200).json({ chain });
}

const ACTIONS = { 'create-from-project': handleCreateFromProject, 'add-component': handleAddComponent };

export default async function handler(req, res){
  try{
    if(req.method === 'GET'){
      if(req.query?.componentId){ await handleTraceability(req, res); return; }
      await handleGet(req, res);
      return;
    }
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
