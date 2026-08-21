/* Revision humana de elementos detectados en Planos IA / Takeoff (RC4 Fase 2).
   Logica pura (sin React, sin Firebase, sin OpenAI): decide estados, aplica
   la regla determinista de escala, y es la UNICA puerta hacia el motor APU
   existente. Espejo deliberado de src/domain/libraryReview.js -- misma
   filosofia (regla dura en codigo, nunca solo en el prompt del modelo). */

export const PLANO_ELEMENT_STATES = Object.freeze({
  PROPUESTO_POR_IA: 'PROPUESTO_POR_IA',
  REQUIERE_REVISION: 'REQUIERE_REVISION',
  VALIDADO_POR_USUARIO: 'VALIDADO_POR_USUARIO',
  RECHAZADO: 'RECHAZADO'
});

const VALID_STATES = new Set(Object.values(PLANO_ELEMENT_STATES));

export const ESCALA_FUENTES = Object.freeze({
  COTAS_TEXTO: 'cotas_texto',
  ESCALA_GRAFICA: 'escala_grafica',
  REFERENCIA_USUARIO: 'referencia_usuario',
  NO_DETERMINADA: 'no_determinada'
});

const VALID_ESCALA_FUENTES = new Set(Object.values(ESCALA_FUENTES));

export const TIPOS_ELEMENTO = Object.freeze([
  'muro', 'piso', 'losa', 'puerta', 'ventana', 'columna', 'trabe', 'plafon', 'otro'
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
  const requiresHuman = state === PLANO_ELEMENT_STATES.VALIDADO_POR_USUARIO || state === PLANO_ELEMENT_STATES.RECHAZADO;
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
    motivo: motivo || entry.motivo || ''
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
