import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORG_STATUS,
  MEMBER_STATUS,
  INVITATION_STATUS,
  MAX_ORG_MEMBERS,
  TRIAL_DURATION_DAYS,
  computeExpiresAt,
  resolveOrgStatus,
  daysRemaining,
  trialWarningLevel,
  canCreateContent,
  isActiveTrialStatus,
  isOrgManagerRole,
  isActiveMember,
  hasInviteCapacity,
  isInvitationUsable,
  ORG_ROLE,
  LEGACY_ORG_ROLE_MANAGER,
} from './organization.js';

test('computeExpiresAt suma 30 dias por defecto', () => {
  const activated = new Date('2026-01-01T00:00:00.000Z');
  const expires = computeExpiresAt(activated);
  assert.equal(expires.toISOString(), '2026-01-31T00:00:00.000Z');
});

test('resolveOrgStatus deja ACTIVE_TRIAL igual si no ha vencido', () => {
  const org = { status: ORG_STATUS.ACTIVE_TRIAL, expiresAt: '2026-02-01T00:00:00.000Z' };
  const now = new Date('2026-01-15T00:00:00.000Z');
  assert.equal(resolveOrgStatus(org, now), ORG_STATUS.ACTIVE_TRIAL);
});

test('resolveOrgStatus deriva TRIAL_EXPIRED aunque el documento aun diga ACTIVE_TRIAL', () => {
  const org = { status: ORG_STATUS.ACTIVE_TRIAL, expiresAt: '2026-01-01T00:00:00.000Z' };
  const now = new Date('2026-01-02T00:00:00.000Z');
  assert.equal(resolveOrgStatus(org, now), ORG_STATUS.TRIAL_EXPIRED);
});

test('resolveOrgStatus respeta estados que no son trial (SUSPENDED/CONVERTED)', () => {
  assert.equal(resolveOrgStatus({ status: ORG_STATUS.SUSPENDED, expiresAt: '2020-01-01' }), ORG_STATUS.SUSPENDED);
  assert.equal(resolveOrgStatus({ status: ORG_STATUS.CONVERTED, expiresAt: '2020-01-01' }), ORG_STATUS.CONVERTED);
});

test('resolveOrgStatus acepta Firestore Timestamp (objeto con toDate())', () => {
  const org = { status: ORG_STATUS.ACTIVE_TRIAL, expiresAt: { toDate: () => new Date('2026-01-01T00:00:00.000Z') } };
  const now = new Date('2026-01-02T00:00:00.000Z');
  assert.equal(resolveOrgStatus(org, now), ORG_STATUS.TRIAL_EXPIRED);
});

test('resolveOrgStatus devuelve null sin organizacion', () => {
  assert.equal(resolveOrgStatus(null), null);
});

test('daysRemaining redondea hacia arriba y nunca es negativo', () => {
  const org = { expiresAt: '2026-01-10T00:00:00.000Z' };
  assert.equal(daysRemaining(org, new Date('2026-01-09T00:00:00.000Z')), 1);
  assert.equal(daysRemaining(org, new Date('2026-01-09T12:00:00.000Z')), 1);
  assert.equal(daysRemaining(org, new Date('2026-01-10T00:00:00.000Z')), 0);
  assert.equal(daysRemaining(org, new Date('2026-02-01T00:00:00.000Z')), 0);
});

test('daysRemaining es null sin expiresAt valido', () => {
  assert.equal(daysRemaining({}), null);
  assert.equal(daysRemaining({ expiresAt: 'no-es-fecha' }), null);
});

test('trialWarningLevel solo dispara en 7/3/1 dias, nunca antes', () => {
  assert.equal(trialWarningLevel(30), null);
  assert.equal(trialWarningLevel(8), null);
  assert.equal(trialWarningLevel(7), 7);
  assert.equal(trialWarningLevel(4), 7);
  assert.equal(trialWarningLevel(3), 3);
  assert.equal(trialWarningLevel(2), 3);
  assert.equal(trialWarningLevel(1), 1);
  assert.equal(trialWarningLevel(0), 1);
  assert.equal(trialWarningLevel(null), null);
});

test('canCreateContent solo es true en ACTIVE_TRIAL o CONVERTED', () => {
  assert.equal(canCreateContent(ORG_STATUS.ACTIVE_TRIAL), true);
  assert.equal(canCreateContent(ORG_STATUS.CONVERTED), true);
  assert.equal(canCreateContent(ORG_STATUS.TRIAL_EXPIRED), false);
  assert.equal(canCreateContent(ORG_STATUS.SUSPENDED), false);
  assert.equal(canCreateContent(ORG_STATUS.PENDING), false);
  assert.equal(canCreateContent(undefined), false);
});

test('isActiveTrialStatus / isOrgManagerRole', () => {
  assert.equal(isActiveTrialStatus(ORG_STATUS.ACTIVE_TRIAL), true);
  assert.equal(isActiveTrialStatus(ORG_STATUS.TRIAL_EXPIRED), false);
  assert.equal(isOrgManagerRole(ORG_ROLE.MANAGER), true);
  assert.equal(isOrgManagerRole('collaborator'), false);
});

// Endurecimiento de roles: org_admin -> company_manager, con compatibilidad --
// una organizacion creada ANTES de este renombrado sigue reconociendo a su
// responsable (isOrgManagerRole acepta ambos valores), pero ORG_ROLE.MANAGER
// ya nunca es el valor legado.
test('isOrgManagerRole acepta el valor legado org_admin ademas del nuevo company_manager', () => {
  assert.equal(ORG_ROLE.MANAGER, 'company_manager');
  assert.equal(LEGACY_ORG_ROLE_MANAGER, 'org_admin');
  assert.equal(isOrgManagerRole(LEGACY_ORG_ROLE_MANAGER), true);
  assert.equal(isOrgManagerRole('company_manager'), true);
  assert.equal(isOrgManagerRole('super_admin'), false);
  assert.equal(isOrgManagerRole(undefined), false);
});

test('isActiveMember exige status active exacto', () => {
  assert.equal(isActiveMember({ status: MEMBER_STATUS.ACTIVE }), true);
  assert.equal(isActiveMember({ status: MEMBER_STATUS.DISABLED }), false);
  assert.equal(isActiveMember(null), false);
});

test('hasInviteCapacity respeta el tope de 10 (miembros activos + invitaciones pendientes)', () => {
  assert.equal(hasInviteCapacity(9, 0), true);
  assert.equal(hasInviteCapacity(10, 0), false);
  assert.equal(hasInviteCapacity(5, 4), true);
  assert.equal(hasInviteCapacity(5, 5), false);
  assert.equal(hasInviteCapacity(0, MAX_ORG_MEMBERS), false);
});

test('isInvitationUsable exige status pending y no vencida', () => {
  const now = new Date('2026-01-10T00:00:00.000Z');
  assert.equal(isInvitationUsable({ status: INVITATION_STATUS.PENDING, expiresAt: '2026-01-20T00:00:00.000Z' }, now), true);
  assert.equal(isInvitationUsable({ status: INVITATION_STATUS.PENDING, expiresAt: '2026-01-01T00:00:00.000Z' }, now), false);
  assert.equal(isInvitationUsable({ status: INVITATION_STATUS.ACCEPTED, expiresAt: '2026-01-20T00:00:00.000Z' }, now), false);
  assert.equal(isInvitationUsable(null, now), false);
});

test('TRIAL_DURATION_DAYS y MAX_ORG_MEMBERS son los valores del brief', () => {
  assert.equal(TRIAL_DURATION_DAYS, 30);
  assert.equal(MAX_ORG_MEMBERS, 10);
});
