import { generateAPU, generateAPUv2 } from '../server/api-lib/_openaiApuCore.mjs';
import { markFeatureUsed, requireFeature } from '../server/api-lib/_authGuard.mjs';

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error:'Metodo no permitido.' });
    return;
  }
  try{
    const authz = await requireFeature(req, 'apu');
    // schema:'v2' es aditivo y opcional: nadie en la UI actual lo manda, asi
    // que el flujo por defecto (sin ese campo) sigue devolviendo exactamente
    // el mismo shape { ok, apu } de siempre.
    const wantsV2 = req.body?.schema === 'v2';
    const apu = wantsV2 ? await generateAPUv2(req.body || {}) : await generateAPU(req.body || {});
    await markFeatureUsed(authz);
    res.status(200).json(wantsV2 ? { ok:true, apu, schemaVersion:2 } : { ok:true, apu });
  }catch(err){
    /* "error" se mantiene como string (compatibilidad con el frontend actual,
       que hace data?.error || fallback). ok/errorCode se agregan de forma
       aditiva para clientes nuevos, sin romper el contrato existente. */
    const message = err.message || 'No se pudo generar el APU con IA.';
    res.status(err.status || 400).json({ ok:false, error:message, errorCode:String(err.status || 400) });
  }
}
