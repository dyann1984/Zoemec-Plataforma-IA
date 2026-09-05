/* Capa de servicio para el analisis con IA de un levantamiento (seccion 8 del
   sprint original). Fase 1 NO implementa vision artificial: este modulo solo
   deja definida la interfaz que el motor IA real conectara en una fase
   futura, para que la UI (LevantamientoCard/SurveyDetail) ya pueda invocarla
   sin requerir refactor cuando el motor exista.

   Nota (portado sobre origin/main): ZOEMEC ya tiene un endpoint IA real y en
   produccion para analisis de imagenes/planos -- api/visual-ai.mjs (accion
   'takeoff', ver src/domain/planoReview.js y _planoValidate.mjs para el
   patron de validacion server-side determinista). Cuando se implemente el
   analisis real de Levantamiento IA, el patron correcto es extender ese
   mismo endpoint (una accion nueva, ej. 'levantamiento') en vez de crear un
   segundo servicio serverless -- ZOEMEC esta deliberadamente limitado a
   pocas funciones serverless (limite del plan Hobby de Vercel, ver
   ZOEMEC_RC4_PLANOS_TAKEOFF.md).

   Capacidades futuras previstas para analyzeSurveyWithAI(survey):
   - Reconocer elementos constructivos (muros, puertas, ventanas, columnas...)
   - Clasificar superficies (piso, muro, plafon)
   - Detectar posibles trabajos (pintura, demolicion, aplanado, etc.)
   - Proponer conceptos (unidad + cantidad + descripcion)
   - Detectar deterioros: humedad, grietas, desprendimientos, faltantes
   - Estimar cantidades a partir de imagenes/geometria importada

   Ninguna de estas capacidades esta implementada todavia. */

export const AI_ANALYSIS_STATUS = Object.freeze({
  NOT_IMPLEMENTED: 'not_implemented',
  QUEUED: 'queued',
  RUNNING: 'running',
  DONE: 'done',
  ERROR: 'error'
});

/**
 * Punto de entrada futuro para analizar un levantamiento con IA.
 * Fase 1: siempre regresa NOT_IMPLEMENTED sin hacer ninguna llamada externa.
 * @param {object} survey - Levantamiento (ver src/domain/levantamientoSchema.js)
 * @returns {Promise<{status:string, message:string}>}
 */
export async function analyzeSurveyWithAI(survey){
  void survey;
  return {
    status: AI_ANALYSIS_STATUS.NOT_IMPLEMENTED,
    message: 'Analizar levantamiento con IA estará disponible próximamente.'
  };
}
