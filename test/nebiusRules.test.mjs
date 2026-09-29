import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
let env;
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-nebius-rules', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } }); });
after(async () => { await env?.cleanup(); });
test('AI audit cannot be forged or read directly even by superadmin; API controls access', async () => {
  for (const ctx of [env.unauthenticatedContext(), env.authenticatedContext('alice'), env.authenticatedContext('admin', { super_admin: true, email_verified: true })]) {
    await assertFails(ctx.firestore().doc('engineeringAiAudit/test').set({ status: 'success' }));
    await assertFails(ctx.firestore().doc('engineeringAiAudit/test').get());
  }
});
