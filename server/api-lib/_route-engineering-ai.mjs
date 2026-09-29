import { requireAuth, requireFeature, requireSuperAdmin } from './_authGuard.mjs';
import { loadOrgContext, assertOrgNotExpired } from './_orgGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { nebiusConfig } from './_nebiusProvider.mjs';
import { runEngineeringAnalysis } from './_engineeringOrchestrator.mjs';
import { aiError } from './_engineeringContext.mjs';

const MESSAGES = {
  NEBIUS_NOT_CONFIGURED: 'Nebius no configurado. Un administrador debe configurar la clave en el servidor.',
  NEBIUS_CONFIG_ERROR: 'La configuración de Nebius necesita revisión del administrador.',
  FORBIDDEN: 'No tienes acceso al proyecto o APU solicitado.',
  INSUFFICIENT_EVIDENCE: 'ZOEMEC no dispone de evidencia suficiente para responder con confianza.',
  INVALID_MODEL_OUTPUT: 'La respuesta no superó la validación de evidencia. Intenta reformular la pregunta.',
  NEBIUS_API_ERROR: 'Nebius no pudo completar el análisis. Intenta de nuevo.',
  NEBIUS_TIMEOUT: 'Nebius tardó demasiado. Intenta de nuevo.',
  NEBIUS_RATE_LIMIT: 'Nebius alcanzó su límite de solicitudes. Intenta más tarde.',
  CONTEXT_LIMIT: 'El proyecto excede el límite de contexto. Selecciona un APU para analizarlo.',
  INVALID_REQUEST: 'Revisa el proyecto y la pregunta.', INVALID_SCENARIO: 'Revisa los parámetros del escenario.'
};
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      if (req.query?.admin === '1') {
        await requireSuperAdmin(req);
        const config = nebiusConfig();
        const snap = await getAdminDb().collection('engineeringAiAudit').orderBy('timestamp', 'desc').limit(100).get();
        const records = snap.docs.map(d => d.data());
        const successes = records.filter(r => r.status === 'success');
        const measured = records.filter(r => Number.isFinite(r.latencyMs));
        return res.status(200).json({ provider: 'Nebius', model: config.model,
          status: !config.apiKey ? 'No configurado' : records[0]?.status === 'success' ? 'Operativo' : records[0]?.status === 'error' ? 'Error' : 'Configurado; sin llamada verificada',
          sample: 'Últimos 100 análisis registrados', calls: records.length, successes: successes.length,
          errors: records.filter(r => r.status === 'error').length,
          latencyMs: measured.length ? Math.round(measured.reduce((s, r) => s + r.latencyMs, 0) / measured.length) : null,
          tokens: successes.some(r => Number.isFinite(r.usage?.total_tokens)) ? successes.reduce((s, r) => s + (r.usage?.total_tokens || 0), 0) : null,
          cost: null, latestRequestId: records[0]?.requestId || null });
      }
      await requireAuth(req);
      const config = nebiusConfig();
      return res.status(200).json({ configured: !!config.apiKey, provider: 'Nebius', model: config.model,
        status: config.apiKey ? 'Configurado; disponibilidad se comprueba al analizar' : 'Nebius no configurado' });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Método no permitido.' }); }
    const authz = await requireFeature(req, 'assistant', { deferRateLimit: true });
    const org = await loadOrgContext(authz.uid);
    if (org && org.member.status !== 'active') throw aiError('FORBIDDEN', 403);
    assertOrgNotExpired(org);
    const identity = { uid: authz.uid, organizationId: org?.organizationId || null, memberStatus: org?.member.status || null };
    return res.status(200).json(await runEngineeringAnalysis({ body: req.body, identity, db: getAdminDb(), consumeRateLimit: authz.consumeRateLimit }));
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    const code = MESSAGES[error.code] ? error.code : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR';
    return res.status(status).json({ ok: false, code, error: MESSAGES[code] || (status === 401 ? 'Inicia sesión para continuar.' : status === 429 ? 'Límite de solicitudes alcanzado. Intenta más tarde.' : 'No se pudo completar el análisis. Intenta de nuevo.') });
  }
}
