/* Estado de trabajo de "APU Inteligente" (RC4): logica pura, sin React, para
   que "Limpiar trabajo" sea un reseteo COMPLETO y verificable por prueba, sin
   depender de un arnes de render de componentes (este proyecto no usa
   jsdom/@testing-library). main.jsx solo llama estas funciones y conecta el
   resultado a sus useState; la forma del estado "vacio" y la regla de que
   APUs sobreviven viven aqui, donde si se pueden probar. */

/* Forma exacta de "sin trabajo en curso" para el panel de generacion:
   catalogo de conceptos, archivo Excel actual, conceptos detectados/
   seleccionados, duplicados, progreso y resultado de la ultima generacion.
   Cualquier cambio a esta forma (agregar un campo de estado nuevo al panel)
   debe reflejarse aqui tambien -- la prueba de "estado vacio" depende de
   esta funcion, no de una lista duplicada en main.jsx. */
export function emptyApuWorkspaceState(){
  return {
    concept: '',
    aiUnit: '',
    aiQty: '',
    aiOpen: false,
    excelInfo: null,
    conceptBatch: null,
    batchAPUs: [],
    aiStatus: '',
    batchBusy: false,
    showExecutive: false,
    batchSelection: null,
    batchSearch: '',
    batchResult: null
  };
}

/* Retira del listado de APUs del proyecto SOLO los que produjo el ultimo
   lote de catalogo (batchApuIds) -- nunca APUs guardados por otra via
   (concepto suelto, sesiones anteriores) ni datos de otros proyectos. Si no
   hay lote activo (batchApuIds vacio), no quita nada. */
export function removeBatchApus(apus, batchApuIds){
  const list = Array.isArray(apus) ? apus : [];
  if(!batchApuIds || !batchApuIds.length) return list;
  const ids = new Set(batchApuIds);
  return list.filter(a => !ids.has(a?.id));
}
