/* Organizaciones / Trial Empresarial de 30 dias (Fase 1). Mismo patron que
   _route-projects.mjs / _route-apus.mjs: reubicado bajo server/api-lib/ para
   ser despachado por api/gateway.mjs (limite de 12 funciones serverless del
   plan Hobby de Vercel, ver VERCEL_HOBBY_COMPAT.md) -- no agrega una funcion
   nueva, solo una entrada mas en el router existente.

   Identidad SIEMPRE del token verificado (requireAuth/requireActiveOrgMember/
   requireCompanyManager, ver _orgGuard.mjs) -- nunca se confia en un uid/organiza-
   tionId que venga del body. Toda escritura de organizations/members/
   invitations pasa por aqui (Admin SDK); el cliente JAMAS escribe esas
   colecciones directo (ver firestore.rules: write:false para las tres). */
import crypto from 'node:crypto';
import { FieldValue, getAdminDb } from './_firebaseAdmin.mjs';
import { requireAuth } from './_authGuard.mjs';
import { loadOrgContext, requireActiveOrgMember, requireCompanyManager, httpError } from './_orgGuard.mjs';
import {
  ORG_STATUS,
  ORG_ROLE,
  MEMBER_STATUS,
  INVITATION_STATUS,
  MAX_ORG_MEMBERS,
  INVITE_TOKEN_TTL_DAYS,
  computeExpiresAt,
  daysRemaining,
  resolveOrgStatus,
  isInvitationUsable,
  isOrgManagerRole,
} from '../../src/domain/organization.js';

function generateToken(){
  return crypto.randomBytes(24).toString('base64url');
}
function hashToken(token){
  return crypto.createHash('sha256').update(token).digest('hex');
}

function publicOrg(org){
  if(!org) return null;
  const status = resolveOrgStatus(org);
  return {
    id: org.id,
    name: org.name || null,
    responsibleName: org.responsibleName || null,
    responsibleEmail: org.responsibleEmail || null,
    status,
    plan: org.plan || 'TRIAL',
    maxUsers: org.maxUsers || MAX_ORG_MEMBERS,
    activatedAt: org.activatedAt || null,
    expiresAt: org.expiresAt || null,
    convertedAt: org.convertedAt || null,
    daysRemaining: daysRemaining(org),
  };
}

/* GET ?action=me : contexto de organizacion del usuario autenticado (o null
   si no pertenece a ninguna). Usado por el cliente al iniciar sesion para
   pintar el banner de trial y activar/bloquear acciones. */
async function handleMe(req, res){
  const authz = await requireAuth(req);
  const ctx = await loadOrgContext(authz.uid);
  if(!ctx){ res.status(200).json({ organization: null, membership: null }); return; }
  res.status(200).json({
    organization: publicOrg(ctx.org),
    membership: { uid: ctx.member.uid, role: ctx.member.role, status: ctx.member.status },
  });
}

/* Alta self-serve: un usuario YA autenticado (cuenta creada normalmente via
   register()) crea su organizacion y queda como company_manager (responsable
   de esa empresa -- NO admin de ZOEMEC). Un uid solo puede
   crear/pertenecer a una organizacion (modelo simple para Fase 1: sin
   multi-organizacion por usuario). */
async function handleCreate(req, res){
  const authz = await requireAuth(req);
  const { name, responsibleName } = req.body || {};
  if(!name || !String(name).trim()) throw httpError(400, 'Falta el nombre de la empresa.');
  if(!responsibleName || !String(responsibleName).trim()) throw httpError(400, 'Falta el nombre del responsable.');

  const db = getAdminDb();
  const userRef = db.collection('users').doc(authz.uid);
  const orgRef = db.collection('organizations').doc();

  const org = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if(userSnap.exists && userSnap.data().organizationId){
      throw httpError(409, 'Tu cuenta ya pertenece a una organizacion.');
    }
    const now = new Date().toISOString();
    const next = {
      id: orgRef.id,
      name: String(name).trim(),
      responsibleName: String(responsibleName).trim(),
      responsibleEmail: authz.email,
      createdByUid: authz.uid,
      status: ORG_STATUS.ACTIVE_TRIAL,
      plan: 'TRIAL',
      activatedAt: now,
      expiresAt: computeExpiresAt(now).toISOString(),
      maxUsers: MAX_ORG_MEMBERS,
      trialExtensions: [],
      suspendedAt: null,
      suspendedReason: null,
      convertedAt: null,
      dataRetentionUntil: null,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(orgRef, next);
    tx.set(orgRef.collection('members').doc(authz.uid), {
      uid: authz.uid,
      email: authz.email,
      displayName: authz.name,
      role: ORG_ROLE.MANAGER,
      status: MEMBER_STATUS.ACTIVE,
      invitedBy: null,
      joinedAt: now,
      lastAccessAt: now,
    });
    // Mismo criterio "solo rellena lo ausente" que loadOrCreateProfile/
    // requireFeature (ver src/domain/userProfile.js, server/api-lib/
    // _authGuard.mjs): si el usuario ya tenia perfil (caso normal, creado
    // por register()), NUNCA se pisa role/plan/active/etc, solo se agregan
    // organizationId/orgRole. Si por algun motivo esta es la PRIMERA
    // escritura a users/{uid} de esa cuenta (nunca paso por
    // loadOrCreateProfile ni por requireFeature antes), se siembran los
    // mismos valores de arranque seguros que usa el resto del codigo.
    const userPatch = { organizationId: orgRef.id, orgRole: ORG_ROLE.MANAGER, updatedAt: FieldValue.serverTimestamp() };
    if(!userSnap.exists){
      Object.assign(userPatch, {
        uid: authz.uid, email: authz.email, name: authz.name,
        role: 'user', plan: 'Gratis', active: true, apusCreated: 0,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    tx.set(userRef, userPatch, { merge: true });
    return next;
  });

  res.status(201).json({ organization: publicOrg(org) });
}

/* Invitar (solo company_manager, el responsable de la empresa): valida cupo
   (miembros activos + invitaciones pendientes no vencidas < 10) dentro de
   una transaccion para que dos invitaciones simultaneas no exista sobrepasen
   el tope, genera un token aleatorio y guarda solo su hash -- el token crudo
   se devuelve UNA vez. */
async function handleInvite(req, res){
  const { authz, orgContext } = await requireCompanyManager(req);
  const { email, role } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  if(!cleanEmail || !cleanEmail.includes('@')) throw httpError(400, 'Correo de invitacion invalido.');
  const inviteRole = role === ORG_ROLE.MANAGER ? ORG_ROLE.MANAGER : ORG_ROLE.COLLABORATOR;

  const db = getAdminDb();
  const orgRef = db.collection('organizations').doc(orgContext.organizationId);
  const invitationRef = orgRef.collection('invitations').doc();
  const token = generateToken();
  const tokenHash = hashToken(token);

  const invitation = await db.runTransaction(async (tx) => {
    const [membersSnap, invitationsSnap] = await Promise.all([
      tx.get(orgRef.collection('members').where('status', '==', MEMBER_STATUS.ACTIVE)),
      tx.get(orgRef.collection('invitations').where('status', '==', INVITATION_STATUS.PENDING)),
    ]);
    const activeMembers = membersSnap.size;
    const pendingInvitations = invitationsSnap.docs.filter(d => isInvitationUsable(d.data())).length;
    if(activeMembers + pendingInvitations >= MAX_ORG_MEMBERS){
      throw httpError(409, `Esta empresa ya alcanzo el maximo de ${MAX_ORG_MEMBERS} usuarios.`);
    }
    const now = new Date();
    const next = {
      id: invitationRef.id,
      email: cleanEmail,
      role: inviteRole,
      tokenHash,
      status: INVITATION_STATUS.PENDING,
      createdBy: authz.uid,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + INVITE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      acceptedAt: null,
      acceptedByUid: null,
    };
    tx.set(invitationRef, next);
    return next;
  });

  res.status(201).json({
    invitation: { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt },
    token, // crudo, solo en esta respuesta -- el cliente arma el link para copiar
    organizationId: orgContext.organizationId,
  });
}

/* Aceptar invitacion: cualquier cuenta autenticada+verificada (requireAuth),
   normalmente todavia SIN organizacion. El link trae organizationId +
   invitationId + token; el token se compara por hash, nunca se guarda en
   claro. El correo de la invitacion debe coincidir con el de la cuenta que
   acepta (evita que un link filtrado lo use alguien distinto al invitado). */
async function handleAcceptInvite(req, res){
  const authz = await requireAuth(req);
  const { organizationId, invitationId, token } = req.body || {};
  if(!organizationId || !invitationId || !token) throw httpError(400, 'Faltan datos de la invitacion.');

  const db = getAdminDb();
  const userRef = db.collection('users').doc(authz.uid);
  const orgRef = db.collection('organizations').doc(String(organizationId));
  const invitationRef = orgRef.collection('invitations').doc(String(invitationId));
  const memberRef = orgRef.collection('members').doc(authz.uid);

  const result = await db.runTransaction(async (tx) => {
    const [userSnap, orgSnap, invitationSnap] = await Promise.all([
      tx.get(userRef), tx.get(orgRef), tx.get(invitationRef),
    ]);
    if(userSnap.exists && userSnap.data().organizationId){
      throw httpError(409, 'Tu cuenta ya pertenece a una organizacion.');
    }
    if(!orgSnap.exists) throw httpError(404, 'La organizacion no existe.');
    if(!invitationSnap.exists) throw httpError(404, 'La invitacion no existe.');
    const invitation = invitationSnap.data();
    if(hashToken(String(token)) !== invitation.tokenHash) throw httpError(403, 'Invitacion invalida.');
    if(!isInvitationUsable(invitation)) throw httpError(410, 'Esta invitacion ya fue usada o ya vencio.');
    if(String(invitation.email).toLowerCase() !== String(authz.email).toLowerCase()){
      throw httpError(403, 'Esta invitacion fue enviada a otro correo electronico.');
    }
    const activeMembersSnap = await tx.get(orgRef.collection('members').where('status', '==', MEMBER_STATUS.ACTIVE));
    if(activeMembersSnap.size >= MAX_ORG_MEMBERS){
      throw httpError(409, `Esta empresa ya alcanzo el maximo de ${MAX_ORG_MEMBERS} usuarios.`);
    }
    const now = new Date().toISOString();
    tx.set(memberRef, {
      uid: authz.uid, email: authz.email, displayName: authz.name,
      role: invitation.role, status: MEMBER_STATUS.ACTIVE,
      invitedBy: invitation.createdBy, joinedAt: now, lastAccessAt: now,
    });
    tx.update(invitationRef, { status: INVITATION_STATUS.ACCEPTED, acceptedAt: now, acceptedByUid: authz.uid });
    tx.set(userRef, { organizationId: orgRef.id, orgRole: invitation.role, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { organizationId: orgRef.id, role: invitation.role };
  });

  res.status(200).json(result);
}

async function handleListMembers(req, res){
  const { orgContext } = await requireActiveOrgMember(req);
  const db = getAdminDb();
  const snap = await db.collection('organizations').doc(orgContext.organizationId).collection('members').get();
  const members = snap.docs.map(d => {
    const m = d.data();
    return { uid: m.uid, email: m.email, displayName: m.displayName, role: m.role, status: m.status, joinedAt: m.joinedAt, lastAccessAt: m.lastAccessAt };
  });
  res.status(200).json({ members });
}

/* Deshabilitar miembro (solo company_manager): no puede auto-deshabilitarse
   ni dejar la organizacion sin ningun responsable activo. Conserva el
   registro (no borra datos ni membresia) -- solo bloquea acceso futuro via
   Firestore Rules (isActiveOrgMember exige status=='active'). */
async function handleDisableMember(req, res){
  const { authz, orgContext } = await requireCompanyManager(req);
  const { targetUid } = req.body || {};
  if(!targetUid) throw httpError(400, 'Falta el usuario a deshabilitar.');
  if(targetUid === authz.uid) throw httpError(400, 'No puedes deshabilitarte a ti mismo.');

  const db = getAdminDb();
  const orgRef = db.collection('organizations').doc(orgContext.organizationId);
  const targetRef = orgRef.collection('members').doc(String(targetUid));

  await db.runTransaction(async (tx) => {
    const targetSnap = await tx.get(targetRef);
    if(!targetSnap.exists) throw httpError(404, 'Ese usuario no pertenece a esta organizacion.');
    const target = targetSnap.data();
    if(target.status === MEMBER_STATUS.DISABLED) return;
    if(isOrgManagerRole(target.role)){
      // Trae solo activos (subcoleccion pequeña, <=MAX_ORG_MEMBERS) y filtra
      // el rol en memoria en vez de un .where('role','==',...) -- el rol de
      // responsable acepta DOS valores validos (nuevo + legado,
      // isOrgManagerRole) y Firestore no compara una igualdad contra dos
      // valores en una sola query sin index compuesto.
      const activeSnap = await tx.get(orgRef.collection('members').where('status', '==', MEMBER_STATUS.ACTIVE));
      const otherActiveManagers = activeSnap.docs.filter(d => d.id !== String(targetUid) && isOrgManagerRole(d.data().role)).length;
      if(otherActiveManagers === 0){
        throw httpError(409, 'No puedes desactivar al unico responsable activo de la empresa.');
      }
    }
    tx.update(targetRef, { status: MEMBER_STATUS.DISABLED, disabledAt: new Date().toISOString(), disabledBy: authz.uid });
  });

  res.status(200).json({ ok: true });
}

const ACTIONS = {
  create: handleCreate,
  invite: handleInvite,
  acceptInvite: handleAcceptInvite,
  listMembers: handleListMembers,
  disableMember: handleDisableMember,
};

export default async function handler(req, res){
  try{
    if(req.method === 'GET'){
      const action = req.query?.action;
      if(action === 'me'){ await handleMe(req, res); return; }
      throw httpError(400, `Accion no reconocida: "${action}".`);
    }
    if(req.method !== 'POST'){ res.status(405).json({ error: 'Metodo no permitido.' }); return; }
    const action = req.body?.action;
    const run = ACTIONS[action];
    if(!run) throw httpError(400, `Accion no reconocida: "${action}".`);
    await run(req, res);
  }catch(err){
    res.status(err.status || 400).json({ error: err.message || 'No se pudo completar la solicitud.' });
  }
}
