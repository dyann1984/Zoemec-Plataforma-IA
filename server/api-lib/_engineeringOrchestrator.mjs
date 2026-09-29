import { randomUUID, createHash } from 'node:crypto';
import { aiError, assertScope, buildEngineeringContext, cleanText } from './_engineeringContext.mjs';
import { ANALYSES, createNebiusProvider, nebiusConfig } from './_nebiusProvider.mjs';

export async function loadEngineeringProject(db, identity, projectId, apuId) {
  const snap = await db.collection('projects').doc(projectId).get();
  const project = snap.exists ? { ...snap.data(), id: snap.id } : null;
  assertScope(project, identity);
  if (project.archivedAt) throw aiError('FORBIDDEN', 403);
  let apus;
  if (apuId) {
    const apuSnap = await db.collection('apus').doc(apuId).get();
    const apu = apuSnap.exists ? { ...apuSnap.data(), id: apuSnap.id } : null;
    assertScope(apu, identity);
    if (apu.projectId !== projectId || apu.archivedAt) throw aiError('FORBIDDEN', 403);
    apus = [apu];
  } else {
    const docs = await db.collection('apus').where('projectId', '==', projectId).limit(21).get();
    apus = docs.docs.map(d => ({ ...d.data(), id: d.id })).filter(d => !d.archivedAt);
    apus.forEach(d => assertScope(d, identity));
  }
  // Project-scoped memory matches the existing Intelligence panel's project query.
  const [memorySnap, evidenceSnap] = await Promise.all([
    db.collection('technicalMemory').where('context.projectId', '==', projectId).limit(101).get(),
    db.collection('evidenceItems').where('projectId', '==', projectId).limit(101).get()
  ]);
  if (memorySnap.docs.length > 100 || evidenceSnap.docs.length > 100) throw aiError('CONTEXT_LIMIT', 413);
  const memory = memorySnap.docs.map(d => d.data()).filter(d => d.scope === 'PROJECT' && d.context?.projectId === projectId);
  const evidence = evidenceSnap.docs.map(d => ({ ...d.data(), id: d.id })).filter(d => {
    try { assertScope(d, identity); return true; } catch { return false; }
  });
  return { project, apus, memory, evidence };
}
export function validateEngineeringRequest(body) {
  if (!body || typeof body !== 'object' || JSON.stringify(body).length > 5000) throw aiError('INVALID_REQUEST');
  if (Object.keys(body).some(k => !['projectId', 'apuId', 'question', 'analysis', 'scenario'].includes(k))) throw aiError('INVALID_REQUEST');
  const id = v => typeof v === 'string' && /^[\w-]{1,160}$/.test(v);
  if (!id(body.projectId) || (body.apuId != null && !id(body.apuId)) || !ANALYSES.includes(body.analysis)) throw aiError('INVALID_REQUEST');
  if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 1000) throw aiError('INVALID_REQUEST');
  if (body.scenario && (!body.apuId || typeof body.scenario !== 'object' || Object.keys(body.scenario).some(k => !['kind', 'resourceDescripcion', 'value'].includes(k)))) throw aiError('INVALID_SCENARIO');
  return { ...body, question: cleanText(body.question, 1000) };
}
export async function runEngineeringAnalysis({ body, identity, db, consumeRateLimit, provider, env = process.env }) {
  const input = validateEngineeringRequest(body);
  const source = await loadEngineeringProject(db, identity, input.projectId, input.apuId);
  const { context, indicators } = buildEngineeringContext({ ...source, identity, scenario: input.scenario });
  const config = nebiusConfig(env);
  const requestId = randomUUID(); const started = Date.now();
  const record = { requestId, timestamp: new Date().toISOString(), tenant: identity.organizationId || `user:${identity.uid}`,
    user: identity.uid, projectId: input.projectId, apuId: input.apuId || null, provider: 'Nebius', model: config.model,
    analysis: input.analysis, contextHash: createHash('sha256').update(JSON.stringify(context)).digest('hex'),
    versions: indicators.map(i => ({ apuId: i.apuId, version: i.version })), status: 'started' };
  // Persist before consuming provider credits; fail closed if audit cannot be written.
  const auditRef = db.collection('engineeringAiAudit').doc(requestId);
  await auditRef.set(record);
  try {
    if (!source.apus.length) throw aiError('INSUFFICIENT_EVIDENCE', 422);
    if (!config.apiKey && !provider) throw aiError('NEBIUS_NOT_CONFIGURED', 503);
    await consumeRateLimit();
    const answer = await (provider || createNebiusProvider({ env }))[input.analysis]({ context, question: input.question });
    await auditRef.update({ status: 'success', latencyMs: Date.now() - started, evidenceRefs: answer.evidenceRefs.map(r => r.id),
      providerRequestId: answer.providerRequestId, usage: answer.usage });
    return { ok: true, answer, requestId, indicators, missingData: context.missingData,
      project: context.project, contextHash: record.contextHash, timestamp: record.timestamp };
  } catch (error) {
    const code = error.code || 'INTERNAL_ERROR';
    await auditRef.update({ status: 'error', errorCode: /^[A-Z_]+$/.test(code) ? code : 'INTERNAL_ERROR', latencyMs: Date.now() - started });
    throw error;
  }
}
