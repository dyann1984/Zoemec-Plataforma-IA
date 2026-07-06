import { requireFeature } from './_authGuard.mjs';

const MODEL = process.env.OPENAI_PRICE_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';

async function callResponses(body){
  const res = await fetch('https://api.openai.com/v1/responses', {
    method:'POST',
    headers:{
      Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify(body)
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

function extractText(data){
  if(data?.output_text) return data.output_text;
  const parts = (Array.isArray(data?.output) ? data.output : [])
    .filter(item => item?.type === 'message')
    .flatMap(item => Array.isArray(item.content) ? item.content : [])
    .filter(c => c?.type === 'output_text')
    .map(c => c.text || '');
  return parts.join('\n');
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error:'Metodo no permitido.' });
    return;
  }
  try{
    await requireFeature(req, 'ai');
    if(!process.env.OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY en Vercel.');

    const { description = '', unit = '', kind = 'materials' } = req.body || {};
    const desc = String(description).trim();
    if(!desc) throw new Error('Escribe la descripcion del insumo antes de consultar el precio.');

    const tipoTexto = kind === 'labor'
      ? 'salario base diario (por jornada) de este oficio de la construccion'
      : kind === 'equipment'
      ? 'costo de renta por dia de este equipo o herramienta de construccion'
      : 'precio unitario de venta de este material de construccion';

    const prompt = `Busca en la web el ${tipoTexto} HOY en Mexico, en pesos mexicanos (MXN):
"${desc}"${unit ? ` (unidad requerida: ${unit})` : ''}

Consulta fuentes mexicanas vigentes (Home Depot Mexico, Construrama, ferreterias en linea, tabuladores CMIC, listas de precios de construccion). Si el precio de la fuente esta en otra presentacion (bulto, caja, rollo), conviertelo a la unidad requerida y explicalo en notes.

Devuelve SOLO un JSON valido, sin markdown ni texto adicional:
{
  "price": numero (precio tipico por ${unit || 'unidad'}, sin IVA si es posible),
  "priceMin": numero,
  "priceMax": numero,
  "currency": "MXN",
  "source": "nombre de la fuente principal consultada",
  "url": "url de la fuente principal",
  "date": "fecha de la consulta",
  "notes": "aclaracion breve: presentacion original, conversion aplicada, si incluye IVA"
}`;

    const base = { model: MODEL, input: prompt };

    // Intento 1: herramienta web_search actual; Intento 2: web_search_preview (modelos 4.1)
    let out = await callResponses({ ...base, tools:[{ type:'web_search' }] });
    if(!out.ok){
      out = await callResponses({
        ...base,
        tools:[{ type:'web_search_preview', user_location:{ type:'approximate', country:'MX' } }]
      });
    }
    if(!out.ok) throw new Error(out.data?.error?.message || `OpenAI API error ${out.status}`);

    const text = extractText(out.data);
    if(!text) throw new Error('La busqueda web no devolvio contenido.');

    const clean = text.replace(/```json|```/g, '').trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if(!jsonMatch) throw new Error('No pude interpretar el precio devuelto por la busqueda.');

    const quote = JSON.parse(jsonMatch[0]);
    quote.price = Number(quote.price) || 0;
    quote.priceMin = Number(quote.priceMin) || quote.price;
    quote.priceMax = Number(quote.priceMax) || quote.price;
    if(!(quote.price > 0)) throw new Error('La busqueda no encontro un precio confiable para este insumo.');

    res.status(200).json({ quote });
  }catch(err){
    res.status(err.status || 400).json({ error: err.message || 'No se pudo consultar el precio de mercado.' });
  }
}
