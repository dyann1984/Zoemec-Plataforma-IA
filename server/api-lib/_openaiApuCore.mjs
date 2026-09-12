import { APU_DEFAULT_FACTORS } from '../../src/lib/apuCalc.js';
import { normalizeAIApuToV2 } from '../../src/domain/apuSchema.js';
import { normalizeConstructionProposal, computeRequiresValidation } from '../../src/domain/constructionProposal.js';

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
  "materialsSource": ["catalogo" o "estimado_ia", uno por cada renglon de materials, en el mismo orden],
  "labor": [["descripcion completa", jornadas, "jor", salarioBase, fsr]],
  "laborSource": ["catalogo" o "estimado_ia", uno por cada renglon de labor, en el mismo orden],
  "equipment": [["descripcion completa", cantidad, "unidad", costo]],
  "equipmentSource": ["catalogo" o "estimado_ia", uno por cada renglon de equipment, en el mismo orden],
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
- "materialsSource"/"laborSource"/"equipmentSource" son OBLIGATORIOS y deben tener EXACTAMENTE el mismo numero de elementos que materials/labor/equipment, en el mismo orden. Usa "catalogo" SOLO cuando el precio de ese renglon salio de una coincidencia real en el CATALOGO DISPONIBLE de arriba; usa "estimado_ia" para cualquier precio que tu hayas calculado sin esa evidencia -- nunca marques "catalogo" sin una coincidencia real.
- Cuando no haya coincidencia de catalogo para un renglon, entrega tu mejor estimacion de mercado mexicano actual (nunca dejes precioUnitario/salarioBase/costo en 0 ni un numero absurdo), pero ese renglon SIEMPRE debe ir marcado "estimado_ia" -- el sistema lo mostrara como pendiente de validacion, nunca como precio verificado.
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
export async function generateAPUv2({ concept='', catalog=[], preserveOriginal=false, mode='', referencePU=0 }){
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
  "laborDetails": [{ "cuadrilla": numeroDeTrabajadoresDE_ESTE_RENGLON_UNICAMENTE, "rendimiento": unidadesDeConceptoPorJornadaDeTODALaCuadrillaCompleta, "jornada": horasPorJornada }],
  "equipment": [["descripcion completa", cantidad, "unidad", tarifa]],
  "equipmentDetails": [{ "integracion": "POR_UNIDAD_OBRA|POR_JORNADA|POR_LOTE|AMORTIZABLE", "rendimientoDiario": numeroOnull, "vidaUtilDias": numeroOnull, "factorUso": numeroOnull, "modalidad": "renta_jornada|costo_horario|costo_diario|costo_lote|propio_contratista" }],
  "seguridad": [["EPP o proteccion", cantidad, "unidad", precioUnitario]],
  "seguridadDetails": [{ "integracion": "AMORTIZABLE para EPP reutilizable (casco, guantes de trabajo, botas, lentes, arnes, careta, proteccion auditiva -- el default para casi todo EPP) o POR_UNIDAD_OBRA SOLO para EPP desechable de un solo uso declarado como tal", "rendimientoDiario": numeroOnull, "vidaUtilDias": numeroOnull, "factorReposicion": numeroOnull }],
  "consumables": [["descripcion completa del consumible", cantidad, "unidad", precioUnitario, mermaPorcentaje]],
  "consumableSources": [{ "especificacion": "texto tecnico o null", "proveedor": "nombre real solo si viene del catalogo, si no null", "region": "region o null", "integracion": "POR_UNIDAD_OBRA o POR_LOTE", "technicalReason": "por que este consumible especifico aplica a este procedimiento" }],
  "procedimientoConstructivo": ["paso 1", "paso 2", "..."],
  "controlCalidad": [{ "especificacion": "texto", "criterio": "texto verificable" }],
  "criterioMedicion": { "criterio": "una frase que describe COMO se mide/cuantifica este concepto en obra (ej. se mide el volumen real excavado, medido en banco, verificado por levantamiento topografico antes y despues)", "formaPago": "una frase que describe COMO se paga este concepto (ej. pago por unidad de obra terminada, previa aprobacion de la supervision, con base en el volumen medido)", "incluye": ["que incluye el precio"], "excluye": ["que no incluye"] },
  "technicalJustifications": {
    "materials": "por que estos materiales y estas cantidades para este concepto especifico",
    "labor": "por que esta cuadrilla y este rendimiento para este concepto especifico",
    "equipment": "por que este equipo/maquinaria para este concepto especifico",
    "smallTools": "por que esta herramienta menor para este concepto especifico",
    "consumables": "por que estos consumibles, o 'NO APLICA -- no se identificaron consumibles independientes para este procedimiento.' si consumables va vacio",
    "safety": "por que este EPP/seguridad para el riesgo especifico de este concepto"
  },
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
- AMORTIZABLE: para TODO EPP REUTILIZABLE (casco, GUANTES de trabajo, botas, lentes, arnes, careta, proteccion auditiva, chaleco reflejante -- practicamente todo el EPP estandar de una cuadrilla es reutilizable) y equipo propiedad del contratista. Ejemplo INCORRECTO: "1 casco = $250" convertido en $250 por cada m² de una obra de 613.76 m², o "2 pares de guantes = $71/par" convertido en $142 por cada METRO de una obra de 80 m. Ejemplo CORRECTO: integracion:"AMORTIZABLE", cantidad:numeroDeTrabajadores, vidaUtilDias:180 (vida util tipica de un casco/guantes/botas en obra), rendimientoDiario:igualQueLaCuadrillaQueLoUsa, factorReposicion:1. El motor amortiza: (precio x trabajadores x factorReposicion) / vidaUtilDias / rendimientoDiario. Usa POR_UNIDAD_OBRA en seguridad SOLO para EPP genuinamente desechable/de un solo uso declarado como tal (ej. mascarilla desechable, guante de nitrilo desechable para manejo de quimicos, cubrebocas) -- nunca para casco/guantes de trabajo/botas/lentes/arnes/proteccion auditiva estandar, esos SIEMPRE son AMORTIZABLE salvo que el concepto explicitamente diga que son de un solo uso.
- POR_LOTE: costo fijo de la obra completa (ej. "materiales de proteccion temporal del area", comprados una sola vez). El motor lo reparte entre la cantidad contractual total, no lo repitas tu por unidad.
- Nunca inventes numeros de relleno para rendimientoDiario/vidaUtilDias/factorUso/factorReposicion: si no tienes una estimacion razonable, usa el mismo rendimientoDiario que declaraste en laborDetails para la cuadrilla que usa ese recurso (mismo ciclo de produccion).

Reglas obligatorias sobre CONSUMIBLES Y AUXILIARES (obligatorio):
- "consumables" son insumos que se GASTAN durante el procedimiento pero NO quedan integrados en la obra (a diferencia de "materials"): discos de corte, brocas, lijas, electrodos, costales, cinta, cuerda, combustible, lubricantes, u otros consumibles especificos de ESTE procedimiento.
- Genera consumibles UNICAMENTE cuando el procedimiento real de este concepto los requiera. PROHIBIDO inventar consumibles genericos o aplicar un porcentaje de relleno "para no dejar la seccion vacia".
- Si el concepto genuinamente no requiere consumibles independientes (ej. ya estan cubiertos dentro de materials/equipment), deja "consumables": [] y explica por que en technicalJustifications.consumables con el texto "NO APLICA -- no se identificaron consumibles independientes para este procedimiento." -- eso es preferible a inventar un costo.
- "consumableSources" debe tener EXACTAMENTE el mismo numero de elementos que "consumables", en el mismo orden.

Reglas obligatorias sobre JUSTIFICACION TECNICA (obligatorio, no lo omitas):
- "technicalJustifications" es OBLIGATORIO y debe tener las 6 claves (materials, labor, equipment, smallTools, consumables, safety) siempre presentes, cada una con 1 a 3 frases.
- Cada texto debe explicar el POR QUE de lo que declaraste en esa categoria PARA ESTE CONCEPTO EXACTO (no una explicacion generica que serviria para cualquier concepto): por que esos materiales/cantidades, por que esa cuadrilla/rendimiento, por que ese equipo, por que esa herramienta menor, por que esos consumibles (o su ausencia), por que ese EPP para el riesgo especifico de esta actividad.
- Nunca dejes un texto vacio ni un texto de relleno ("segun normativa aplicable" sin mas): si de verdad no hay nada que justificar en una categoria (ej. equipment vacio), dilo explicitamente ("No se requiere equipo/maquinaria: la actividad es enteramente manual.").

Reglas obligatorias sobre MANO DE OBRA (obligatorio):
- Agrupa TODA la mano de obra de un mismo ciclo de produccion en una sola cuadrilla (labor con 1-2 renglones: oficial + ayudante, o un tercero solo si es un oficio realmente distinto como electricista/soldador). El "rendimiento" declarado en laborDetails debe ser el de la cuadrilla completa terminando el ciclo, no el de una sub-tarea aislada.
- PROHIBIDO fragmentar un mismo ciclo en varias "cuadrillas": para un concepto como "desmantelamiento de tuberia" (corte + traslado + limpieza), NO generes 3 renglones de labor (uno para corte, otro para traslado, otro para limpieza) como si fueran 3 cuadrillas independientes -- son la MISMA cuadrilla trabajando su jornada. Usa como mucho 2 renglones (oficial+ayudante) con UN rendimiento combinado que ya incluya las 3 actividades.
- Solo usa renglones de labor adicionales cuando se trate de oficios genuinamente distintos con especialidad y salario propios (ej. soldador certificado ademas de albañiles).
- SEMANTICA CRITICA DE "cuadrilla" EN laborDetails (obligatorio, el motor de calculo depende de esto): "cuadrilla" es el numero de trabajadores DE ESE RENGLON/oficio UNICAMENTE, NUNCA el total de personas de la cuadrilla completa repetido en cada renglon. Ejemplo CORRECTO: cuadrilla de 1 operador de excavadora + 1 ayudante -> renglon "Operador de excavadora" con cuadrilla:1, renglon "Ayudante" con cuadrilla:1 (nunca cuadrilla:2 en ambos). Ejemplo INCORRECTO que debes evitar: poner cuadrilla:2 en cada uno de los 2 renglones porque "la cuadrilla tiene 2 integrantes en total" -- eso duplica el costo de mano de obra en el calculo (jornadas = cuadrilla_del_renglon / rendimiento). El "rendimiento" (unidades de concepto por jornada) SI es el de la cuadrilla completa trabajando junta y SI puede repetirse igual en cada renglon del mismo ciclo -- son dos campos con semantica distinta, no los confundas.

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
- "criterioMedicion" debe reflejar que unidad se mide y que excluye explicitamente (acabados adicionales, materiales no listados, etc.). "criterio" y "formaPago" son OBLIGATORIOS y especificos de este concepto (no una frase generica que serviria para cualquier partida): explica como se cuantifica/verifica la cantidad ejecutada y como se factura/paga, con el nivel de detalle de un contrato de obra real.
- "confidenceBreakdown": nunca declares 100 salvo certeza absoluta; si el concepto es ambiguo o generico, baja "cantidades" y "composicion" en vez de subir el numero artificialmente.
- Cada descripcion debe ser completa y profesional; evita textos cortados.
- Materiales: 3 a 8 renglones. Mano de obra: 1 a 5 renglones. Equipo: 1 a 5 renglones. Consumibles: 0 a 5 renglones (0 es valido y esperado cuando no aplica).
- En notes explica rendimientos asumidos, alcance incluido y cualquier supuesto tecnico auditable, uno por elemento.
- Si no hay coincidencia de catalogo para un renglon, entrega tu mejor estimacion de mercado mexicano actual (nunca 0 ni un numero absurdo) con proveedor:null en su fuente correspondiente -- el sistema ya trata TODO precio de IA como pendiente de validacion hasta que un usuario lo confirme (normalizeAIApuToV2 ignora cualquier "estado" que intentes declarar aqui, asi que no lo incluyas).
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
  return normalizeAIApuToV2(json, cleanConcept, { referencePU });
}

/* Fase 3 (evolucion integral Levantamiento IA): "Propuesta constructiva con
   IA" -- unico punto del repo que llama a OpenAI con VISION (imageUrls,
   URLs publicas de descarga de Firebase Storage -- el modelo las descarga
   el mismo, nunca se le manda el binario). Devuelve el JSON crudo YA
   FILTRADO por normalizeConstructionProposal (src/domain/constructionProposal.js)
   -- ese modulo es la unica fuente de verdad sobre que forma es valida,
   este archivo no duplica esa logica.

   Dimensiones PROPORCIONADAS por el usuario (knownDimensions) se fijan
   DESPUES de la respuesta del modelo, nunca se le pide que las repita: un
   dato que el usuario ya dio con certeza no debe depender de que la IA lo
   transcriba bien -- mismo principio que ownerUid/organizationId en el
   resto del backend (la fuente de verdad real nunca es lo que un modelo/
   cliente afirma, es lo que el sistema ya sabe con certeza). */
export async function generateConstructionProposal({ imageUrls = [], userPrompt = '', knownDimensions = {}, stylePreferences = null, referenceBudget = 0 } = {}){
  if(!process.env.OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY en Vercel.');
  const cleanPrompt = String(userPrompt || '').trim();
  if(!cleanPrompt) throw new Error('Describe que quieres construir en este espacio.');
  const images = (Array.isArray(imageUrls) ? imageUrls : [])
    .filter(u => typeof u === 'string' && /^https:\/\//.test(u))
    .slice(0, 6);

  const knownDimsEntries = ['largo', 'ancho', 'altura']
    .map(key => [key, Number(knownDimensions?.[key])])
    .filter(([, value]) => Number.isFinite(value) && value > 0);
  const knownDimsText = knownDimsEntries.length
    ? `Dimensiones REALES ya confirmadas por el usuario (nunca las inventes ni las corrijas, dalas por ciertas): ${knownDimsEntries.map(([k, v]) => `${k}=${v}m`).join(', ')}.`
    : 'El usuario no dio ninguna medida real conocida -- si necesitas una escala para razonar proporciones, dilo en notes en vez de inventar un numero de "sentido comun".';
  const styleText = stylePreferences ? `Preferencias de estilo del usuario (ya elegidas explicitamente, uselas para el sistema constructivo/acabados sugeridos): ${JSON.stringify(stylePreferences)}.` : '';
  const budgetText = Number(referenceBudget) > 0 ? `Presupuesto objetivo de referencia: $${Number(referenceBudget)} MXN -- orientativo, no fuerces el sistema constructivo para encajar en el a costa de omitir algo necesario.` : '';

  const prompt = `Eres un arquitecto/ingeniero de costos mexicano. Un usuario te muestra evidencia visual de un espacio (fotos adjuntas${images.length ? '' : ' -- NO se adjunto ninguna foto esta vez, trabaja SOLO con la descripcion de texto y advierte esa limitacion en notes'}) y describe que quiere construir ahi:

"${cleanPrompt}"

${knownDimsText}
${styleText}
${budgetText}

Genera una propuesta constructiva preliminar. Para CADA dimension, declara "origen" usando EXACTAMENTE una de estas 4 palabras, con este significado estricto:
- "detectado": lo puedes observar/medir de forma razonable EN LA FOTO (proporciones relativas visibles).
- "proporcionado": es exactamente un valor de las "Dimensiones REALES ya confirmadas" de arriba.
- "inferido": lo calculaste a partir de otro valor detectado/proporcionado con una relacion confiable (ej. superficie = largo x ancho).
- "estimado": es tu mejor aproximacion SIN evidencia directa -- usa esto generosamente en vez de fingir certeza que no tienes.
Nunca declares "detectado" o "proporcionado" si no es literalmente cierto -- preferir "estimado" a mentir sobre la certeza es obligatorio.

Devuelve SOLO JSON valido con esta forma exacta:
{
  "descripcion": "resumen breve de la propuesta",
  "dimensiones": {
    "largo": { "valor": numeroEnMetrosOnull, "origen": "detectado|proporcionado|inferido|estimado" },
    "ancho": { "valor": numeroEnMetrosOnull, "origen": "..." },
    "altura": { "valor": numeroEnMetrosOnull, "origen": "..." },
    "superficie": { "valor": numeroEnM2Onull, "origen": "..." },
    "volumen": { "valor": numeroEnM3Onull, "origen": "..." }
  },
  "sistemaConstructivo": {
    "preliminares": ["item 1", "..."],
    "cimentacion": ["..."],
    "estructura": ["..."],
    "muros": ["..."],
    "cubierta": ["..."],
    "instalaciones": ["..."],
    "acabados": ["..."]
  },
  "notes": ["supuestos explicitos, limitaciones de la evidencia disponible, y CUALQUIER cosa que requiera validacion profesional real antes de construir (cimentacion, estructura, instalaciones electricas/hidraulicas siempre la requieren)"]
}

Reglas obligatorias:
- Cada categoria de "sistemaConstructivo" que no aplique a esta propuesta queda como arreglo vacio -- nunca inventes contenido de relleno "para no dejarla vacia".
- "cimentacion" y "estructura", si los llenas, son SIEMPRE preliminares/conceptuales -- dilo en notes, nunca los presentes como un calculo estructural real.
- Nunca proyectes un costo total en esta respuesta -- eso lo hace el motor de APU real de ZOEMEC despues, con precios reales.`;

  const content = await requestChatCompletion({
    temperature: 0.2,
    maxTokens: 1400,
    jsonResponse: true,
    messages: [
      { role: 'system', content: 'Eres un arquitecto/ingeniero de costos senior mexicano. Nunca declaras un dato como detectado o proporcionado si no lo es realmente -- la honestidad sobre el origen de cada dato es mas importante que sonar seguro. Respondes solo con JSON valido.' },
      {
        role: 'user',
        content: images.length
          ? [{ type: 'text', text: prompt }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))]
          : prompt
      }
    ]
  });
  const json = extractJsonObject(content);
  if(!json) throw new Error('La API no devolvio JSON valido.');
  const proposal = normalizeConstructionProposal(json);
  // Las dimensiones que el usuario YA confirmo se fijan aqui, pisando lo que
  // el modelo haya dicho -- ver comentario de la funcion arriba. Recalcula
  // requiresProfessionalValidation despues del override: fijar una
  // dimension a "proporcionado" puede cambiar el resultado (ya no depende
  // de una estimacion), nunca se deja el valor viejo desactualizado.
  for(const [key, value] of knownDimsEntries){
    proposal.dimensiones[key] = { valor: value, origen: 'proporcionado' };
  }
  proposal.requiresProfessionalValidation = computeRequiresValidation(proposal.dimensiones, proposal.sistemaConstructivo);
  return proposal;
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
      { role:'system', content:'Eres ZOE, asistente tecnico de ZOEMEC, una plataforma mexicana de costos de construccion. Responde en espanol claro, directo y util. Prioriza el analisis tecnico de APU, FSR, rendimientos, materiales, mano de obra, equipo, indirectos, financiamiento, utilidad y cargos. Si tienes contexto de proyecto o APU activo, úsalo para responder con mayor precision. No actues como un chatbot generico.' },
      ...priorTurns,
      ...contextPrompt,
      { role:'user', content:cleanQuestion }
    ]
  });
  return content || 'No pude generar respuesta.';
}

/* Fase 0 (Inteligencia de Costos, hallazgo #24 -- "la IA no debe inventar el
   precio"): generateAPU (v1, el que usa main.jsx en produccion hoy) no
   tenia NINGUN mecanismo para distinguir un precio real de catalogo de uno
   que el modelo invento -- ambos llegaban como el mismo numero plano en
   materials/labor/equipment, indistinguibles para el resto del sistema
   (apuConfidence.js, UI, exportacion). El prompt ahora exige un arreglo
   paralelo *Source ("catalogo"|"estimado_ia") por cada renglon; esta
   funcion lo normaliza a `priceOrigin` con el MISMO largo que cada seccion
   -- por seguridad, cualquier renglon sin marca explicita (el modelo omitio
   el campo, o el arreglo vino mas corto) se trata como "estimado_ia" nunca
   como "catalogo": el default mas restrictivo, igual criterio que
   isSuperAdminProfile/isActiveOrgMember en el resto del backend (nunca se
   asume el estado mas privilegiado/confiable por ausencia de dato). */
const VALID_PRICE_ORIGINS = new Set(['catalogo', 'estimado_ia']);
function normalizePriceOrigin(sourceArr, rowCount){
  const arr = Array.isArray(sourceArr) ? sourceArr : [];
  return Array.from({ length: rowCount }, (_, i) => {
    const value = String(arr[i] ?? '').trim().toLowerCase();
    return VALID_PRICE_ORIGINS.has(value) ? value : 'estimado_ia';
  });
}

export function sanitizeAPU(raw, fallbackConcept){
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
  const materials = row(raw.materials, ['Material', 1, 'pza', 0, 0]);
  const labor = row(raw.labor, ['Mano de obra', 0.01, 'jor', 0, 1]);
  const equipment = row(raw.equipment, ['Equipo', 0, 'hr', 0]);
  return {
    concept: generated.length < 18 && original ? original : generated,
    unit: text(raw.unit || 'pza').replace('m2', 'm²').replace('m3', 'm³'),
    family: text(raw.family, 'APU generado con IA'),
    confidence: num(raw.confidence, 92),
    sat: text(raw.sat, '72100000'),
    materials, labor, equipment,
    // priceOrigin: 'catalogo'|'estimado_ia' por renglon, mismo orden que su
    // seccion -- ver normalizePriceOrigin. Aditivo: nunca cambia el array
    // materials/labor/equipment que ya consumen apuCalc.js/la UI existente.
    priceOrigin: {
      materials: normalizePriceOrigin(raw.materialsSource, materials.length),
      labor: normalizePriceOrigin(raw.laborSource, labor.length),
      equipment: normalizePriceOrigin(raw.equipmentSource, equipment.length)
    },
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
