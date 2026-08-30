/* Material & Price Intelligence 2.1 -- regla 9: telemetria de consumo.
   Registra UNICAMENTE datos comprobables que OpenAI/el propio proceso
   reportan de verdad (inputTokens/outputTokens/cachedTokens cuando la API
   los devuelve, webSearchCalls/resourcesAnalyzed/cacheHits/cacheMisses que
   ZOEMEC mismo cuenta). Nunca inventa un costo monetario: ZOEMEC no esta
   conectado a la API de facturacion de OpenAI (confirmado en /api/health,
   openaiUsage:not_available) -- ese campo se deja fuera a proposito, nunca
   se estima con una tarifa asumida. Modulo puro, sin red. */

export function createPriceTelemetry(){
  const totals = {
    inputTokens: 0, outputTokens: 0, cachedTokens: 0,
    webSearchCalls: 0, resourcesAnalyzed: 0, cacheHits: 0, cacheMisses: 0,
    cacheExpired: 0, inFlightDeduplications: 0, searchesDeferred: 0,
    serverCacheHits: 0
  };

  function recordUsage(partial = {}){
    for(const key of Object.keys(totals)){
      const value = Number(partial[key]);
      if(Number.isFinite(value) && value > 0) totals[key] += value;
    }
    return { ...totals };
  }

  function snapshot(){
    return { ...totals };
  }

  return { recordUsage, snapshot };
}
