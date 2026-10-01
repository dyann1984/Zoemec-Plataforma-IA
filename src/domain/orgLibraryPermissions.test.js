import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canReadOrgLibrary, canManageOrgLibrary, resolvePaidFeatureEntitlement } from './orgLibraryPermissions.js';

const ctx = (role, status = 'active', orgStatus = 'CONVERTED') => ({ organizationId: 'ORG-1', member: { role, status }, status: orgStatus });

test('lectura: cualquier miembro ACTIVO, sin importar el rol', () => {
  assert.equal(canReadOrgLibrary(ctx('company_manager')), true);
  assert.equal(canReadOrgLibrary(ctx('collaborator')), true);
  assert.equal(canReadOrgLibrary(ctx('org_admin')), true);
  assert.equal(canReadOrgLibrary(ctx('collaborator', 'disabled')), false);
  assert.equal(canReadOrgLibrary(null), false);
});

test('administracion: solo responsable activo de una empresa que puede crear contenido', () => {
  assert.equal(canManageOrgLibrary(ctx('company_manager')), true);
  assert.equal(canManageOrgLibrary(ctx('org_admin', 'active', 'ACTIVE_TRIAL')), true);
  assert.equal(canManageOrgLibrary(ctx('collaborator')), false);
  assert.equal(canManageOrgLibrary(ctx('company_manager', 'disabled')), false);
  assert.equal(canManageOrgLibrary(ctx('company_manager', 'active', 'TRIAL_EXPIRED')), false);
  assert.equal(canManageOrgLibrary(null), false);
});

test('derecho a IA por membresia: empresa CONVERTED o en trial cubre por igual a responsable y colaborador', () => {
  // Antes solo ACTIVE_TRIAL daba el derecho: un colaborador de empresa
  // CONVERTED caia a su plan personal (Gratis, sin IA) -> Price Intelligence 402.
  for(const orgStatus of ['CONVERTED', 'ACTIVE_TRIAL']){
    const r = resolvePaidFeatureEntitlement({ orgStatus, memberStatus: 'active' });
    assert.deepEqual(r, { bypassPlanLimits: true, source: 'organization' }, orgStatus);
  }
});

test('sin derecho: trial vencido, suspendida, membresia deshabilitada o sin empresa', () => {
  assert.equal(resolvePaidFeatureEntitlement({ orgStatus: 'TRIAL_EXPIRED', memberStatus: 'active' }).bypassPlanLimits, false);
  assert.equal(resolvePaidFeatureEntitlement({ orgStatus: 'SUSPENDED', memberStatus: 'active' }).bypassPlanLimits, false);
  assert.equal(resolvePaidFeatureEntitlement({ orgStatus: 'CONVERTED', memberStatus: 'disabled' }).bypassPlanLimits, false);
  assert.equal(resolvePaidFeatureEntitlement({}).bypassPlanLimits, false);
  assert.deepEqual(resolvePaidFeatureEntitlement({ isSuperAdmin: true }), { bypassPlanLimits: true, source: 'super_admin' });
});

test('la funcion de derecho no recibe rol: el rol no puede influir', () => {
  const src = resolvePaidFeatureEntitlement.toString();
  assert.doesNotMatch(src, /role/);
});
