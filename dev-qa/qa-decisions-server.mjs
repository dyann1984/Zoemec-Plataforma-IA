/* ARNES DE QA (Fase 6, extendido en Fase 7) -- NO es parte del producto ni
   del build de produccion. Vite (npm run dev) ya sabe proxiar /api/* a
   http://127.0.0.1:ZOEMEC_AI_PORT (ver vite.config.js, capacidad
   preexistente para server/openai-apu-server.mjs) -- este servidor local
   monta los handlers REALES (api/technical-memory.mjs,
   api/challenge-decisions.mjs, api/projects.mjs, api/apus.mjs -- Fase 7 --
   sin copiar ni reimplementar su logica) sobre ese mismo puerto, conectados
   al EMULADOR de Firestore+Auth (nunca produccion). Correr en vez de
   `npm run ai` mientras se hace QA (mismo puerto, no pueden correr los dos
   a la vez).

   Uso:
     firebase emulators:start --project zoemec-plataforma-ia --only firestore,auth
     node dev-qa/qa-decisions-server.mjs
     VITE_USE_FIREBASE_EMULATOR=true npm run dev */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'zoemec-plataforma-ia';

import http from 'node:http';
import { URL } from 'node:url';
import technicalMemoryHandler from '../api/technical-memory.mjs';
import challengeDecisionsHandler from '../api/challenge-decisions.mjs';
import projectsHandler from '../api/projects.mjs';
import apusHandler from '../api/apus.mjs';
import exportEventsHandler from '../api/export-events.mjs';

const PORT = Number(process.env.ZOEMEC_AI_PORT || 8787);
const ROUTES = {
  '/api/technical-memory': technicalMemoryHandler, '/api/challenge-decisions': challengeDecisionsHandler,
  '/api/projects': projectsHandler, '/api/apus': apusHandler, '/api/export-events': exportEventsHandler
};

function readBody(req){
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Adapta el contrato plano de node:http al contrato Vercel (req.query,
// req.body ya parseado, res.status().json()) que los handlers ya usan --
// mismo espiritu que server/openai-apu-server.mjs, generalizado a GET/query.
function adaptResponse(res){
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); return res; };
  return res;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if(req.method === 'OPTIONS'){ res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const handler = ROUTES[url.pathname];
  if(!handler){ res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: `Not found (arnes de QA solo monta: ${Object.keys(ROUTES).join(', ')})` })); return; }

  let body = {};
  if(req.method === 'POST'){
    const raw = await readBody(req);
    try{ body = raw ? JSON.parse(raw) : {}; }catch{ body = {}; }
  }
  adaptResponse(res);
  try{
    await handler({ method: req.method, headers: req.headers, query: Object.fromEntries(url.searchParams.entries()), body }, res);
  }catch(err){
    res.status(500).json({ error: err?.message || 'Error interno del arnes de QA.' });
  }
});

server.listen(PORT, () => {
  console.log(`ZOEMEC QA decisions server (emulador Firestore+Auth) listo en http://127.0.0.1:${PORT}`);
  console.log(`Rutas montadas: ${Object.keys(ROUTES).join(', ')}`);
});
