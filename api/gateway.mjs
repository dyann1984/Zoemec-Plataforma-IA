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
import organizationsHandler from '../server/api-lib/_route-organizations.mjs';
import constructionProposalHandler from '../server/api-lib/_route-construction-proposal.mjs';
import planoTakeoffsHandler from '../server/api-lib/_route-plano-takeoffs.mjs';
import catalogoConceptosHandler from '../server/api-lib/_route-catalogo-conceptos.mjs';
import presupuestosHandler from '../server/api-lib/_route-presupuestos.mjs';
import changeOrdersHandler from '../server/api-lib/_route-change-orders.mjs';
import commitmentsHandler from '../server/api-lib/_route-commitments.mjs';
import progressHandler from '../server/api-lib/_route-progress.mjs';
import estimatesHandler from '../server/api-lib/_route-estimates.mjs';
import paymentsHandler from '../server/api-lib/_route-payments.mjs';
import constructionDnaHandler from '../server/api-lib/_route-construction-dna.mjs';
import projectVaultHandler from '../server/api-lib/_route-project-vault.mjs';

const ROUTES = {
  '/api/apus': apusHandler,
  '/api/projects': projectsHandler,
  '/api/challenge-decisions': challengeDecisionsHandler,
  '/api/technical-memory': technicalMemoryHandler,
  '/api/export-events': exportEventsHandler,
  '/api/health': healthHandler,
  '/api/organizations': organizationsHandler,
  '/api/construction-proposal': constructionProposalHandler,
  '/api/plano-takeoffs': planoTakeoffsHandler,
  '/api/catalogo-conceptos': catalogoConceptosHandler,
  '/api/presupuestos': presupuestosHandler,
  '/api/change-orders': changeOrdersHandler,
  '/api/commitments': commitmentsHandler,
  '/api/progress': progressHandler,
  '/api/estimates': estimatesHandler,
  '/api/payments': paymentsHandler,
  '/api/construction-dna': constructionDnaHandler,
  '/api/project-vault': projectVaultHandler,
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
