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

/* Puente real hacia el catalogo/APU: shape base {desc, unidad, precio} que ya
   consume matchPrice() (src/lib/excelImport.js) y domain/apuGeneration.js --
   sin motor nuevo. Regresa null si el insumo no esta VALIDADO: es la barrera
   dura que impide que un PROPUESTO o RECHAZADO se cuele al catalogo.

   Campos adicionales (Fase Biblioteca Inteligente): clave/categoria/
   sinonimos se agregan SOLO cuando el insumo ya los trae -- nunca se
   inventan aqui. `estado: 'BIBLIOTECA'` es la clasificacion de procedencia
   de precio del punto 12 del spec del usuario (distinta de APU_DATA_STATE
   de apuSchema.js, que describe el renglon final del APU; el mapeo entre
   ambas ocurre en apuGeneration.js al construir materialSources/
   equipmentSources).

   `tipo` (material|labor|equipment|epp, opcional): encontrado durante la
   auditoria de aceptacion -- sin esto, un catalogo plano no distingue una
   tarifa de mano de obra de un precio de material, y una coincidencia por
   similitud de texto podria cruzar categorias por accidente. Se propaga
   SOLO si el insumo ya lo trae (misma regla de "nunca inventar" que clave/
   categoria/sinonimos); un insumo sin tipo sigue funcionando exactamente
   igual que antes (matching sin filtro de categoria).

   `rendimiento`/`rendimientoUnidad` (opcional): cierra el hueco real
   encontrado en la misma auditoria -- el catalogo no tenia forma de
   representar un rendimiento validado para reutilizar en mano de obra
   (distinto de un precio). Se usa en apuGeneration.js para que un renglon
   de mano de obra con match de catalogo tambien pueda adoptar un
   rendimiento real, no solo un precio. */
export function toCatalogRow(insumo, review){
  if(!review || review.state !== INSUMO_STATES.VALIDADO) return null;
  if(!insumo || !insumo.desc || !(Number(insumo.precio) > 0)) return null;
  const row = { desc: insumo.desc, unidad: insumo.unidad || '', precio: Number(insumo.precio), estado: 'BIBLIOTECA' };
  if(insumo.clave) row.clave = String(insumo.clave);
  if(insumo.categoria) row.categoria = String(insumo.categoria);
  if(Array.isArray(insumo.sinonimos) && insumo.sinonimos.length) row.sinonimos = insumo.sinonimos.map(String);
  if(insumo.tipo) row.tipo = String(insumo.tipo);
  if(Number(insumo.rendimiento) > 0){
    row.rendimiento = Number(insumo.rendimiento);
    if(insumo.rendimientoUnidad) row.rendimientoUnidad = String(insumo.rendimientoUnidad);
    // Cuadrilla real asociada a ese rendimiento (opcional): sin ella,
    // apuGeneration.js asume cuadrilla=1 (mismo criterio conservador que
    // crewModel.js para el resto de las plantillas -- nunca fabrica un
    // tamaño de cuadrilla que la biblioteca no declaro).
    if(Number(insumo.cuadrilla) > 0) row.cuadrilla = Number(insumo.cuadrilla);
  }
  return row;
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

/* Agrega extractValidatedCatalogRows sobre TODOS los documentos de Biblioteca
   visibles (no solo el que el usuario abrio manualmente) -- cierra el punto
   1 de la Biblioteca Inteligente del spec del usuario ("consultar biblioteca
   local" antes de generar, no solo cuando alguien da clic en un documento a
   la vez). Documentos sin contentInsumos/insumosReview simplemente no
   aportan filas (no es un error). */
export function extractAllValidatedCatalogRows(docs){
  return (Array.isArray(docs) ? docs : []).flatMap(doc => extractValidatedCatalogRows(doc));
}

function catalogDedupeKey(row){
  if(row?.clave) return `clave:${String(row.clave).trim().toLowerCase()}`;
  const desc = String(row?.desc || '').trim().toLowerCase();
  const unidad = String(row?.unidad || '').trim().toLowerCase();
  return `du:${desc}|${unidad}`;
}

/* Fusiona newRows dentro de existingCatalog sin duplicados y SIN perder
   trazabilidad (bug real encontrado en main.jsx: la fusion anterior hacia
   `.map(({traceability,...row})=>row)` y tiraba fuente/fecha/validador antes
   de guardar el catalogo). Dedup por clave cuando ambas filas la tienen; si
   no, por descripcion+unidad normalizadas -- una coincidencia mas fuerte que
   el Set-por-string-exacto anterior, pero deliberadamente simple (no difusa):
   una descripcion con redaccion distinta a proposito no se fusiona sola,
   queda para revision humana en vez de adivinar. Si una fila nueva coincide
   con una existente, la nueva sustituye (dato mas reciente valida). */
export function mergeCatalogRows(existingCatalog, newRows){
  const merged = [...(Array.isArray(existingCatalog) ? existingCatalog : [])];
  const indexByKey = new Map(merged.map((row, i) => [catalogDedupeKey(row), i]));
  for(const row of (Array.isArray(newRows) ? newRows : [])){
    const key = catalogDedupeKey(row);
    if(indexByKey.has(key)){
      merged[indexByKey.get(key)] = row;
    } else {
      indexByKey.set(key, merged.length);
      merged.push(row);
    }
  }
  return merged;
}
