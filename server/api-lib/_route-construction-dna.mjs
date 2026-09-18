/* Construction DNA (Fase F, Project Vault): snapshot ESTRUCTURADO y
   versionado del proyecto, derivado en el servidor de datos que YA existen
   (catalogo, presupuesto agregado, explosion, Confidence Engine) -- ver
   src/domain/constructionDnaDerivation.js para la logica de derivacion
   pura y src/domain/constructionDnaVersioning.js para el versionado
   (mismo patron que _route-presupuestos.mjs: documento puntero actual +
   coleccion de versiones inmutable + auditoria append-only), salvo que
   aqui el id del documento puntero ES el projectId directamente -- un DNA
   es 1:1 con su proyecto (nunca varios DNA paralelos como si podria haber
   varios presupuestos historicos), asi que no hace falta un id generado
   aparte. */
import { requireAuth } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { appendAudit } from './_decisionAudit.mjs';
import { loadOrgContext, assertOrgNotExpired, canAccessOrgScopedDoc } from './_orgGuard.mjs';
import { createConstructionDnaVersion } from '../../src/domain/constructionDnaVersioning.js';
import { deriveConstructionDna } from '../../src/domain/constructionDnaDerivation.js';
import { aggregatePresupuesto } from '../../src/domain/presupuestoAggregation.js';
import { computeExplosionData } from '../../src/domain/explosionData.js';
import { runProjectConfidence } from '../../src/domain/apuConfidence.js';
import { buildProjectLocationSnapshot } from '../../src/domain/geography.js';
import { calcAPUv2 } from '../../src/lib/apuCalc.js';

const POINTER_COLLECTION = 'constructionDna';
const VERSIONS_COLLECTION = 'constructionDnaVersions';
const AUDIT_COLLECTION = 'constructionDnaAudit';

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }
function versionDocId(projectId, version){ return `${String(projectId).replace(/[^a-zA-Z0-9_-]/g, '_')}__${String(version)}`; }

// El contenido real del APU (materials/labor/calculated) vive en
// `apus/{id}.snapshot` -- mismo criterio que PresupuestoModule.jsx y las
// rutas de Fase E, nunca al nivel del documento envoltorio.
function flattenApu(doc){
  return { ...(doc.snapshot || {}), id: doc.id, projectId: doc.projectId ?? doc.snapshot?.projectId ?? null };
}

async function handleGet(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  const { projectId } = req.query || {};
  if(!projectId) throw httpError(400, 'Falta projectId.');
  const db = getAdminDb();
  const pointerSnap = await db.collection(POINTER_COLLECTION).doc(String(projectId)).get();
  if(!pointerSnap.exists){ res.status(200).json({ constructionDna: null, versions: [] }); return; }
  const pointer = pointerSnap.data();
  if(!canAccessOrgScopedDoc(pointer, authz, orgContext)) throw httpError(403, 'El Construction DNA de este proyecto pertenece a otro usuario.');
  const versionsSnap = await db.collection(VERSIONS_COLLECTION).where('projectId', '==', String(projectId)).get();
  const versions = versionsSnap.docs.map(d => d.data()).sort((a, b) => Number(a.version.replace(/\D/g, '')) - Number(b.version.replace(/\D/g, '')));
  res.status(200).json({ constructionDna: pointer, versions });
}

/* GENERATE: recalcula el DNA a partir de datos reales y guarda una version
   NUEVA (nunca sobreescribe la anterior). Todo el fetch es de solo lectura
   fuera de la transaccion (no hay forma de que una lectura larga bloquee
   escrituras de otros usuarios); la transaccion solo decide el numero de
   version siguiente y hace las 2 escrituras (puntero + version) de forma
   atomica con su auditoria. */
async function handleGenerate(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { projectId, reason } = req.body || {};
  if(!projectId) throw httpError(400, 'Falta projectId.');
  const db = getAdminDb();

  const projectSnap = await db.collection('projects').doc(String(projectId)).get();
  if(!projectSnap.exists) throw httpError(404, 'El proyecto no existe.');
  const project = projectSnap.data();
  if(!canAccessOrgScopedDoc(project, authz, orgContext)) throw httpError(403, 'Este proyecto pertenece a otro usuario.');

  const orgFilter = orgContext
    ? (q) => q.where('organizationId', '==', orgContext.organizationId)
    : (q) => q.where('ownerUid', '==', authz.uid);

  const [catalogSnap, apusSnap] = await Promise.all([
    orgFilter(db.collection('catalogConceptos')).where('projectId', '==', String(projectId)).get(),
    orgFilter(db.collection('apus')).where('projectId', '==', String(projectId)).get()
  ]);
  const catalogConceptos = catalogSnap.docs.map(d => d.data()).filter(c => !c.archivedAt);
  const apuDocs = apusSnap.docs.map(d => d.data());
  const apusFlat = apuDocs.map(flattenApu);
  const apuByConcepto = new Map(apusFlat.map(a => [a.id, a]));

  const presupuestoRows = catalogConceptos.map(c => {
    const apu = c.apuId ? apuByConcepto.get(c.apuId) : null;
    const totals = apu ? (apu.calculated || calcAPUv2(apu)) : null;
    return { conceptoId: c.id, clave: c.clave, capitulo: c.capitulo, concept: c.concept, unit: c.unit, qty: c.qty, apuId: c.apuId || null, pu: totals?.pu ?? 0, direct: totals?.direct ?? 0 };
  });
  const { capituloSubtotals } = aggregatePresupuesto(presupuestoRows);
  const explosionData = apuDocs.length ? computeExplosionData(apuDocs) : null;
  const confidenceProject = apusFlat.length ? runProjectConfidence(apusFlat) : null;
  const { ubicacionEstructurada } = buildProjectLocationSnapshot(project);

  const draftDna = deriveConstructionDna({
    projectId: String(projectId), catalogConceptos, capituloSubtotals, explosionData,
    ubicacionEstructurada, confidenceProject
  });

  const pointerRef = db.collection(POINTER_COLLECTION).doc(String(projectId));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const organizationId = orgContext ? orgContext.organizationId : null;
  const now = new Date().toISOString();

  const pointerSnap = await pointerRef.get();
  let previousVersionSnapshot = [];
  if(pointerSnap.exists){
    const pointer = pointerSnap.data();
    const lastVersionSnap = await db.collection(VERSIONS_COLLECTION).doc(versionDocId(projectId, pointer.currentVersion)).get();
    if(lastVersionSnap.exists){
      const lastVersion = lastVersionSnap.data();
      previousVersionSnapshot = [{ version: lastVersion.version, snapshot: lastVersion.snapshot }];
    }
  }

  const built = await createConstructionDnaVersion(draftDna, previousVersionSnapshot, {
    user: authz.email || authz.uid, reason: reason || 'Snapshot generado desde datos del proyecto',
    sources: ['catalogo', 'presupuesto', 'explosion', 'confidence'], engineVersion: 'construction-dna-v1'
  });
  const entry = built.entry;
  const versionDoc = { ...entry, id: versionDocId(projectId, entry.version), projectId: String(projectId), ownerUid: authz.uid, organizationId, createdAt: now };
  const pointerDoc = {
    id: String(projectId), projectId: String(projectId), ownerUid: authz.uid, organizationId,
    currentVersion: entry.version, snapshot: entry.snapshot,
    createdAt: pointerSnap.exists ? pointerSnap.data().createdAt : now, updatedAt: now
  };

  await db.runTransaction(async (tx) => {
    tx.set(pointerRef, pointerDoc);
    tx.set(db.collection(VERSIONS_COLLECTION).doc(versionDoc.id), versionDoc);
    appendAudit(tx, auditRef, {
      entryId: pointerDoc.id, action: 'CONSTRUCTION_DNA_VERSION_CREATED', previousStatus: previousVersionSnapshot[0]?.version || null, newStatus: entry.version,
      actor: authz.uid, actorEmail: authz.email, reason: reason || null, source: 'api',
      projectId: pointerDoc.projectId, organizationId, ownerUid: authz.uid
    });
  });

  res.status(201).json({ constructionDna: pointerDoc, version: versionDoc });
}

const ACTIONS = { generate: handleGenerate };

export default async function handler(req, res){
  try{
    if(req.method === 'GET'){ await handleGet(req, res); return; }
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
