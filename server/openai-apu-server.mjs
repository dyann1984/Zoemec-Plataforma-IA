import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateAPU, generateAPUv2, answerAssistant } from './api-lib/_openaiApuCore.mjs';
import { searchMarketReferences } from './api-lib/_priceIntelligenceCore.mjs';
import gatewayHandler from '../api/gateway.mjs';
import googleDriveHandler from '../api/google-drive.mjs';
import oneDriveHandler from '../api/onedrive.mjs';
import uploadLibraryHandler from '../api/upload-library.mjs';
import visualAiHandler from '../api/visual-ai.mjs';
import statusHandler from '../api/status.mjs';

/* Rutas que YA sirve api/gateway.mjs en produccion (Vercel) -- este servidor
   de desarrollo local (`npm run ai`) las monta TAL CUAL, sin reimplementar
   ninguna, para que `npm run dev` + `npm run ai` (contra el emulador de
   Firebase, ver .env.development.local) permita probar en el navegador real
   Proyectos/Catalogo/Presupuesto/APU/Planos/Organizaciones -- antes solo
   /api/generate-apu, /api/assistant y /api/price-intelligence funcionaban en
   local, el resto daba 502 (nada escuchaba en ese puerto para esas rutas). */
const GATEWAY_PATHS = new Set([
  '/api/apus', '/api/projects', '/api/challenge-decisions', '/api/technical-memory',
  '/api/export-events', '/api/health', '/api/organizations', '/api/construction-proposal',
  '/api/plano-takeoffs', '/api/catalogo-conceptos', '/api/presupuestos',
  '/api/change-orders', '/api/commitments', '/api/progress', '/api/estimates', '/api/payments',
  '/api/construction-dna', '/api/project-vault'
]);
// Otras funciones serverless de produccion (api/*.mjs, fuera del gateway)
// que tambien tienen sentido probar contra el emulador localmente.
const DIRECT_HANDLERS = {
  '/api/google-drive': googleDriveHandler,
  '/api/onedrive': oneDriveHandler,
  '/api/upload-library': uploadLibraryHandler,
  '/api/visual-ai': visualAiHandler,
  '/api/status': statusHandler
};

const PORT = Number(process.env.ZOEMEC_AI_PORT || 8787);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

loadEnv('.env');
loadEnv('.env.local');

function loadEnv(fileName){
  const envPath = join(process.cwd(), fileName);
  if(!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for(const line of lines){
    const trimmed = line.trim();
    if(!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    if(!process.env[key]) process.env[key] = rest.join('=').replace(/^["']|["']$/g, '');
  }
}

/* Adapta la respuesta cruda de node:http al contrato res.status(n).json(obj)
   que ya usan TODOS los handlers de api/*.mjs y server/api-lib/_route-*.mjs
   (identico al que Vercel les da en produccion) -- ningun handler necesita
   saber que corre sobre este servidor local en vez de Vercel. */
function buildVercelRes(raw){
  const shim = {
    _status: 200,
    status(code){ shim._status = code; return shim; },
    json(data){ endJson(raw, shim._status, data); return shim; }
  };
  return shim;
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  if(req.method === 'OPTIONS') return endJson(res, 204, {});
  if(req.method === 'GET' && req.url === '/health') return endJson(res, 200, { ok:true, model:MODEL });

  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname;

  // Rutas Firestore-reales (gateway.mjs / api/*.mjs directos): mismos
  // handlers que produccion, contra el emulador local (ver
  // .env.development.local#VITE_USE_FIREBASE_EMULATOR y
  // src/firebase.js#connectFirestoreEmulator/connectAuthEmulator -- el
  // cliente ya manda tokens del emulador, y _firebaseAdmin.mjs detecta
  // FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST igual que en los
  // tests de emulador). Nunca requieren OPENAI_API_KEY -- son CRUD, no IA.
  if(GATEWAY_PATHS.has(pathname) || DIRECT_HANDLERS[pathname]){
    try{
      const query = Object.fromEntries(url.searchParams.entries());
      let body = undefined;
      if(req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH'){
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      }
      const vercelReq = { method: req.method, url: req.url, headers: req.headers, query, body };
      const handler = DIRECT_HANDLERS[pathname] || gatewayHandler;
      await handler(vercelReq, buildVercelRes(res));
    }catch(error){
      endJson(res, 500, { error: error?.message || 'No se pudo procesar la solicitud' });
    }
    return;
  }

  if(req.method !== 'POST') return endJson(res, 404, { error:'Not found' });

  try{
    if(!process.env.OPENAI_API_KEY){
      return endJson(res, 501, { error:'Falta OPENAI_API_KEY en .env' });
    }
    const body = await readBody(req);
    const payload = JSON.parse(body || '{}');
    if(pathname === '/api/generate-apu'){
      const wantsV2 = payload?.schema === 'v2';
      const apu = wantsV2 ? await generateAPUv2(payload) : await generateAPU(payload);
      return endJson(res, 200, wantsV2 ? { apu, schemaVersion:2 } : { apu });
    }
    if(pathname === '/api/assistant'){
      const answer = await answerAssistant(payload);
      return endJson(res, 200, { answer });
    }
    if(pathname === '/api/price-intelligence'){
      const result = await searchMarketReferences(payload);
      return endJson(res, 200, result);
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

// 25MB: suficiente para un PDF de plano real en base64 (Visual AI/PlanoTakeoffWorkspace)
// -- antes 1.5MB solo alcanzaba para JSON de catalogo/APU, nunca un archivo.
const MAX_LOCAL_DEV_BODY_BYTES = 25_000_000;
function readBody(req){
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if(data.length > MAX_LOCAL_DEV_BODY_BYTES){
        req.destroy();
        reject(new Error('El archivo o catalogo es demasiado grande para esta solicitud.'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
