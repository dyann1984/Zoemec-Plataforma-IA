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
    res.status(200).json({ apu });
  }catch(err){
    res.status(err.status || 400).json({ error:err.message || 'No se pudo generar el APU con IA.' });
  }
}
