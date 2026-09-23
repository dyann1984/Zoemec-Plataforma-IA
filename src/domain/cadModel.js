/* Modelo geometrico COMUN del Plano Inteligente (B.1). Fuente unica de verdad
   para TODO lo que el modulo de planos muestra o calcula: canvas 2D, visor
   3D, panel de propiedades, cuantificacion y la liga concepto/APU leen de
   aqui -- ninguno guarda su propia copia de una longitud o un area (regla
   16 del brief: `wall.length` se DERIVA siempre de x1/y1/x2/y2, nunca existe
   un `viewerWallLength`/`takeoffLength` paralelo).

   Logica PURA (sin React, sin three.js, sin red): cada mutacion recibe un
   modelo y regresa uno NUEVO (nunca muta el recibido), lo que hace trivial
   el deshacer/rehacer (cadHistory.js) y la persistencia (el modelo es JSON
   plano: sin arreglos anidados, compatible con Firestore tal cual).

   Sistema de coordenadas: metros reales, x hacia la derecha, y hacia ABAJO
   de la pantalla (mismo sentido que SVG y que el viewport de pdfjs) -- el
   visor 3D mapea (x, y) de planta a (x, z) de escena, con la altura en Y.

   Muros por EJE (linea central) + espesor: es la representacion que permite
   medir longitud, area bruta/neta y volumen sin ambiguedad, y la misma que
   ya usa surveyGeometryModel.js para Levantamiento. */

export const CAD_SCHEMA_VERSION = 1;

export const CAD_KIND = Object.freeze({ WALL: 'wall', OPENING: 'opening', SPACE: 'space', DIMENSION: 'dimension' });
export const OPENING_TYPE = Object.freeze({ DOOR: 'door', WINDOW: 'window' });

/* Estado de revision de un objeto (punto 7/12 del brief). Solo dos estados
   GUARDADOS: lo creado por el usuario nace CONFIRMADO; lo propuesto por el
   reconocimiento (vector/IA) nace PENDIENTE con su confianza. "Error" NO se
   guarda: es el resultado de validateCadModel sobre la geometria vigente --
   un muro que deja de tener error al corregirse no debe arrastrar una marca
   vieja. */
export const REVIEW_STATUS = Object.freeze({ CONFIRMADO: 'CONFIRMADO', PENDIENTE: 'PENDIENTE' });

export const CAD_SOURCE = Object.freeze({
  USER: 'USUARIO', VECTOR: 'VECTOR_PDF', AI: 'IA', FIXTURE: 'FIXTURE'
});

export const SCALE_STATUS = Object.freeze({
  CONFIRMADA: 'CONFIRMADA', PENDIENTE: 'PENDIENTE', NO_DETERMINADA: 'NO_DETERMINADA'
});

const ID_PREFIX = Object.freeze({ wall: 'M', door: 'P', window: 'V', space: 'ESP', dimension: 'C' });
const COLLECTION = Object.freeze({ wall: 'walls', opening: 'openings', space: 'spaces', dimension: 'dimensions' });

/* Dos extremos a menos de 5 mm se consideran el MISMO nodo (esquina
   compartida). Suficiente para absorber redondeos de captura/snap sin unir
   por accidente dos muros que de verdad estan separados. */
export const JOIN_TOLERANCE_M = 0.005;
export const MIN_WALL_LENGTH_M = 0.05;

export const DEFAULT_CAD_DEFAULTS = Object.freeze({
  wallHeight: 2.7, wallThickness: 0.15,
  doorWidth: 0.9, doorHeight: 2.1,
  windowWidth: 1.2, windowHeight: 1.2, windowSill: 0.9
});

const r4 = n => Math.round(n * 10000) / 10000;

function assertFinite(value, label){
  const n = Number(value);
  if(!Number.isFinite(n)) throw new Error(`${label} debe ser un numero valido.`);
  return n;
}
function assertPositive(value, label){
  const n = assertFinite(value, label);
  if(!(n > 0)) throw new Error(`${label} debe ser mayor que cero.`);
  return n;
}
function assertNonNegative(value, label){
  const n = assertFinite(value, label);
  if(n < 0) throw new Error(`${label} no puede ser negativo.`);
  return n;
}

export function createEmptyCadModel({ defaults = {}, scale = null, underlay = null } = {}){
  return {
    schemaVersion: CAD_SCHEMA_VERSION,
    units: 'm',
    defaults: { ...DEFAULT_CAD_DEFAULTS, ...defaults },
    scale: scale || { status: SCALE_STATUS.CONFIRMADA, fuente: 'modelo_en_metros', confidenceLevel: 'ALTA', confidence: null, ratio: null, metersPerUnit: null, evidencia: 'Geometria capturada directamente en metros reales.' },
    underlay,
    walls: [],
    openings: [],
    spaces: [],
    dimensions: [],
    counters: { M: 0, P: 0, V: 0, ESP: 0, C: 0 }
  };
}

/* IDs persistentes (punto 3): contador por prefijo que SOLO crece -- borrar
   M-03 nunca libera "M-03" para otro muro (un concepto/APU ya ligado a
   M-03 no debe terminar apuntando a una pared distinta). */
function allocateId(model, key){
  const prefix = ID_PREFIX[key];
  const counters = { ...(model.counters || {}) };
  const existingMax = collectionFor(model, key)
    .map(el => Number(String(el.id).split('-').pop()) || 0)
    .reduce((m, n) => Math.max(m, n), 0);
  const next = Math.max(counters[prefix] || 0, existingMax) + 1;
  counters[prefix] = next;
  return { counters, id: `${prefix}-${String(next).padStart(2, '0')}` };
}

function collectionFor(model, key){
  if(key === 'door') return (model.openings || []).filter(o => o.type === OPENING_TYPE.DOOR);
  if(key === 'window') return (model.openings || []).filter(o => o.type === OPENING_TYPE.WINDOW);
  return model[COLLECTION[key]] || [];
}

/* ---------- Busqueda ---------- */

export function findElement(model, id){
  if(!model || !id) return null;
  for(const kind of [CAD_KIND.WALL, CAD_KIND.OPENING, CAD_KIND.SPACE, CAD_KIND.DIMENSION]){
    const element = (model[COLLECTION[kind]] || []).find(el => el.id === id);
    if(element) return { kind, element };
  }
  return null;
}

export function listAllElements(model){
  return [
    ...(model?.walls || []).map(element => ({ kind: CAD_KIND.WALL, element })),
    ...(model?.openings || []).map(element => ({ kind: CAD_KIND.OPENING, element })),
    ...(model?.spaces || []).map(element => ({ kind: CAD_KIND.SPACE, element })),
    ...(model?.dimensions || []).map(element => ({ kind: CAD_KIND.DIMENSION, element }))
  ];
}

/* ---------- Geometria basica ---------- */

export function wallLength(wall){
  return Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
}
export function wallAngle(wall){
  return Math.atan2(wall.y2 - wall.y1, wall.x2 - wall.x1);
}
export function wallDirection(wall){
  const len = wallLength(wall) || 1;
  return { x: (wall.x2 - wall.x1) / len, y: (wall.y2 - wall.y1) / len };
}
/* Normal "izquierda" del muro (girar la direccion +90 en pantalla). */
export function wallNormal(wall){
  const d = wallDirection(wall);
  return { x: -d.y, y: d.x };
}
export function pointAlongWall(wall, distance){
  const d = wallDirection(wall);
  return { x: wall.x1 + d.x * distance, y: wall.y1 + d.y * distance };
}

export function projectPointOnSegment(p, a, b){
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { point, t, dist: Math.hypot(p.x - point.x, p.y - point.y) };
}

function samePoint(a, b, tol = JOIN_TOLERANCE_M){
  return Math.hypot(a.x - b.x, a.y - b.y) <= tol;
}
function wallStart(w){ return { x: w.x1, y: w.y1 }; }
function wallEnd(w){ return { x: w.x2, y: w.y2 }; }

/* Extension de cada extremo del eje para dibujar el SOLIDO del muro: si el
   extremo comparte nodo con otro muro (esquina), el solido se prolonga medio
   espesor para cerrar la esquina sin hueco; un extremo libre no se prolonga.
   2D (wallPlanPieces) y 3D (cad3d.js) usan esta misma funcion -- la esquina
   se ve igual en ambas vistas. NUNCA afecta la longitud medida (eje). */
export function wallEndExtensions(model, wall){
  const others = (model.walls || []).filter(w => w.id !== wall.id);
  const joined = p => others.some(o => samePoint(p, wallStart(o)) || samePoint(p, wallEnd(o)));
  const half = (Number(wall.thickness) || 0) / 2;
  return { start: joined(wallStart(wall)) ? half : 0, end: joined(wallEnd(wall)) ? half : 0 };
}

export function polygonArea(points){
  const pts = Array.isArray(points) ? points : [];
  let sum = 0;
  for(let i = 0; i < pts.length; i++){
    const a = pts[i], b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}
export function polygonPerimeter(points){
  const pts = Array.isArray(points) ? points : [];
  if(pts.length < 2) return 0;
  let sum = 0;
  for(let i = 0; i < pts.length; i++){
    const a = pts[i], b = pts[(i + 1) % pts.length];
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}
export function polygonCentroid(points){
  const pts = Array.isArray(points) ? points : [];
  if(!pts.length) return { x: 0, y: 0 };
  let a = 0, cx = 0, cy = 0;
  for(let i = 0; i < pts.length; i++){
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross; cx += (p.x + q.x) * cross; cy += (p.y + q.y) * cross;
  }
  if(Math.abs(a) < 1e-9){
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/* ---------- Metricas (unica fuente de cantidades) ---------- */

export function openingsOnWall(model, wallId){
  return (model.openings || []).filter(o => o.wallId === wallId);
}

/* Area de hueco que REALMENTE descuenta el muro: se recorta a la altura del
   muro (una ventana cuyo antepecho+alto excede el muro solo descuenta la
   parte que cabe) y al largo del muro -- el descuento nunca puede superar
   el area bruta. La inconsistencia misma la reporta validateCadModel. */
export function openingDeductedArea(opening, wall){
  const width = Math.max(0, Math.min(Number(opening.width) || 0, wall ? wallLength(wall) : Infinity));
  const top = (Number(opening.sill) || 0) + (Number(opening.height) || 0);
  const clippedTop = wall ? Math.min(top, Number(wall.height) || 0) : top;
  const h = Math.max(0, clippedTop - (Number(opening.sill) || 0));
  return width * h;
}

export function computeWallMetrics(model, wallOrId){
  const wall = typeof wallOrId === 'string' ? (model.walls || []).find(w => w.id === wallOrId) : wallOrId;
  if(!wall) return null;
  const length = wallLength(wall);
  const height = Number(wall.height) || 0;
  const thickness = Number(wall.thickness) || 0;
  const grossArea = length * height;
  const openings = openingsOnWall(model, wall.id).map(o => ({ id: o.id, type: o.type, area: r4(openingDeductedArea(o, wall)) }));
  const openingsArea = Math.min(grossArea, openings.reduce((s, o) => s + o.area, 0));
  const netArea = Math.max(0, grossArea - openingsArea);
  return {
    id: wall.id,
    length: r4(length),
    height: r4(height),
    thickness: r4(thickness),
    grossArea: r4(grossArea),
    openingsArea: r4(openingsArea),
    netArea: r4(netArea),
    netVolume: r4(netArea * thickness),
    openings
  };
}

export function computeOpeningMetrics(model, openingOrId){
  const op = typeof openingOrId === 'string' ? (model.openings || []).find(o => o.id === openingOrId) : openingOrId;
  if(!op) return null;
  const wall = (model.walls || []).find(w => w.id === op.wallId) || null;
  return {
    id: op.id,
    type: op.type,
    wallId: op.wallId,
    width: r4(Number(op.width) || 0),
    height: r4(Number(op.height) || 0),
    sill: r4(Number(op.sill) || 0),
    offset: r4(Number(op.offset) || 0),
    area: r4((Number(op.width) || 0) * (Number(op.height) || 0)),
    deductedArea: r4(openingDeductedArea(op, wall)),
    pieces: 1
  };
}

export function spaceHeight(model, space){
  const h = Number(space?.ceilingHeight);
  return h > 0 ? h : (Number(model?.defaults?.wallHeight) || DEFAULT_CAD_DEFAULTS.wallHeight);
}

export function computeSpaceMetrics(model, spaceOrId){
  const space = typeof spaceOrId === 'string' ? (model.spaces || []).find(s => s.id === spaceOrId) : spaceOrId;
  if(!space) return null;
  const area = polygonArea(space.points);
  const perimeter = polygonPerimeter(space.points);
  const height = spaceHeight(model, space);
  return {
    id: space.id,
    area: r4(area),
    perimeter: r4(perimeter),
    floorArea: r4(area),
    ceilingArea: r4(area),
    height: r4(height),
    wallFinishArea: r4(perimeter * height),
    volume: r4(area * height)
  };
}

/* Puntos de una cota: una cota ligada a un muro (ref.kind==='wall') toma
   SIEMPRE los extremos vigentes del muro -- si el muro se edita, la cota se
   actualiza sola (punto 6). Una cota libre guarda sus propios puntos. */
export function resolveDimension(model, dim){
  if(dim?.ref?.kind === 'wall'){
    const wall = (model.walls || []).find(w => w.id === dim.ref.id);
    if(!wall) return { id: dim.id, a: null, b: null, value: null, missingRef: true, status: dim.status };
    const a = wallStart(wall), b = wallEnd(wall);
    return { id: dim.id, a, b, value: r4(wallLength(wall)), missingRef: false, status: dim.status, offset: dim.offset };
  }
  const a = dim?.a, b = dim?.b;
  if(!a || !b) return { id: dim?.id, a: null, b: null, value: null, missingRef: true, status: dim?.status };
  return { id: dim.id, a, b, value: r4(Math.hypot(b.x - a.x, b.y - a.y)), missingRef: false, status: dim.status, offset: dim.offset };
}

/* ---------- Validacion (estado ERROR del punto 12, siempre derivado) ---------- */

export const CAD_ISSUE = Object.freeze({
  WALL_TOO_SHORT: 'MURO_DEMASIADO_CORTO',
  OPENING_WITHOUT_WALL: 'ABERTURA_SIN_MURO',
  OPENING_EXCEEDS_WALL: 'ABERTURA_EXCEDE_MURO',
  OPENING_TOO_TALL: 'ABERTURA_EXCEDE_ALTURA',
  OPENINGS_OVERLAP: 'ABERTURAS_TRASLAPADAS',
  SPACE_INVALID: 'ESPACIO_INVALIDO',
  DIMENSION_PENDING: 'COTA_PENDIENTE_VALIDACION',
  DIMENSION_ORPHAN: 'COTA_SIN_REFERENCIA',
  ELEMENT_PENDING: 'ELEMENTO_PENDIENTE',
  SCALE_UNCONFIRMED: 'ESCALA_SIN_CONFIRMAR'
});

export function validateCadModel(model){
  const issues = [];
  const push = (id, severity, code, message) => issues.push({ id, severity, code, message });
  if(model?.scale?.status && model.scale.status !== SCALE_STATUS.CONFIRMADA){
    push(null, 'warning', CAD_ISSUE.SCALE_UNCONFIRMED, 'La escala del plano no esta confirmada: las medidas son provisionales.');
  }
  for(const wall of model?.walls || []){
    if(wallLength(wall) < MIN_WALL_LENGTH_M) push(wall.id, 'error', CAD_ISSUE.WALL_TOO_SHORT, `${wall.id}: longitud menor a ${MIN_WALL_LENGTH_M} m.`);
    if(wall.review?.status === REVIEW_STATUS.PENDIENTE) push(wall.id, 'pending', CAD_ISSUE.ELEMENT_PENDING, `${wall.id}: detectado automaticamente, pendiente de validar.`);
  }
  const byWall = new Map();
  for(const op of model?.openings || []){
    const wall = (model.walls || []).find(w => w.id === op.wallId);
    if(op.review?.status === REVIEW_STATUS.PENDIENTE) push(op.id, 'pending', CAD_ISSUE.ELEMENT_PENDING, `${op.id}: detectado automaticamente, pendiente de validar.`);
    if(!wall){ push(op.id, 'error', CAD_ISSUE.OPENING_WITHOUT_WALL, `${op.id}: no esta alojado en ningun muro.`); continue; }
    const len = wallLength(wall);
    if((Number(op.offset) || 0) < -1e-6 || (Number(op.offset) || 0) + (Number(op.width) || 0) > len + 1e-6){
      push(op.id, 'error', CAD_ISSUE.OPENING_EXCEEDS_WALL, `${op.id}: se sale del muro ${wall.id} (${len.toFixed(2)} m).`);
    }
    if((Number(op.sill) || 0) + (Number(op.height) || 0) > (Number(wall.height) || 0) + 1e-6){
      push(op.id, 'error', CAD_ISSUE.OPENING_TOO_TALL, `${op.id}: antepecho + alto supera la altura del muro ${wall.id}.`);
    }
    if(!byWall.has(wall.id)) byWall.set(wall.id, []);
    byWall.get(wall.id).push(op);
  }
  byWall.forEach(list => {
    const sorted = [...list].sort((a, b) => a.offset - b.offset);
    for(let i = 1; i < sorted.length; i++){
      if(sorted[i].offset < sorted[i - 1].offset + sorted[i - 1].width - 1e-6){
        push(sorted[i].id, 'error', CAD_ISSUE.OPENINGS_OVERLAP, `${sorted[i].id} se traslapa con ${sorted[i - 1].id}.`);
      }
    }
  });
  for(const space of model?.spaces || []){
    if(!Array.isArray(space.points) || space.points.length < 3 || polygonArea(space.points) < 0.01){
      push(space.id, 'error', CAD_ISSUE.SPACE_INVALID, `${space.id}: poligono sin area valida.`);
    }
    if(space.review?.status === REVIEW_STATUS.PENDIENTE) push(space.id, 'pending', CAD_ISSUE.ELEMENT_PENDING, `${space.id}: detectado automaticamente, pendiente de validar.`);
  }
  for(const dim of model?.dimensions || []){
    const resolved = resolveDimension(model, dim);
    if(resolved.missingRef) push(dim.id, 'error', CAD_ISSUE.DIMENSION_ORPHAN, `${dim.id}: la cota perdio su referencia.`);
    if(dim.status === 'PENDIENTE_VALIDACION') push(dim.id, 'pending', CAD_ISSUE.DIMENSION_PENDING, `${dim.id}: cota del plano original pendiente de validacion.`);
  }
  return issues;
}

/* Estado visual consolidado de UN objeto: 'error' > 'pendiente' > 'confirmado'. */
export function elementDisplayStatus(issues, id){
  const mine = (issues || []).filter(i => i.id === id);
  if(mine.some(i => i.severity === 'error')) return 'error';
  if(mine.some(i => i.severity === 'pending')) return 'pendiente';
  return 'confirmado';
}

export function confidenceLevel(pct){
  const n = Number(pct);
  if(!Number.isFinite(n)) return null;
  if(n >= 85) return 'ALTA';
  if(n >= 60) return 'MEDIA';
  return 'BAJA';
}

/* ---------- Mutaciones puras ---------- */

function withCollection(model, kind, updater){
  const key = COLLECTION[kind];
  return { ...model, [key]: updater(model[key] || []) };
}

function userReview(){
  return { status: REVIEW_STATUS.CONFIRMADO, confidence: null };
}

export function addWall(model, input = {}){
  const x1 = assertFinite(input.x1, 'Inicio X'), y1 = assertFinite(input.y1, 'Inicio Y');
  const x2 = assertFinite(input.x2, 'Final X'), y2 = assertFinite(input.y2, 'Final Y');
  if(Math.hypot(x2 - x1, y2 - y1) < MIN_WALL_LENGTH_M) throw new Error(`Un muro debe medir al menos ${MIN_WALL_LENGTH_M} m.`);
  const thickness = input.thickness != null ? assertPositive(input.thickness, 'Espesor') : model.defaults.wallThickness;
  const height = input.height != null ? assertPositive(input.height, 'Altura') : model.defaults.wallHeight;
  const { counters, id } = allocateId(model, 'wall');
  const wall = {
    id, x1, y1, x2, y2, thickness, height,
    thicknessSource: input.thicknessSource || (input.thickness != null ? 'USUARIO' : 'DEFAULT'),
    source: input.source || CAD_SOURCE.USER,
    review: input.review || userReview(),
    sourceElementId: input.sourceElementId || null,
    assignment: null
  };
  return { model: { ...withCollection(model, CAD_KIND.WALL, list => [...list, wall]), counters }, id };
}

/* Edicion directa de un muro (punto 4). `length` conserva el INICIO y la
   direccion, mueve el final -- es lo que un usuario espera al teclear "5.82"
   en el campo Longitud. Los huecos alojados viajan con el muro porque su
   posicion es relativa (offset desde el inicio), nunca absoluta. */
export function updateWall(model, id, patch = {}){
  const wall = (model.walls || []).find(w => w.id === id);
  if(!wall) throw new Error(`No existe el muro ${id}.`);
  let next = { ...wall };
  for(const key of ['x1', 'y1', 'x2', 'y2']){
    if(patch[key] != null) next[key] = assertFinite(patch[key], key);
  }
  if(patch.length != null){
    const length = assertPositive(patch.length, 'Longitud');
    if(length < MIN_WALL_LENGTH_M) throw new Error(`Un muro debe medir al menos ${MIN_WALL_LENGTH_M} m.`);
    const d = wallDirection(next);
    next = { ...next, x2: next.x1 + d.x * length, y2: next.y1 + d.y * length };
  }
  if(patch.thickness != null){ next.thickness = assertPositive(patch.thickness, 'Espesor'); next.thicknessSource = 'USUARIO'; }
  if(patch.height != null) next.height = assertPositive(patch.height, 'Altura');
  if(wallLength(next) < MIN_WALL_LENGTH_M) throw new Error(`Un muro debe medir al menos ${MIN_WALL_LENGTH_M} m.`);
  return withCollection(model, CAD_KIND.WALL, list => list.map(w => w.id === id ? next : w));
}

/* Mueve un extremo de muro. Con `connected` (default), todo lo que compartia
   ese nodo -- el extremo de otros muros, vertices de espacios, extremos de
   cotas libres -- se mueve con el: una esquina corregida no deja muros
   despegados ni un espacio con el area vieja (punto 4: "recalcular
   automaticamente", nunca resultados desactualizados). */
export function moveWallEndpoint(model, id, which, point, { connected = true } = {}){
  const wall = (model.walls || []).find(w => w.id === id);
  if(!wall) throw new Error(`No existe el muro ${id}.`);
  const px = assertFinite(point?.x, 'X'), py = assertFinite(point?.y, 'Y');
  const old = which === 'start' ? wallStart(wall) : wallEnd(wall);
  const target = which === 'start' ? { ...wall, x1: px, y1: py } : { ...wall, x2: px, y2: py };
  if(wallLength(target) < MIN_WALL_LENGTH_M) throw new Error(`Un muro debe medir al menos ${MIN_WALL_LENGTH_M} m.`);
  return moveNode(model, old, { x: px, y: py }, { onlyWallId: connected ? null : id, primary: { id, which } });
}

function moveNode(model, from, to, { onlyWallId = null, primary = null } = {}){
  const movePt = p => samePoint(p, from) ? { x: to.x, y: to.y } : p;
  const walls = (model.walls || []).map(w => {
    if(onlyWallId && w.id !== onlyWallId) return w;
    let next = w;
    if(primary && w.id === primary.id){
      return primary.which === 'start' ? { ...w, x1: to.x, y1: to.y } : { ...w, x2: to.x, y2: to.y };
    }
    if(samePoint(wallStart(w), from)) next = { ...next, x1: to.x, y1: to.y };
    if(samePoint(wallEnd(w), from)) next = { ...next, x2: to.x, y2: to.y };
    return next;
  });
  if(onlyWallId) return { ...model, walls };
  const spaces = (model.spaces || []).map(s => ({ ...s, points: s.points.map(movePt) }));
  const dimensions = (model.dimensions || []).map(d => d.ref ? d : { ...d, a: d.a ? movePt(d.a) : d.a, b: d.b ? movePt(d.b) : d.b });
  return { ...model, walls, spaces, dimensions };
}

export function translateWall(model, id, dx, dy){
  const wall = (model.walls || []).find(w => w.id === id);
  if(!wall) throw new Error(`No existe el muro ${id}.`);
  const ddx = assertFinite(dx, 'dx'), ddy = assertFinite(dy, 'dy');
  return withCollection(model, CAD_KIND.WALL, list => list.map(w => w.id === id
    ? { ...w, x1: w.x1 + ddx, y1: w.y1 + ddy, x2: w.x2 + ddx, y2: w.y2 + ddy }
    : w));
}

function openingDefaults(model, type){
  const d = model.defaults;
  return type === OPENING_TYPE.DOOR
    ? { width: d.doorWidth, height: d.doorHeight, sill: 0 }
    : { width: d.windowWidth, height: d.windowHeight, sill: d.windowSill };
}

/* Aloja una puerta/ventana en un muro. `offset` = distancia (m) desde el
   INICIO del muro al borde cercano del hueco. Si no se da, se centra; si se
   da un punto (`at`), se centra el hueco en la proyeccion de ese punto
   sobre el eje. */
export function addOpening(model, input = {}){
  const type = input.type === OPENING_TYPE.WINDOW ? OPENING_TYPE.WINDOW : OPENING_TYPE.DOOR;
  const wall = (model.walls || []).find(w => w.id === input.wallId);
  if(!wall) throw new Error('La apertura debe alojarse en un muro existente.');
  const defaults = openingDefaults(model, type);
  const width = input.width != null ? assertPositive(input.width, 'Ancho') : defaults.width;
  const height = input.height != null ? assertPositive(input.height, 'Alto') : defaults.height;
  const sill = input.sill != null ? assertNonNegative(input.sill, 'Antepecho') : defaults.sill;
  const len = wallLength(wall);
  let offset;
  if(input.offset != null) offset = assertFinite(input.offset, 'Posicion');
  else if(input.at){
    const { t } = projectPointOnSegment(input.at, wallStart(wall), wallEnd(wall));
    offset = t * len - width / 2;
  } else offset = (len - width) / 2;
  if(input.offset == null) offset = Math.min(Math.max(offset, 0), Math.max(0, len - width));
  const { counters, id } = allocateId(model, type);
  const opening = {
    id, type, wallId: wall.id, offset: r4(offset), width, height, sill,
    swing: type === OPENING_TYPE.DOOR ? (input.swing || 'left') : null,
    source: input.source || CAD_SOURCE.USER,
    review: input.review || userReview(),
    sourceElementId: input.sourceElementId || null,
    assignment: null
  };
  return { model: { ...withCollection(model, CAD_KIND.OPENING, list => [...list, opening]), counters }, id };
}

export function updateOpening(model, id, patch = {}){
  const op = (model.openings || []).find(o => o.id === id);
  if(!op) throw new Error(`No existe la apertura ${id}.`);
  const next = { ...op };
  if(patch.wallId != null){
    if(!(model.walls || []).some(w => w.id === patch.wallId)) throw new Error(`No existe el muro ${patch.wallId}.`);
    next.wallId = patch.wallId;
  }
  if(patch.width != null) next.width = assertPositive(patch.width, 'Ancho');
  if(patch.height != null) next.height = assertPositive(patch.height, 'Alto');
  if(patch.sill != null) next.sill = assertNonNegative(patch.sill, 'Antepecho');
  if(patch.offset != null) next.offset = r4(assertFinite(patch.offset, 'Posicion'));
  if(patch.at){
    const wall = (model.walls || []).find(w => w.id === next.wallId);
    if(wall){
      const len = wallLength(wall);
      const { t } = projectPointOnSegment(patch.at, wallStart(wall), wallEnd(wall));
      next.offset = r4(Math.min(Math.max(t * len - next.width / 2, 0), Math.max(0, len - next.width)));
    }
  }
  if(patch.swing != null && next.type === OPENING_TYPE.DOOR) next.swing = patch.swing === 'right' ? 'right' : 'left';
  return withCollection(model, CAD_KIND.OPENING, list => list.map(o => o.id === id ? next : o));
}

export function addSpace(model, input = {}){
  const points = (input.points || []).map((p, i) => ({ x: assertFinite(p?.x, `Vertice ${i + 1} X`), y: assertFinite(p?.y, `Vertice ${i + 1} Y`) }));
  if(points.length < 3 || polygonArea(points) < 0.01) throw new Error('Un espacio necesita al menos 3 vertices y un area mayor que cero.');
  const { counters, id } = allocateId(model, 'space');
  const space = {
    id, name: String(input.name || '').trim() || `Espacio ${id.split('-').pop()}`,
    points,
    ceilingHeight: input.ceilingHeight != null ? assertPositive(input.ceilingHeight, 'Altura de plafon') : null,
    source: input.source || CAD_SOURCE.USER,
    review: input.review || userReview(),
    assignment: null
  };
  return { model: { ...withCollection(model, CAD_KIND.SPACE, list => [...list, space]), counters }, id };
}

export function updateSpace(model, id, patch = {}){
  const space = (model.spaces || []).find(s => s.id === id);
  if(!space) throw new Error(`No existe el espacio ${id}.`);
  const next = { ...space };
  if(patch.name != null) next.name = String(patch.name).trim() || space.name;
  if(patch.ceilingHeight !== undefined) next.ceilingHeight = patch.ceilingHeight == null || patch.ceilingHeight === '' ? null : assertPositive(patch.ceilingHeight, 'Altura de plafon');
  if(patch.points){
    const pts = patch.points.map(p => ({ x: assertFinite(p.x, 'X'), y: assertFinite(p.y, 'Y') }));
    if(pts.length < 3 || polygonArea(pts) < 0.01) throw new Error('El espacio quedaria sin area valida.');
    next.points = pts;
  }
  return withCollection(model, CAD_KIND.SPACE, list => list.map(s => s.id === id ? next : s));
}

export function moveSpaceVertex(model, id, index, point){
  const space = (model.spaces || []).find(s => s.id === id);
  if(!space) throw new Error(`No existe el espacio ${id}.`);
  const points = space.points.map((p, i) => i === index ? { x: assertFinite(point.x, 'X'), y: assertFinite(point.y, 'Y') } : p);
  return updateSpace(model, id, { points });
}

/* Cota (punto 6): `wallId` -> ligada al muro (se actualiza sola); `a`/`b`
   -> cota libre. `status: 'PENDIENTE_VALIDACION'` para cotas que vienen del
   plano original y no se pudieron confirmar. */
export function addDimension(model, input = {}){
  const { counters, id } = allocateId(model, 'dimension');
  let dim;
  if(input.wallId){
    if(!(model.walls || []).some(w => w.id === input.wallId)) throw new Error(`No existe el muro ${input.wallId}.`);
    dim = { id, ref: { kind: 'wall', id: input.wallId }, a: null, b: null, offset: input.offset != null ? Number(input.offset) : 0.6 };
  } else {
    const a = { x: assertFinite(input.a?.x, 'A.x'), y: assertFinite(input.a?.y, 'A.y') };
    const b = { x: assertFinite(input.b?.x, 'B.x'), y: assertFinite(input.b?.y, 'B.y') };
    if(Math.hypot(b.x - a.x, b.y - a.y) < 0.01) throw new Error('Una cota necesita dos puntos distintos.');
    dim = { id, ref: null, a, b, offset: input.offset != null ? Number(input.offset) : 0.4 };
  }
  dim = {
    ...dim,
    status: input.status === 'PENDIENTE_VALIDACION' ? 'PENDIENTE_VALIDACION' : 'OK',
    declaredValue: input.declaredValue != null ? Number(input.declaredValue) : null,
    source: input.source || CAD_SOURCE.USER
  };
  return { model: { ...withCollection(model, CAD_KIND.DIMENSION, list => [...list, dim]), counters }, id };
}

export function updateDimension(model, id, patch = {}){
  const dim = (model.dimensions || []).find(d => d.id === id);
  if(!dim) throw new Error(`No existe la cota ${id}.`);
  const next = { ...dim };
  if(patch.offset != null) next.offset = assertFinite(patch.offset, 'Desfase');
  if(patch.status) next.status = patch.status === 'PENDIENTE_VALIDACION' ? 'PENDIENTE_VALIDACION' : 'OK';
  if(!dim.ref){
    if(patch.a) next.a = { x: assertFinite(patch.a.x, 'A.x'), y: assertFinite(patch.a.y, 'A.y') };
    if(patch.b) next.b = { x: assertFinite(patch.b.x, 'B.x'), y: assertFinite(patch.b.y, 'B.y') };
  }
  return withCollection(model, CAD_KIND.DIMENSION, list => list.map(d => d.id === id ? next : d));
}

/* Eliminar (con cascada): un muro se lleva sus huecos y sus cotas ligadas --
   nunca deja una puerta flotando sin muro ni una cota apuntando a nada. */
export function deleteElement(model, id){
  const found = findElement(model, id);
  if(!found) return model;
  if(found.kind === CAD_KIND.WALL){
    return {
      ...model,
      walls: model.walls.filter(w => w.id !== id),
      openings: (model.openings || []).filter(o => o.wallId !== id),
      dimensions: (model.dimensions || []).filter(d => !(d.ref?.kind === 'wall' && d.ref.id === id))
    };
  }
  return withCollection(model, found.kind, list => list.filter(el => el.id !== id));
}

export function setElementReview(model, id, status){
  const found = findElement(model, id);
  if(!found) throw new Error(`No existe el elemento ${id}.`);
  if(found.kind === CAD_KIND.DIMENSION){
    return updateDimension(model, id, { status: status === REVIEW_STATUS.CONFIRMADO ? 'OK' : 'PENDIENTE_VALIDACION' });
  }
  const review = { ...(found.element.review || {}), status: status === REVIEW_STATUS.CONFIRMADO ? REVIEW_STATUS.CONFIRMADO : REVIEW_STATUS.PENDIENTE };
  return withCollection(model, found.kind, list => list.map(el => el.id === id ? { ...el, review } : el));
}

export function setElementAssignment(model, id, assignment){
  const found = findElement(model, id);
  if(!found || found.kind === CAD_KIND.DIMENSION) throw new Error(`No se puede asignar concepto a ${id}.`);
  return withCollection(model, found.kind, list => list.map(el => el.id === id ? { ...el, assignment: assignment || null } : el));
}

export function setScale(model, scale){
  return { ...model, scale: { ...model.scale, ...scale } };
}

/* Calibracion: el dibujo completo estaba a una escala distinta por un factor
   uniforme -> se escala TODO lo que salio del dibujo (coordenadas, posicion
   de huecos, anchos de huecos detectados, espesores medidos del dibujo).
   Lo que NO sale del dibujo en planta (alturas, antepechos, anchos/espesores
   capturados por el usuario) nunca se toca. */
export function rescaleModel(model, factor){
  const f = assertPositive(factor, 'Factor de escala');
  const sp = p => ({ x: p.x * f, y: p.y * f });
  return {
    ...model,
    walls: (model.walls || []).map(w => ({
      ...w, x1: w.x1 * f, y1: w.y1 * f, x2: w.x2 * f, y2: w.y2 * f,
      thickness: w.thicknessSource === 'DIBUJO' ? r4(w.thickness * f) : w.thickness
    })),
    openings: (model.openings || []).map(o => ({
      ...o, offset: r4(o.offset * f), width: o.source === CAD_SOURCE.USER ? o.width : r4(o.width * f)
    })),
    spaces: (model.spaces || []).map(s => ({ ...s, points: s.points.map(sp) })),
    dimensions: (model.dimensions || []).map(d => d.ref ? d : { ...d, a: sp(d.a), b: sp(d.b) }),
    underlay: model.underlay ? { ...model.underlay, metersPerUnit: model.underlay.metersPerUnit * f } : model.underlay,
    scale: {
      ...model.scale,
      metersPerUnit: model.scale?.metersPerUnit ? model.scale.metersPerUnit * f : model.scale?.metersPerUnit,
      ratio: model.scale?.ratio ? r4(model.scale.ratio * f) : model.scale?.ratio
    }
  };
}

/* ---------- Geometria de dibujo en planta (compartida 2D) ---------- */

/* Tramos SOLIDOS de un muro en planta (se corta donde hay hueco) --
   poligonos de 4 vertices en metros, listos para el canvas 2D. Mismo corte
   y mismas extensiones de esquina que usa cad3d.js. */
export function wallPlanPieces(model, wall){
  const len = wallLength(wall);
  if(len <= 0) return [];
  const ext = wallEndExtensions(model, wall);
  const d = wallDirection(wall), n = wallNormal(wall);
  const half = (Number(wall.thickness) || 0) / 2;
  const holes = openingsOnWall(model, wall.id)
    .map(o => ({ a: Math.max(0, Math.min(o.offset, len)), b: Math.max(0, Math.min(o.offset + o.width, len)) }))
    .filter(h => h.b > h.a)
    .sort((x, y) => x.a - y.a);
  const intervals = [];
  let cursor = -ext.start;
  for(const h of holes){
    if(h.a > cursor) intervals.push([cursor, h.a]);
    cursor = Math.max(cursor, h.b);
  }
  if(len + ext.end > cursor) intervals.push([cursor, len + ext.end]);
  return intervals.map(([s0, s1]) => {
    const p0 = { x: wall.x1 + d.x * s0, y: wall.y1 + d.y * s0 };
    const p1 = { x: wall.x1 + d.x * s1, y: wall.y1 + d.y * s1 };
    return [
      { x: p0.x + n.x * half, y: p0.y + n.y * half },
      { x: p1.x + n.x * half, y: p1.y + n.y * half },
      { x: p1.x - n.x * half, y: p1.y - n.y * half },
      { x: p0.x - n.x * half, y: p0.y - n.y * half }
    ];
  });
}

export function modelBounds(model){
  const pts = [];
  (model?.walls || []).forEach(w => { pts.push({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }); });
  (model?.spaces || []).forEach(s => pts.push(...s.points));
  (model?.dimensions || []).forEach(d => { if(!d.ref && d.a && d.b) pts.push(d.a, d.b); });
  if(model?.underlay?.metersPerUnit){
    pts.push({ x: 0, y: 0 }, { x: model.underlay.widthUnits * model.underlay.metersPerUnit, y: model.underlay.heightUnits * model.underlay.metersPerUnit });
  }
  if(!pts.length) return null;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function elementBounds(model, id){
  const found = findElement(model, id);
  if(!found) return null;
  const { kind, element } = found;
  let pts = [];
  if(kind === CAD_KIND.WALL) pts = [wallStart(element), wallEnd(element)];
  else if(kind === CAD_KIND.OPENING){
    const wall = (model.walls || []).find(w => w.id === element.wallId);
    if(wall) pts = [pointAlongWall(wall, element.offset), pointAlongWall(wall, element.offset + element.width)];
  } else if(kind === CAD_KIND.SPACE) pts = element.points;
  else {
    const r = resolveDimension(model, element);
    if(r.a && r.b) pts = [r.a, r.b];
  }
  if(!pts.length) return null;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
