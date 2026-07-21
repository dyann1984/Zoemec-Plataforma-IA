const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

/* OpenAI casi siempre responde JSON, pero ante timeouts, cortes de red o errores
   de infraestructura puede llegar un cuerpo vacio o truncado. response.json()
   en ese caso lanza "Unexpected end of JSON input" tal cual, y ese texto tecnico
   terminaba visible para el usuario final. Aqui se lee el texto primero y se
   deja un mensaje claro, con codigo de estado, si no se puede interpretar. */
async function readOpenAIJson(response){
  let text = '';
  try{ text = await response.text(); }catch{ text = ''; }
  if(!text || !text.trim()){
    const error = new Error(`OpenAI no devolvio contenido (HTTP ${response.status}).`);
    error.status = response.status === 200 ? 502 : response.status;
    throw error;
  }
  try{ return JSON.parse(text); }
  catch{
    const error = new Error(`OpenAI devolvio una respuesta con formato invalido (HTTP ${response.status}).`);
    error.status = 502;
    throw error;
  }
}

function openaiStatusMessage(status, fallback){
  if(status === 401) return 'La API key de OpenAI fue rechazada (401). Revisa OPENAI_API_KEY en Vercel.';
  if(status === 403) return 'OpenAI rechazo la solicitud por permisos (403).';
  if(status === 429) return 'OpenAI esta limitando las solicitudes por volumen (429). Intenta de nuevo en unos segundos.';
  if(status >= 500) return 'OpenAI no esta disponible en este momento (error de servidor).';
  return fallback;
}

export function extractJsonObject(text){
  if(typeof text !== 'string') return null;
  const trimmed = text.trim();
  let candidate = trimmed;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*)\s*```/i);
  if(fence && fence[1]) candidate = fence[1].trim();
  try{
    return JSON.parse(candidate);
  }catch{}
  const start = candidate.indexOf('{');
  if(start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for(let i = start; i < candidate.length; i++){
    const ch = candidate[i];
    if(inString){
      if(escape){ escape = false; }
      else if(ch === '\\') escape = true;
      else if(ch === '"') inString = false;
      continue;
    }
    if(ch === '"') inString = true;
    else if(ch === '{') depth++;
    else if(ch === '}') depth--;
    if(depth === 0 && i > start){
      const slice = candidate.slice(start, i + 1);
      try{ return JSON.parse(slice); }catch{}
    }
  }
  return null;
}

export async function generateAPU({ concept='', catalog=[], preserveOriginal=false, mode='' }){
  if(!process.env.OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY en Vercel.');
  const cleanConcept = String(concept || '').trim();
  if(!cleanConcept) throw new Error('Escribe un concepto para generar el APU.');
  const catalogSample = (Array.isArray(catalog) ? catalog : []).slice(0, 120).map(item => ({
    desc: item.desc,
    unidad: item.unidad,
    precio: Number(item.precio || 0)
  }));

  const preserveText = preserveOriginal ? 'Preserva el concepto original exactamente y no lo cambies de tema.' : '';
  const batchText = mode === 'batch-concept' ? 'Este APU forma parte de un lote de conceptos. Mantén el mismo enfoque tecnico para cada concepto y no homogenices respuestas entre ellos.' : '';
  const prompt = `Genera una cedula de analisis de precio unitario mexicano para este concepto EXACTO.

CONCEPTO ORIGINAL, NO LO CAMBIES DE TEMA:
${cleanConcept}

${preserveText}
${batchText}

CATALOGO DISPONIBLE. Usa estos precios cuando coincidan semanticamente:
${JSON.stringify(catalogSample)}

Devuelve SOLO JSON valido con esta forma:
{
  "concept": "mismo concepto original, solo corregido ortograficamente",
  "unit": "m2|m3|kg|m|pza|lote|...",
  "family": "familia tecnica detectada",
  "confidence": 0-100,
  "sat": "clave SAT sugerida",
  "materials": [["descripcion completa", cantidad, "unidad", precioUnitario, mermaPorcentaje]],
  "labor": [["descripcion completa", jornadas, "jor", salarioBase, fsr]],
  "equipment": [["descripcion completa", cantidad, "unidad", costo]],
  "herramienta": 3,
  "indCampo": 5,
  "indOficina": 5,
  "finance": 1,
  "utility": 12,
  "cargos": 0,
  "iva": 16,
  "notes": ["decisiones tecnicas breves, rendimientos asumidos, inclusiones y exclusiones"]
}

Reglas obligatorias:
- No cambies el concepto. Si el usuario pide estructura metalica, no generes lavabo, block, concreto ni otro tema.
- Si el concepto trae unidad entre parentesis como (KG), (M2), (PZA), esa unidad manda.
- Si el concepto trae "Objetivo: $X" o "P.U. referencia", arma el APU para acercarse al precio objetivo sin meter ajustes absurdos.
- Si el concepto es de supervision, admin, obra civil o instalaciones especiales, genera una matriz tecnica con insumos y mano de obra razonables.
- Cada descripcion debe ser completa y profesional; evita textos cortados.
- Materiales: 3 a 8 renglones. Mano de obra: 1 a 5 renglones. Equipo: 1 a 5 renglones.
- Las cantidades deben representar consumo o rendimiento por UNA unidad del concepto analizado.
- En mano de obra usa jornadas por unidad, salario base diario y FSR separado.
- En notes explica rendimientos asumidos, cuadrilla, alcance incluido y cualquier supuesto tecnico auditable.
- No inventes precios extravagantes; usa mercado mexicano razonable si no hay catalogo.
- El resultado debe ser editable, auditable y comparable con NeoData/OPUS.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{
      Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      model:MODEL,
      response_format:{ type:'json_object' },
      temperature:0.15,
      messages:[
        { role:'system', content:'Eres un analista senior de precios unitarios para construccion en Mexico. Tu prioridad es respetar el concepto original y entregar matrices APU tecnicas, completas, numericas y en JSON valido.' },
        { role:'user', content:prompt }
      ]
    })
  });

  if(!response.ok){
    const errBody = await readOpenAIJson(response).catch(()=>null);
    const error = new Error(errBody?.error?.message || openaiStatusMessage(response.status, `OpenAI API error ${response.status}`));
    error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw error;
  }
  const data = await readOpenAIJson(response);
  const content = String(data?.choices?.[0]?.message?.content || '');
  const json = extractJsonObject(content);
  if(!json) throw new Error('La API no devolvio JSON valido.');
  return sanitizeAPU(json, cleanConcept);
}

export async function answerAssistant({ question='', history=[], context={} }){
  if(!process.env.OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY en Vercel.');
  const cleanQuestion = String(question || '').trim();
  if(!cleanQuestion) return 'Escribe una pregunta tecnica para poder ayudarte.';
  const projectContext = context.project?.name ? `Proyecto activo: ${context.project.name}.` : '';
  const apuContext = context.activeApu?.concept ? `APU activo: ${context.activeApu.concept} (${context.activeApu.family || 'sin familia definida'}) con confianza ${Number(context.activeApu.confidence || 0)}%.` : '';
  const libraryContext = Array.isArray(context.library) ? `Biblioteca disponible: ${context.library.length} insumos.` : '';
  const additionalContext = [projectContext, apuContext, libraryContext].filter(Boolean).join(' ');
  const priorTurns = (Array.isArray(history) ? history : [])
    .filter(m => m && typeof m.content === 'string' && m.content.trim() && (m.role === 'user' || m.role === 'assistant'))
    .slice(-6)
    .map(m => ({ role: m.role, content: String(m.content).trim().slice(0, 2000) }));
  const contextPrompt = additionalContext ? [{ role:'user', content:`Contexto de plataforma: ${additionalContext}` }] : [];
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{
      Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      model:MODEL,
      temperature:0.18,
      max_tokens:700,
      messages:[
        { role:'system', content:'Eres ZOE, copiloto tecnico de ZOEMEC, una plataforma mexicana de costos de construccion. Responde en espanol claro, directo y util. Prioriza el analisis tecnico de APU, FSR, rendimientos, materiales, mano de obra, equipo, indirectos, utilidad y cargos. Si tienes contexto de proyecto o APU activo, úsalo para responder con mayor precision. No actues como un chatbot generico.' },
        ...priorTurns,
        ...contextPrompt,
        { role:'user', content:cleanQuestion }
      ]
    })
  });
  if(!response.ok){
    const errBody = await readOpenAIJson(response).catch(()=>null);
    const error = new Error(errBody?.error?.message || openaiStatusMessage(response.status, `OpenAI API error ${response.status}`));
    error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw error;
  }
  const data = await readOpenAIJson(response);
  return data?.choices?.[0]?.message?.content || 'No pude generar respuesta.';
}

function sanitizeAPU(raw, fallbackConcept){
  const text = (value, fallback='') => String(value ?? fallback).trim();
  const num = (value, fallback=0) => {
    const n = Number(String(value ?? '').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : fallback;
  };
  const row = (arr, defaults) => Array.isArray(arr)
    ? arr.map(r => defaults.map((d,i) => (i === 0 || i === 2) ? text(r?.[i], d) : num(r?.[i], d)))
    : [];
  const original = text(fallbackConcept);
  const generated = text(raw.concept, original);
  return {
    concept: generated.length < 18 && original ? original : generated,
    unit: text(raw.unit || 'pza').replace('m2', 'm²').replace('m3', 'm³'),
    family: text(raw.family, 'APU generado con IA'),
    confidence: num(raw.confidence, 92),
    sat: text(raw.sat, '72100000'),
    materials: row(raw.materials, ['Material', 1, 'pza', 0, 0]),
    labor: row(raw.labor, ['Mano de obra', 0.01, 'jor', 0, 1]),
    equipment: row(raw.equipment, ['Equipo', 0, 'hr', 0]),
    herramienta: num(raw.herramienta, 3),
    indCampo: num(raw.indCampo, 5),
    indOficina: num(raw.indOficina, 5),
    finance: num(raw.finance, 1),
    utility: num(raw.utility, 12),
    cargos: num(raw.cargos, 0),
    iva: num(raw.iva, 16),
    notes: Array.isArray(raw.notes) ? raw.notes.map(n => text(n)).filter(Boolean).slice(0, 5) : []
  };
}
