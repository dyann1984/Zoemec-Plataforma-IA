import { APU_DEFAULT_FACTORS } from '../src/lib/apuCalc.js';
import { normalizeAIApuToV2 } from '../src/domain/apuSchema.js';

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

/* Fetch compartido por generateAPU, generateAPUv2 y answerAssistant: mismo
   endpoint, mismo manejo de errores/JSON invalido (readOpenAIJson,
   openaiStatusMessage). Cada llamador sigue eligiendo su propio prompt,
   temperature y formato de respuesta; esto no cambia ningun comportamiento,
   solo evita repetir el bloque de fetch+manejo de errores tres veces. */
async function requestChatCompletion({ messages, temperature = 0.15, maxTokens, jsonResponse = false }){
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{
      Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      model:MODEL,
      temperature,
      ...(jsonResponse ? { response_format:{ type:'json_object' } } : {}),
      ...(maxTokens ? { max_tokens:maxTokens } : {}),
      messages
    })
  });
  if(!response.ok){
    const errBody = await readOpenAIJson(response).catch(()=>null);
    const error = new Error(errBody?.error?.message || openaiStatusMessage(response.status, `OpenAI API error ${response.status}`));
    error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw error;
  }
  const data = await readOpenAIJson(response);
  return String(data?.choices?.[0]?.message?.content || '');
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
  "herramienta": ${APU_DEFAULT_FACTORS.herramienta},
  "indCampo": ${APU_DEFAULT_FACTORS.indCampo},
  "indOficina": ${APU_DEFAULT_FACTORS.indOficina},
  "finance": ${APU_DEFAULT_FACTORS.finance},
  "utility": ${APU_DEFAULT_FACTORS.utility},
  "cargos": ${APU_DEFAULT_FACTORS.cargos},
  "iva": ${APU_DEFAULT_FACTORS.iva},
  "notes": ["decisiones tecnicas breves, rendimientos asumidos, inclusiones y exclusiones"]
}

Reglas obligatorias:
- No cambies el concepto. Si el usuario pide estructura metalica, no generes lavabo, block, concreto ni otro tema.
- Si el concepto trae unidad entre parentesis como (KG), (M2), (PZA), esa unidad manda.
- Si el concepto trae "Objetivo: $X" o "P.U. referencia", arma el APU para acercarse al precio objetivo sin meter ajustes absurdos.
- Si el concepto es de supervision, admin, obra civil o instalaciones especiales, genera una matriz tecnica con insumos y mano de obra razonables.
- Para estructura metalica usa acero ASTM/A36/A500, soldadura, primario, grout/anclajes si aplica, cuadrilla de montadores/soldadores, grua o equipo de izaje y EPP.
- Para losacero usa lamina losacero, pernos conectores, fijaciones, cuadrilla de montadores, soldadora/elevador y seguridad.
- Para PTR/Durock usa perfil PTR, tablero Durock, anclajes, tornilleria, soldadura, juntas/acabados y cuadrilla de herrero.
- Para concreto usa concreto/premezclado o cemento/arena/grava/agua solo si el concepto lo pide.
- Cada descripcion debe ser completa y profesional; evita textos cortados.
- Materiales: 3 a 8 renglones. Mano de obra: 1 a 5 renglones. Equipo: 1 a 5 renglones.
- Las cantidades deben representar consumo o rendimiento por UNA unidad del concepto analizado.
- En mano de obra usa jornadas por unidad, salario base diario y FSR separado.
- En notes explica rendimientos asumidos, cuadrilla, alcance incluido y cualquier supuesto tecnico auditable.
- No inventes precios extravagantes; usa mercado mexicano razonable si no hay catalogo.
- El resultado debe ser editable, auditable y comparable con NeoData/OPUS.`;

  const content = await requestChatCompletion({
    temperature:0.15,
    jsonResponse:true,
    messages:[
      { role:'system', content:'Eres un analista senior de precios unitarios para construccion en Mexico. Tu prioridad es respetar el concepto original y entregar matrices APU tecnicas, completas, numericas y en JSON valido.' },
      { role:'user', content:prompt }
    ]
  });
  const json = extractJsonObject(content);
  if(!json) throw new Error('La API no devolvio JSON valido.');
  return sanitizeAPU(json, cleanConcept);
}

/* Genera un APU en el esquema profesional v2 (ver src/domain/apuSchema.js):
   procedimiento constructivo, control de calidad, criterio de medicion,
   fuentes por renglon, cuadrilla/rendimiento en mano de obra, seguridad y
   confianza desglosada. Usa su propio prompt (mas rico, mas tokens) y su
   propia llamada a OpenAI -- no reutiliza la respuesta de generateAPU -- para
   que el flujo v1 (generateAPU, el que usa main.jsx hoy en produccion) nunca
   pague el costo/latencia extra de este prompt ampliado. Nada llama a esta
   funcion desde la UI todavia: se conecta en una fase posterior. */
export async function generateAPUv2({ concept='', catalog=[], preserveOriginal=false, mode='' }){
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
  const prompt = `Genera una cedula PROFESIONAL de analisis de precio unitario mexicano para este concepto EXACTO, con el nivel de detalle de una matriz de ingenieria de costos (auditable, con procedimiento constructivo, control de calidad, criterio de medicion y trazabilidad de fuentes).

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
  "materialSources": [{ "proveedor": "nombre real solo si viene del catalogo, si no null", "region": "region o null", "integracion": "POR_UNIDAD_OBRA o POR_LOTE" }],
  "labor": [["descripcion completa", jornadas, "jor", salarioBase, fsr]],
  "laborDetails": [{ "cuadrilla": numeroDeTrabajadores, "rendimiento": unidadesDeConceptoPorJornadaDeTODALaCuadrilla, "jornada": horasPorJornada }],
  "equipment": [["descripcion completa", cantidad, "unidad", tarifa]],
  "equipmentDetails": [{ "integracion": "POR_UNIDAD_OBRA|POR_JORNADA|POR_LOTE|AMORTIZABLE", "rendimientoDiario": numeroOnull, "vidaUtilDias": numeroOnull, "factorUso": numeroOnull, "modalidad": "renta_jornada|costo_horario|costo_diario|costo_lote|propio_contratista" }],
  "seguridad": [["EPP o proteccion", cantidad, "unidad", precioUnitario]],
  "seguridadDetails": [{ "integracion": "AMORTIZABLE para EPP reutilizable (casco, botas, lentes, arnes, careta, proteccion auditiva) o POR_UNIDAD_OBRA para EPP desechable/consumible", "rendimientoDiario": numeroOnull, "vidaUtilDias": numeroOnull, "factorReposicion": numeroOnull }],
  "procedimientoConstructivo": ["paso 1", "paso 2", "..."],
  "controlCalidad": [{ "especificacion": "texto", "criterio": "texto verificable" }],
  "criterioMedicion": { "incluye": ["que incluye el precio"], "excluye": ["que no incluye"] },
  "herramienta": ${APU_DEFAULT_FACTORS.herramienta},
  "indCampo": ${APU_DEFAULT_FACTORS.indCampo},
  "indOficina": ${APU_DEFAULT_FACTORS.indOficina},
  "finance": ${APU_DEFAULT_FACTORS.finance},
  "utility": ${APU_DEFAULT_FACTORS.utility},
  "cargos": ${APU_DEFAULT_FACTORS.cargos},
  "iva": ${APU_DEFAULT_FACTORS.iva},
  "confidenceBreakdown": { "precios": 0-100, "rendimientos": 0-100, "cantidades": 0-100, "composicion": 0-100 },
  "notes": ["supuestos tecnicos explicitos, uno por elemento de la lista"]
}

Reglas obligatorias sobre INTEGRACION DE RECURSOS (obligatorio, no lo omitas):
- Cada renglon de equipo y seguridad DEBE traer su "integracion" explicita en equipmentDetails/seguridadDetails. Nunca dejes que el sistema la adivine.
- POR_UNIDAD_OBRA: solo cuando el consumo escala realmente con cada unidad del concepto (ej. un consumible que se gasta proporcionalmente).
- POR_JORNADA: equipo rentado por dia cuyo costo se reparte entre lo que la cuadrilla produce en un dia. Ejemplo INCORRECTO: renta de andamio $500 cargada completa a CADA metro de una obra de 80 m. Ejemplo CORRECTO: integracion:"POR_JORNADA", rendimientoDiario:20 (si la cuadrilla avanza 20 m/dia) -> el motor calcula $500/20 = $25/m automaticamente. NUNCA hagas tu esa division: solo entrega tarifa y rendimientoDiario.
- AMORTIZABLE: para EPP REUTILIZABLE (casco, botas, lentes, arnes, careta, proteccion auditiva) y equipo propiedad del contratista. Ejemplo INCORRECTO: "1 casco = $250" convertido en $250 por cada m² de una obra de 613.76 m². Ejemplo CORRECTO: integracion:"AMORTIZABLE", cantidad:numeroDeTrabajadores, vidaUtilDias:180 (vida util tipica de un casco en obra), rendimientoDiario:igualQueLaCuadrillaQueLoUsa, factorReposicion:1. El motor amortiza: (precio x trabajadores x factorReposicion) / vidaUtilDias / rendimientoDiario.
- POR_LOTE: costo fijo de la obra completa (ej. "materiales de proteccion temporal del area", comprados una sola vez). El motor lo reparte entre la cantidad contractual total, no lo repitas tu por unidad.
- Nunca inventes numeros de relleno para rendimientoDiario/vidaUtilDias/factorUso/factorReposicion: si no tienes una estimacion razonable, usa el mismo rendimientoDiario que declaraste en laborDetails para la cuadrilla que usa ese recurso (mismo ciclo de produccion).

Reglas obligatorias sobre MANO DE OBRA (obligatorio):
- Agrupa TODA la mano de obra de un mismo ciclo de produccion en una sola cuadrilla (labor con 1-2 renglones: oficial + ayudante, o un tercero solo si es un oficio realmente distinto como electricista/soldador). El "rendimiento" declarado en laborDetails debe ser el de la cuadrilla completa terminando el ciclo, no el de una sub-tarea aislada.
- PROHIBIDO fragmentar un mismo ciclo en varias "cuadrillas": para un concepto como "desmantelamiento de tuberia" (corte + traslado + limpieza), NO generes 3 renglones de labor (uno para corte, otro para traslado, otro para limpieza) como si fueran 3 cuadrillas independientes -- son la MISMA cuadrilla trabajando su jornada. Usa como mucho 2 renglones (oficial+ayudante) con UN rendimiento combinado que ya incluya las 3 actividades.
- Solo usa renglones de labor adicionales cuando se trate de oficios genuinamente distintos con especialidad y salario propios (ej. soldador certificado ademas de albañiles).

Reglas obligatorias:
- No cambies el concepto. Si el usuario pide estructura metalica, no generes lavabo, block, concreto ni otro tema.
- Si el concepto trae unidad entre parentesis como (KG), (M2), (PZA), esa unidad manda.
- Para estructura metalica usa acero ASTM/A36/A500, soldadura, primario, grout/anclajes si aplica, cuadrilla de montadores/soldadores, grua o equipo de izaje y EPP.
- Para losacero usa lamina losacero, pernos conectores, fijaciones, cuadrilla de montadores, soldadora/elevador y seguridad.
- Para PTR/Durock usa perfil PTR, tablero Durock, anclajes, tornilleria, soldadura, juntas/acabados y cuadrilla de herrero.
- Para concreto usa concreto/premezclado o cemento/arena/grava/agua solo si el concepto lo pide.
- "laborDetails" debe tener EXACTAMENTE el mismo numero de elementos que "labor", en el mismo orden (uno por renglon de mano de obra).
- "materialSources" debe tener EXACTAMENTE el mismo numero de elementos que "materials", en el mismo orden. Si no hay evidencia real de proveedor (no viene del catalogo), usa proveedor:null -- NUNCA inventes un nombre de proveedor real.
- "equipmentDetails" debe tener EXACTAMENTE el mismo numero de elementos que "equipment", y "seguridadDetails" EXACTAMENTE el mismo numero que "seguridad", ambos en el mismo orden.
- "seguridad" incluye como minimo el EPP basico aplicable a la actividad (casco, guantes, lentes, etc. segun corresponda); puede ir vacio solo si el concepto es puramente administrativo/de oficina.
- "procedimientoConstructivo" son pasos de ejecucion en orden, especificos del concepto (no genericos de relleno).
- "criterioMedicion" debe reflejar que unidad se mide y que excluye explicitamente (acabados adicionales, materiales no listados, etc.).
- "confidenceBreakdown": nunca declares 100 salvo certeza absoluta; si el concepto es ambiguo o generico, baja "cantidades" y "composicion" en vez de subir el numero artificialmente.
- Cada descripcion debe ser completa y profesional; evita textos cortados.
- Materiales: 3 a 8 renglones. Mano de obra: 1 a 5 renglones. Equipo: 1 a 5 renglones.
- En notes explica rendimientos asumidos, alcance incluido y cualquier supuesto tecnico auditable, uno por elemento.
- No inventes precios extravagantes; usa mercado mexicano razonable si no hay catalogo.
- El resultado debe ser editable, auditable y comparable con NeoData/OPUS.`;

  const content = await requestChatCompletion({
    temperature:0.15,
    jsonResponse:true,
    messages:[
      { role:'system', content:'Eres un ingeniero de costos senior mexicano, especialista en matrices de precios unitarios profesionales (nivel NeoData/OPUS): procedimiento constructivo, control de calidad, criterio de medicion y trazabilidad de fuentes. Nunca declares un dato como verificado si no viene de una fuente real proporcionada. Responde solo con JSON valido.' },
      { role:'user', content:prompt }
    ]
  });
  const json = extractJsonObject(content);
  if(!json) throw new Error('La API no devolvio JSON valido.');
  return normalizeAIApuToV2(json, cleanConcept);
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
  const content = await requestChatCompletion({
    temperature:0.18,
    maxTokens:700,
    messages:[
      { role:'system', content:'Eres ZOE, copiloto tecnico de ZOEMEC, una plataforma mexicana de costos de construccion. Responde en espanol claro, directo y util. Prioriza el analisis tecnico de APU, FSR, rendimientos, materiales, mano de obra, equipo, indirectos, utilidad y cargos. Si tienes contexto de proyecto o APU activo, úsalo para responder con mayor precision. No actues como un chatbot generico.' },
      ...priorTurns,
      ...contextPrompt,
      { role:'user', content:cleanQuestion }
    ]
  });
  return content || 'No pude generar respuesta.';
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
    herramienta: num(raw.herramienta, APU_DEFAULT_FACTORS.herramienta),
    indCampo: num(raw.indCampo, APU_DEFAULT_FACTORS.indCampo),
    indOficina: num(raw.indOficina, APU_DEFAULT_FACTORS.indOficina),
    finance: num(raw.finance, APU_DEFAULT_FACTORS.finance),
    utility: num(raw.utility, APU_DEFAULT_FACTORS.utility),
    cargos: num(raw.cargos, APU_DEFAULT_FACTORS.cargos),
    iva: num(raw.iva, APU_DEFAULT_FACTORS.iva),
    notes: Array.isArray(raw.notes) ? raw.notes.map(n => text(n)).filter(Boolean).slice(0, 5) : []
  };
}
