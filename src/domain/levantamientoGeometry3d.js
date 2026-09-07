/* Proyeccion 3D del modelo geometrico de Levantamiento IA (Fase 1.5). Modulo
   puro, sin React/DOM ni Three.js -- convierte src/domain/surveyGeometryModel.js
   (fuente unica de verdad: muros M-01..M-04 + aberturas) en una lista plana
   de elementos con posicion/rotacion listos para mallar, consumida por
   src/features/levantamiento/Survey3DViewer.jsx.

   NO es el mismo motor que src/domain/geometry3d.js (ese sigue siendo
   exclusivo de APU, deriva de una cantidadObra escalar con footprint
   cuadrado asumido) -- aqui la fuente es el modelo real de un Space
   (largo/ancho/alto medidos + muros/aberturas explicitos), sin necesidad de
   forzar la forma de un APU para poder visualizarlo.

   Los muros se generan como SEGMENTOS alrededor de cada hueco (ver
   surveyGeometryModel.js#buildWallSegments) -- sin CSG: el "hueco" de una
   puerta/ventana es simplemente la ausencia de segmento en esa zona del
   muro, mas un segmento de dintel (y de pretil si sillHeight>0). La
   puerta/ventana misma se agrega como un elemento aparte que rellena ese
   hueco (hoja de puerta / vidrio de ventana). */
import { ELEMENT_TYPE } from './levantamientoSchema.js';
import { buildSpaceGeometryModel } from './surveyGeometryModel.js';

function toNum(v){
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/* Punto {x,y} del plano del Space (+ altura Y) -> posicion 3D {x,y,z}. x del
   plano -> x 3D, y del plano -> z 3D (profundidad), altura -> Y -- mismo
   criterio que ya usa src/features/visual3d/Technical3DViewer.jsx (eje Y
   arriba, piso en el plano X-Z). */
function toScenePosition(x, y, heightY){
  return { x, y: heightY, z: y };
}

function wallPointAt(wall, xAlongWall){
  const t = wall.length > 0 ? xAlongWall / wall.length : 0;
  return {
    x: wall.from.x + (wall.to.x - wall.from.x) * t,
    y: wall.from.y + (wall.to.y - wall.from.y) * t
  };
}

export function deriveGeometryFromSpace(space = {}){
  const length = toNum(space.length);
  const width = toNum(space.width);
  const height = toNum(space.height);

  if(!(length > 0) || !(width > 0) || !(height > 0)){
    return {
      ok: false,
      reason: 'REQUIERE_VALIDACION',
      missing: ['length', 'width', 'height'].filter(k => !(toNum(space[k]) > 0)),
      message: 'El espacio necesita largo, ancho y alto reales para generar un modelo 3D.'
    };
  }

  const model = buildSpaceGeometryModel(space);
  const elements = [];

  elements.push({
    id: 'floor-1',
    type: 'floor',
    label: space.name || '',
    dimensions: { width: length, depth: width, thickness: null },
    position: toScenePosition(length / 2, width / 2, 0)
  });

  elements.push({
    id: 'ceiling-1',
    type: 'ceiling',
    label: space.name || '',
    dimensions: { width: length, depth: width, thickness: null },
    position: toScenePosition(length / 2, width / 2, height)
  });

  model.walls.forEach(wall => {
    wall.segments.forEach((seg, i) => {
      const midX = (seg.x0 + seg.x1) / 2;
      const mid = wallPointAt(wall, midX);
      elements.push({
        id: `wall-${wall.id}-${i}`,
        type: 'wall',
        label: wall.id,
        wallId: wall.id,
        dimensions: { width: seg.x1 - seg.x0, height: seg.yTop - seg.yBase, thickness: null },
        position: toScenePosition(mid.x, mid.y, seg.yBase + (seg.yTop - seg.yBase) / 2),
        rotationY: wall.angle
      });
    });
  });

  let doorIdx = 0, windowIdx = 0;
  model.openings.forEach(op => {
    const mid = wallPointAt(model.walls.find(w => w.id === op.wallId) || model.walls[0], op.offset + op.width / 2);
    const isDoor = op.type === ELEMENT_TYPE.DOOR;
    elements.push({
      id: op.id,
      type: isDoor ? 'door' : 'window',
      label: isDoor ? `P-${String(++doorIdx).padStart(2, '0')}` : `V-${String(++windowIdx).padStart(2, '0')}`,
      wallId: op.wallId,
      dimensions: { width: op.width || 0.01, height: op.height || 0.01, thickness: null },
      position: toScenePosition(mid.x, mid.y, op.sillHeight + op.height / 2),
      rotationY: op.angle,
      warnings: op.warnings
    });
  });

  return { ok: true, elements, requiresManualInput: false, warnings: model.openings.flatMap(o => o.warnings) };
}
