/* Snapping del Plano Inteligente (punto 5). Puro: recibe el modelo comun
   (cadModel.js) y un punto en metros, regresa el punto "atrapado" y QUE lo
   atrapo -- el canvas 2D solo dibuja el marcador, nunca decide el snap por
   su cuenta. Los cuatro modos son reales (no decorativos):
     - endpoint: extremos de muro y vertices de espacio
     - intersection: cruce de ejes de dos muros
     - midpoint: punto medio de un muro
     - nearest: punto mas cercano sobre el eje de un muro
   Prioridad fija endpoint > intersection > midpoint > nearest: un punto que
   esta a la vez cerca de un extremo y "sobre" el muro siempre se va al
   extremo, que es lo que un usuario de CAD espera. */
import { projectPointOnSegment } from './cadModel.js';

export const SNAP_KIND = Object.freeze({
  ENDPOINT: 'endpoint', INTERSECTION: 'intersection', MIDPOINT: 'midpoint', NEAREST: 'nearest'
});
const PRIORITY = [SNAP_KIND.ENDPOINT, SNAP_KIND.INTERSECTION, SNAP_KIND.MIDPOINT, SNAP_KIND.NEAREST];

export const DEFAULT_SNAP_SETTINGS = Object.freeze({
  endpoint: true, intersection: true, midpoint: true, nearest: true
});

function segmentIntersection(a, b, c, d){
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if(Math.abs(denom) < 1e-12) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  if(t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

export function collectSnapCandidates(model, { excludeWallId = null } = {}){
  const walls = (model?.walls || []).filter(w => w.id !== excludeWallId);
  const candidates = [];
  walls.forEach(w => {
    candidates.push({ kind: SNAP_KIND.ENDPOINT, x: w.x1, y: w.y1, refId: w.id });
    candidates.push({ kind: SNAP_KIND.ENDPOINT, x: w.x2, y: w.y2, refId: w.id });
    candidates.push({ kind: SNAP_KIND.MIDPOINT, x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2, refId: w.id });
  });
  (model?.spaces || []).forEach(s => s.points.forEach(p => candidates.push({ kind: SNAP_KIND.ENDPOINT, x: p.x, y: p.y, refId: s.id })));
  for(let i = 0; i < walls.length; i++){
    for(let j = i + 1; j < walls.length; j++){
      const a = walls[i], b = walls[j];
      const p = segmentIntersection({ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }, { x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 });
      if(p) candidates.push({ kind: SNAP_KIND.INTERSECTION, x: p.x, y: p.y, refId: `${a.id}×${b.id}` });
    }
  }
  return candidates;
}

/* `tolerance` en METROS (el canvas la calcula a partir de unos pocos
   pixeles de pantalla / zoom actual, para que el "iman" se sienta igual a
   cualquier zoom). */
export function findSnap(model, point, { tolerance = 0.25, settings = DEFAULT_SNAP_SETTINGS, excludeWallId = null } = {}){
  if(!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const candidates = collectSnapCandidates(model, { excludeWallId });
  for(const kind of PRIORITY){
    if(!settings[kind]) continue;
    let best = null, bestDist = Infinity;
    if(kind === SNAP_KIND.NEAREST){
      for(const w of (model?.walls || [])){
        if(w.id === excludeWallId) continue;
        const proj = projectPointOnSegment(point, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
        if(proj.dist <= tolerance && proj.dist < bestDist){ bestDist = proj.dist; best = { kind, x: proj.point.x, y: proj.point.y, refId: w.id }; }
      }
    } else {
      for(const c of candidates){
        if(c.kind !== kind) continue;
        const dist = Math.hypot(c.x - point.x, c.y - point.y);
        if(dist <= tolerance && dist < bestDist){ bestDist = dist; best = c; }
      }
    }
    if(best) return best;
  }
  return null;
}

/* Restriccion ortogonal (Shift mientras se dibuja): fuerza el segmento a
   horizontal o vertical respecto del punto anterior. */
export function orthoConstrain(from, point){
  if(!from) return point;
  return Math.abs(point.x - from.x) >= Math.abs(point.y - from.y)
    ? { x: point.x, y: from.y }
    : { x: from.x, y: point.y };
}
