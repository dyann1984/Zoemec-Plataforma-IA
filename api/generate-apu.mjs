import { generateAPU, generateAPUv2 } from '../server/api-lib/_openaiApuCore.mjs';
import { markFeatureUsed, requireFeature } from '../server/api-lib/_authGuard.mjs';
import { loadOrgContext } from '../server/api-lib/_orgGuard.mjs';
import { getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';
import { runApuGeneration, wantsServerContext } from '../server/api-lib/_apuGenerateCore.mjs';

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error:'Metodo no permitido.' });
    return;
  }
  try{
    const authz = await requireFeature(req, 'apu');
    const body = req.body || {};
    // schema:'v2' es aditivo y opcional. projectId/contextMode (P0 paridad
    // ADMIN vs COLLABORATOR) activan la resolucion server-side del contexto
    // empresarial; sin ellos se conserva el comportamiento historico.
    const needsContext = wantsServerContext(body);
    const orgContext = needsContext ? await loadOrgContext(authz.uid) : null;
    const { apu, wantsV2, context } = await runApuGeneration({
      body, authz, orgContext,
      db: needsContext ? getAdminDb() : null,
      generate: (payload, { wantsV2: v2 }) => v2 ? generateAPUv2(payload) : generateAPU(payload)
    });
    await markFeatureUsed(authz);
    res.status(200).json(wantsV2 ? { ok:true, apu, schemaVersion:2, context } : { ok:true, apu, context });
  }catch(err){
    /* "error" se mantiene como string (compatibilidad con el frontend actual,
       que hace data?.error || fallback). ok/errorCode se agregan de forma
       aditiva para clientes nuevos, sin romper el contrato existente. */
    const message = err.message || 'No se pudo generar el APU con IA.';
    res.status(err.status || 400).json({ ok:false, error:message, errorCode:String(err.status || 400) });
  }
}
