/* Deshacer / rehacer del Plano Inteligente (punto 18). Como cada mutacion de
   cadModel.js regresa un modelo NUEVO, el historial es simplemente una pila
   de modelos inmutables -- sin comandos inversos que puedan desincronizarse
   del modelo real. Tope de 100 pasos para no crecer sin limite en memoria. */

export const HISTORY_LIMIT = 100;

export function createHistory(present){
  return { past: [], present, future: [], lastLabel: null };
}

export function commitHistory(history, next, label = ''){
  if(next === history.present) return history;
  const past = [...history.past, { model: history.present, label }].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], lastLabel: label };
}

/* Reemplaza el presente SIN crear un paso de historial -- para estados
   intermedios de un arrastre: el arrastre completo (inicio -> soltar) debe
   deshacerse con UN solo Ctrl+Z, no con uno por cada pixel movido. */
export function replacePresent(history, next){
  return { ...history, present: next };
}

export function canUndo(history){ return history.past.length > 0; }
export function canRedo(history){ return history.future.length > 0; }

export function undoHistory(history){
  if(!canUndo(history)) return history;
  const prev = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: prev.model,
    future: [{ model: history.present, label: prev.label }, ...history.future],
    lastLabel: prev.label ? `Deshecho: ${prev.label}` : null
  };
}

export function redoHistory(history){
  if(!canRedo(history)) return history;
  const next = history.future[0];
  return {
    past: [...history.past, { model: history.present, label: next.label }],
    present: next.model,
    future: history.future.slice(1),
    lastLabel: next.label ? `Rehecho: ${next.label}` : null
  };
}
