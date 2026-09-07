/* Conversion de un modelo 3D importado (GLB/GLTF/OBJ) hacia el modelo de
   datos de Levantamiento IA (Fase 2A). Modulo puro, sin React/DOM/Three.js --
   mismo espiritu que src/lib/levantamientoCalc.js y src/domain/surveyGeometryModel.js:
   funciones deterministas, testeables con node --test sin mocks.

   Separacion de dominio (misma regla que el resto de Levantamiento IA): este
   archivo NO sabe leer un archivo 3D ni tocar Three.js (eso vive en
   src/lib/levantamientoModelLoader.js, acoplado a Three y sin test unitario
   por convencion del proyecto) -- solo convierte numeros ya extraidos
   (bounding box, factor de escala) en un `Space` valido, reusando
   makeEmptySpace de levantamientoSchema.js exactamente como lo hace
   ManualSurveyForm.jsx. Nunca duplica la geometria de muros/aberturas:
   produce un Space "en blanco" (sin elements) que surveyGeometryModel.js
   procesa igual que cualquier otro Space capturado a mano.

   v1 deliberadamente NO intenta detectar muros/puertas/ventanas desde la
   malla importada (ver plan de Fase 2A): eso es un problema de vision por
   computadora fuera de alcance de una primera version, y fabricar
   "detecciones" no verificables violaria el mismo principio de "nunca
   inventar datos" que ya siguen computeSpaceGeometry/resolveOpening. El
   usuario revisa/completa puertas y ventanas a mano con SpaceCard.jsx, el
   mismo componente que ya usa la captura manual. */
import { makeEmptySpace } from './levantamientoSchema.js';

function toFiniteNumber(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* Factor de escala uniforme a partir de una medida real conocida vs. la
   medida cruda leida del modelo (seccion "definir/verificar escala" del
   pedido). Usado sobre todo para OBJ, que no tiene unidad estandar -- GLB/
   GLTF ya vienen en metros por especificacion y normalmente usan factor 1.
   Nunca regresa un factor invalido (cero, negativo, NaN, Infinity): eso
   cambiaria un Space a dimensiones absurdas de forma silenciosa. */
export function computeUniformScaleFactor({ measuredLength, knownLength }){
  const measured = toFiniteNumber(measuredLength);
  const known = toFiniteNumber(knownLength);
  if(measured === null || measured <= 0) return { ok: false, reason: 'medida_leida_invalida' };
  if(known === null || known <= 0) return { ok: false, reason: 'medida_real_invalida' };
  const factor = known / measured;
  if(!Number.isFinite(factor) || factor <= 0) return { ok: false, reason: 'factor_invalido' };
  return { ok: true, factor };
}

/* Bounding box (ya en la convencion de plano de levantamientoGeometry3d.js:
   x->largo, z->ancho, y->alto) -> Space rectangular unico, aplicando el
   factor de escala uniforme a los 3 ejes. `elements` siempre vacio en v1
   (ver comentario de cabecera) -- el usuario los agrega en la revision.
   Reusa makeEmptySpace (nunca reconstruye su forma a mano), asi que hereda
   automaticamente su saneamiento de numeros (toNum: negativos/NaN -> 0). */
export function deriveSpaceFromImportedModel({ boundingBoxSize, scaleFactor = 1, name = '' }){
  const factor = toFiniteNumber(scaleFactor);
  const safeFactor = (factor === null || factor <= 0) ? 1 : factor;
  const size = boundingBoxSize || {};
  return makeEmptySpace({
    name,
    length: toFiniteNumber(size.x) * safeFactor || 0,
    width: toFiniteNumber(size.z) * safeFactor || 0,
    height: toFiniteNumber(size.y) * safeFactor || 0
  });
}

/* Metadatos del archivo importado (seccion "metadatos del archivo" +
   "persistencia" del pedido) -- objeto plano, JSON-safe a proposito: esto es
   lo unico que se persiste de la importacion (nunca el File/THREE.Object3D
   original), guardado en survey.importMeta. */
export function buildSurveyImportMeta({ sourceFormat, fileName, fileSizeBytes, meshCount, triangleCount, scaleFactor, importedAt = Date.now() }){
  return {
    sourceFormat: sourceFormat || null,
    fileName: fileName || '',
    fileSizeBytes: toFiniteNumber(fileSizeBytes) || 0,
    meshCount: toFiniteNumber(meshCount) || 0,
    triangleCount: toFiniteNumber(triangleCount) || 0,
    scaleFactor: toFiniteNumber(scaleFactor) || 1,
    importedAt: toFiniteNumber(importedAt) || Date.now()
  };
}
