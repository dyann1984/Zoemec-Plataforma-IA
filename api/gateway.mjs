/* Router/adapter de compatibilidad con el limite de Vercel Hobby (12
   Serverless Functions por deployment). Este archivo NO contiene logica de
   negocio propia -- unicamente despacha cada ruta publica original hacia el
   handler correspondiente, reubicado sin modificar en
   server/api-lib/_route-*.mjs (ver VERCEL_HOBBY_COMPAT.md para el detalle
   completo de por que existe y que NO cambio).

   Vercel preserva el pathname ORIGINAL de la solicitud entrante en
   `req.url` cuando esta se resuelve mediante una entrada de `rewrites` en
   vercel.json (el rewrite es transparente para el cliente Y para la
   funcion) -- por eso este router puede leer `req.url` para saber cual de
   las rutas originales se pidio, sin que vercel.json necesite codificar esa
   informacion de ninguna otra forma. */
import apusHandler from '../server/api-lib/_route-apus.mjs';
import projectsHandler from '../server/api-lib/_route-projects.mjs';
import challengeDecisionsHandler from '../server/api-lib/_route-challenge-decisions.mjs';
import technicalMemoryHandler from '../server/api-lib/_route-technical-memory.mjs';
import exportEventsHandler from '../server/api-lib/_route-export-events.mjs';
import healthHandler from '../server/api-lib/_route-health.mjs';

const ROUTES = {
  '/api/apus': apusHandler,
  '/api/projects': projectsHandler,
  '/api/challenge-decisions': challengeDecisionsHandler,
  '/api/technical-memory': technicalMemoryHandler,
  '/api/export-events': exportEventsHandler,
  '/api/health': healthHandler,
};

export default async function handler(req, res){
  let pathname;
  try{
    pathname = new URL(req.url, 'http://internal.zoemec').pathname;
  }catch{
    res.status(400).json({ error: 'URL de solicitud invalida.' });
    return;
  }
  const route = ROUTES[pathname];
  if(!route){
    res.status(404).json({ error: `Ruta no reconocida: ${pathname}` });
    return;
  }
  return route(req, res);
}
