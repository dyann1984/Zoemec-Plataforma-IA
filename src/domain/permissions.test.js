/* src/domain/permissions.js no tenia pruebas propias -- se descubrio al
   intentar importarlo desde un script de Node puro (dev-qa/roles-qa.mjs,
   Endurecimiento de roles) que import.meta.env sin guard tumbaba CUALQUIER
   import de este archivo fuera del bundler de Vite. Estas pruebas fijan el
   contrato de isAdminUser (super_admin, administrador GLOBAL de ZOEMEC --
   NO confundir con company_manager, ver organization.js#ORG_ROLE) tras el
   endurecimiento que le quito la rama de users/{uid}.role. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAdminUser, SUPERADMIN_EMAILS, canUse, PLAN_LIMITS, hasValidSession, userInitials } from './permissions.js';

test('SUPERADMIN_EMAILS trae el respaldo fijo (VITE_SUPERADMIN_EMAILS nunca esta configurada bajo Node puro)', () => {
  assert.deepEqual(SUPERADMIN_EMAILS, ['dianalopez161184@gmail.com']);
});

test('isAdminUser: el correo exacto de la cuenta autorizada SI es super_admin', () => {
  assert.equal(isAdminUser({ email: 'dianalopez161184@gmail.com' }, {}), true);
  assert.equal(isAdminUser({}, { email: 'DianaLopez161184@Gmail.com' }), true, 'normaliza mayusculas/espacios igual que antes');
});

test('isAdminUser: el custom claim real super_admin===true SI otorga acceso', () => {
  assert.equal(isAdminUser({ claims: { super_admin: true } }, {}), true);
});

test('isAdminUser: un custom claim con otro nombre (admin, el viejo) o en false NUNCA otorga acceso', () => {
  assert.equal(isAdminUser({ claims: { admin: true } }, {}), false, 'el claim viejo "admin" ya no cuenta -- solo "super_admin"');
  assert.equal(isAdminUser({ claims: { super_admin: false } }, {}), false);
});

// Endurecimiento de seguridad (auditoria de roles): ESTE es el comportamiento
// que cambio a proposito -- antes cualquiera de estos 4 valores en Firestore
// otorgaba super_admin; ahora ninguno lo hace, sin importar quien lo haya
// escrito ahi.
test('isAdminUser: NINGUN valor de profile.role otorga super_admin nunca mas (ni admin/administrator/administrador/superadmin)', () => {
  for(const role of ['admin', 'administrator', 'administrador', 'superadmin', 'ADMIN']){
    assert.equal(isAdminUser({}, { role, email: 'cualquiera@empresa.test' }), false, `role="${role}" ya no debe otorgar super_admin`);
  }
});

test('isAdminUser: un correo cualquiera (incluido uno de prueba QA) nunca es super_admin', () => {
  assert.equal(isAdminUser({ email: 'qa.manager@zoemec.test' }, {}), false);
  assert.equal(isAdminUser({}, { email: 'qa.usuario1@zoemec.test' }), false);
  assert.equal(isAdminUser(null, null), false);
  assert.equal(isAdminUser(undefined, undefined), false);
});

test('canUse: user.isAdmin (super_admin) sigue teniendo bypass total de limites de plan', () => {
  assert.equal(canUse({ isAdmin: true, plan: 'Gratis' }, 'apu', 999), true);
});

test('canUse: sin ser admin ni trial activo, respeta el limite del plan', () => {
  assert.equal(canUse({ plan: 'Gratis' }, 'apu', 1), false);
  assert.equal(canUse({ plan: 'Gratis' }, 'apu', 0), true);
});

test('hasValidSession / userInitials siguen funcionando igual (sin relacion con el endurecimiento de roles)', () => {
  assert.equal(hasValidSession({ email: 'a@b.com', plan: 'Gratis', uid: 'u1' }), true);
  assert.equal(hasValidSession({ email: 'a@b.com' }), false);
  assert.equal(userInitials('Beto Tester'), 'BT');
  assert.equal(userInitials('', 'zoe@empresa.com'), 'Z');
});
