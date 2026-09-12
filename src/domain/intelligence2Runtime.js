/* Material & Price Intelligence 2.1 -- runtime real usado por main.jsx (regla
   11: individual y batch comparten EXACTAMENTE esta misma instancia y
   politica, nunca sistemas paralelos). Este es el UNICO archivo que conoce a
   la vez el dominio puro (src/domain/*) y la capa de red del cliente
   (apiClient.js) -- src/domain/ sigue sin depender de fetch/Firebase.

   Cache: singleton de sesion (createInMemoryPriceCacheStore) por defecto --
   sobrevive entre llamadas de generateAI/generateBatchAPU dentro de la misma
   sesion de navegador (deduplicacion real entre APUs distintos que comparten
   un mismo insumo). Para produccion con cache persistente entre sesiones,
   ver server/api-lib/_priceCacheFirestoreStore.mjs (mismo contrato
   get/set/delete) -- intercambiable aqui sin tocar ningun otro archivo.

   Budget/telemetry/inFlightRegistry: se crean NUEVOS en cada invocacion de
   generateAI/generateBatchAPU (createIntelligence2RunContext), nunca se
   acumulan indefinidamente durante toda la sesion -- un presupuesto de
   busquedas tiene sentido "por corrida", no "para siempre". */
import { createPriceSearchCache, PRICE_CACHE_TTL_MS } from './priceSearchCache.js';
import { createPriceSearchBudget } from './priceSearchBudget.js';
import { createPriceTelemetry } from './priceTelemetry.js';
import { createInFlightRegistry } from './inFlightRegistry.js';
import { apiPost } from '../services/apiClient.js';

/* Hotfix 2.1.1 -- FASE 5 del controlled live retest: no existia ninguna
   forma REAL de activar PRICE_SEARCH_RESOURCE_TYPES en un Preview ya
   desplegado sin editar codigo y volver a desplegar (INTELLIGENCE2_CONFIG
   era una constante de modulo fija). Se agrega una unica variable de
   entorno de BUILD (Vite expone solo las que empiezan con VITE_), fijada
   SOLO en el ambiente Preview de Vercel -- nunca en Production -- para que
   una prueba controlada pueda restringir categorias sin volver a tocar
   este archivo cada vez. Formato: lista separada por comas, ej.
   "materials" o "materials,equipment". Vacia/ausente (el caso de
   produccion siempre) -> null, exactamente el comportamiento productivo
   actual (las 4 categorias). `import.meta.env` no existe bajo Node puro
   (node --test) -- el optional chaining lo deja simplemente undefined ahi,
   nunca lanza. */
export function parseResourceTypesEnv(raw){
  const value = String(raw ?? '').trim();
  if(!value) return null;
  const kinds = value.split(',').map(s => s.trim()).filter(Boolean);
  return kinds.length ? kinds : null;
}

/* Configuracion central, mutable a proposito (regla 9: "no quiero politicas
   imposibles de cambiar") -- ajustar antes de correr el lote de 40 conceptos
   sin tener que tocar ningun otro archivo. */
export const INTELLIGENCE2_CONFIG = {
  maxPriceSearchesPerBatch: 40,
  defaultTtlMs: PRICE_CACHE_TTL_MS.NORMAL,
  /* Hotfix 2.1.1 -- regla 7: `null` preserva el comportamiento productivo
     actual (materials + labor + equipment + seguridad, igual que siempre).
     Se puede ajustar aqui en codigo (ej. ['materials']) o, sin tocar este
     archivo, con VITE_PRICE_SEARCH_RESOURCE_TYPES en el ambiente de build
     -- este valor llega a enrichApuWithIntelligence2 via
     createIntelligence2RunContext() abajo, que main.jsx ya esparce
     (...runContext) en cada llamada. */
  priceSearchResourceTypes: parseResourceTypesEnv(typeof import.meta !== 'undefined' ? import.meta.env?.VITE_PRICE_SEARCH_RESOURCE_TYPES : undefined)
};

let sharedCache = null;
export function getSharedPriceCache(){
  if(!sharedCache) sharedCache = createPriceSearchCache({ defaultTtlMs: INTELLIGENCE2_CONFIG.defaultTtlMs });
  return sharedCache;
}
/* Solo para pruebas/reinicio explicito de sesion -- nunca se llama desde el
   flujo normal de generacion. */
export function resetSharedPriceCache(){ sharedCache = null; }

/* searchFn real de produccion: wrapper delgado sobre /api/price-intelligence
   (server/api-lib/_priceIntelligenceCore.mjs) -- MISMO endpoint que ya usaba
   enrichAPUWithMarketPrices, cero logica nueva de busqueda aqui. */
// Fase 2 (APU regionalizados): country/state/city ESTRUCTURADOS del proyecto
// activo, ademas de `location` (texto libre legado, ej. projects.ubicacion
// sin estructurar todavia). resolveResourcePrice (materialPriceIntelligence2.js)
// ya manda estos mismos campos por renglon (rowCountry/rowState/rowCity) --
// tienen prioridad si algun dia un recurso trae su propia ubicacion, pero
// hoy siempre coinciden con los del proyecto (un solo nivel de ubicacion
// por corrida, no por recurso).
export function createProductionSearchFn({ location = '', country = '', state = '', city = '', dateBase = '' } = {}){
  return async ({ description, unit, kind, region, country: rowCountry, state: rowState, city: rowCity, dateBase: rowDateBase, technicalSpecification, tenantScope }) => {
    return apiPost('/api/price-intelligence', {
      description, unit, kind, location: region || location, dateBase: rowDateBase || dateBase,
      categoriaLaboral: kind === 'labor' ? description : '',
      technicalSpecification: technicalSpecification || '', region: region || location,
      country: rowCountry || country, state: rowState || state, city: rowCity || city,
      tenantScope: tenantScope || null
    });
  };
}

/* createIntelligence2RunContext: agrupa lo que necesita CADA llamada a
   enrichApuWithIntelligence2 (individual o batch) -- cache compartido de
   sesion + budget/telemetry/inFlightRegistry frescos para esa corrida. */
export function createIntelligence2RunContext({
  maxPriceSearches = INTELLIGENCE2_CONFIG.maxPriceSearchesPerBatch, location = '', country = '', state = '', city = '', dateBase = '',
  resourceTypes = INTELLIGENCE2_CONFIG.priceSearchResourceTypes
} = {}){
  return {
    cache: getSharedPriceCache(),
    budget: createPriceSearchBudget({ maxSearches: maxPriceSearches }),
    telemetry: createPriceTelemetry(),
    inFlightRegistry: createInFlightRegistry(),
    searchFn: createProductionSearchFn({ location, country, state, city, dateBase }),
    resourceTypes,
    // Fase 2: se reenvia tal cual a enrichApuWithIntelligence2 (main.jsx hace
    // `enrichApuWithIntelligence2({..., ...runContext})`) -- ahi decide el
    // fingerprint de cache por recurso Y el snapshot que se congela en el
    // APU (apuSchema.js#ubicacionEstructurada), nunca un enlace vivo al
    // proyecto.
    location: { country, state, city }
  };
}
