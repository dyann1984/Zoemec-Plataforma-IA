/* Biblioteca EMPRESARIAL -- logica server-side (P0 paridad ADMIN vs
   COLLABORATOR). Recibe `db` y el orgContext ya resuelto por
   _orgGuard.mjs#loadOrgContext, asi que se prueba con un Firestore en
   memoria sin credenciales. La ruta (_route-org-library.mjs) solo
   autentica y despacha.

   Mismo patron que catalogConceptos/presupuestos: documento por recurso en
   la coleccion `orgLibrary` con `organizationId` fijado SIEMPRE desde el
   orgContext (nunca del body) + auditoria append-only `orgLibraryAudit`.
   Lectura: cualquier miembro activo. Escritura: solo el responsable de la
   empresa (canManageOrgLibrary). Aislamiento: toda consulta filtra por el
   organizationId del propio usuario -- no existe forma de pedir otra. */
import { appendAudit } from './_decisionAudit.mjs';
import { ORG_LIBRARY_COLLECTION, loadApuGenerationContext } from './_apuContextResolver.mjs';
import { canReadOrgLibrary, canManageOrgLibrary } from '../../src/domain/orgLibraryPermissions.js';
import {
  makeEmptyOrgLibraryEntry, validateOrgLibraryEntry, orgLibraryEntryKey, planOrgLibraryImport,
  personalRowToOrgCandidate, ORG_LIBRARY_STATUS, ORG_LIBRARY_TYPE
} from '../../src/domain/orgLibrarySchema.js';
import { toContextDiagnostics } from '../../src/domain/apuContextResolution.js';

export const ORG_LIBRARY_AUDIT_COLLECTION = 'orgLibraryAudit';
const MAX_BATCH_WRITES = 400; // < 500 (limite de Firestore por batch)
const MAX_IMPORT_ROWS = 5000;
const UPDATABLE_FIELDS = ['type', 'code', 'description', 'unit', 'price', 'currency', 'region', 'source', 'date', 'validUntil', 'evidence'];

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }

export function assertCanRead(orgContext){
  if(!orgContext) throw httpError(403, 'La biblioteca empresarial solo existe para miembros de una empresa.');
  if(!canReadOrgLibrary(orgContext)) throw httpError(403, 'Tu acceso a esta empresa no esta activo.');
}
export function assertCanManage(orgContext){
  assertCanRead(orgContext);
  if(!canManageOrgLibrary(orgContext)) throw httpError(403, 'Solo el responsable de la empresa puede modificar la biblioteca empresarial.');
}

async function loadOrgEntries(db, organizationId){
  const snap = await db.collection(ORG_LIBRARY_COLLECTION).where('organizationId', '==', String(organizationId)).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function assertProjectBelongsToOrg(db, organizationId, projectId){
  if(!projectId) return;
  const snap = await db.collection('projects').doc(String(projectId)).get();
  if(!snap.exists || snap.data()?.organizationId !== organizationId){
    throw httpError(403, 'El proyecto no pertenece a tu empresa.');
  }
}

function sanitizeCandidate(input, { organizationId, actor, projectId = null }){
  const entry = makeEmptyOrgLibraryEntry({
    organizationId,
    projectId: projectId || input?.projectId || null,
    type: Object.values(ORG_LIBRARY_TYPE).includes(input?.type) ? input.type : ORG_LIBRARY_TYPE.MATERIAL,
    code: input?.code, description: input?.description, unit: input?.unit,
    price: input?.price, currency: input?.currency, region: input?.region,
    source: input?.source, date: input?.date, validUntil: input?.validUntil,
    evidence: input?.evidence ?? null, origin: input?.origin ?? null,
    createdBy: actor, updatedBy: actor
  });
  return entry;
}

async function commitWrites(db, writes){
  for(let i = 0; i < writes.length; i += MAX_BATCH_WRITES){
    const batch = db.batch();
    writes.slice(i, i + MAX_BATCH_WRITES).forEach(w => {
      if(w.op === 'set') batch.set(db.collection(ORG_LIBRARY_COLLECTION).doc(w.id), w.data);
      else batch.update(db.collection(ORG_LIBRARY_COLLECTION).doc(w.id), w.data);
    });
    await batch.commit();
  }
}

/* ---------- lectura ---------- */

export async function listOrgLibrary(db, { orgContext, projectId = null, includeArchived = false }){
  assertCanRead(orgContext);
  const entries = await loadOrgEntries(db, orgContext.organizationId);
  return entries
    .filter(e => includeArchived || (!e.archivedAt && e.status !== ORG_LIBRARY_STATUS.ARCHIVED))
    .filter(e => !e.projectId || !projectId || String(e.projectId) === String(projectId))
    .sort((a, b) => String(a.description).localeCompare(String(b.description)));
}

/* Vista previa del contexto que usaria la IA (regla 20 del encargo): mismo
   cargador que /api/generate-apu, sin llamar a la IA. Cualquier miembro.
   includeCatalog: ademas devuelve el catalogo YA RESUELTO (precedencia,
   region, vigencia) -- lo usa la plantilla de respaldo del lote cuando la IA
   no responde, para que ese respaldo tambien use la biblioteca de la
   empresa y no el catalogo personal del navegador. Un miembro ya puede
   leer esa biblioteca, asi que no expone nada nuevo. */
const PREVIEW_MAX_CATALOG_ROWS = 2000;
export async function previewApuContext(db, { authz, orgContext, projectId = null, concept = '', includePersonal = false, clientPersonalCatalog = [], includeCatalog = false }){
  const ctx = await loadApuGenerationContext({
    db, authz, orgContext, projectId, requestedMode: 'organization', includePersonal, clientPersonalCatalog, concept,
    maxModelRows: includeCatalog ? PREVIEW_MAX_CATALOG_ROWS : undefined
  });
  const diagnostics = toContextDiagnostics(ctx);
  return includeCatalog ? { ...diagnostics, catalog: ctx.catalogForModel } : diagnostics;
}

/* ---------- escritura (solo responsable) ---------- */

export async function createOrgLibraryEntries(db, { orgContext, actor, entries = [], projectId = null }){
  assertCanManage(orgContext);
  const organizationId = orgContext.organizationId;
  await assertProjectBelongsToOrg(db, organizationId, projectId);
  const existing = (await loadOrgEntries(db, organizationId)).filter(e => !e.archivedAt);
  const existingKeys = new Map(existing.filter(e => String(e.projectId || '') === String(projectId || '')).map(e => [orgLibraryEntryKey(e), e]));
  const created = [], rejected = [];
  const writes = [];
  (entries || []).forEach((input, index) => {
    const entry = sanitizeCandidate(input, { organizationId, actor, projectId });
    const { valid, errors } = validateOrgLibraryEntry(entry);
    if(!valid){ rejected.push({ index, reason: errors.join(' ') }); return; }
    const key = orgLibraryEntryKey(entry);
    if(existingKeys.has(key)){ rejected.push({ index, reason: 'DUPLICADO', existingId: existingKeys.get(key).id }); return; }
    existingKeys.set(key, entry);
    writes.push({ op: 'set', id: entry.id, data: entry });
    created.push(entry);
  });
  await commitWrites(db, writes);
  if(created.length){
    await appendAudit(db, ORG_LIBRARY_AUDIT_COLLECTION, {
      action: 'ORG_LIBRARY_CREATED', organizationId, actor, projectId: projectId || null,
      count: created.length, ids: created.slice(0, 50).map(e => e.id)
    });
  }
  return { created, rejected };
}

export async function updateOrgLibraryEntry(db, { orgContext, actor, id, patch = {} }){
  assertCanManage(orgContext);
  const ref = db.collection(ORG_LIBRARY_COLLECTION).doc(String(id));
  const snap = await ref.get();
  if(!snap.exists) throw httpError(404, 'El recurso no existe.');
  const current = snap.data();
  // Aislamiento: un responsable de la empresa A nunca modifica un recurso
  // de la empresa B, aunque conozca su id.
  if(current.organizationId !== orgContext.organizationId) throw httpError(403, 'Este recurso pertenece a otra empresa.');
  const next = { ...current };
  UPDATABLE_FIELDS.forEach(f => { if(patch[f] !== undefined) next[f] = f === 'price' ? Number(patch[f]) : patch[f]; });
  next.updatedBy = actor;
  next.updatedAt = new Date().toISOString();
  const { valid, errors } = validateOrgLibraryEntry(next);
  if(!valid) throw httpError(400, errors.join(' '));
  await ref.set(next);
  await appendAudit(db, ORG_LIBRARY_AUDIT_COLLECTION, {
    action: 'ORG_LIBRARY_UPDATED', organizationId: orgContext.organizationId, actor, entryId: current.id,
    previous: { price: current.price, description: current.description, unit: current.unit, region: current.region },
    next: { price: next.price, description: next.description, unit: next.unit, region: next.region }
  });
  return next;
}

export async function archiveOrgLibraryEntry(db, { orgContext, actor, id }){
  assertCanManage(orgContext);
  const ref = db.collection(ORG_LIBRARY_COLLECTION).doc(String(id));
  const snap = await ref.get();
  if(!snap.exists) throw httpError(404, 'El recurso no existe.');
  const current = snap.data();
  if(current.organizationId !== orgContext.organizationId) throw httpError(403, 'Este recurso pertenece a otra empresa.');
  const now = new Date().toISOString();
  const next = { ...current, status: ORG_LIBRARY_STATUS.ARCHIVED, archivedAt: now, updatedAt: now, updatedBy: actor };
  await ref.set(next);
  await appendAudit(db, ORG_LIBRARY_AUDIT_COLLECTION, { action: 'ORG_LIBRARY_ARCHIVED', organizationId: orgContext.organizationId, actor, entryId: current.id });
  return next;
}

/* ---------- migracion NO destructiva del catalogo personal ---------- */

/* rows: filas del catalogo PERSONAL del propio responsable (su blob
   users/{uid}/state/zoemec-catalogo, que el cliente envia explicitamente al
   pulsar "Copiar a biblioteca de empresa"). Nunca se lee ni se borra el
   blob personal desde aqui: se COPIA lo que el usuario decide compartir. */
function buildCandidates(rows, { organizationId, region, fromUid }){
  return (Array.isArray(rows) ? rows : []).slice(0, MAX_IMPORT_ROWS)
    .map(r => personalRowToOrgCandidate(r, { organizationId, region, fromUid }));
}

export async function previewPersonalImport(db, { orgContext, authz, rows = [], region = '' }){
  assertCanManage(orgContext);
  const organizationId = orgContext.organizationId;
  const candidates = buildCandidates(rows, { organizationId, region, fromUid: authz.uid });
  const existing = (await loadOrgEntries(db, organizationId)).filter(e => !e.projectId);
  const plan = planOrgLibraryImport(candidates, existing);
  return {
    summary: plan.summary,
    toCreate: plan.toCreate.slice(0, 200).map(c => ({ description: c.description, unit: c.unit, price: c.price, region: c.region, source: c.source, date: c.date })),
    toUpdate: plan.toUpdate.slice(0, 200).map(u => ({ existingId: u.existingId, description: u.candidate.description, unit: u.candidate.unit, from: u.from, to: u.to })),
    conflicts: plan.conflicts.slice(0, 200),
    invalid: plan.invalid.slice(0, 200).map(i => ({ index: i.index, reason: i.reason, description: i.candidate?.description || '' })),
    duplicatesInBatch: plan.duplicatesInBatch.length
  };
}

export async function commitPersonalImport(db, { orgContext, authz, actor, rows = [], region = '', applyUpdates = false }){
  assertCanManage(orgContext);
  const organizationId = orgContext.organizationId;
  const candidates = buildCandidates(rows, { organizationId, region, fromUid: authz.uid })
    .map(c => ({ ...c, createdBy: actor, updatedBy: actor }));
  const existing = (await loadOrgEntries(db, organizationId)).filter(e => !e.projectId);
  const plan = planOrgLibraryImport(candidates, existing);
  const now = new Date().toISOString();
  const writes = plan.toCreate.map(c => ({ op: 'set', id: c.id, data: c }));
  if(applyUpdates){
    plan.toUpdate.forEach(u => writes.push({
      op: 'update', id: u.existingId,
      data: { price: u.to, date: u.candidate.date, source: u.candidate.source, updatedBy: actor, updatedAt: now, evidence: u.candidate.evidence || null }
    }));
  }
  await commitWrites(db, writes);
  await appendAudit(db, ORG_LIBRARY_AUDIT_COLLECTION, {
    action: 'ORG_LIBRARY_PERSONAL_IMPORT', organizationId, actor, fromUid: authz.uid,
    created: plan.toCreate.length, updated: applyUpdates ? plan.toUpdate.length : 0,
    skippedUpdates: applyUpdates ? 0 : plan.toUpdate.length,
    unchanged: plan.unchanged.length, conflicts: plan.conflicts.length, invalid: plan.invalid.length
  });
  return {
    created: plan.toCreate.length,
    updated: applyUpdates ? plan.toUpdate.length : 0,
    skippedUpdates: applyUpdates ? 0 : plan.toUpdate.length,
    unchanged: plan.unchanged.length,
    conflicts: plan.conflicts.length,
    invalid: plan.invalid.length,
    summary: plan.summary
  };
}
