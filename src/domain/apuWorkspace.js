/* Estado de trabajo de "APU Inteligente" (RC4): logica pura, sin React, para
   que "Limpiar trabajo" sea un reseteo COMPLETO y verificable por prueba, sin
   depender de un arnes de render de componentes (este proyecto no usa
   jsdom/@testing-library). main.jsx solo llama estas funciones y conecta el
   resultado a sus useState; la forma del estado "vacio" y la regla de que
   APUs sobreviven viven aqui, donde si se pueden probar. */
import { normalizeUnitLabel } from '../lib/excelImport.js';

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

/* Clave de agrupacion SOLO para la revision de duplicados en pantalla: a
   diferencia de conceptApuKey (apuGeneration.js, que ademas usa clave/codigo
   y P.U. de referencia, pensada para el cache de generacion con IA), aqui
   interesa detectar "es el mismo concepto tecnico" sin importar que cada
   renglon duplicado en un catalogo real casi siempre trae un codigo/fila
   distinto. */
export function duplicateGroupKey(item){
  const concept = String(item?.concept || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim();
  return `${concept}|${normalizeUnitLabel(item?.unit || '')}`;
}
/* Agrupa los conceptos de un lote por duplicateGroupKey -- Map<key, index[]>,
   mismo orden de aparicion. Logica pura, sin React, para que la tabla de
   revision de duplicados (main.jsx) y sus pruebas usen exactamente la misma
   regla de agrupacion. */
export function groupConceptsByDuplicateKey(concepts){
  const groups = new Map();
  (concepts || []).forEach((item, index) => {
    const key = duplicateGroupKey(item);
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  return groups;
}
/* Preseleccion por defecto de la tabla de revision de lote: un renglon por
   grupo de duplicados (el primero de cada grupo). Esto es la UNICA razon
   legitima por la que "seleccionados" puede empezar por debajo de
   "conceptos detectados" -- y siempre queda visible en pantalla (contador
   "X de Y seleccionados" + boton "Seleccionar todos"), nunca en silencio. */
export function defaultBatchSelection(concepts){
  const sel = new Set();
  groupConceptsByDuplicateKey(concepts).forEach(indices => sel.add(indices[0]));
  return sel;
}

/* CAUSA RAIZ del defecto real "6 detectados -> 4 seleccionados/generados"
   (RC6, catalogo de texto pegado con los 6 conceptos del reporte): esta
   funcion filtraba por una lista FIJA de unidades "conocidas" (m2, kg, pza,
   lote...) que quedo desactualizada frente a las unidades que RC5 empezo a
   producir legitimamente desde texto pegado -- "u" (fallback de
   normalizeUnitLabel cuando el concepto no trae ninguna unidad tecnica
   explicita, ej. "Movimiento de mueble") y "costal"/"saco"/"bulto"/"viaje"
   (unidades de conteo, ej. "acarreo de 46 costales"). El filtro corria
   DESPUES de que el concepto ya aparecia "seleccionado" en la tabla de
   revision, asi que lo excluia de generateSelectedBatch/exportConceptBatch/
   exportConceptsAPUPDF EN SILENCIO -- la UI nunca explicaba por que
   "Seleccionados" bajaba de "Conceptos". Ese chequeo ademas era redundante:
   el camino de Excel ya exige una unidad tecnica reconocida ANTES de crear
   el renglon (ver unitRe en extractConceptsFromSheetRows,
   src/lib/excelImport.js), y el camino de texto pegado ya descarta ruido
   antes de crear el concepto (ver isNoiseConceptLine, mismo archivo) -- para
   cuando un item llega aqui ya paso por un filtro de ruido real; una
   segunda lista de unidades solo podia quedarse corta y volver a romperse
   con la proxima unidad legitima nueva.

   Invariante de produccion (RC6): un concepto SELECCIONADO por el usuario
   SIEMPRE se intenta generar -- "REQUIERE REVISION" es un estado del
   resultado, nunca un motivo de exclusion silenciosa. Esta funcion ya NO
   filtra por vocabulario de unidad: solo descarta lo que es literalmente
   imposible de generar (sin texto de concepto) o texto de ruido inequivoco
   ("TOTAL"/"SUBTOTAL"). El vocabulario de unidad conocido sigue existiendo
   como SENAL de revision, no de exclusion -- ver conceptNeedsReviewFlag. */
export function isExportableConceptItem(item){
  const conceptRaw = String(item?.concept || '').trim();
  if(!conceptRaw) return false;
  const concept = conceptRaw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim();
  if(/^(total|subtotal|gran total)\b/.test(concept)) return false;
  if(/\b(total partida|total zona|total area|total capitulo|subtotal partida|gran total)\b/.test(concept)) return false;
  return true;
}
/* Senal SOLO de revision (nunca de exclusion, ver isExportableConceptItem
   arriba): un concepto con descripcion muy corta, cantidad invalida o
   unidad fuera del vocabulario tecnico conocido SIGUE generandose, pero el
   lote lo marca REQUIERE REVISION (ver requiresReview en runQueueJob,
   main.jsx) para que un humano lo revise antes de aprobar el precio --
   nunca desaparece del presupuesto por esto. */
export function conceptNeedsReviewFlag(item){
  const concept = String(item?.concept || '').trim();
  const unit = normalizeUnitLabel(item?.unit);
  const qty = Number(item?.qty || 0);
  if(concept.length < 12 || qty <= 0) return true;
  return !/^(m2|m²|m3|m³|kg|ton|tonelada|pza|pieza|pzas|ml|m|l|lt|lote|jgo|hr|hora|dia|día|jor|jornal|serv|servicio|sal|salida|salidas|costal|costales|saco|sacos|bulto|bultos|viaje|viajes|u)$/i.test(unit);
}
/* Resuelve, a partir del lote completo y los indices marcados en pantalla
   (batchSelection), la lista final que SI se manda a generar/exportar y la
   lista de conceptos que quedan fuera -- ya sea porque no estaban marcados
   (duplicados agrupados, ver defaultBatchSelection) o porque
   isExportableConceptItem los rechazo (ruido inequivoco). Logica pura
   compartida por generateSelectedBatch/exportConceptBatch/
   exportConceptBatchPDF (main.jsx) para que los 3 caminos de
   generacion/exportacion nunca puedan dar resultados distintos entre si, y
   para que "N conceptos requieren confirmacion" se pueda mostrar siempre en
   vez de excluir en silencio. */
/* Aislamiento por proyecto (RC7): logica pura detras de useProjectScoped
   (main.jsx) -- vive aqui para que "Vaciar proyecto" (borrar TODOS los APUs
   del proyecto activo, no solo el ultimo lote) se pueda probar contra la
   MISMA funcion que usa la app real, sin duplicar la regla de fusion en un
   test aparte (leccion de RC6: una segunda copia de la logica se
   desincroniza). Un item sin projectId propio pertenece al scope `null`
   (compatibilidad con datos previos a "proyectos"). */
export function scopedListView(list, scopeKey){
  const key = scopeKey ?? null;
  return (list || []).filter(x => (x?.projectId ?? null) === key);
}
/* Fusiona una lista YA FILTRADA al proyecto activo (nextScoped) de vuelta
   con el almacenamiento completo (prevList, todos los proyectos) sin tocar
   los items de otros proyectos -- ni para leer ni para escribir. "Vaciar
   proyecto" es simplemente mergeScopedUpdate(prevList, activeProjectId, []). */
export function mergeScopedUpdate(prevList, scopeKey, nextScoped){
  const key = scopeKey ?? null;
  const prev = prevList || [];
  const others = prev.filter(x => (x?.projectId ?? null) !== key);
  const tagged = (nextScoped || []).map(x => (x && (x.projectId ?? null) === null) ? { ...x, projectId: key } : x);
  return [...others, ...tagged];
}

export function resolveBatchSelection(concepts, selectedIndices){
  const list = Array.isArray(concepts) ? concepts : [];
  const selected = selectedIndices instanceof Set ? selectedIndices : new Set();
  const selectedList = [];
  const excludedConcepts = [];
  list.forEach((item, i) => {
    const checked = selected.has(i);
    const exportable = isExportableConceptItem(item);
    if(checked && exportable) selectedList.push(item);
    else excludedConcepts.push(item?.concept || '');
  });
  return { selectedList, excludedConcepts };
}

/* RC10 -- causa raiz real del "112 detectados -> 1 hoja exportada": el
   nombre del archivo descargado ("APU-PROFESIONAL-ZOEMEC (N).xlsx") solo lo
   produce exportAPUExcelV2 SIN fileName, y el UNICO llamador asi en todo el
   codigo es el boton de UN SOLO APU del editor (ProfessionalApuEditor.onExcel,
   ver src/main.jsx) -- exportConceptBatch (el boton de lote) SIEMPRE pasa
   fileName:'APU-POR-CONCEPTO-ZOEMEC.xlsx'. No hay ningun punto del codigo
   donde exportConceptBatch reduzca un arreglo de 112 a 1 -- se audito
   exhaustivamente (batchAPUs, buildBatchAPUs, exportConceptsAPUWorkbook,
   exportAPUExcelV2: ninguno hace slice/find/toma-el-primero).

   Aun asi, la sugerencia de arquitectura del reporte es correcta y se
   implementa: en vez de depender EXCLUSIVAMENTE de batchAPUs (estado de
   React transitorio, useState sin persistir, vulnerable a closures viejos
   si algun dia cambia el orden de renders), el boton de lote ahora resuelve
   primero contra la fuente PERSISTENTE (apus del proyecto activo, ya
   correctamente aislado por proyecto desde RC7) buscando cada concepto por
   su `clave` -- la misma clave que applyConceptMetadataV2 (apuGeneration.js)
   siempre fuerza a partir de item.code/item.clave, nunca inventada. Esto
   ademas preserva el orden original del lote (concepts.map, no el orden de
   finalizacion de la cola concurrente) y no depende de ids frescos (uid())
   que no se pueden derivar del concepto de origen. */
export function resolveBatchExportApus({ concepts, persistedApus, cachedApus } = {}){
  const list = Array.isArray(concepts) ? concepts : [];
  if(!list.length) return [];
  const byClave = new Map((persistedApus || []).filter(Boolean).map(a => [a.clave, a]));
  const fromPersisted = list.map(item => byClave.get(item?.code || item?.clave)).filter(Boolean);
  if(fromPersisted.length === list.length) return fromPersisted;
  if(Array.isArray(cachedApus) && cachedApus.length === list.length) return cachedApus;
  return null;
}

/* Guard contra exportacion parcial (RC10): si la cantidad de APUs
   efectivamente resueltos para exportar no coincide con lo que la UI ya
   anuncio (conceptsTotal/generated), NUNCA se genera un archivo parcial en
   silencio -- se aborta con un mensaje explicito y accionable. */
export function assertExpectedExportCount(expected, actual){
  const exp = Number(expected) || 0;
  const act = Number(actual) || 0;
  if(act === 0){
    throw new Error(`No se puede exportar: no hay ningún APU disponible para exportar (se esperaban ${exp}).`);
  }
  if(act < exp){
    throw new Error(`El lote contiene ${exp} APUs, pero solo ${act} está disponible para exportación. Recarga el proyecto o vuelve a generar el lote.`);
  }
}
