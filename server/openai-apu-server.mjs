import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateAPU, generateAPUv2, answerAssistant } from '../api/_openaiApuCore.mjs';

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
      const wantsV2 = payload?.schema === 'v2';
      const apu = wantsV2 ? await generateAPUv2(payload) : await generateAPU(payload);
      return endJson(res, 200, wantsV2 ? { apu, schemaVersion:2 } : { apu });
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
