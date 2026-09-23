/* Reconocimiento asistido (punto 7): convierte lo que ya produce el analisis
   existente del plano (api/visual-ai.mjs action=takeoffVector -> elementos
   VECTOR_DETECTED con segmentos reales en puntos PDF + elementos de IA con
   bbox aproximada) en PROPUESTAS dentro del modelo comun. Todo lo que sale
   de aqui nace con review.status = PENDIENTE y su confianza: la IA propone,
   el usuario acepta/corrige -- nunca se da por validado nada automaticamente.

   Tambien decide la escala propuesta, SIN confirmarla: una escala detectada
   (cota de texto / escala grafica) queda PENDIENTE con confianza MEDIA hasta
   que el usuario la confirme o calibre; sin ninguna fuente se usa 1:100
   PROVISIONAL con confianza BAJA para poder dibujar algo, marcado como tal.

   Puro: el mapeo PDF->viewport (flip de Y, rotacion de pagina) lo inyecta el
   llamador como `toViewport` (en el navegador es viewport.convertToViewportPoint
   de pdfjs a escala 1), asi que este modulo no depende de pdfjs. */
import {
  createEmptyCadModel, addWall, addOpening, addSpace, addDimension,
  CAD_SOURCE, OPENING_TYPE, REVIEW_STATUS, SCALE_STATUS, confidenceLevel,
  projectPointOnSegment, wallLength
} from './cadModel.js';

export const METERS_PER_PDF_POINT = 0.0254 / 72;
export const PROVISIONAL_RATIO = 100;

const deg = r => r * 180 / Math.PI;

/* Escala propuesta a partir de la resolucion ya existente (planoVectorGeometry
   resolveScale). Niveles, no porcentajes: el motor de escala no calcula una
   probabilidad real, y el brief pide no fingir precision. */
export function proposeScale(resolvedScale, { unitKind = 'pdf' } = {}){
  const mpu = Number(resolvedScale?.realUnitsPerPdfPoint);
  const toRatio = m => unitKind === 'pdf' ? Math.round((m / METERS_PER_PDF_POINT) * 100) / 100 : null;
  if(Number.isFinite(mpu) && mpu > 0){
    const fuente = resolvedScale.fuente;
    const confirmed = fuente === 'referencia_usuario';
    return {
      status: confirmed ? SCALE_STATUS.CONFIRMADA : SCALE_STATUS.PENDIENTE,
      fuente, confidenceLevel: confirmed ? 'ALTA' : 'MEDIA', confidence: null,
      metersPerUnit: mpu, ratio: toRatio(mpu),
      evidencia: resolvedScale.evidencia || ''
    };
  }
  const provisional = unitKind === 'pdf' ? PROVISIONAL_RATIO * METERS_PER_PDF_POINT : 0.01;
  return {
    status: SCALE_STATUS.NO_DETERMINADA,
    fuente: 'provisional', confidenceLevel: 'BAJA', confidence: null,
    metersPerUnit: provisional, ratio: toRatio(provisional),
    evidencia: unitKind === 'pdf'
      ? 'Sin escala detectada: se asume 1:100 PROVISIONAL. Calibra con una medida conocida antes de cuantificar.'
      : 'Imagen sin escala: 1 px = 1 cm PROVISIONAL. Calibra con una medida conocida antes de cuantificar.'
  };
}

/* Un grupo de segmentos colineales (planoVectorGeometry#groupSegmentsIntoWalls)
   -> un solo eje de muro entre los extremos proyectados. */
function chainToAxis(segments, toWorld){
  if(!segments?.length) return null;
  const pts = segments.flatMap(s => [toWorld(s.x1, s.y1), toWorld(s.x2, s.y2)]);
  const first = segments[0];
  const a0 = toWorld(first.x1, first.y1), b0 = toWorld(first.x2, first.y2);
  const len0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
  const d = { x: (b0.x - a0.x) / len0, y: (b0.y - a0.y) / len0 };
  const ts = pts.map(p => (p.x - a0.x) * d.x + (p.y - a0.y) * d.y);
  const tMin = Math.min(...ts), tMax = Math.max(...ts);
  return { x1: a0.x + d.x * tMin, y1: a0.y + d.y * tMin, x2: a0.x + d.x * tMax, y2: a0.y + d.y * tMax };
}

function axisAngle(w){
  let a = Math.atan2(w.y2 - w.y1, w.x2 - w.x1) % Math.PI;
  if(a < 0) a += Math.PI;
  return a;
}
function angleDiff(a, b){
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

/* Muro de doble linea (las dos caras) -> un solo eje con espesor medido.
   Criterio conservador: paralelos (<2 grados), separados 5-45 cm y
   traslapados al menos 60% del mas corto. Lo que no cumple se deja tal
   cual (el usuario lo ve como dos propuestas y decide). */
export function mergeParallelWallPairs(axes, { minGap = 0.05, maxGap = 0.45, minOverlap = 0.6 } = {}){
  const used = new Array(axes.length).fill(false);
  const out = [];
  for(let i = 0; i < axes.length; i++){
    if(used[i]) continue;
    const a = axes[i];
    let merged = null;
    for(let j = i + 1; j < axes.length && !merged; j++){
      if(used[j]) continue;
      const b = axes[j];
      if(deg(angleDiff(axisAngle(a), axisAngle(b))) > 2) continue;
      const lenA = Math.hypot(a.x2 - a.x1, a.y2 - a.y1), lenB = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
      if(!lenA || !lenB) continue;
      const d = { x: (a.x2 - a.x1) / lenA, y: (a.y2 - a.y1) / lenA };
      const n = { x: -d.y, y: d.x };
      const mb = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
      const gapSigned = (mb.x - a.x1) * n.x + (mb.y - a.y1) * n.y;
      const gap = Math.abs(gapSigned);
      if(gap < minGap || gap > maxGap) continue;
      const tb1 = (b.x1 - a.x1) * d.x + (b.y1 - a.y1) * d.y;
      const tb2 = (b.x2 - a.x1) * d.x + (b.y2 - a.y1) * d.y;
      const bMin = Math.min(tb1, tb2), bMax = Math.max(tb1, tb2);
      const overlap = Math.min(lenA, bMax) - Math.max(0, bMin);
      if(overlap < minOverlap * Math.min(lenA, lenB)) continue;
      const tMin = Math.min(0, bMin), tMax = Math.max(lenA, bMax);
      const off = gapSigned / 2;
      merged = {
        x1: a.x1 + d.x * tMin + n.x * off, y1: a.y1 + d.y * tMin + n.y * off,
        x2: a.x1 + d.x * tMax + n.x * off, y2: a.y1 + d.y * tMax + n.y * off,
        thickness: Math.round(gap * 1000) / 1000,
        sourceElementIds: [...(a.sourceElementIds || []), ...(b.sourceElementIds || [])],
        confidence: Math.min(a.confidence ?? 100, b.confidence ?? 100)
      };
      used[j] = true;
    }
    used[i] = true;
    out.push(merged || a);
  }
  return out;
}

/* Cierra esquinas: dos ejes no paralelos cuyos extremos quedan cerca de su
   interseccion se prolongan/recortan a ese punto (los ejes de un muro de
   doble linea nunca se tocan exactamente). Tolerancia en metros. */
export function healCorners(axes, { tolerance = 0.5 } = {}){
  const out = axes.map(a => ({ ...a }));
  for(let i = 0; i < out.length; i++){
    for(let j = i + 1; j < out.length; j++){
      const a = out[i], b = out[j];
      if(deg(angleDiff(axisAngle(a), axisAngle(b))) < 20) continue;
      const r = { x: a.x2 - a.x1, y: a.y2 - a.y1 }, s = { x: b.x2 - b.x1, y: b.y2 - b.y1 };
      const denom = r.x * s.y - r.y * s.x;
      if(Math.abs(denom) < 1e-12) continue;
      const t = ((b.x1 - a.x1) * s.y - (b.y1 - a.y1) * s.x) / denom;
      const P = { x: a.x1 + r.x * t, y: a.y1 + r.y * t };
      const snapEnd = (w) => {
        const d1 = Math.hypot(w.x1 - P.x, w.y1 - P.y), d2 = Math.hypot(w.x2 - P.x, w.y2 - P.y);
        if(Math.min(d1, d2) > tolerance) return null;
        return d1 <= d2 ? 'start' : 'end';
      };
      const ea = snapEnd(a), eb = snapEnd(b);
      if(!ea || !eb) continue;
      if(ea === 'start'){ a.x1 = P.x; a.y1 = P.y; } else { a.x2 = P.x; a.y2 = P.y; }
      if(eb === 'start'){ b.x1 = P.x; b.y1 = P.y; } else { b.x2 = P.x; b.y2 = P.y; }
    }
  }
  return out;
}

/* Punto principal: elementos del analisis -> modelo comun con propuestas.
   `underlay` = { kind:'pdf'|'image', page, widthUnits, heightUnits } en las
   unidades del viewport a escala 1 (puntos PDF / pixeles de imagen). */
export function buildCadModelFromRecognition({ elementos = [], resolvedScale = null, underlay = null, pageNumber = 1, toViewport = null, defaults = {} } = {}){
  const unitKind = underlay?.kind === 'image' ? 'image' : 'pdf';
  const scale = proposeScale(resolvedScale, { unitKind });
  const mpu = scale.metersPerUnit;
  const mapPoint = toViewport || ((x, y) => ({ x, y: -y }));
  const toWorld = (x, y) => { const p = mapPoint(x, y); return { x: p.x * mpu, y: p.y * mpu }; };
  const pageW = (underlay?.widthUnits || 0) * mpu, pageH = (underlay?.heightUnits || 0) * mpu;

  let model = createEmptyCadModel({
    defaults,
    scale,
    underlay: underlay ? { ...underlay, page: underlay.page || pageNumber, metersPerUnit: mpu } : null
  });
  const report = { walls: 0, doors: 0, windows: 0, spaces: 0, dimensions: 0, unplaced: [], scale };
  const onPage = (elementos || []).filter(el => (el.pagina ?? 1) === pageNumber && el.estado !== 'RECHAZADO');

  // 1) Muros: geometria vectorial real primero; bbox de IA solo si no hay vector.
  let axes = [];
  onPage.filter(el => el.tipo === 'muro' && el.geometry?.kind === 'segments').forEach(el => {
    const axis = chainToAxis(el.geometry.segments, toWorld);
    if(axis) axes.push({ ...axis, sourceElementIds: [el.id], confidence: Number(el.confianzaIA) || null, source: CAD_SOURCE.VECTOR });
  });
  if(!axes.length && pageW > 0){
    onPage.filter(el => el.tipo === 'muro' && el.geometry?.kind === 'bbox').forEach(el => {
      const b = el.geometry.bbox;
      const x0 = b.x0 * pageW, x1 = b.x1 * pageW, y0 = b.y0 * pageH, y1 = b.y1 * pageH;
      const horizontal = (x1 - x0) >= (y1 - y0);
      axes.push(horizontal
        ? { x1: x0, y1: (y0 + y1) / 2, x2: x1, y2: (y0 + y1) / 2, sourceElementIds: [el.id], confidence: Number(el.confianzaIA) || null, source: CAD_SOURCE.AI }
        : { x1: (x0 + x1) / 2, y1: y0, x2: (x0 + x1) / 2, y2: y1, sourceElementIds: [el.id], confidence: Number(el.confianzaIA) || null, source: CAD_SOURCE.AI });
    });
  }
  axes = healCorners(mergeParallelWallPairs(axes));
  axes.forEach(a => {
    if(Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 0.2) return;
    try{
      ({ model } = addWall(model, {
        x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2,
        thickness: a.thickness || undefined,
        thicknessSource: a.thickness ? 'DIBUJO' : 'DEFAULT',
        source: a.source || CAD_SOURCE.VECTOR,
        review: { status: REVIEW_STATUS.PENDIENTE, confidence: a.confidence, level: confidenceLevel(a.confidence) },
        sourceElementId: (a.sourceElementIds || []).join(',') || null
      }));
      report.walls++;
    }catch{ /* eje degenerado: se omite, nunca rompe el resto */ }
  });

  // 2) Puertas / ventanas: centro de la bbox de IA -> muro mas cercano.
  onPage.filter(el => el.tipo === 'puerta' || el.tipo === 'ventana').forEach(el => {
    const type = el.tipo === 'puerta' ? OPENING_TYPE.DOOR : OPENING_TYPE.WINDOW;
    if(el.geometry?.kind !== 'bbox' || !(pageW > 0)){
      report.unplaced.push({ id: el.id, tipo: el.tipo, descripcion: el.descripcion || '', confianza: el.confianzaIA ?? null, reason: 'La IA no dio ubicacion en el plano.' });
      return;
    }
    const b = el.geometry.bbox;
    const center = { x: ((b.x0 + b.x1) / 2) * pageW, y: ((b.y0 + b.y1) / 2) * pageH };
    let best = null;
    for(const w of model.walls){
      const proj = projectPointOnSegment(center, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
      if(proj.dist <= 1.0 && (!best || proj.dist < best.dist)) best = { wall: w, dist: proj.dist };
    }
    if(!best){
      report.unplaced.push({ id: el.id, tipo: el.tipo, descripcion: el.descripcion || '', confianza: el.confianzaIA ?? null, reason: 'No hay un muro a menos de 1 m de la ubicacion propuesta.' });
      return;
    }
    const sizeW = Math.max((b.x1 - b.x0) * pageW, (b.y1 - b.y0) * pageH);
    const width = Math.min(Math.max(sizeW, 0.4), Math.max(0.4, wallLength(best.wall) - 0.05));
    try{
      ({ model } = addOpening(model, {
        type, wallId: best.wall.id, at: center, width,
        source: CAD_SOURCE.AI,
        review: { status: REVIEW_STATUS.PENDIENTE, confidence: Number(el.confianzaIA) || null, level: confidenceLevel(el.confianzaIA) },
        sourceElementId: el.id
      }));
      if(type === OPENING_TYPE.DOOR) report.doors++; else report.windows++;
    }catch(err){
      report.unplaced.push({ id: el.id, tipo: el.tipo, descripcion: el.descripcion || '', confianza: el.confianzaIA ?? null, reason: err.message });
    }
  });

  // 3) Espacios: habitacion/piso con bbox -> rectangulo propuesto.
  onPage.filter(el => (el.tipo === 'habitacion' || el.tipo === 'piso') && el.geometry?.kind === 'bbox' && pageW > 0).forEach(el => {
    const b = el.geometry.bbox;
    const pts = [
      { x: b.x0 * pageW, y: b.y0 * pageH }, { x: b.x1 * pageW, y: b.y0 * pageH },
      { x: b.x1 * pageW, y: b.y1 * pageH }, { x: b.x0 * pageW, y: b.y1 * pageH }
    ];
    try{
      ({ model } = addSpace(model, {
        name: el.descripcion || 'Espacio detectado', points: pts, source: CAD_SOURCE.AI,
        review: { status: REVIEW_STATUS.PENDIENTE, confidence: Number(el.confianzaIA) || null, level: confidenceLevel(el.confianzaIA) }
      }));
      report.spaces++;
    }catch{ /* bbox degenerada */ }
  });

  // 4) Cotas trazadas en el plano: siempre "pendiente de validacion".
  onPage.filter(el => el.tipo === 'cota' && el.geometry?.kind === 'segments').forEach(el => {
    const axis = chainToAxis(el.geometry.segments, toWorld);
    if(!axis) return;
    try{
      ({ model } = addDimension(model, {
        a: { x: axis.x1, y: axis.y1 }, b: { x: axis.x2, y: axis.y2 },
        status: 'PENDIENTE_VALIDACION', source: CAD_SOURCE.VECTOR,
        declaredValue: Number(el.cantidadPropuesta) || null
      }));
      report.dimensions++;
    }catch{ /* cota degenerada */ }
  });

  onPage.filter(el => !['muro', 'puerta', 'ventana', 'habitacion', 'piso', 'cota'].includes(el.tipo)).forEach(el => {
    report.unplaced.push({ id: el.id, tipo: el.tipo, descripcion: el.descripcion || '', confianza: el.confianzaIA ?? null, reason: 'Tipo sin representacion geometrica en el plano (se conserva en la lista del analisis).' });
  });

  return { model, report };
}
