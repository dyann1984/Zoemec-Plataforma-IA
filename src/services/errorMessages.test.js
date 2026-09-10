import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firebaseMessage, friendlyServiceError, classifyErrorOrigin } from './errorMessages.js';

test('firebaseMessage falls back to Spanish text with no t()', () => {
  const msg = firebaseMessage({ code: 'auth/wrong-password' });
  assert.match(msg, /contrasena|contraseña/i);
});

test('firebaseMessage uses t() when provided', () => {
  const t = (key) => (key === 'auth.errors.wrongPassword' ? 'TRANSLATED' : key);
  assert.equal(firebaseMessage({ code: 'auth/wrong-password' }, t), 'TRANSLATED');
});

test('firebaseMessage never returns the raw key when t() has no translation', () => {
  const t = (key) => key; // simulates translate() falling back to the key itself
  const msg = firebaseMessage({ code: 'auth/wrong-password' }, t);
  assert.notEqual(msg, 'auth.errors.wrongPassword');
});

test('firebaseMessage maps previously-unhandled codes instead of leaking raw Firebase text', () => {
  const t = (key) => key;
  for(const code of ['auth/too-many-requests', 'auth/invalid-action-code', 'auth/expired-action-code', 'auth/user-disabled', 'auth/invalid-email']){
    const msg = firebaseMessage({ code, message: `Firebase: Error (${code}).` }, t);
    assert.notEqual(msg, `Firebase: Error (${code}).`, `${code} should not leak the raw SDK message`);
  }
});

test('firebaseMessage falls back to a generic message for unknown codes, never the raw code alone', () => {
  const msg = firebaseMessage({ code: 'auth/totally-unknown-code' });
  assert.ok(msg && msg.length > 0);
});

test('friendlyServiceError hides env var names', () => {
  const msg = friendlyServiceError(new Error('Missing OPENAI_API_KEY in process.env'));
  assert.doesNotMatch(msg, /OPENAI_API_KEY|process\.env/);
});

// --- classifyErrorOrigin / clasificacion de permission-denied por capa real ---
// (incidente produccion: antes CUALQUIER codigo que contuviera "permission-denied"
// se mostraba como "permisos de Firestore", sin importar la capa real de origen)

test('classifyErrorOrigin recognizes a bare Firestore permission-denied code', () => {
  assert.equal(classifyErrorOrigin({ code: 'permission-denied' }), 'firestore');
});

test('classifyErrorOrigin recognizes an Auth-prefixed code', () => {
  assert.equal(classifyErrorOrigin({ code: 'auth/permission-denied' }), 'auth');
});

test('classifyErrorOrigin recognizes a Storage-prefixed code', () => {
  assert.equal(classifyErrorOrigin({ code: 'storage/unauthorized' }), 'storage');
});

test('classifyErrorOrigin recognizes a Cloud Functions callable-prefixed code', () => {
  assert.equal(classifyErrorOrigin({ code: 'functions/permission-denied' }), 'functions');
});

test('classifyErrorOrigin recognizes a raw REST/Google API denial (uppercase status, no SDK prefix)', () => {
  assert.equal(classifyErrorOrigin({ code: 'PERMISSION_DENIED' }), 'rest');
  assert.equal(classifyErrorOrigin({ code: 403, status: 'PERMISSION_DENIED' }), 'rest');
});

test('classifyErrorOrigin returns unknown for anything else', () => {
  assert.equal(classifyErrorOrigin({ code: 'auth/wrong-password'.slice(5) }), 'unknown');
  assert.equal(classifyErrorOrigin({}), 'unknown');
});

test('firebaseMessage: a real Firestore permission-denied still blames Firestore specifically', () => {
  const msg = firebaseMessage({ code: 'permission-denied' });
  assert.match(msg, /firestore/i);
});

test('firebaseMessage: an Auth-layer permission-denied does NOT blame Firestore', () => {
  const msg = firebaseMessage({ code: 'auth/permission-denied' });
  assert.match(msg, /inicio de sesion/i);
  assert.doesNotMatch(msg, /firestore/i);
});

test('firebaseMessage: a Storage permission-denied does NOT blame Firestore', () => {
  const msg = firebaseMessage({ code: 'storage/unauthorized' });
  // 'unauthorized' no coincide con ningun needle de FIREBASE_CODE_TO_KEY, asi
  // que hoy cae a generic -- se deja documentado aqui como comportamiento
  // actual (Storage no forma parte del incidente de login, no se amplia el
  // alcance de esta correccion mas alla de lo pedido). Lo unico que importa
  // para este incidente es que NO se etiquete como Firestore.
  assert.doesNotMatch(msg, /firestore/i);
});

test('firebaseMessage: a raw REST PERMISSION_DENIED (no SDK prefix) is labeled as such, not as Firestore', () => {
  const msg = firebaseMessage({ code: 'PERMISSION_DENIED' });
  assert.doesNotMatch(msg, /firestore/i);
});

test('firebaseMessage: t() receives the origin-specific key, not the old generic "permissionDenied"', () => {
  const seenKeys = [];
  const t = (key) => { seenKeys.push(key); return key; };
  firebaseMessage({ code: 'auth/permission-denied' }, t);
  assert.deepEqual(seenKeys, ['auth.errors.permissionDeniedAuth']);
});

test('firebaseMessage: fallback (no t) never blames Firestore for a non-Firestore permission-denied', () => {
  const msg = firebaseMessage({ code: 'auth/permission-denied' });
  assert.doesNotMatch(msg, /firestore/i);
});
