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

/* DEFECTO REAL (reportado con evidencia medida: catalogo de 25 conceptos ->
   Excel exportado con RESUMEN + CONTROL_REVISION + 1 SOLA hoja APU): la
   pagina de APU Inteligente muestra, sobre el MISMO concepto previsualizado
   (siempre el primero del lote), un boton "Descargar Excel"/"Descargar PDF"
   de UN SOLO APU (ProfessionalApuEditor, uso legitimo para un concepto
   suelto) al mismo tiempo que el boton "Excel completo por concepto (N
   hojas)" del lote completo. Ambos se llaman "Descargar Excel" para el
   usuario -- nada distingue "esto exporta 1 concepto" de "esto exporta los
   N del catalogo". Reproducido en vivo: el boton de UN SOLO APU exporta
   exactamente RESUMEN + CONTROL_REVISION + 1 hoja (el primer concepto),
   nunca los N del catalogo -- sin error, sin aviso.

   Esta funcion es la logica pura de la advertencia: dado el catalogo
   actualmente cargado y el concepto que se esta previsualizando, decide si
   la exportacion de UN SOLO APU es ambigua (hay un catalogo real con mas de
   1 concepto) y devuelve el texto exacto a mostrar antes de proceder, o
   null si no hay ambiguedad (uso legitimo: sin catalogo, o catalogo de un
   solo concepto). main.jsx solo llama window.confirm(mensaje) con este
   texto antes de invocar el export real -- nunca decide el texto ahi. */
export function describeAmbiguousSingleExport(conceptBatch, previewConcept){
  const total = conceptBatch?.concepts?.length || 0;
  if(total <= 1) return null;
  const nombre = String(previewConcept || '').trim() || '(sin concepto)';
  return `Cargaste un catalogo con ${total} conceptos. "Descargar Excel/PDF" aqui solo exporta EL CONCEPTO QUE ESTAS VIENDO ("${nombre}"), no los ${total} conceptos del catalogo.\n\nPara exportar el catalogo completo usa "Excel completo por concepto (${total} hojas)" o "PDF individual por concepto" en el panel de arriba.\n\n¿Aun asi quieres descargar solo este concepto?`;
}
