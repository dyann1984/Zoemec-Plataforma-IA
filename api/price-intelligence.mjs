import { requireFeature } from '../server/api-lib/_authGuard.mjs';
import { searchMarketReferencesWithCache } from '../server/api-lib/_priceIntelligenceCache.mjs';

/* Material & Price Intelligence 2.1: este endpoint ahora pasa por el cache
   persistente de Firestore (ver _priceIntelligenceCache.mjs) ANTES de
   llamar a OpenAI -- CACHE_HIT nunca toca _priceIntelligenceCore.mjs. El
   motor de busqueda real (searchMarketReferences) sigue siendo exactamente
   el mismo, sin ningun cambio; esta capa solo decide SI hace falta
   llamarlo. tenantScope/technicalSpecification son opcionales y aditivos
   (compatibilidad total con clientes que no los envian). */
export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error: 'Metodo no permitido.' });
    return;
  }
  try{
    await requireFeature(req, 'ai');
    const {
      description = '', unit = '', kind = 'materials', location = '', dateBase = '',
      technicalSpecification = '', region = '', tenantScope = null
    } = req.body || {};
    const result = await searchMarketReferencesWithCache({ description, unit, kind, location, dateBase, technicalSpecification, region, tenantScope });
    res.status(200).json(result);
  }catch(err){
    // Ver comentario en api/generate-apu.mjs: err.publicMessage (fallo real
    // de OpenAI, clasificado en _priceIntelligenceCore.mjs) es seguro para
    // el cliente; err.message queda de fallback para errores propios de
    // ZOEMEC (auth, validacion).
    const message = err.publicMessage || err.message || 'No se pudo consultar precios de mercado.';
    res.status(err.status || 400).json({
      error: message,
      ...(err.errorClass ? { errorClass: err.errorClass } : {})
    });
  }
}
