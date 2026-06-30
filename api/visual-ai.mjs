import { FieldValue, getAdminDb } from './_firebaseAdmin.mjs';
import { markFeatureUsed, requireFeature } from './_authGuard.mjs';

const SYSTEM = `Eres ZOEMEC Visual IA, asistente tecnico para arquitectura, construccion y obra.
Responde en espanol, con criterio profesional, supuestos claros y alcance presupuestable.
Entrega: diagnostico visual, propuesta, materiales, riesgos, partidas de presupuesto y siguientes pasos.`;

function dataUrlToBlob(dataUrl){
  const [meta='', b64=''] = String(dataUrl).split(',');
  const mime = meta.match(/data:(.*?);base64/)?.[1] || 'image/png';
  const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
  return new Blob([bytes], { type:mime });
}

function visualPrompt({ mode, prompt }){
  const modeText = {
    fachada:'Render arquitectonico realista de fachada o exterior, respetando la construccion existente y proponiendo materiales viables.',
    plano:'Visualizacion arquitectonica 3D conceptual a partir de plano, con volumenes claros, escala humana y materiales de obra.',
    interior:'Render de interiorismo constructivo, con acabados, iluminacion, mobiliario y detalles ejecutables.',
    obra:'Imagen tecnica de revision de obra con propuesta de mejora, seguridad, orden y alcance constructivo.'
  };
  return `${modeText[mode] || modeText.fachada}
Solicitud del usuario: ${prompt}
Estilo: profesional, realista, construccion mexicana, sin texto ni marcas de agua dentro de la imagen.
Debe conservar lo reconocible de la imagen de referencia cuando exista, mostrando la propuesta final de manera clara.`;
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error:'Metodo no permitido.' });
    return;
  }
  try{
    const authz = await requireFeature(req, 'visual');
    if(!process.env.OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY en Vercel.');
    const { image, fileName, mode='fachada', prompt='' } = req.body || {};
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
    let imageUrl = '';
    let imageB64 = '';
    let imageError = '';
    const imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
    const promptImage = visualPrompt({ mode, prompt });
    try{
      let imgRes;
      if(image && String(image).startsWith('data:image/')){
        const form = new FormData();
        form.append('model', imageModel);
        form.append('image', dataUrlToBlob(image), fileName || 'referencia.png');
        form.append('prompt', promptImage);
        form.append('size', process.env.OPENAI_IMAGE_SIZE || '1024x1024');
        imgRes = await fetch('https://api.openai.com/v1/images/edits', {
          method:'POST',
          headers:{ Authorization:`Bearer ${process.env.OPENAI_API_KEY}` },
          body:form
        });
      }else{
        imgRes = await fetch('https://api.openai.com/v1/images/generations', {
          method:'POST',
          headers:{
            Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type':'application/json'
          },
          body:JSON.stringify({
            model:imageModel,
            prompt:promptImage,
            size:process.env.OPENAI_IMAGE_SIZE || '1024x1024'
          })
        });
      }
      const imgData = await imgRes.json();
      if(!imgRes.ok) throw new Error(imgData.error?.message || 'OpenAI no pudo generar la imagen.');
      imageUrl = imgData.data?.[0]?.url || '';
      imageB64 = imgData.data?.[0]?.b64_json || '';
      if(!imageUrl && !imageB64) throw new Error('La respuesta de imagen no trajo archivo generado.');
    }catch(err){
      imageError = err.message || 'No se pudo generar la imagen.';
    }

    if(authz.uid){
      try{
        const db = getAdminDb();
        await db.collection('visual_requests').add({
          uid:authz.uid,
          email:authz.email || '',
          fileName:fileName || '',
          mode,
          prompt,
          result,
          imageGenerated:Boolean(imageUrl || imageB64),
          imageError,
          createdAt:FieldValue.serverTimestamp()
        });
      }catch{}
    }
    await markFeatureUsed(authz);

    res.status(200).json({ result: imageError ? `${result}\n\nImagen IA: ${imageError}` : result, imageUrl, imageB64, imageError });
  }catch(err){
    res.status(err.status || 400).json({ error:err.message || 'No se pudo usar Visual IA.' });
  }
}
