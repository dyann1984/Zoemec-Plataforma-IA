import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.ZOEMEC_AI_PORT || 8787);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

loadEnv();

function loadEnv(){
  const envPath = join(process.cwd(), '.env');
  if(!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for(const line of lines){
    const trimmed = line.trim();
    if(!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    if(!process.env[key]) process.env[key] = rest.join('=').replace(/^["']|["']$/g, '');
  }
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  if(req.method === 'OPTIONS') return endJson(res, 204, {});
  if(req.method === 'GET' && req.url === '/health') return endJson(res, 200, { ok:true, model:MODEL });
  if(req.method !== 'POST') return endJson(res, 404, { error:'Not found' });

  try{
    if(!process.env.OPENAI_API_KEY){
      return endJson(res, 501, { error:'Falta OPENAI_API_KEY en .env' });
    }
    const body = await readBody(req);
    const payload = JSON.parse(body || '{}');
    if(req.url === '/api/generate-apu'){
      const apu = await generateAPU(payload);
      return endJson(res, 200, { apu });
    }
    if(req.url === '/api/assistant'){
      const answer = await answerAssistant(payload);
      return endJson(res, 200, { answer });
    }
    endJson(res, 404, { error:'Not found' });
  }catch(error){
    endJson(res, 500, { error:error?.message || 'No se pudo procesar la solicitud' });
  }
});

server.listen(PORT, () => {
  console.log(`ZOEMEC AI server listo en http://127.0.0.1:${PORT}`);
});

function setCors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function endJson(res, status, data){
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' });
  res.end(status === 204 ? '' : JSON.stringify(data));
}

function readBody(req){
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if(data.length > 1_500_000){
        req.destroy();
        reject(new Error('El archivo o catalogo es demasiado grande para esta solicitud.'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function generateAPU({ concept='', catalog=[] }){
  const cleanConcept = String(concept || '').trim();
  const catalogSample = (catalog || []).slice(0, 120).map(item => ({
    desc: item.desc,
    unidad: item.unidad,
    precio: Number(item.precio || 0)
  }));

  const prompt = `Genera una cedula de analisis de precio unitario mexicano para este concepto EXACTO.

CONCEPTO ORIGINAL, NO LO CAMBIES DE TEMA:
${cleanConcept}

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
- Para estructura metalica usa acero ASTM/A36/A500, soldadura, primario, grout/anclajes si aplica, cuadrilla de montadores/soldadores, grua o equipo de izaje y EPP.
- Para losacero usa lamina losacero, pernos conectores, fijaciones, cuadrilla de montadores, soldadora/elevador y seguridad.
- Para PTR/Durock usa perfil PTR, tablero Durock, anclajes, tornilleria, soldadura, juntas/acabados y cuadrilla de herrero.
- Para concreto usa concreto/premezclado o cemento/arena/grava/agua solo si el concepto lo pide.
- Cada descripcion debe ser completa y profesional; evita textos cortados.
- Materiales: 3 a 8 renglones. Mano de obra: 1 a 5 renglones. Equipo: 1 a 5 renglones.
- Las cantidades deben representar consumo o rendimiento por UNA unidad del concepto analizado.
- En mano de obra usa jornadas por unidad, salario base diario y FSR separado; no mezcles salario real en el salario base.
- En notes explica rendimientos asumidos, cuadrilla, alcance incluido y cualquier supuesto tecnico auditable.
- No inventes precios extravagantes; usa mercado mexicano razonable si no hay catalogo.
- El resultado debe ser editable, auditable y comparable con NeoData/OPUS.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{
      'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      model: MODEL,
      response_format:{ type:'json_object' },
      temperature:0.15,
      messages:[
        { role:'system', content:'Eres un analista senior de precios unitarios para construccion en Mexico. Tu prioridad es respetar el concepto original y entregar matrices APU tecnicas, completas, numericas y en JSON valido.' },
        { role:'user', content:prompt }
      ]
    })
  });

  const data = await response.json();
  if(!response.ok){
    throw new Error(data?.error?.message || `OpenAI API error ${response.status}`);
  }
  const content = data?.choices?.[0]?.message?.content;
  if(!content) throw new Error('La API no devolvio contenido.');
  return sanitizeAPU(JSON.parse(content), cleanConcept);
}

async function answerAssistant({ question='' }){
  const cleanQuestion = String(question || '').trim();
  if(!cleanQuestion) return 'Escribe una pregunta tecnica para poder ayudarte.';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{
      'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      model: MODEL,
      temperature:0.25,
      messages:[
        { role:'system', content:'Eres ZOEMIC, asistente tecnico de una plataforma mexicana de costos de construccion. Responde en espanol claro, directo y util. Ayudas con APU, matrices de precios unitarios, FSR, rendimientos, catalogos de conceptos, presupuestos, explosion de insumos, programa de obra, planes de usuario y preparacion para produccion. No inventes que ya hay pagos o autenticacion si no se configuro; explica pasos concretos.' },
        { role:'user', content:cleanQuestion }
      ]
    })
  });
  const data = await response.json();
  if(!response.ok) throw new Error(data?.error?.message || `OpenAI API error ${response.status}`);
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
