import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logLoginTrace, errInfo, isPermissionDeniedCode, makeTraceId, createLoginTracer } from './loginDiagnostics.js';

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

test('makeTraceId returns a short, non-empty string, different on each call', () => {
  const a = makeTraceId();
  const b = makeTraceId();
  assert.equal(typeof a, 'string');
  assert.ok(a.length > 0 && a.length <= 8);
  assert.notEqual(a, b, 'dos ids seguidos no deberian colisionar en la practica');
});

test('createLoginTracer: todas las llamadas a .trace() comparten el mismo traceId en la salida', () => {
  const lines = [];
  const original = console.info;
  console.info = (...args) => lines.push(args);
  try{
    const tracer = createLoginTracer('abc123');
    tracer.trace('AUTH_SIGNIN_START');
    tracer.trace('AUTH_SIGNIN_SUCCESS');
    tracer.trace('LOGIN_CATCH', { stage: 'PROFILE_LOAD_START', code: 'permission-denied' });
  }finally{
    console.info = original;
  }
  assert.equal(lines.length, 3);
  for(const line of lines){
    assert.match(line[0], /abc123/, 'cada linea debe llevar el mismo traceId');
  }
  assert.equal(lines[0][1], 'AUTH_SIGNIN_START');
  assert.equal(lines[2][2].code, 'permission-denied');
});

test('createLoginTracer sin traceId explicito genera uno propio via makeTraceId', () => {
  const tracer = createLoginTracer();
  assert.equal(typeof tracer.traceId, 'string');
  assert.ok(tracer.traceId.length > 0);
});

test('createLoginTracer.trace nunca lanza, incluso si console esta roto', () => {
  const original = console.info;
  console.info = () => { throw new Error('console is broken'); };
  try{
    const tracer = createLoginTracer('abc123');
    assert.doesNotThrow(() => tracer.trace('LOGIN_START'));
  }finally{
    console.info = original;
  }
});
