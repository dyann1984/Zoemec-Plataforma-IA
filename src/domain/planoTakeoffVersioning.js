/* Versionado inmutable de un planoTakeoff (Fase B, punto 11). Mismo
   principio que src/domain/apuVersioning.js (nunca sobreescribe una version
   anterior, cada guardado crea V{n+1}) pero sin su dependencia de
   finalizeProfessionalAPU (especifica de APU) -- un planoTakeoff no tiene
   costos que recalcular, solo un snapshot de elementos/calibracion/escala
   que se clona tal cual. Deliberadamente un modulo separado en vez de
   generalizar apuVersioning.js: la logica compartida real (numero de
   version siguiente + snapshot clonado) son 3 lineas, no justifica acoplar
   dos dominios distintos a una sola abstraccion todavia. */

const clone = value => structuredClone(value);
const stamp = () => new Date().toISOString();

export function createPlanoTakeoffVersion(snapshot, history = [], { user = 'Usuario', reason = 'Guardado', at = stamp() } = {}){
  const number = (history.reduce((max, v) => Math.max(max, Number(String(v.version || '').replace(/\D/g, '')) || 0), 0)) + 1;
  const entry = { version: `V${number}`, at, user, reason, snapshot: clone(snapshot) };
  return { snapshot: clone(entry.snapshot), history: [...history, entry] };
}

export function restorePlanoTakeoffVersion(entry, history, options = {}){
  if(!entry?.snapshot) throw new Error('La version seleccionada no contiene snapshot.');
  return createPlanoTakeoffVersion(entry.snapshot, history, { ...options, reason: options.reason || `Restauracion de ${entry.version}` });
}
