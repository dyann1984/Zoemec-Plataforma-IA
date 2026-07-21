import { generateAPU } from './_openaiApuCore.mjs';
import { markFeatureUsed, requireFeature } from './_authGuard.mjs';

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error:'Metodo no permitido.' });
    return;
  }
  try{
    const authz = await requireFeature(req, 'apu');
    const apu = await generateAPU(req.body || {});
    await markFeatureUsed(authz);
    res.status(200).json({ ok:true, apu });
  }catch(err){
    /* "error" se mantiene como string (compatibilidad con el frontend actual,
       que hace data?.error || fallback). ok/errorCode se agregan de forma
       aditiva para clientes nuevos, sin romper el contrato existente. */
    const message = err.message || 'No se pudo generar el APU con IA.';
    res.status(err.status || 400).json({ ok:false, error:message, errorCode:String(err.status || 400) });
  }
}
