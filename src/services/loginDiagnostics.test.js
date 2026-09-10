import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logLoginTrace, errInfo, isPermissionDeniedCode } from './loginDiagnostics.js';

test('logLoginTrace never throws, even with no console available', () => {
  const original = console.info;
  console.info = () => { throw new Error('console is broken'); };
  try{
    assert.doesNotThrow(() => logLoginTrace('LOGIN_START'));
    assert.doesNotThrow(() => logLoginTrace('LOGIN_CATCH', { stage:'AUTH_SIGNIN_START', code:'auth/network-request-failed' }));
  }finally{
    console.info = original;
  }
});

test('errInfo extracts only code/name/message, nothing else from the error object', () => {
  const err = new Error('boom');
  err.code = 'permission-denied';
  err.name = 'FirebaseError';
  err.credential = { idToken: 'super-secret-token', password: 'hunter2' };
  const info = errInfo(err);
  assert.deepEqual(Object.keys(info).sort(), ['code', 'message', 'name']);
  assert.equal(info.code, 'permission-denied');
  assert.equal(info.name, 'FirebaseError');
  assert.equal(info.message, 'boom');
});

test('errInfo truncates the message to 200 characters', () => {
  const longMessage = 'x'.repeat(500);
  const info = errInfo({ message: longMessage });
  assert.equal(info.message.length, 200);
});

test('errInfo never throws on a missing/empty error', () => {
  assert.deepEqual(errInfo(undefined), { code: null, name: null, message: '' });
  assert.deepEqual(errInfo({}), { code: null, name: null, message: '' });
});

test('isPermissionDeniedCode matches Firestore-style and functions-callable-style codes', () => {
  assert.equal(isPermissionDeniedCode('permission-denied'), true);
  assert.equal(isPermissionDeniedCode('functions/permission-denied'), true);
});

test('isPermissionDeniedCode does not match unrelated or empty codes', () => {
  assert.equal(isPermissionDeniedCode('auth/wrong-password'), false);
  assert.equal(isPermissionDeniedCode(''), false);
  assert.equal(isPermissionDeniedCode(undefined), false);
});
