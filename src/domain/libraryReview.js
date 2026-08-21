/* Revision humana de insumos extraidos de Biblioteca (RC4).
   Logica pura (sin React, sin Firebase): decide que estados existen y,
   sobre todo, que estados pueden alimentar el catalogo real que consume
   matchPrice()/domain/apuGeneration.js. Regla critica del usuario: SOLO
   VALIDADO puede llegar al APU. PROPUESTO, RECHAZADO o cualquier estado sin
   revision humana explicita quedan siempre fuera. */

export const INSUMO_STATES = Object.freeze({
  PROPUESTO: 'PROPUESTO',
  VALIDADO: 'VALIDADO',
  RECHAZADO: 'RECHAZADO'
});

const VALID_STATES = new Set(Object.values(INSUMO_STATES));

export function isValidInsumoState(state){
  return VALID_STATES.has(state);
}

/* Transicion de un insumo: exige usuario y fecha cuando el nuevo estado no es
   PROPUESTO (no se puede "validar" ni "rechazar" sin dejar quien y cuando). */
export function applyInsumoReview(entry, { state, validatedBy = null, validatedAt = null } = {}){
  if(!isValidInsumoState(state)){
    throw new Error(`Estado de insumo invalido: ${state}`);
  }
  if(state !== INSUMO_STATES.PROPUESTO && !validatedBy){
    throw new Error('Falta el usuario que valida/rechaza este insumo.');
  }
  return {
    ...entry,
    state,
    validatedBy: state === INSUMO_STATES.PROPUESTO ? null : validatedBy,
    validatedAt: state === INSUMO_STATES.PROPUESTO ? null : (validatedAt || new Date().toISOString())
  };
}

/* Unico puente real hacia el catalogo/APU: exactamente el shape {desc,
   unidad, precio} que ya consume matchPrice() (src/lib/excelImport.js) y
   domain/apuGeneration.js -- sin motor nuevo. Regresa null si el insumo no
   esta VALIDADO: es la barrera dura que impide que un PROPUESTO o RECHAZADO
   se cuele al catalogo. */
export function toCatalogRow(insumo, review){
  if(!review || review.state !== INSUMO_STATES.VALIDADO) return null;
  if(!insumo || !insumo.desc || !(Number(insumo.precio) > 0)) return null;
  return { desc: insumo.desc, unidad: insumo.unidad || '', precio: Number(insumo.precio) };
}

/* Filtra un documento de Biblioteca completo (contentInsumos + insumosReview
   paralelos por indice) a solo las filas VALIDADAS, listas para fusionarse
   con el catalogo existente antes de llamar a /api/generate-apu o a
   standardAPUForConcept/makeAPUFromConcept. Conserva trazabilidad completa
   (documento fuente, fila, usuario, fecha) junto con la fila de catalogo. */
export function extractValidatedCatalogRows(doc){
  const insumos = Array.isArray(doc?.contentInsumos) ? doc.contentInsumos : [];
  const reviews = Array.isArray(doc?.insumosReview) ? doc.insumosReview : [];
  const reviewByIndex = new Map(reviews.map(r => [r.index, r]));
  const rows = [];
  insumos.forEach((insumo, index) => {
    const review = reviewByIndex.get(index);
    const row = toCatalogRow(insumo, review);
    if(!row) return;
    rows.push({
      ...row,
      traceability: {
        sourceDocId: doc.id || null,
        sourceDocName: doc.name || '',
        rowRef: insumo.rowRef ?? index,
        validatedBy: review.validatedBy,
        validatedAt: review.validatedAt
      }
    });
  });
  return rows;
}
