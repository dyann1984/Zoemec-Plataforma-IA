/* Guard de organizacion/trial empresarial: mismo patron que _authGuard.mjs
   (requireAuth/requireFeature/requireSuperAdmin) pero para el contexto de
   organizacion (Fase 1 del trial empresarial de 30 dias). Identidad SIEMPRE
   via requireAuth (token verificado con Firebase Admin) -- nunca se confia
   en un organizationId que venga del body/query del cliente. */
import { FieldValue, getAdminDb } from './_firebaseAdmin.mjs';
import { requireAuth } from './_authGuard.mjs';
import {
  ORG_STATUS,
  MEMBER_STATUS,
  isOrgManagerRole,
  resolveOrgStatus,
  canCreateContent,
  TRIAL_EXPIRED_MESSAGE,
} from '../../src/domain/organization.js';

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }

/* Si el trial ya vencio segun resolveOrgStatus() (calculo puro, en base a
   expiresAt) pero el documento en Firestore todavia dice ACTIVE_TRIAL,
   persiste la transicion aqui -- una sola vez, dentro de una transaccion que
   vuelve a leer el documento fresco para no pisar una extension concurrente
   (Fase 4, panel admin) ni repetir la escritura en cada llamada. La
   autorizacion real (canCreateContent) siempre usa el estado RESUELTO, nunca
   depende de que esta escritura ya se haya completado. */
async function persistExpiryIfNeeded(db, organizationId, org){
  if(org.status !== ORG_STATUS.ACTIVE_TRIAL) return org;
  if(resolveOrgStatus(org) !== ORG_STATUS.TRIAL_EXPIRED) return org;
  const orgRef = db.collection('organizations').doc(organizationId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orgRef);
    if(!snap.exists) return org;
    const fresh = { id: organizationId, ...snap.data() };
    if(fresh.status !== ORG_STATUS.ACTIVE_TRIAL) return fresh;
    if(resolveOrgStatus(fresh) !== ORG_STATUS.TRIAL_EXPIRED) return fresh;
    tx.update(orgRef, { status: ORG_STATUS.TRIAL_EXPIRED, updatedAt: FieldValue.serverTimestamp() });
    return { ...fresh, status: ORG_STATUS.TRIAL_EXPIRED };
  });
}

/* Bloque base reutilizado por rutas que SI o SI requieren organizacion
   (organizations.mjs) y por rutas donde la organizacion es OPCIONAL
   (projects/apus: un usuario individual sin organizacion sigue funcionando
   exactamente igual que hoy). Devuelve null si el usuario no pertenece a
   ninguna organizacion -- nunca lanza por eso solo. */
export async function loadOrgContext(uid){
  const db = getAdminDb();
  const userSnap = await db.collection('users').doc(uid).get();
  const organizationId = userSnap.exists ? (userSnap.data().organizationId || null) : null;
  if(!organizationId) return null;

  const orgRef = db.collection('organizations').doc(organizationId);
  const memberRef = orgRef.collection('members').doc(uid);
  const [orgSnap, memberSnap] = await Promise.all([orgRef.get(), memberRef.get()]);
  if(!orgSnap.exists || !memberSnap.exists) return null;

  let org = { id: orgSnap.id, ...orgSnap.data() };
  org = await persistExpiryIfNeeded(db, organizationId, org);
  const member = { uid, ...memberSnap.data() };
  const status = resolveOrgStatus(org);
  return { organizationId, org, member, status, db };
}

export async function requireActiveOrgMember(req){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  if(!orgContext) throw httpError(403, 'No perteneces a ninguna organizacion.');
  if(orgContext.member.status !== MEMBER_STATUS.ACTIVE) throw httpError(403, 'Tu acceso a esta organizacion fue desactivado. Contacta al administrador de tu empresa.');
  return { authz, orgContext };
}

// Responsable de UNA empresa (antes "org_admin") -- NO es super admin de
// ZOEMEC, ver _authGuard.mjs#requireSuperAdmin para eso. isOrgManagerRole
// acepta el valor nuevo ('company_manager') y el legado ('org_admin') para
// que una organizacion creada antes de este renombrado siga funcionando.
export async function requireCompanyManager(req){
  const ctx = await requireActiveOrgMember(req);
  if(!isOrgManagerRole(ctx.orgContext.member.role)) throw httpError(403, 'Esta accion es solo para el responsable de la empresa.');
  return ctx;
}

// Para rutas donde la organizacion es opcional (projects/apus/export-events):
// no lanza si el usuario no tiene organizacion (comportamiento individual
// intacto); solo bloquea si SI pertenece a una y el trial ya vencio.
export function assertOrgNotExpired(orgContext){
  if(!orgContext) return;
  if(!canCreateContent(orgContext.status)){
    throw httpError(402, TRIAL_EXPIRED_MESSAGE);
  }
}

// Un documento org-scoped (projects/apus/...) es accesible por su dueno
// original (comportamiento individual intacto) o por cualquier miembro
// activo de la MISMA organizacion a la que quedo asociado al crearse.
export function canAccessOrgScopedDoc(doc, authz, orgContext){
  if(!doc) return false;
  if(doc.ownerUid === authz.uid) return true;
  return Boolean(orgContext && doc.organizationId && doc.organizationId === orgContext.organizationId);
}

export { httpError };
