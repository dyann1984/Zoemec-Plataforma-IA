/* Price Intelligence real: busca en la web (OpenAI Responses API + tool
   web_search, mismo mecanismo que api/market-price.mjs) precios de mercado
   REALES para un insumo, pidiendo VARIAS referencias por separado (no un
   promedio que la IA calcule por su cuenta) para poder calcular minimo /
   mediana / promedio / maximo / outliers de forma deterministica en este
   modulo, no en el modelo.

   OpenAI NUNCA decide el nivel de evidencia final: solo propone las
   referencias que encontro (proveedor, precio, presentacion, url). Este
   modulo es quien calcula estadisticas y clasifica MERCADO/REFERENCIAL/
   ESTIMADO_IA segun cuantas fuentes reales llegaron. */

const MODEL = process.env.OPENAI_PRICE_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';

async function callResponses(body){
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
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

function median(nums){
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* Outlier = precio que se desvia mas de 40% de la mediana de todas las
   referencias encontradas. Regla simple, explicita y documentada (no una
   caja negra): se usa solo para excluir del "precio recomendado", nunca para
   borrar la referencia -- el outlier se conserva y se marca, visible en la
   hoja FUENTES_PRECIOS para que un humano pueda revisar por que discrepa. */
function detectOutliers(precios, med){
  if(!(med > 0)) return precios.map(() => false);
  return precios.map(p => Math.abs(p - med) / med > 0.4);
}

function tipoTextoPara(kind){
  if(kind === 'labor') return 'salario base diario (por jornada, sin prestaciones) de este oficio de la construccion';
  if(kind === 'equipment') return 'costo de renta por dia de este equipo o maquinaria de construccion';
  if(kind === 'seguridad') return 'precio de venta al publico de esta pieza de equipo de proteccion personal (EPP), nueva';
  return 'precio unitario de venta de este material de construccion';
}

export async function searchMarketReferences({ description = '', unit = '', kind = 'materials', location = '', dateBase = '' } = {}){
  if(!process.env.OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY en Vercel.');
  const desc = String(description || '').trim();
  if(!desc) throw new Error('Falta la descripcion del insumo a consultar.');

  const prompt = `Busca en la web el ${tipoTextoPara(kind)} en Mexico${location ? ` (region de referencia: ${location})` : ''}, en pesos mexicanos (MXN), con fecha base ${dateBase || 'hoy'}:
"${desc}"${unit ? ` (unidad requerida para el calculo: ${unit})` : ''}

Consulta VARIAS fuentes mexicanas reales y distintas entre si, en este orden de prioridad: fabricante, distribuidor autorizado, proveedor especializado, cadena comercial reconocida (Home Depot Mexico, Construrama, ferreterias en linea, tabuladores CMIC/CNIC). Reporta cada fuente por separado -- NO promedies ni resumas tu mismo, eso lo calcula el sistema.

Si el precio de una fuente viene en una presentacion distinta a la unidad requerida (ej. cubeta 19L, saco 20kg, rollo 10m2, caja 1.44m2, millar de piezas), conviertelo a la unidad requerida y reporta el factor de conversion que usaste.

Devuelve SOLO un JSON valido, sin markdown ni texto adicional:
{
  "referencias": [
    {
      "proveedor": "nombre real de la fuente consultada",
      "url": "url real de la fuente",
      "precioOriginal": numero,
      "presentacionOriginal": "texto, ej. saco 20kg / cubeta 19L / pieza",
      "unidadOriginal": "texto",
      "factorConversion": numero (multiplicador para llegar a la unidad requerida; 1 si ya coincide),
      "precioNormalizado": numero (precio ya convertido a la unidad requerida),
      "fecha": "fecha de la fuente o de tu consulta"
    }
  ]
}
Incluye entre 1 y 4 referencias reales verificables. Si no encuentras ninguna fuente confiable, devuelve "referencias": [].`;

  const base = { model: MODEL, input: prompt };
  let out = await callResponses({ ...base, tools: [{ type: 'web_search' }] });
  if(!out.ok){
    out = await callResponses({
      ...base,
      tools: [{ type: 'web_search_preview', user_location: { type: 'approximate', country: 'MX' } }]
    });
  }
  if(!out.ok) throw new Error(out.data?.error?.message || `OpenAI API error ${out.status}`);

  const text = extractText(out.data);
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { referencias: [] };

  const referencias = (Array.isArray(parsed.referencias) ? parsed.referencias : [])
    .map(r => {
      const factorConversion = Number(r.factorConversion) > 0 ? Number(r.factorConversion) : 1;
      const precioOriginal = Number(r.precioOriginal) || 0;
      const precioNormalizado = Number(r.precioNormalizado) > 0 ? Number(r.precioNormalizado) : precioOriginal / factorConversion;
      return {
        proveedor: String(r.proveedor || '').trim(),
        url: String(r.url || '').trim(),
        precioOriginal,
        presentacionOriginal: String(r.presentacionOriginal || '').trim(),
        unidadOriginal: String(r.unidadOriginal || unit || '').trim(),
        factorConversion,
        precioNormalizado,
        fecha: String(r.fecha || '').trim()
      };
    })
    .filter(r => r.precioNormalizado > 0);

  if(!referencias.length){
    return { referencias: [], estadisticas: null, precioRecomendado: null, nivelEvidencia: 'ESTIMADO_IA' };
  }

  const precios = referencias.map(r => r.precioNormalizado);
  const med = median(precios);
  const outlierFlags = detectOutliers(precios, med);
  referencias.forEach((r, i) => { r.outlier = outlierFlags[i]; });
  const validos = precios.filter((_, i) => !outlierFlags[i]);
  const usados = validos.length ? validos : precios;

  const estadisticas = {
    minimo: Math.min(...precios),
    maximo: Math.max(...precios),
    mediana: median(usados),
    promedio: usados.reduce((a, b) => a + b, 0) / usados.length,
    nFuentes: referencias.length
  };
  const nivelEvidencia = referencias.length >= 2 ? 'MERCADO' : 'REFERENCIAL';
  return { referencias, estadisticas, precioRecomendado: estadisticas.mediana, nivelEvidencia };
}
