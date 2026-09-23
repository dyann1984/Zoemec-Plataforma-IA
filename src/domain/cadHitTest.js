/* Seleccion por clic y geometria de dibujo de cotas del Plano Inteligente.
   Puro: el canvas 2D convierte el clic a metros y pregunta aqui QUE objeto
   toco -- asi la seleccion no depende de que SVG haya quedado encima de
   que (una ventana dentro del grosor de un muro siempre gana al muro). */
import {
  CAD_KIND, projectPointOnSegment, pointAlongWall, wallLength, resolveDimension
} from './cadModel.js';

/* Posicion de dibujo de una cota: linea de cota desplazada `offset` metros
   sobre la normal izquierda de a->b, con el punto medio para el texto y el
   angulo (siempre legible: nunca de cabeza). */
export function dimensionLayout(model, dim){
  const r = resolveDimension(model, dim);
  if(!r.a || !r.b) return null;
  const len = Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y) || 1;
  const d = { x: (r.b.x - r.a.x) / len, y: (r.b.y - r.a.y) / len };
  const n = { x: -d.y, y: d.x };
  const o = Number(dim.offset) || 0;
  const p1 = { x: r.a.x + n.x * o, y: r.a.y + n.y * o };
  const p2 = { x: r.b.x + n.x * o, y: r.b.y + n.y * o };
  let angle = Math.atan2(d.y, d.x) * 180 / Math.PI;
  if(angle > 90) angle -= 180;
  if(angle <= -90) angle += 180;
  return { a: r.a, b: r.b, p1, p2, n, d, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, angle, value: r.value, status: dim.status, declaredValue: dim.declaredValue ?? null };
}

function pointInPolygon(p, pts){
  let inside = false;
  for(let i = 0, j = pts.length - 1; i < pts.length; j = i++){
    const a = pts[i], b = pts[j];
    if(((a.y > p.y) !== (b.y > p.y)) && (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)) inside = !inside;
  }
  return inside;
}

/* `isSelectable(kind, element)` permite al llamador excluir capas ocultas o
   bloqueadas. Prioridad: apertura > cota > muro > espacio. */
export function hitTestCad(model, p, tolerance, { isSelectable = () => true } = {}){
  if(!model || !p) return null;
  let best = null;
  const consider = (kind, id, dist) => { if(!best || dist < best.dist) best = { kind, id, dist }; };

  for(const o of model.openings || []){
    if(!isSelectable(CAD_KIND.OPENING, o)) continue;
    const wall = (model.walls || []).find(w => w.id === o.wallId);
    if(!wall) continue;
    const a = pointAlongWall(wall, o.offset), b = pointAlongWall(wall, o.offset + o.width);
    const { dist } = projectPointOnSegment(p, a, b);
    if(dist <= Math.max(tolerance, (wall.thickness || 0) / 2 + tolerance * 0.5)) consider(CAD_KIND.OPENING, o.id, dist);
  }
  if(best) return best.id;

  for(const dim of model.dimensions || []){
    if(!isSelectable(CAD_KIND.DIMENSION, dim)) continue;
    const lay = dimensionLayout(model, dim);
    if(!lay) continue;
    const { dist } = projectPointOnSegment(p, lay.p1, lay.p2);
    if(dist <= tolerance) consider(CAD_KIND.DIMENSION, dim.id, dist);
  }
  if(best) return best.id;

  for(const w of model.walls || []){
    if(!isSelectable(CAD_KIND.WALL, w) || wallLength(w) <= 0) continue;
    const { dist } = projectPointOnSegment(p, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
    if(dist <= (w.thickness || 0) / 2 + tolerance) consider(CAD_KIND.WALL, w.id, dist);
  }
  if(best) return best.id;

  for(const s of model.spaces || []){
    if(!isSelectable(CAD_KIND.SPACE, s)) continue;
    if(pointInPolygon(p, s.points)) return s.id;
  }
  return null;
}
