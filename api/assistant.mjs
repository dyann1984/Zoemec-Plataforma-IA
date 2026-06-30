import { answerAssistant } from './_openaiApuCore.mjs';

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error:'Metodo no permitido.' });
    return;
  }
  try{
    const answer = await answerAssistant(req.body || {});
    res.status(200).json({ answer });
  }catch(err){
    res.status(400).json({ error:err.message || 'No se pudo responder con IA.' });
  }
}
