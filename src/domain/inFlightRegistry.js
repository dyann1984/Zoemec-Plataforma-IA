/* Material & Price Intelligence 2.1 -- regla 8 (integracion final):
   single-flight / in-flight deduplication. Cuando 20 recursos identicos de
   un mismo batch llegan "al mismo tiempo" (antes de que el primer
   cache.save() termine), sin esto los 20 verian CACHE_MISS y dispararian 20
   busquedas reales identicas. Este registro asegura que solo la PRIMERA
   llamada por fingerprint ejecuta la funcion real; las demas, mientras esa
   promesa siga pendiente, reciben exactamente el mismo resultado (o el
   mismo error) sin volver a llamar a nada. Modulo puro, sin red. Vive
   SEPARADO del cache (el cache es almacenamiento; esto es coordinacion de
   ejecucion concurrente) para poder usarse incluso con un cache
   deshabilitado o fallido. */

export function createInFlightRegistry(){
  const pending = new Map();

  /* getOrCreate: si ya existe una promesa pendiente para `key`, la reutiliza
     (single-flight real); si no, ejecuta factory() UNA vez, la registra
     mientras este pendiente, y la limpia del registro cuando resuelve o
     rechaza (exito o error) -- nunca deja una entrada "fantasma" bloqueando
     llamadas futuras despues de que la real ya termino. */
  function getOrCreate(key, factory){
    if(pending.has(key)) return pending.get(key);
    const promise = Promise.resolve().then(factory).finally(() => { pending.delete(key); });
    pending.set(key, promise);
    return promise;
  }

  function size(){ return pending.size; }

  return { getOrCreate, size };
}
