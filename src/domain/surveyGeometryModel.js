/* Modelo geometrico de Levantamiento IA (Fase 1.5). Fuente unica de verdad
   geometrica de un Space: Plano 2D, Vista 3D y el adaptador de Takeoff leen
   TODOS de aqui -- ningun consumidor calcula muros, posiciones de aberturas
   o segmentos por su cuenta, para que nunca puedan discrepar entre si.

   Separacion de dominio (regla explicita del usuario): este archivo SOLO
   produce geometria (muros, aberturas, segmentos). Cuantificacion (areas
   totales, conteos) sigue viviendo en src/lib/levantamientoCalc.js
   (computeSpaceGeometry/aggregateSurveyTotals) -- este modulo la REUSA
   (buildSpaceGeometryModel llama computeSpaceGeometry), nunca la duplica.
   El puente hacia Plano/Takeoff (src/domain/levantamientoTakeoffBridge.js)
   sigue operando sobre esas cantidades agregadas, no sobre esta geometria --
   Levantamiento -> geometria, Plano/Takeoff -> cuantificacion, Concepto ->
   APU -> costo, tres niveles que no se mezclan.

   Diseñado pensando en espacios rectangulares hoy, pero con muros
   explicitos (id, coordenadas, orientacion) en vez de derivar todo de
   length/width en cada consumidor -- esto es lo que permitira, en fases
   futuras, espacios irregulares/datos de video o LiDAR sin rehacer Plano 2D
   ni Vista 3D: solo tendrian que producir un arreglo de Wall distinto. */
import { ELEMENT_TYPE, WALL_IDS } from './levantamientoSchema.js';
import { computeSpaceGeometry } from '../lib/levantamientoCalc.js';

const PLACEABLE_TYPES = new Set([ELEMENT_TYPE.DOOR, ELEMENT_TYPE.WINDOW]);

export const OPENING_WARNING = Object.freeze({
  NO_WALL_ASSIGNED: 'sin_muro_asignado',
  EXCEEDS_WALL: 'excede_longitud_del_muro',
  OFFSET_OUT_OF_BOUNDS: 'offset_fuera_del_muro',
  OPENINGS_OVERLAP: 'aberturas_traslapadas'
});

function toNum(v){
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/* Los 4 muros canonicos de un Space rectangular, explicitos (id, longitud,
   altura, orientacion, coordenadas inicial/final) -- nunca implicitos via
   length/width en cada consumidor. Coordenadas en metros, origen en la
   esquina (0,0) del Space, x=largo, y=ancho. Orden fijo M-01..M-04 (ver
   WALL_IDS en levantamientoSchema.js): M-01/M-03 miden `length`, M-02/M-04
   miden `width`. `angle` es la direccion del muro (radianes, desde `from`
   hacia `to`), fija por indice. */
export function buildSpaceWalls(space){
  const length = toNum(space?.length);
  const width = toNum(space?.width);
  const height = toNum(space?.height);
  const corners = [
    { x: 0, y: 0 },
    { x: length, y: 0 },
    { x: length, y: width },
    { x: 0, y: width }
  ];
  const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  return WALL_IDS.map((id, i) => ({
    id,
    from: corners[i],
    to: corners[(i + 1) % 4],
    length: i % 2 === 0 ? length : width,
    height,
    angle: angles[i]
  }));
}

/* Resuelve la posicion de UNA puerta/ventana dentro de sus muros. NUNCA muta
   el elemento recibido ni lanza excepcion -- siempre regresa un resultado
   renderizable, con `warnings` describiendo cualquier problema (abertura sin
   muro asignado, mas ancha que el muro, o con un offset que se saldria del
   muro) para que la UI (SpaceCard.jsx/SpaceFloorPlan2D.jsx) muestre una
   advertencia clara en vez de fallar en silencio o romper el render:

   - Sin wallId valido (levantamiento guardado antes de Fase 1.5, o el
     usuario todavia no elige un muro): se asigna uno por rotacion segun
     `index` (posicion del elemento dentro de la lista de aberturas del
     Space) y se centra -- NO es una migracion de datos, el elemento guardado
     sigue sin wallId; esto es solo la posicion de despliegue.
   - Abertura mas ancha que el muro asignado: no se puede ubicar de forma
     valida -- offset se fija en 0 y se marca EXCEEDS_WALL.
   - offset explicito fuera de rango (negativo o offset+ancho > longitud del
     muro): se recorta al rango valido para poder dibujar algo razonable, y
     se marca OFFSET_OUT_OF_BOUNDS para que el usuario corrija el valor real. */
export function resolveOpening(element, walls, index = 0){
  const list = walls && walls.length ? walls : buildSpaceWalls({ length: 0, width: 0, height: 0 });
  const width = toNum(element?.width);
  const height = toNum(element?.height);
  const sillHeight = toNum(element?.sillHeight);
  const warnings = [];

  const explicitWall = list.find(w => w.id === element?.wallId);
  const hasExplicitWall = !!explicitWall;
  if(!hasExplicitWall) warnings.push(OPENING_WARNING.NO_WALL_ASSIGNED);
  const wall = explicitWall || list[((index % list.length) + list.length) % list.length];

  if(width > wall.length && wall.length > 0) warnings.push(OPENING_WARNING.EXCEEDS_WALL);

  let offset;
  if(hasExplicitWall){
    const rawOffset = toNum(element?.offset);
    const maxOffset = Math.max(0, wall.length - width);
    if(rawOffset < 0 || rawOffset > maxOffset) warnings.push(OPENING_WARNING.OFFSET_OUT_OF_BOUNDS);
    offset = Math.min(Math.max(rawOffset, 0), maxOffset);
  } else {
    offset = Math.max(0, (wall.length - width) / 2);
  }

  const t = wall.length > 0 ? (offset + width / 2) / wall.length : 0.5;
  const center = {
    x: wall.from.x + (wall.to.x - wall.from.x) * t,
    y: wall.from.y + (wall.to.y - wall.from.y) * t
  };

  return {
    id: element?.id ?? null,
    type: element?.type ?? null,
    wallId: wall.id,
    offset,
    width,
    height,
    sillHeight,
    center,
    angle: wall.angle,
    warnings
  };
}

/* Construye los segmentos que tejen UN muro alrededor de sus aberturas --
   sin CSG: solo rectangulos que llenan el muro completo excepto donde hay
   una abertura, mas un segmento de dintel arriba (siempre) y de pretil abajo
   (solo si sillHeight > 0, tipico de ventana; una puerta con sillHeight=0 no
   genera pretil). Coordenadas locales al muro: x a lo largo (0..wall.length),
   y vertical (0..wall.height).

   Aberturas traslapadas en el mismo muro (ver OPENINGS_OVERLAP mas abajo):
   esta funcion NUNCA genera un segmento de ancho negativo ni duplicado aunque
   dos aberturas se crucen -- x1 siempre es >= x0 (ambos pasan por el mismo
   Math.max contra `cursor`, que solo avanza) y el guard `x1 > cursor` descarta
   cualquier abertura que quede completamente cubierta por la anterior ya
   procesada. El efecto visible de un traslape es que la abertura que se
   procesa despues (por offset) no vuelve a abrir un hueco donde la anterior
   ya lo hizo -- geometria siempre valida, nunca rota; la deteccion del
   conflicto para avisarle al usuario vive en withOverlapWarnings/
   OPENINGS_OVERLAP, no aqui. */
export function buildWallSegments(wall, openingsOnWall){
  const sorted = [...(openingsOnWall || [])].sort((a, b) => a.offset - b.offset);
  const segments = [];
  let cursor = 0;
  sorted.forEach(op => {
    const x0 = Math.max(cursor, Math.min(op.offset, wall.length));
    const x1 = Math.max(x0, Math.min(op.offset + op.width, wall.length));
    if(x1 > cursor){
      if(x0 > cursor) segments.push({ wallId: wall.id, x0: cursor, x1: x0, yBase: 0, yTop: wall.height });
      const headerBase = op.sillHeight + op.height;
      if(headerBase < wall.height) segments.push({ wallId: wall.id, x0, x1, yBase: headerBase, yTop: wall.height });
      if(op.sillHeight > 0) segments.push({ wallId: wall.id, x0, x1, yBase: 0, yTop: Math.min(op.sillHeight, wall.height) });
      cursor = x1;
    }
  });
  if(cursor < wall.length) segments.push({ wallId: wall.id, x0: cursor, x1: wall.length, yBase: 0, yTop: wall.height });
  return segments;
}

/* Detecta pares de aberturas en el MISMO muro cuyos rangos resueltos
   [offset, offset+width] se cruzan -- usa el offset YA resuelto por
   resolveOpening (post-clamp), que es el que de verdad se dibuja, no el
   valor crudo capturado por el usuario. Regresa un arreglo NUEVO (nunca muta
   `openings`) marcando OPENINGS_OVERLAP en toda abertura que participe en al
   menos un cruce -- buildWallSegments de arriba ya es a prueba de esto (jamas
   produce un segmento invalido), asi que esta funcion es puramente
   informativa: le da a la UI (SpaceCard.jsx/SpaceFloorPlan2D.jsx/
   Survey3DViewer.jsx, las mismas que ya leen `warnings`) lo que necesita para
   avisarle al usuario que dos aberturas se pisan y debe mover una. */
function withOverlapWarnings(openings){
  const overlappingIds = new Set();
  const byWall = new Map();
  openings.forEach(op => {
    if(!byWall.has(op.wallId)) byWall.set(op.wallId, []);
    byWall.get(op.wallId).push(op);
  });
  byWall.forEach(onWall => {
    const sorted = [...onWall].sort((a, b) => a.offset - b.offset);
    for(let i = 1; i < sorted.length; i++){
      if(sorted[i].offset < sorted[i - 1].offset + sorted[i - 1].width){
        overlappingIds.add(sorted[i - 1].id);
        overlappingIds.add(sorted[i].id);
      }
    }
  });
  if(!overlappingIds.size) return openings;
  return openings.map(op => overlappingIds.has(op.id)
    ? { ...op, warnings: [...op.warnings, OPENING_WARNING.OPENINGS_OVERLAP] }
    : op);
}

/* Modelo geometrico completo de un Space -- unico punto de entrada que debe
   usar cualquier consumidor (Plano 2D, Vista 3D, adaptador de Takeoff). */
export function buildSpaceGeometryModel(space){
  const walls = buildSpaceWalls(space);
  const placeable = (space?.elements || []).filter(el => PLACEABLE_TYPES.has(el?.type));
  const openings = withOverlapWarnings(placeable.map((el, index) => resolveOpening(el, walls, index)));
  const wallsWithSegments = walls.map(w => ({
    ...w,
    segments: buildWallSegments(w, openings.filter(o => o.wallId === w.id))
  }));
  return {
    space,
    geometry: computeSpaceGeometry(space),
    walls: wallsWithSegments,
    openings
  };
}
