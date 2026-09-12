/* Endpoints reales de Memoria Tecnica (Fase 6). Reusa el dominio puro
   (src/domain/technicalMemory.js, Fase 4 -- nunca se reimplementa aqui) y el
   adapter de Firestore ya probado contra el emulador
   (server/api-lib/_technicalMemoryFirestoreAdapter.mjs). Convencion del
   repo: UN archivo plano por feature, `action` en el body distingue la
   operacion de escritura (ver api/onedrive.mjs), GET para lecturas (ver
   api/health.mjs) -- no se inventa un router ni rutas dinamicas que este
   proyecto (Vercel + `api/*.mjs` plano) no usa en ningun otro lado.

   Identidad SIEMPRE del token verificado (requireAuth/requireSuperAdmin,
   _authGuard.mjs) -- createdBy/approvedBy/rejectedBy nunca se leen del
   body, sin importar que el cliente los mande (regla 3 del spec).

   Autorizacion (regla 4, policy explicita -- el proyecto solo tiene
   admin/user hoy, no un rol "supervisor" dedicado):
     - Crear PROPOSAL: cualquier usuario autenticado (requireAuth).
     - APPROVE / REJECT / SUPERSEDE: requireSuperAdmin. Documentado aqui porque
       no existe todavia un rol intermedio; si se agrega uno mas adelante,
       este es el unico lugar que hay que cambiar.

   Reubicado fuera de api/ en el parche de compatibilidad con Vercel Hobby
   (consolidacion de funciones serverless) -- ver api/gateway.mjs y
   VERCEL_HOBBY_COMPAT.md. Contenido/logica identicos a la version original
   en api/technical-memory.mjs, solo cambiaron las rutas relativas de
   import. */
import { requireAuth, requireSuperAdmin } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { appendAudit } from './_decisionAudit.mjs';
import { loadOrgContext, canAccessOrgScopedDoc } from './_orgGuard.mjs';
import { createFirestoreMemoryRepository } from './_technicalMemoryFirestoreAdapter.mjs';
import { createMemoryProposal, approveMemoryEntry, rejectMemoryEntry, supersedeMemoryEntry, MEMORY_STATUS, MEMORY_SCOPE } from '../../src/domain/technicalMemory.js';

const COLLECTION = 'technicalMemory';
const AUDIT_COLLECTION = 'technicalMemoryAudit';

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }

/* FASE 3 (aprendizaje progresivo SEGURO), Parte 0 -- hallazgo de esta fase:
   handleList devolvia CUALQUIER entrada que coincidiera con scope/type/
   status/projectId sin verificar que quien pregunta tenga relacion real con
   ese proyecto u organizacion -- a diferencia de _route-projects.mjs/
   _route-apus.mjs, que ya usan canAccessOrgScopedDoc. Pasaba inadvertido
   porque este endpoint casi no se usaba en produccion; conectarlo de verdad
   a Confidence/Challenge (el resto de esta fase) le da trafico real, asi que
   se cierra primero. Regla por scope (misma jerarquia que ya define
   technicalMemory.js#MEMORY_SCOPE):
     GLOBAL       -> piso generico de la plataforma, visible para cualquier
                     usuario autenticado (nunca describe un proyecto/empresa).
     PROJECT      -> exige poder acceder al PROYECTO real (mismo criterio que
                     ver el proyecto mismo, no la identidad de quien propuso
                     la memoria -- es memoria de equipo, no personal).
     ORGANIZATION -> exige pertenecer a esa organizacion exacta.
     USER         -> exige ser ese mismo usuario.
   Un administrador real sigue viendo todo (mismo criterio que el resto de
   la plataforma, ver isAdmin()/requireSuperAdmin). */
async function filterVisibleEntries(entries, authz){
  if(authz.role === 'admin') return entries;
  const db = getAdminDb();
  const orgContext = await loadOrgContext(authz.uid);
  const projectIds = [...new Set(entries
    .filter(e => e.scope === MEMORY_SCOPE.PROJECT && e.context?.projectId)
    .map(e => e.context.projectId))];
  const projectDocs = await Promise.all(projectIds.map(id => db.collection('projects').doc(id).get()));
  const projectsById = new Map(projectIds.map((id, i) => [id, projectDocs[i].exists ? projectDocs[i].data() : null]));
  return entries.filter(entry => {
    if(entry.scope === MEMORY_SCOPE.GLOBAL) return true;
    if(entry.scope === MEMORY_SCOPE.USER) return entry.context?.userId === authz.uid;
    if(entry.scope === MEMORY_SCOPE.ORGANIZATION) return Boolean(orgContext && entry.context?.organizationId === orgContext.organizationId);
    if(entry.scope === MEMORY_SCOPE.PROJECT) return canAccessOrgScopedDoc(projectsById.get(entry.context?.projectId), authz, orgContext);
    return false;
  });
}

async function handleList(req, res){
  const authz = await requireAuth(req);
  const { id, scope, type, status, projectId } = req.query || {};
  const repo = createFirestoreMemoryRepository();
  if(id){
    const entry = await repo.getById(String(id));
    const visible = entry ? (await filterVisibleEntries([entry], authz))[0] || null : null;
    res.status(200).json({ entry: visible, requestedBy: authz.uid });
    return;
  }
  let entries = await repo.list({ scope: scope || undefined, type: type || undefined, status: status || undefined });
  // context.projectId no es parte del contrato generico de list() (Fase 4,
  // repository interface solo filtra scope/type/status) -- se filtra aqui,
  // en la capa de API, sin tocar el contrato del repositorio.
  if(projectId) entries = entries.filter(e => e.context?.projectId === projectId);
  entries = await filterVisibleEntries(entries, authz);
  res.status(200).json({ entries, count: entries.length });
}

/* CREATE PROPOSAL (regla 2/3): identidad siempre de requireAuth, nunca del
   body -- createdBy/provenance.userId se sobreescriben sin importar lo que
   mande el cliente. */
async function handleProposal(req, res){
  const authz = await requireAuth(req);
  const { scope, type, subject, value, unit, context, tags, provenance } = req.body || {};
  let entry;
  try{
    entry = createMemoryProposal({
      scope, type, subject, value, unit, context, tags,
      provenance: { ...(provenance || {}), userId: authz.uid, apuId: (provenance || {}).apuId || null },
      createdBy: authz.email || authz.uid
    });
  }catch(err){ throw httpError(400, err.message); }
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(entry.id);
  await docRef.set(entry);
  await appendAudit(db, AUDIT_COLLECTION, {
    entryId: entry.id, action: 'PROPOSAL_CREATED', previousStatus: null, newStatus: MEMORY_STATUS.PROPOSED,
    actor: authz.uid, actorEmail: authz.email, reason: null, source: 'api',
    projectId: entry.context?.projectId || null, apuId: entry.provenance?.apuId || null, organizationId: entry.context?.organizationId || null
  });
  res.status(201).json({ entry });
}

/* APPROVE/REJECT: transaccion (regla 6 -- concurrencia). Lee el estado
   ACTUAL dentro de la transaccion (nunca el que trajo el GET previo del
   cliente), valida PROPOSED->APPROVED/REJECTED como unica transicion valida
   (regla 5 -- validacion server-side, la UI nunca es la barrera real), y
   escribe el nuevo estado + su registro de auditoria atomicamente. Repetir
   la accion sobre una entrada ya resuelta falla con 409 -- esa es la
   idempotencia real (regla 12): nunca un doble-approve silencioso. */
async function handleApprove(req, res){
  const authz = await requireSuperAdmin(req);
  const { id } = req.body || {};
  if(!id) throw httpError(400, 'Falta id de la entrada a aprobar.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const approved = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'La entrada de memoria no existe.');
    const current = snap.data();
    if(current.status !== MEMORY_STATUS.PROPOSED) throw httpError(409, `No se puede aprobar: la entrada ya esta en estado ${current.status}, no PROPOSED.`);
    const next = approveMemoryEntry(current, { approvedBy: authz.email || authz.uid });
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'APPROVED', previousStatus: current.status, newStatus: next.status,
      actor: authz.uid, actorEmail: authz.email || null, reason: null, source: 'api',
      projectId: next.context?.projectId || null, apuId: next.provenance?.apuId || null, organizationId: next.context?.organizationId || null
    });
    return next;
  });
  res.status(200).json({ entry: approved });
}

async function handleReject(req, res){
  const authz = await requireSuperAdmin(req);
  const { id, reason } = req.body || {};
  if(!id) throw httpError(400, 'Falta id de la entrada a rechazar.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const rejected = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'La entrada de memoria no existe.');
    const current = snap.data();
    if(current.status !== MEMORY_STATUS.PROPOSED) throw httpError(409, `No se puede rechazar: la entrada ya esta en estado ${current.status}, no PROPOSED.`);
    const next = rejectMemoryEntry(current, { rejectedBy: authz.email || authz.uid, reason: reason || null });
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'REJECTED', previousStatus: current.status, newStatus: next.status,
      actor: authz.uid, actorEmail: authz.email || null, reason: reason || null, source: 'api',
      projectId: next.context?.projectId || null, apuId: next.provenance?.apuId || null, organizationId: next.context?.organizationId || null
    });
    return next;
  });
  res.status(200).json({ entry: rejected });
}

/* SUPERSEDE (regla 5/11): solo sobre una entrada APPROVED -- crea una
   version NUEVA (PROPOSED, debe pasar su propia revision) y marca la
   anterior SUPERSEDED sin borrarla (regla 11: nunca update destructivo).
   Ambos documentos + la auditoria se escriben en la MISMA transaccion. */
async function handleSupersede(req, res){
  const authz = await requireSuperAdmin(req);
  const { id, value, unit, scope, type, subject, context, tags } = req.body || {};
  if(!id) throw httpError(400, 'Falta id de la entrada a reemplazar.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'La entrada de memoria no existe.');
    const current = snap.data();
    if(current.status !== MEMORY_STATUS.APPROVED) throw httpError(409, `Solo se puede reemplazar (supersede) una entrada APPROVED; esta esta en ${current.status}.`);
    let superseded, nextEntry;
    try{
      ({ supersededEntry: superseded, nextEntry } = supersedeMemoryEntry(current, {
        scope: scope || current.scope, type: type || current.type, subject: subject || current.subject,
        value, unit: unit ?? current.unit, context: context || current.context, tags: tags || current.tags,
        provenance: { userId: authz.uid, apuId: current.provenance?.apuId || null }, createdBy: authz.email || authz.uid
      }));
    }catch(err){ throw httpError(400, err.message); }
    const nextRef = db.collection(COLLECTION).doc(nextEntry.id);
    tx.set(docRef, superseded);
    tx.set(nextRef, nextEntry);
    appendAudit(tx, auditRef, {
      entryId: current.id, action: 'SUPERSEDED', previousStatus: current.status, newStatus: MEMORY_STATUS.SUPERSEDED,
      actor: authz.uid, actorEmail: authz.email || null, reason: `Reemplazada por ${nextEntry.id}`, source: 'api',
      projectId: current.context?.projectId || null, apuId: current.provenance?.apuId || null, organizationId: current.context?.organizationId || null
    });
    return { superseded, nextEntry };
  });
  res.status(200).json(result);
}

const ACTIONS = { proposal: handleProposal, approve: handleApprove, reject: handleReject, supersede: handleSupersede };

export default async function handler(req, res){
  try{
    if(req.method === 'GET'){ await handleList(req, res); return; }
    if(req.method !== 'POST'){ res.status(405).json({ error: 'Metodo no permitido.' }); return; }
    const action = req.body?.action;
    const run = ACTIONS[action];
    if(!run) throw httpError(400, `Accion no reconocida: "${action}".`);
    await run(req, res);
  }catch(err){
    res.status(err.status || 400).json({ error: err.message || 'No se pudo completar la solicitud.' });
  }
}
