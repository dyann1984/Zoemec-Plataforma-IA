import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUserProfile } from './userProfile.js';

const fbUser = { uid: 'uid-abc', email: 'nuevo@zoemec.test', displayName: 'Nuevo Usuario' };

test('perfil inexistente (raw=null/undefined): no hay nada que normalizar, devuelve null', () => {
  assert.equal(normalizeUserProfile(null, fbUser), null);
  assert.equal(normalizeUserProfile(undefined, fbUser), null);
});

test('usuario nuevo (perfil ya completo y bien tipado): no necesita normalizacion, ningun campo se toca', () => {
  const raw = { uid: 'uid-abc', name: 'Nuevo Usuario', email: 'nuevo@zoemec.test', role: 'user', plan: 'Gratis', active: true, apusCreated: 0 };
  const { profile, needsNormalization, patch } = normalizeUserProfile(raw, fbUser);
  assert.equal(needsNormalization, false);
  assert.deepEqual(patch, {});
  assert.deepEqual(profile, raw);
});

test('usuario legacy sin "active": se rellena con true (arranque seguro), nada mas cambia', () => {
  const raw = { uid: 'uid-abc', name: 'Legacy', email: 'legacy@zoemec.test', role: 'user', plan: 'Gratis', apusCreated: 3 };
  const { profile, needsNormalization, patch } = normalizeUserProfile(raw, fbUser);
  assert.equal(needsNormalization, true);
  assert.deepEqual(patch, { active: true });
  assert.equal(profile.active, true);
  assert.equal(profile.role, 'user');
  assert.equal(profile.plan, 'Gratis');
});

test('usuario legacy sin "plan": se rellena con Gratis, nunca con un plan de pago', () => {
  const raw = { uid: 'uid-abc', name: 'Legacy', email: 'legacy@zoemec.test', role: 'user', active: true, apusCreated: 3 };
  const { patch, profile } = normalizeUserProfile(raw, fbUser);
  assert.deepEqual(patch, { plan: 'Gratis' });
  assert.equal(profile.plan, 'Gratis');
});

test('usuario legacy sin "role": se rellena con user, nunca con admin', () => {
  const raw = { uid: 'uid-abc', name: 'Legacy', email: 'legacy@zoemec.test', plan: 'Gratis', active: true, apusCreated: 3 };
  const { patch, profile } = normalizeUserProfile(raw, fbUser);
  assert.deepEqual(patch, { role: 'user' });
  assert.equal(profile.role, 'user');
});

test('admin real: role="admin" existente NUNCA se toca ni se degrada a "user"', () => {
  const raw = { uid: 'uid-admin', name: 'Admin ZOEMEC', email: 'admin@zoemec.test', role: 'admin', plan: 'Empresa', active: true, apusCreated: 12 };
  const { profile, needsNormalization, patch } = normalizeUserProfile(raw, { uid: 'uid-admin', email: 'admin@zoemec.test' });
  assert.equal(needsNormalization, false);
  assert.deepEqual(patch, {});
  assert.equal(profile.role, 'admin');
  assert.equal(profile.plan, 'Empresa');
});

test('cuenta desactivada a proposito (active:false explicito): NUNCA se reactiva sola', () => {
  const raw = { uid: 'uid-abc', name: 'Suspendido', email: 'x@zoemec.test', role: 'user', plan: 'Gratis', active: false, apusCreated: 0 };
  const { profile, needsNormalization, patch } = normalizeUserProfile(raw, fbUser);
  assert.equal(needsNormalization, false);
  assert.deepEqual(patch, {});
  assert.equal(profile.active, false);
});

test('tipos incorrectos (plan numerico, active como string) se tratan como ausentes y se corrigen al default seguro', () => {
  const raw = { uid: 'uid-abc', name: 'Raro', email: 'x@zoemec.test', role: 'user', plan: 12345, active: 'true', apusCreated: 5 };
  const { patch, profile } = normalizeUserProfile(raw, fbUser);
  assert.deepEqual(patch, { plan: 'Gratis', active: true });
  assert.equal(profile.plan, 'Gratis');
  assert.equal(profile.active, true);
});

test('perfil sin name/email/apusCreated tambien se completa con valores seguros derivados de fbUser', () => {
  const raw = { uid: 'uid-abc', role: 'user', plan: 'Gratis', active: true };
  const { patch, profile } = normalizeUserProfile(raw, fbUser);
  assert.equal(patch.name, 'Nuevo Usuario');
  assert.equal(patch.email, 'nuevo@zoemec.test');
  assert.equal(patch.apusCreated, 0);
  assert.equal(profile.name, 'Nuevo Usuario');
});

test('acceso de otro UID: el uid resultante SIEMPRE viene de fbUser, nunca del documento leido', () => {
  const rawWithForeignUid = { uid: 'uid-OTRO-USUARIO', name: 'X', email: 'x@zoemec.test', role: 'user', plan: 'Gratis', active: true };
  const { profile } = normalizeUserProfile(rawWithForeignUid, fbUser);
  assert.equal(profile.uid, fbUser.uid);
  assert.notEqual(profile.uid, 'uid-OTRO-USUARIO');
});

test('nunca muta el objeto raw original (funcion pura)', () => {
  const raw = { uid: 'uid-abc', name: 'Legacy', email: 'legacy@zoemec.test', role: 'user', plan: 'Gratis' };
  const snapshot = JSON.parse(JSON.stringify(raw));
  normalizeUserProfile(raw, fbUser);
  assert.deepEqual(raw, snapshot);
});
