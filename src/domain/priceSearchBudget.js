/* Material & Price Intelligence 2.1 -- regla 9: control de consumo. Un lote
   grande (los 40 conceptos que se procesaran despues) no debe poder agotar
   el saldo de OpenAI sin control ni tumbar el batch completo al llegar al
   limite. MAX_PRICE_SEARCHES_PER_BATCH es configurable por instancia (no una
   constante global fija) para que cada llamador decida su propio limite
   segun el saldo disponible en ese momento. Modulo puro, sin red. */

export const PRICE_SEARCH_DEFERRED = 'PRICE_SEARCH_DEFERRED';

/* Hotfix 2.1.1 -- regla 7 (control de categorias de busqueda): distinto de
   PRICE_SEARCH_DEFERRED (presupuesto agotado a mitad de corrida). Un
   recurso queda PRICE_SEARCH_SKIPPED_CATEGORY cuando su `kind` no esta
   habilitado por PRICE_SEARCH_RESOURCE_TYPES -- nunca llega a consumir
   presupuesto ni a llamar searchFn, y eso debe distinguirse claramente de
   "se intento pero ya no habia saldo". */
export const PRICE_SEARCH_SKIPPED_CATEGORY = 'PRICE_SEARCH_SKIPPED_CATEGORY';

/* createPriceSearchBudget: contador simple pero explicito. canSearch() nunca
   lanza ni bloquea -- el llamador decide que hacer cuando el presupuesto se
   agota (regla explicita: "NO fallar todo el batch", los recursos
   pendientes quedan PRICE_SEARCH_DEFERRED y el resto del batch continua). */
export function createPriceSearchBudget({ maxSearches = Infinity } = {}){
  let used = 0;
  const deferred = [];

  function canSearch(){
    return used < maxSearches;
  }

  /* recordSearch: SOLO se llama cuando de verdad se ejecuto una busqueda
     real (nunca en un cache hit -- un cache hit no consume presupuesto). */
  function recordSearch(){
    used += 1;
    return { used, remaining: Math.max(0, maxSearches - used), exhausted: used >= maxSearches };
  }

  function recordDeferred(resourceKey){
    deferred.push(resourceKey);
    return { status: PRICE_SEARCH_DEFERRED, resourceKey };
  }

  return {
    canSearch,
    recordSearch,
    recordDeferred,
    get used(){ return used; },
    get remaining(){ return Math.max(0, maxSearches - used); },
    get exhausted(){ return used >= maxSearches; },
    get deferredResources(){ return [...deferred]; }
  };
}
