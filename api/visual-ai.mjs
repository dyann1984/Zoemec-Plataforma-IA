import { FieldValue, getAdminDb } from './_firebaseAdmin.mjs';

const SYSTEM = `Eres ZOEMEC Visual IA, asistente tecnico para arquitectura, construccion y obra.
Responde en espanol, con criterio profesional, supuestos claros y alcance presupuestable.
Entrega: diagnostico visual, propuesta, materiales, riesgos, partidas de presupuesto y siguientes pasos.`;

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error:'Metodo no permitido.' });
    return;
  }
  try{
    if(!process.env.OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY en Vercel.');
    const { image, fileName, mode='fachada', prompt='', uid, email } = req.body || {};
    if(!prompt.trim()) throw new Error('Escribe una instruccion para la IA.');

    const content = [
      { type:'input_text', text:`Modo: ${mode}\nArchivo: ${fileName || 'sin nombre'}\nSolicitud: ${prompt}` }
    ];
    if(image && String(image).startsWith('data:image/')){
      content.push({ type:'input_image', image_url:image });
    }

    const aiRes = await fetch('https://api.openai.com/v1/responses', {
      method:'POST',
      headers:{
        Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        model:process.env.OPENAI_VISUAL_MODEL || 'gpt-4.1-mini',
        input:[{ role:'system', content:SYSTEM }, { role:'user', content }],
        max_output_tokens:1200
      })
    });
    const data = await aiRes.json();
    if(!aiRes.ok) throw new Error(data.error?.message || 'OpenAI no pudo generar la respuesta.');
    const result = data.output_text || data.output?.flatMap(o=>o.content||[]).map(c=>c.text).filter(Boolean).join('\n') || 'Sin texto generado.';

    if(uid){
      try{
        const db = getAdminDb();
        await db.collection('visual_requests').add({
          uid,
          email:email || '',
          fileName:fileName || '',
          mode,
          prompt,
          result,
          createdAt:FieldValue.serverTimestamp()
        });
      }catch{}
    }

    res.status(200).json({ result });
  }catch(err){
    res.status(400).json({ error:err.message || 'No se pudo usar Visual IA.' });
  }
}
