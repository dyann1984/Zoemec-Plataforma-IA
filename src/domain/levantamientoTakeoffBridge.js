/* Puente Levantamiento IA -> Plano/Takeoff (Fase 1.5, seccion 6 del sprint).
   Modulo puro, sin React/DOM. NO es un motor nuevo: construye un objeto con
   exactamente la forma que src/domain/planoReview.js ya espera y lo hace
   pasar por su gate real (applyPlanoElementReview + toApuSeed), las mismas
   funciones que ya usan PlanoTakeoff/PlanoManualMeasure en src/main.jsx.
   Cero calculo propio de cantidades -- las recibe ya calculadas
   (src/lib/levantamientoCalc.js), y cero logica de estados nueva.

   fuenteEscala se fija en REFERENCIA_USUARIO: la medida no viene de un
   trazo sobre imagen ni de una IA leyendo un plano, viene de una medicion
   directa en obra capturada por el usuario -- exactamente lo que ese valor
   de ESCALA_FUENTES ya representa en planoReview.js. */
import { ESCALA_FUENTES, PLANO_ELEMENT_STATES, applyPlanoElementReview, toApuSeed } from './planoReview.js';

/* Construye la semilla de APU ({concept,unit,qty,referencePU,sourceMeta}) de
   un concepto ya cuantificado de un levantamiento (ej. "Muros netos" de un
   Space). Regresa null si la cantidad no es utilizable (mismo criterio que
   toApuSeed: concept/unit/qty validos) -- nunca envia una cantidad de 0 o
   invalida a APU. */
export function buildPlanoElementFromConcept({ tipo, descripcion, cantidad, unidad, survey, space, validatedBy }){
  const elementoBase = {
    tipo,
    descripcion,
    cantidadPropuesta: Number(cantidad),
    unidad,
    confianzaIA: null,
    pagina: null,
    evidencia: `Levantamiento IA: ${survey?.name || ''}${space?.name ? ' / ' + space.name : ''} (medicion directa en obra)`,
    fuenteEscala: ESCALA_FUENTES.REFERENCIA_USUARIO,
    observaciones: '',
    origenMedicion: 'levantamiento_ia',
    fileName: survey?.name || '',
    visualRequestId: null
  };
  const reviewed = applyPlanoElementReview(elementoBase, {
    state: PLANO_ELEMENT_STATES.VALIDADO_POR_USUARIO,
    validatedBy: validatedBy || 'levantamiento-ia'
  });
  return toApuSeed(reviewed);
}
