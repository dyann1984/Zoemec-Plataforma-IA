// Explicit manual live check, NEVER part of automated tests. Only sends controlled demo data.
import { writeFile } from 'node:fs/promises';
import { createNebiusDemo } from '../src/domain/nebiusDemo.js';
import { buildEngineeringContext } from '../server/api-lib/_engineeringContext.mjs';
import { createNebiusProvider } from '../server/api-lib/_nebiusProvider.mjs';
const { context } = buildEngineeringContext({ ...createNebiusDemo(), identity: { uid: 'nebius-demo-engineer', organizationId: 'nebius-demo-org', memberStatus: 'active' } });
const start = Date.now();
try {
  const result = await createNebiusProvider().analyzeProjectContext({ context, question: 'Resume riesgos y acciones prioritarias usando la evidencia sintética DEMO.' });
  const proof = { checkedAt: new Date().toISOString(), provider: result.provider, model: result.model,
    providerRequestId: result.providerRequestId, usage: result.usage, latencyMs: Date.now() - start,
    status: 'real_call_validated', evidenceRefs: result.evidenceRefs.map(r => r.id) };
  await writeFile('docs/NEBIUS_REAL_CALL.json', JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
} catch (error) {
  console.error(error.code || 'NEBIUS_CHECK_FAILED'); process.exitCode = 1;
}
