import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createNebiusDemo } from '../src/domain/nebiusDemo.js';
process.env.NEBIUS_API_KEY = '';
process.env.FIREBASE_PROJECT_ID = 'demo-zoemec-nebius';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Emulators required');
const { getAdminDb, getAdminAuth } = await import('../server/api-lib/_firebaseAdmin.mjs');
const { default: handler } = await import('../api/gateway.mjs');
const db = getAdminDb(); const auth = getAdminAuth(); const tokens = {};
const fixture = createNebiusDemo({ ownerUid: 'api-alice', organizationId: 'api-orgA' });
// Keep API test data separate from the judge's persistent emulator fixture.
fixture.project.id = 'nebius-api-test-project';
fixture.apus[0].id = 'nebius-api-test-apu';
fixture.apus[0].projectId = fixture.project.id;
fixture.apus[0].snapshot.id = fixture.apus[0].id;
fixture.apus[0].snapshot.projectId = fixture.project.id;
before(async () => {
  for (const [uid, org, status, admin] of [['api-alice', 'api-orgA', 'active', false], ['api-bob', 'api-orgB', 'active', false], ['api-disabled', 'api-orgA', 'disabled', false], ['api-admin', null, 'active', true]]) {
    try { await auth.createUser({ uid, email: `${uid}@example.test`, password: 'Testing123!', emailVerified: true }); } catch (e) { if (e.code !== 'auth/uid-already-exists' && e.code !== 'auth/email-already-exists') throw e; }
    if (admin) await auth.setCustomUserClaims(uid, { super_admin: true });
    await db.doc(`users/${uid}`).set({ uid, active: true, organizationId: org, plan: 'Empresa' });
    if (org) {
      await db.doc(`organizations/${org}`).set({ id: org, status: 'CONVERTED' });
      await db.doc(`organizations/${org}/members/${uid}`).set({ uid, status, role: 'collaborator' });
    }
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${uid}@example.test`, password: 'Testing123!', returnSecureToken: true }) });
    tokens[uid] = (await response.json()).idToken;
    assert.ok(tokens[uid]);
  }
  await db.doc(`projects/${fixture.project.id}`).set(fixture.project);
  await db.doc(`apus/${fixture.apus[0].id}`).set(fixture.apus[0]);
});
async function call({ uid, method = 'POST', body, query = {} } = {}) {
  const result = { status: null, body: null, headers: {} };
  await handler({ method, url: '/api/engineering-ai', headers: uid ? { authorization: `Bearer ${tokens[uid]}` } : {}, query,
    body: body || { projectId: fixture.project.id, apuId: fixture.apus[0].id, analysis: 'explainRisk', question: 'Explica riesgo' } },
  { setHeader(k, v) { result.headers[k] = v; }, status(n) { result.status = n; return this; }, json(b) { result.body = b; } });
  return result;
}
test('Unauthenticated request rejected', async () => assert.equal((await call()).status, 401));
test('Tenant B cannot read tenant A', async () => assert.equal((await call({ uid: 'api-bob' })).status, 403));
test('Disabled member cannot read company context', async () => assert.equal((await call({ uid: 'api-disabled' })).status, 403));
test('Superadmin does not bypass tenant scope', async () => assert.equal((await call({ uid: 'api-admin' })).status, 403));
test('Configured status is truthful and authenticated', async () => {
  const r = await call({ uid: 'api-alice', method: 'GET' });
  assert.equal(r.body.configured, false); assert.equal(r.headers['Cache-Control'], 'no-store');
});
test('Authorized project without API key returns specific safe state', async () => {
  const r = await call({ uid: 'api-alice' });
  assert.equal(r.status, 503); assert.equal(r.body.code, 'NEBIUS_NOT_CONFIGURED');
});
test('Telemetry endpoint restricted to superadmin', async () => {
  assert.equal((await call({ uid: 'api-alice', method: 'GET', query: { admin: '1' } })).status, 403);
  const admin = await call({ uid: 'api-admin', method: 'GET', query: { admin: '1' } });
  assert.equal(admin.status, 200); assert.equal(admin.body.cost, null);
});
test('Rate limit enforced across requests using existing atomic quota', async () => {
  process.env.NEBIUS_API_KEY = 'test-never-sent';
  await db.doc('rateLimits/api-alice_assistant').set({ windowStart: Date.now(), count: 40 });
  const r = await call({ uid: 'api-alice' });
  process.env.NEBIUS_API_KEY = '';
  assert.equal(r.status, 429);
});
test('Unsupported method is rejected', async () => assert.equal((await call({ method: 'DELETE', uid: 'api-alice' })).status, 405));
