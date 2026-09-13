/* Revision humana de elementos detectados en Planos IA / Takeoff (RC4 Fase 2).
   Logica pura (sin React, sin Firebase, sin OpenAI): decide estados, aplica
   la regla determinista de escala, y es la UNICA puerta hacia el motor APU
   existente. Espejo deliberado de src/domain/libraryReview.js -- misma
   filosofia (regla dura en codigo, nunca solo en el prompt del modelo). */

/* Fase B (PDF vectorial -> calibracion -> overlays -> revision -> cantidades):
   dos estados nuevos, puramente ADITIVOS -- ningun llamador existente
   (reviewTakeoffElement, PlanoTakeoff, toApuSeed, las pruebas de RC4) pasa
   nunca estos valores, asi que el comportamiento anterior no cambia en
   absoluto para quien no los use explicitamente.
   - DETECTADO_VECTORIAL: geometria real extraida del PDF vectorial (lineas/
     poligonos), antes de cualquier revision humana -- distinto de
     PROPUESTO_POR_IA porque el dato viene de coordenadas reales del
     documento, no de una inferencia de vision. Sigue exigiendo revision
     humana antes de contar para cuantificacion (ver isQuantifiable abajo).
   - CORREGIDO_POR_USUARIO: el usuario NO solo confirmo el elemento, cambio
     su cantidad/descripcion/unidad. Regla explicita del usuario: "no
     mezclar validado con corregido" -- son dos hechos distintos (uno
     conserva el dato tal cual se propuso, el otro declara que el dato
     propuesto estaba mal y se corrigio). applyPlanoElementReview no impone
     cual usar: el llamador declara el estado segun si de verdad hubo un
     cambio de valor. */
export const PLANO_ELEMENT_STATES = Object.freeze({
  PROPUESTO_POR_IA: 'PROPUESTO_POR_IA',
  DETECTADO_VECTORIAL: 'DETECTADO_VECTORIAL',
  REQUIERE_REVISION: 'REQUIERE_REVISION',
  VALIDADO_POR_USUARIO: 'VALIDADO_POR_USUARIO',
  CORREGIDO_POR_USUARIO: 'CORREGIDO_POR_USUARIO',
  RECHAZADO: 'RECHAZADO'
});

const VALID_STATES = new Set(Object.values(PLANO_ELEMENT_STATES));

/* Origen del OVERLAY/geometria actual de un elemento (Fase B, punto 4 --
   distinto del `estado` de arriba: `estado` es el workflow de revision,
   `origin` es de donde salio la forma/coordenadas que se estan mostrando
   ahora mismo). Nunca se presenta un AI_APPROXIMATION como si fuera
   geometria exacta -- la UI (PlanoOverlayViewer) debe rotular cada capa
   segun este campo. */
export const PLANO_ELEMENT_ORIGIN = Object.freeze({
  VECTOR_DETECTED: 'VECTOR_DETECTED',
  AI_APPROXIMATION: 'AI_APPROXIMATION',
  USER_DRAWN: 'USER_DRAWN',
  USER_CORRECTED: 'USER_CORRECTED'
});
const VALID_ORIGINS = new Set(Object.values(PLANO_ELEMENT_ORIGIN));
export function isValidPlanoElementOrigin(origin){
  return VALID_ORIGINS.has(origin);
}

/* Un elemento SOLO cuenta para cuantificacion (planoQuantification.js) si un
   humano ya lo confirmo -- sin importar si el dato de partida vino de
   geometria vectorial real o de una aproximacion de IA: la cuantificacion
   alimenta decisiones de costo reales, y este proyecto nunca deja pasar un
   numero sin verificacion humana explicita a esa etapa (mismo criterio que
   toApuSeed abajo). DETECTADO_VECTORIAL, PROPUESTO_POR_IA y REQUIERE_REVISION
   quedan fuera hasta que alguien los revise. */
export function isQuantifiable(estado){
  return estado === PLANO_ELEMENT_STATES.VALIDADO_POR_USUARIO || estado === PLANO_ELEMENT_STATES.CORREGIDO_POR_USUARIO;
}

export const ESCALA_FUENTES = Object.freeze({
  COTAS_TEXTO: 'cotas_texto',
  ESCALA_GRAFICA: 'escala_grafica',
  REFERENCIA_USUARIO: 'referencia_usuario',
  NO_DETERMINADA: 'no_determinada'
});

const VALID_ESCALA_FUENTES = new Set(Object.values(ESCALA_FUENTES));

/* 'habitacion'/'eje'/'cota' son aditivos (Fase B, punto 5) -- amplian el
   conjunto valido, nunca invalidan un elemento existente de RC4. */
export const TIPOS_ELEMENTO = Object.freeze([
  'muro', 'piso', 'losa', 'puerta', 'ventana', 'columna', 'trabe', 'plafon', 'habitacion', 'eje', 'cota', 'otro'
]);

export function isValidPlanoState(state){
  return VALID_STATES.has(state);
}

export function isValidEscalaFuente(fuente){
  return VALID_ESCALA_FUENTES.has(fuente);
}

/* Regla critica (Fase 2, punto 4/5): si la fuente de escala no es fiable,
   la cantidad NUNCA se persiste, sin importar lo que el modelo haya puesto.
   Determinista: no depende de que el prompt se haya obedecido. Se aplica
   SIEMPRE, tanto en la validacion server-side (_planoValidate.mjs) como aqui,
   para que cualquier llamador (pruebas incluidas) obtenga el mismo resultado. */
export function enforceScaleRule(elemento){
  if(elemento?.fuenteEscala === ESCALA_FUENTES.NO_DETERMINADA){
    return {
      ...elemento,
      cantidadPropuesta: null,
      estado: PLANO_ELEMENT_STATES.REQUIERE_REVISION
    };
  }
  return elemento;
}

/* Transicion de revision humana de UN elemento. confianzaIA (estimacion del
   modelo) y estadoRevision (decision humana) se mantienen SIEMPRE separados:
   nunca se deja que confianzaIA implique por si sola un estado de revision.
   Exige usuario+fecha para cualquier estado que no sea PROPUESTO_POR_IA o
   REQUIERE_REVISION (los dos estados que puede proponer la IA sin que un
   humano haya actuado todavia). Conserva SIEMPRE los valores originales de
   la IA junto a la correccion: nunca se sobrescriben en silencio. */
export function applyPlanoElementReview(entry, decision = {}){
  const { state, validatedBy = null, validatedAt = null, cantidadCorregida, unidadCorregida, descripcionCorregida, motivo = '' } = decision;
  if(!isValidPlanoState(state)){
    throw new Error(`Estado de elemento invalido: ${state}`);
  }
  const requiresHuman = state === PLANO_ELEMENT_STATES.VALIDADO_POR_USUARIO || state === PLANO_ELEMENT_STATES.CORREGIDO_POR_USUARIO || state === PLANO_ELEMENT_STATES.RECHAZADO;
  if(requiresHuman && !validatedBy){
    throw new Error('Falta el usuario que valida/rechaza este elemento.');
  }
  return {
    ...entry,
    estado: state,
    cantidadOriginalIA: entry.cantidadOriginalIA ?? entry.cantidadPropuesta ?? null,
    unidadOriginalIA: entry.unidadOriginalIA ?? entry.unidad ?? '',
    descripcionOriginalIA: entry.descripcionOriginalIA ?? entry.descripcion ?? '',
    cantidadCorregida: cantidadCorregida != null ? Number(cantidadCorregida) : (entry.cantidadCorregida ?? null),
    unidadCorregida: unidadCorregida != null ? unidadCorregida : (entry.unidadCorregida ?? null),
    descripcionCorregida: descripcionCorregida != null ? descripcionCorregida : (entry.descripcionCorregida ?? null),
    validatedBy: requiresHuman ? validatedBy : (entry.validatedBy ?? null),
    validatedAt: requiresHuman ? (validatedAt || new Date().toISOString()) : (entry.validatedAt ?? null),
    motivo: motivo || entry.motivo || '',
    // Fase B, punto 6 (trazabilidad completa): "usuario que corrigio" y
    // "timestamp" son campos PROPIOS, distintos de validatedBy/validatedAt
    // -- un elemento VALIDADO_POR_USUARIO tiene validatedBy pero NUNCA
    // correctedBy (nadie corrigio nada); solo CORREGIDO_POR_USUARIO estampa
    // ambos. Aditivo: RC4 nunca lee estos campos, asi que no cambia nada
    // para quien no usa el estado nuevo.
    correctedBy: state === PLANO_ELEMENT_STATES.CORREGIDO_POR_USUARIO ? validatedBy : (entry.correctedBy ?? null),
    correctedAt: state === PLANO_ELEMENT_STATES.CORREGIDO_POR_USUARIO ? (validatedAt || new Date().toISOString()) : (entry.correctedAt ?? null),
    updatedAt: new Date().toISOString()
  };
}

/* Unico puente real hacia el motor APU existente (regla del punto 9): SOLO
   VALIDADO_POR_USUARIO puede convertirse en semilla de concepto. El shape de
   salida {concept,unit,qty,referencePU} es EXACTAMENTE el que ya consumen
   templateFallbackAPU/standardAPUForConcept/makeAPUFromConcept
   (src/domain/apuGeneration.js) -- cero motor nuevo, mismo contrato que ya
   usan el pegado de texto y la extraccion de conceptos desde Excel. */
export function toApuSeed(elemento){
  if(!elemento || elemento.estado !== PLANO_ELEMENT_STATES.VALIDADO_POR_USUARIO) return null;
  const concept = elemento.descripcionCorregida || elemento.descripcion;
  const unit = elemento.unidadCorregida || elemento.unidad;
  const qtyRaw = elemento.cantidadCorregida != null ? elemento.cantidadCorregida : elemento.cantidadPropuesta;
  const qty = Number(qtyRaw);
  if(!concept || !unit || !Number.isFinite(qty) || qty <= 0) return null;
  return {
    concept,
    unit,
    qty,
    referencePU: 0,
    sourceMeta: {
      origen: 'plano-takeoff',
      visualRequestId: elemento.visualRequestId || null,
      fileName: elemento.fileName || '',
      pagina: elemento.pagina ?? null,
      evidencia: elemento.evidencia || '',
      fuenteEscala: elemento.fuenteEscala || null,
      validatedBy: elemento.validatedBy || null,
      validatedAt: elemento.validatedAt || null
    }
  };
}
