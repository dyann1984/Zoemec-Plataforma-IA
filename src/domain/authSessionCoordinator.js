/* Corrige la condicion de carrera del incidente de produccion: login() y el
   listener onAuthStateChanged podian, ambos, disparar en paralelo la misma
   secuencia (loadOrCreateProfile -> construir sesion -> setUser/setScreen/
   setActiveUid/setUsage) para la MISMA transicion de autenticacion --
   resultado no determinista (gana quien resuelva ultimo) y, en el peor
   caso, un usuario veia un toast de error mientras el listener paralelo lo
   terminaba autenticando de todas formas.

   createSessionCoordinator() da una garantia estructural, no una convencion:
   para un mismo uid, la funcion que realmente construye la sesion
   (loadOrCreateProfile + buildSession + los setState) se ejecuta COMO MUCHO
   una vez por transicion -- cualquier segundo llamador concurrente para ese
   mismo uid recibe la MISMA promesa (y por lo tanto el mismo resultado) en
   vez de disparar su propia ejecucion independiente. No usa React ni
   Firebase: es logica pura, facil de probar con funciones falsas. */
export function createSessionCoordinator(){
  let inFlight = null; // { uid, promise } | null

  return {
    /* Ejecuta taskFn() UNA sola vez para `uid` mientras haya una ejecucion en
       curso para ese mismo uid; cualquier llamada concurrente con el mismo
       uid se cuelga de esa misma promesa en vez de volver a invocar taskFn.
       Una llamada con un uid DISTINTO (ej. el usuario cambio de cuenta a
       mitad de una ejecucion previa) SI dispara su propia ejecucion nueva --
       nunca se sirve el resultado de otra cuenta. */
    async run(uid, taskFn){
      if(inFlight && inFlight.uid === uid){
        return inFlight.promise;
      }
      const promise = Promise.resolve().then(() => taskFn());
      inFlight = { uid, promise };
      try{
        return await promise;
      }finally{
        if(inFlight && inFlight.promise === promise) inFlight = null;
      }
    },
    /* Solo para tests/diagnostico: true si hay una ejecucion en curso. */
    isRunning(){
      return inFlight !== null;
    },
  };
}
