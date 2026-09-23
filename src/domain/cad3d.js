/* Proyeccion 3D del modelo comun del Plano Inteligente (punto 9). Puro, sin
   three.js: produce cajas/poligonos ya posicionados que CadViewer3D.jsx solo
   tiene que mallar. Cada pieza lleva `objectId` = el MISMO id del objeto en
   planta (M-01, P-01, V-01, ESP-01) -- un muro partido en 3 tramos por una
   puerta sigue siendo UN solo objeto M-01 para seleccion/resaltado; nunca se
   inventa un id 3D distinto para la misma pared.

   Reusa buildWallSegments (surveyGeometryModel.js, Levantamiento) para
   cortar el muro alrededor de sus huecos -- mismo algoritmo sin CSG ya
   probado: tramos completos, dintel encima del hueco y pretil debajo cuando
   hay antepecho.

   Escena: x de planta -> X, y de planta -> Z, altura -> Y (piso en Y=0). */
import { buildWallSegments } from './surveyGeometryModel.js';
import {
  OPENING_TYPE, wallLength, wallAngle, wallDirection, wallEndExtensions, openingsOnWall, spaceHeight
} from './cadModel.js';

const DOOR_LEAF_DEPTH = 0.04;
const WINDOW_GLASS_DEPTH = 0.02;
export const FLOOR_THICKNESS = 0.1;

export function deriveCad3D(model){
  const elements = [];
  const walls = model?.walls || [];

  walls.forEach(wall => {
    const len = wallLength(wall);
    if(len <= 0) return;
    const ext = wallEndExtensions(model, wall);
    const d = wallDirection(wall);
    const rotationY = -wallAngle(wall);
    const extLength = ext.start + len + ext.end;
    const ops = openingsOnWall(model, wall.id).map(o => {
      const a = Math.max(0, Math.min(o.offset, len));
      const b = Math.max(a, Math.min(o.offset + o.width, len));
      return { offset: a + ext.start, width: b - a, height: Math.max(0, Math.min(o.height, wall.height - o.sill)), sillHeight: Math.min(o.sill, wall.height) };
    });
    const segments = buildWallSegments({ id: wall.id, length: extLength, height: wall.height }, ops);
    segments.forEach((seg, i) => {
      const along = (seg.x0 + seg.x1) / 2 - ext.start;
      const cx = wall.x1 + d.x * along, cy = wall.y1 + d.y * along;
      elements.push({
        key: `${wall.id}#${i}`, objectId: wall.id, type: 'wall',
        dimensions: { width: seg.x1 - seg.x0, height: seg.yTop - seg.yBase, depth: wall.thickness },
        position: { x: cx, y: seg.yBase + (seg.yTop - seg.yBase) / 2, z: cy },
        rotationY
      });
    });

    openingsOnWall(model, wall.id).forEach(o => {
      const a = Math.max(0, Math.min(o.offset, len));
      const b = Math.max(a, Math.min(o.offset + o.width, len));
      const w = b - a;
      const h = Math.max(0, Math.min(o.height, wall.height - o.sill));
      if(w <= 0 || h <= 0) return;
      const along = (a + b) / 2;
      const isDoor = o.type === OPENING_TYPE.DOOR;
      elements.push({
        key: `${o.id}#0`, objectId: o.id, type: isDoor ? 'door' : 'window', hostWallId: wall.id,
        dimensions: { width: w, height: h, depth: isDoor ? DOOR_LEAF_DEPTH : WINDOW_GLASS_DEPTH },
        position: { x: wall.x1 + d.x * along, y: o.sill + h / 2, z: wall.y1 + d.y * along },
        rotationY
      });
    });
  });

  (model?.spaces || []).forEach(space => {
    if(!Array.isArray(space.points) || space.points.length < 3) return;
    elements.push({
      key: `${space.id}#0`, objectId: space.id, type: 'floor',
      polygon: space.points.map(p => ({ x: p.x, z: p.y })),
      thickness: FLOOR_THICKNESS,
      height: spaceHeight(model, space)
    });
  });

  const xs = [], zs = [];
  let maxHeight = 0;
  walls.forEach(w => { xs.push(w.x1, w.x2); zs.push(w.y1, w.y2); maxHeight = Math.max(maxHeight, w.height || 0); });
  (model?.spaces || []).forEach(s => s.points.forEach(p => { xs.push(p.x); zs.push(p.y); }));
  const bounds = xs.length
    ? { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), height: maxHeight || (model?.defaults?.wallHeight || 2.7) }
    : null;

  return { ok: elements.length > 0, elements, bounds };
}
