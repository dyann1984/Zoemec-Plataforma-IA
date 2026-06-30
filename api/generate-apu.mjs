import { generateAPU } from './_openaiApuCore.mjs';

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error:'Metodo no permitido.' });
    return;
  }
  try{
    const apu = await generateAPU(req.body || {});
    res.status(200).json({ apu });
  }catch(err){
    res.status(400).json({ error:err.message || 'No se pudo generar el APU con IA.' });
  }
}
