import { answerAssistant } from './_openaiApuCore.mjs';
import { markFeatureUsed, requireFeature } from './_authGuard.mjs';

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error:'Metodo no permitido.' });
    return;
  }
  try{
    const authz = await requireFeature(req, 'assistant');
    const answer = await answerAssistant(req.body || {});
    await markFeatureUsed(authz);
    res.status(200).json({ ok:true, answer });
  }catch(err){
    const message = err.message || 'No se pudo responder con IA.';
    res.status(err.status || 400).json({ ok:false, error:message, errorCode:String(err.status || 400) });
  }
}
