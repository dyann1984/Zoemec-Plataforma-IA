/* Cuadrilla y rendimiento REALES para la ruta determinista (motor
   universal de APUs, fase "cuadrilla + rendimiento verificable"). Antes,
   `makeAPUFromConcept` (apuGeneration.js) solo emitia una "incidencia"
   (jornadas por unidad de concepto) por renglon de mano de obra, sin
   cuadrilla/rendimiento/jornada explicitos -- migrateLaborRow (apuSchema.js)
   dejaba cuadrilla/rendimiento en null para CUALQUIER APU de plantilla, asi
   que en pantalla (calcLaborRow, apuCalc.js) el costo se calculaba con esa
   incidencia opaca, nunca con una cuadrilla/rendimiento verificable.

   Este modulo NO reestima numeros nuevos: RECONSTRUYE la cuadrilla y el
   rendimiento que la incidencia YA EXISTENTE en el catalogo tecnico
   siempre implico (incidencia = 1/rendimiento para una cuadrilla de 1
   integrante de ese oficio) -- ver deriveCrewFromLaborRows. El precio
   resultante NO cambia (calcLaborRow ya calcula cuadrilla/rendimiento
   cuando ambos existen, y cuadrilla=1 / rendimiento=1/incidencia reproduce
   exactamente la misma incidencia de antes), lo que cambia es que ahora
   cuadrilla/rendimiento/jornada quedan EXPLICITOS, verificables y con una
   fuente declarada (RENDIMIENTO_FUENTE), en vez de estar implicitos dentro
   de un numero opaco. */
import { RENDIMIENTO_FUENTE } from './apuReview.js';

/* Disciplinas donde la cuadrilla se calibro contra una matriz REAL de la
   Biblioteca ZOEMEC (samples/library/*.xlsx, catalogos reales de precios
   unitarios mexicanos) en vez de solo el valor por defecto del catalogo
   tecnico interno:
   - concreto: samples/library/edificacion-cimentaciones-ZAPATAS-AISLADAS.xlsx
     trae "CUADRILLA No 5 (1 ALBAÑIL+1 PEON)" para zapata aislada de
     concreto -- coincide con la cuadrilla de este motor (Oficial albañil +
     Ayudante/peón).
   - acero: el mismo archivo trae "CUADRILLA No 4 (1 Fierrero + 1 Ayudante
     general)" para el armado de la misma zapata -- coincide con la
     cuadrilla de este motor (Fierrero + Ayudante).
   El resto de las disciplinas usa RENDIMIENTO_FUENTE.PLANTILLA (base
   tecnica ZOEMEC, no calibrada contra una matriz real todavia) -- nunca se
   presenta como si tuviera el mismo respaldo. */
// Exportado (antes privado) para que apuChallenge.js pueda etiquetar
// honestamente su baseline recalculado como "historico calibrado" solo para
// estas disciplinas, y "plantilla tecnica" para el resto -- nunca al reves.
export const LIBRARY_CALIBRATED_TIPOS = new Set(['concreto', 'acero']);

/* Confianza del rendimiento (0-100, ver yieldConfidence del reporte):
   deliberadamente NUNCA alta (max 85) -- ninguna de las dos fuentes es
   "dato de campo medido en esta obra", asi que ningun renglon de plantilla
   puede presentarse como VALIDADO (eso solo lo hace un humano, ver
   applyRendimientoDecision en apuReview.js). */
const CONFIDENCE_BY_SOURCE = { [RENDIMIENTO_FUENTE.HISTORICO]: 85, [RENDIMIENTO_FUENTE.PLANTILLA]: 65 };
// El fallback "generico" (ningun sistema constructivo identificado, ver
// classifyConstructionSystem en constructionSystems.js) no tiene ninguna
// disciplina real detras de su cuadrilla/rendimiento -- son valores de
// relleno de la plantilla generica, nunca deben presentarse con la misma
// confianza que un sistema realmente identificado.
const GENERIC_CONFIDENCE = 15;

/* Deriva, de los renglones v1 de mano de obra [descripcion, cantidadPorUnidad,
   unidad, salarioBase, fsr] que la plantilla tecnica YA elige para `tipo`,
   una cuadrilla explicita: 1 integrante de esa categoria produciendo un
   rendimiento de cuadrilla = 1/cantidadPorUnidad unidades de concepto por
   jornada de 8 horas. Devuelve un arreglo PARALELO a `laborRows` (mismo
   indice), listo para pasarse como `laborDetails` -- mismo contrato que ya
   usa normalizeAIApuToV2 (apuSchema.js) para la ruta de IA, asi que ambas
   rutas terminan en la misma forma v2 (ver punto 10 del reporte: "mismo
   contrato, no depende de OpenAI"). */
export function deriveCrewFromLaborRows(laborRows, tipo){
  const fuente = LIBRARY_CALIBRATED_TIPOS.has(tipo) ? RENDIMIENTO_FUENTE.HISTORICO : RENDIMIENTO_FUENTE.PLANTILLA;
  const yieldConfidence = tipo === 'generico' ? GENERIC_CONFIDENCE : CONFIDENCE_BY_SOURCE[fuente];
  return (laborRows || []).map(row => {
    const cantidadPorUnidad = Number(row?.[1]) || 0;
    // Sin redondear: 1/cantidadPorUnidad y su inverso vuelven a
    // cantidadPorUnidad con error de punto flotante despreciable (~1e-17),
    // muy por debajo de cualquier tolerancia numerica de los tests
    // existentes -- redondear aqui SI introduciria un error real (~1e-6)
    // que rompe esas pruebas.
    const rendimiento = cantidadPorUnidad > 0 ? 1 / cantidadPorUnidad : 0;
    return { cuadrilla: 1, rendimiento, jornada: 8, rendimientoFuente: fuente, yieldConfidence };
  });
}
