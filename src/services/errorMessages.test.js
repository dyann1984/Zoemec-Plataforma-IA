import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firebaseMessage, friendlyServiceError } from './errorMessages.js';

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
