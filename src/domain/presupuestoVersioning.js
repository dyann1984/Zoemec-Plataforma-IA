/* Versionado inmutable de un Presupuesto (Fase D). Mismo principio que
   src/domain/apuVersioning.js (nunca sobreescribe una version anterior,
   cada guardado crea V{n+1}) pero SIN su dependencia de
   finalizeProfessionalAPU (especifica del esquema de APU) -- un snapshot de
   Presupuesto ya viene completamente agregado por
   presupuestoAggregation.js#aggregatePresupuesto (nada que "finalizar" ni
   recalcular aqui, solo clonar). Deliberadamente un modulo separado en vez
   de generalizar apuVersioning.js -- mismo criterio ya usado en
   src/domain/planoTakeoffVersioning.js: la logica compartida real (numero
   de version siguiente + snapshot clonado) son unas lineas, no justifica
   acoplar dominios distintos a una sola abstraccion. */

const clone = value => structuredClone(value);
const stamp = () => new Date().toISOString();

export function createPresupuestoVersion(snapshot, history = [], { user = 'Usuario', reason = 'Guardado', at = stamp() } = {}){
  const number = (history.reduce((max, v) => Math.max(max, Number(String(v.version || '').replace(/\D/g, '')) || 0), 0)) + 1;
  const entry = { version: `V${number}`, at, user, reason, snapshot: clone(snapshot) };
  return { snapshot: clone(entry.snapshot), history: [...history, entry] };
}

export function restorePresupuestoVersion(entry, history, options = {}){
  if(!entry?.snapshot) throw new Error('La version seleccionada no contiene snapshot.');
  return createPresupuestoVersion(entry.snapshot, history, { ...options, reason: options.reason || `Restauracion de ${entry.version}` });
}
