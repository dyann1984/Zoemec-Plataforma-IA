/* Reglas puras de organizaciones/trial empresarial: sin Firebase, sin React,
   sin DOM. Recibe datos ya cargados (documento de organizacion, membresia) y
   decide estado/plazos/capacidad. Compartido entre cliente (src/) y servidor
   (server/api-lib/_orgGuard.mjs, _route-organizations.mjs) -- misma
   convencion ya usada por src/domain/apuVersioning.js, technicalMemory.js,
   etc. (ver imports "../../src/domain/*.js" en server/api-lib). Unica fuente
   de verdad para "se vencio el trial" y "cuantos dias quedan": evita que
   cliente y servidor calculen fechas de forma distinta. */

export const ORG_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ACTIVE_TRIAL: 'ACTIVE_TRIAL',
  TRIAL_EXPIRED: 'TRIAL_EXPIRED',
  CONVERTED: 'CONVERTED',
  SUSPENDED: 'SUSPENDED',
});

// Rol de RESPONSABLE de UNA empresa dentro de su organizacion -- NO es
// administrador de ZOEMEC (ver src/domain/permissions.js#isAdminUser para el
// super_admin real, global). Antes se llamaba 'org_admin', renombrado a
// 'company_manager' (Endurecimiento de roles) porque el nombre + la etiqueta
// en pantalla ("Administrador") se confundian visualmente con el admin
// global de la plataforma. LEGACY_ORG_ROLE_MANAGER preserva el valor
// anterior para lectura de organizaciones ya creadas -- ver
// isOrgManagerRole() abajo, unica funcion que debe usarse para comparar un
// role guardado (nunca comparar contra ORG_ROLE.MANAGER a secas).
export const ORG_ROLE = Object.freeze({
  MANAGER: 'company_manager',
  COLLABORATOR: 'collaborator',
});
export const LEGACY_ORG_ROLE_MANAGER = 'org_admin';

export const MEMBER_STATUS = Object.freeze({
  ACTIVE: 'active',
  DISABLED: 'disabled',
});

export const INVITATION_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
});

export const MAX_ORG_MEMBERS = 10;
export const TRIAL_DURATION_DAYS = 30;
export const INVITE_TOKEN_TTL_DAYS = 7;
export const TRIAL_WARNING_DAYS = Object.freeze([7, 3, 1]);

const DAY_MS = 24 * 60 * 60 * 1000;

// Acepta Date, string ISO, numero (epoch ms) o Firestore Timestamp
// (objeto con .toDate()) sin importar si viene del Admin SDK o del cliente.
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function computeExpiresAt(activatedAt = new Date(), days = TRIAL_DURATION_DAYS) {
  const activated = toDate(activatedAt) || new Date();
  return new Date(activated.getTime() + days * DAY_MS);
}

/* Deriva el estado EFECTIVO de una organizacion: si el documento todavia dice
   ACTIVE_TRIAL pero ya paso expiresAt, se considera vencida aunque nadie haya
   escrito TRIAL_EXPIRED en Firestore todavia (el backend persiste esa
   transicion la primera vez que la observa, ver _orgGuard.mjs, pero la
   autorizacion real nunca depende de que ese escritura ya haya ocurrido). */
export function resolveOrgStatus(org, now = new Date()) {
  if (!org) return null;
  if (org.status === ORG_STATUS.ACTIVE_TRIAL) {
    const expiresAt = toDate(org.expiresAt);
    if (expiresAt && now.getTime() > expiresAt.getTime()) {
      return ORG_STATUS.TRIAL_EXPIRED;
    }
  }
  return org.status || null;
}

export function daysRemaining(org, now = new Date()) {
  const expiresAt = toDate(org?.expiresAt);
  if (!expiresAt) return null;
  const ms = expiresAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / DAY_MS));
}

// 7/3/1: el nivel de aviso mas urgente que aplica hoy, o null si faltan mas
// de 7 dias (o si ya vencio, donde el aviso pasa a ser el bloqueo, no esto).
export function trialWarningLevel(days) {
  if (days == null || days > TRIAL_WARNING_DAYS[0]) return null;
  if (days <= 1) return 1;
  if (days <= 3) return 3;
  return 7;
}

// Punto 5/7 del brief: durante ACTIVE_TRIAL (o ya CONVERTED a futuro) se
// puede crear contenido nuevo sin limite artificial; TRIAL_EXPIRED/SUSPENDED/
// PENDING bloquean creacion (lectura de lo existente sigue permitida, eso se
// resuelve aparte, no aqui).
export function canCreateContent(orgStatus) {
  return orgStatus === ORG_STATUS.ACTIVE_TRIAL || orgStatus === ORG_STATUS.CONVERTED;
}

export function isActiveTrialStatus(orgStatus) {
  return orgStatus === ORG_STATUS.ACTIVE_TRIAL;
}

// Unica funcion que debe usarse para saber si un `role` guardado corresponde
// al responsable de la empresa -- acepta el valor nuevo Y el legado
// (ver LEGACY_ORG_ROLE_MANAGER arriba).
export function isOrgManagerRole(role) {
  return role === ORG_ROLE.MANAGER || role === LEGACY_ORG_ROLE_MANAGER;
}

export function isActiveMember(member) {
  return Boolean(member) && member.status === MEMBER_STATUS.ACTIVE;
}

// Cuenta miembros activos + invitaciones pendientes (no expiradas) contra el
// tope de 10: una invitacion pendiente ya "reserva" un cupo, para que no se
// puedan mandar 15 invitaciones simultaneas y aceptarlas todas despues.
export function hasInviteCapacity(activeMemberCount, pendingInvitationCount, max = MAX_ORG_MEMBERS) {
  return (Number(activeMemberCount) || 0) + (Number(pendingInvitationCount) || 0) < max;
}

export function isInvitationUsable(invitation, now = new Date()) {
  if (!invitation || invitation.status !== INVITATION_STATUS.PENDING) return false;
  const expiresAt = toDate(invitation.expiresAt);
  if (expiresAt && now.getTime() > expiresAt.getTime()) return false;
  return true;
}

export const TRIAL_EXPIRED_MESSAGE =
  'Tu periodo de evaluacion de ZOEMEC ha finalizado. Tus proyectos permanecen guardados. Activa un plan para continuar trabajando.';

export const TRIAL_EXPORT_NOTICE = 'Generado durante periodo de evaluacion de ZOEMEC';

export function trialStatusLabel(org, now = new Date()) {
  const status = resolveOrgStatus(org, now);
  if (status === ORG_STATUS.ACTIVE_TRIAL) {
    const days = daysRemaining(org, now);
    return days === 1 ? 'Periodo de evaluacion empresarial: 1 dia restante' : `Periodo de evaluacion empresarial: ${days} dias restantes`;
  }
  if (status === ORG_STATUS.TRIAL_EXPIRED) return 'Periodo de evaluacion finalizado';
  return null;
}
