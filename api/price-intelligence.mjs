import { requireFeature } from '../server/api-lib/_authGuard.mjs';
import { searchMarketReferencesWithCache } from '../server/api-lib/_priceIntelligenceCache.mjs';

/* Material & Price Intelligence 2.1: este endpoint ahora pasa por el cache
   persistente de Firestore (ver _priceIntelligenceCache.mjs) ANTES de
   llamar a OpenAI -- CACHE_HIT nunca toca _priceIntelligenceCore.mjs. El
   motor de busqueda real (searchMarketReferences) sigue siendo exactamente
   el mismo, sin ningun cambio; esta capa solo decide SI hace falta
   llamarlo. tenantScope/technicalSpecification son opcionales y aditivos
   (compatibilidad total con clientes que no los envian).

   F1/P0: el rate limit 'ai' se cobra SOLO cuando hay busqueda web real
   (deferRateLimit + beforeWebSearch) -- un resultado servido desde cache no
   consume busqueda. Mismo limite para todos los roles (ver _authGuard.mjs). */
export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error: 'Metodo no permitido.' });
    return;
  }
  try{
    const authz = await requireFeature(req, 'ai', { deferRateLimit: true });
    const {
      description = '', unit = '', kind = 'materials', location = '', dateBase = '',
      technicalSpecification = '', region = '', country = '', state = '', city = '', zone = '', tenantScope = null
    } = req.body || {};
    const result = await searchMarketReferencesWithCache({
      description, unit, kind, location, dateBase, technicalSpecification, region, country, state, city, zone, tenantScope,
      beforeWebSearch: authz.consumeRateLimit
    });
    res.status(200).json(result);
  }catch(err){
    const body = { error: err.message || 'No se pudo consultar precios de mercado.' };
    if(err.code) body.code = err.code;
    if(err.retryAfterSeconds) body.retryAfterSeconds = err.retryAfterSeconds;
    res.status(err.status || 400).json(body);
  }
}
