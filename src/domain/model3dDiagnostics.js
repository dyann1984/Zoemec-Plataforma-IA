/* Diagnostico real del modelo 3D importado (Incidente 3 -- cierre real,
   "no fingir que esta bien"). Puro/testable con node --test: recibe solo
   numeros (bounding boxes de cada malla de primer nivel, ya en espacio
   mundial) y banderas ya calculadas por el loader (levantamientoModelLoader.js)
   -- nunca objetos THREE.js aqui, para poder probar la logica con datos de
   ejemplo sin levantar un renderer.

   Nace de diagnosticar un archivo REAL reportado como "se ve mal en
   produccion" (casa_toledo_desde_plano.glb, 2 mallas "Planta_Baja"/
   "Planta_Alta"): confirmo dos defectos reales y distintos que un boton de
   rotacion manual no explica ni corrige por si solo:
   1) El archivo usa Z como eje vertical real, pero esta empaquetado como
      glTF (que la especificacion OBLIGA a ser Y-up) sin haber convertido
      los ejes en el exportador -- el loader hoy solo aplica la correccion
      Z-up->Y-up para OBJ (unico formato sin eje declarado), nunca para
      GLB/GLTF (formato que la especificacion garantiza Y-up) -- por eso
      este archivo especifico se ve "acostado". Se detecta con evidencia
      real (como se apilan las mallas), no solo confiando en el formato.
   2) Las dos mallas NO comparten huella en planta (Planta_Baja ocupa
      X:[0,4.46], Planta_Alta X:[5.46,10.04] -- CERO traslape, con 1m de
      hueco) -- un defecto real de los DATOS de origen (quien genero este
      GLB no alineo el segundo piso sobre el primero), no algo que el
      visor pueda ni deba "arreglar" adivinando una posicion -- se declara
      "atipica" honestamente en vez de renderizar como si nada. */

export const ORIENTATION_STATUS = Object.freeze({ VALID: 'valida', CORRECTED: 'corregida', UNCERTAIN: 'dudosa' });
export const GEOMETRY_STATUS = Object.freeze({ VALID: 'valida', ATYPICAL: 'atipica' });
export const MATERIALS_STATUS = Object.freeze({ VALID: 'validos', MISSING: 'ausentes' });
export const NORMALS_STATUS = Object.freeze({ VALID: 'validas', CORRECTED: 'corregidas' });
export const SCALE_STATUS = Object.freeze({ CONFIRMED: 'confirmada', UNKNOWN: 'desconocida' });

const AXES = ['x', 'y', 'z'];
const AXIS_INDEX = { x: 0, y: 1, z: 2 };
// Ventana de altura "plausible" para una construccion residencial (un solo
// nivel ronda 2.4-3.5m; edificios de varios niveles pueden llegar a esto
// sin ser descabellados) -- solo se usa como senal debil de respaldo
// cuando hay una unica malla y no hay apilamiento que comparar.
const PLAUSIBLE_HEIGHT_MIN = 1.5;
const PLAUSIBLE_HEIGHT_MAX = 40;

function size(group, axis){ return group.max[AXIS_INDEX[axis]] - group.min[AXIS_INDEX[axis]]; }
function overallExtent(groups, axis){
  const idx = AXIS_INDEX[axis];
  const min = Math.min(...groups.map(g => g.min[idx]));
  const max = Math.max(...groups.map(g => g.max[idx]));
  return { min, max, size: max - min };
}

/* Traslape [0,1] de dos intervalos 1D -- 1 = identicos, 0 = sin contacto. */
function intervalOverlapRatio(aMin, aMax, bMin, bMax){
  const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
  const smaller = Math.min(aMax - aMin, bMax - bMin);
  if(smaller <= 0) return 0;
  return Math.max(0, overlap) / smaller;
}

/* Puntaje de "que tan bien explica `axis` como vertical": ordena las
   mallas por esa coordenada y evalua dos cosas a la vez -- (a) que casi no
   haya hueco entre una y la siguiente (se apilan, como pisos reales) y (b)
   que en los OTROS dos ejes (la "huella en planta") SI se traslapen mucho
   (mismo edificio visto desde arriba). Un eje que es realmente "altura"
   para un edificio de varios niveles cumple ambas cosas a la vez; un eje
   que en realidad es "ancho" o "profundidad" tipicamente no. */
function scoreAxisAsUp(groups, axis){
  const otherAxes = AXES.filter(a => a !== axis);
  const sorted = [...groups].sort((a, b) => a.min[AXIS_INDEX[axis]] - b.min[AXIS_INDEX[axis]]);
  const overall = overallExtent(groups, axis);
  let gapPenalty = 0;
  let footprintOverlap = 0;
  for(let i = 0; i < sorted.length - 1; i++){
    const a = sorted[i], b = sorted[i + 1];
    const gap = b.min[AXIS_INDEX[axis]] - a.max[AXIS_INDEX[axis]];
    gapPenalty += Math.abs(gap) / (overall.size || 1);
    const overlaps = otherAxes.map(oa => intervalOverlapRatio(a.min[AXIS_INDEX[oa]], a.max[AXIS_INDEX[oa]], b.min[AXIS_INDEX[oa]], b.max[AXIS_INDEX[oa]]));
    footprintOverlap += overlaps.reduce((s, v) => s + v, 0) / overlaps.length;
  }
  const pairs = Math.max(1, sorted.length - 1);
  return { gapPenalty: gapPenalty / pairs, footprintOverlap: footprintOverlap / pairs };
}

/* groups: [{name, min:[x,y,z], max:[x,y,z]}] en espacio mundial, YA con
   cualquier correccion de ejes existente por formato aplicada (para OBJ,
   despues de applyDefaultUpAxisCorrection). Devuelve el eje detectado como
   vertical real ('x'|'y'|'z'), nunca asume Y a ciegas. */
export function detectUpAxis(groups){
  if(!Array.isArray(groups) || groups.length === 0) return { axis: 'y', confidence: 'baja', reason: 'sin_datos' };

  if(groups.length >= 2){
    // Dos pasos, no un puntaje mezclado: primero se DESCARTAN los ejes que
    // ni siquiera comparten huella real en los otros dos (footprintOverlap
    // bajo -- ese eje no puede ser "vertical de un mismo edificio", venga
    // el hueco que venga); entre los que SI califican, gana el de menor
    // hueco (mas apilado). Mezclar ambas senales en un solo numero (version
    // anterior de este heuristico) diluia el hueco real cuando dos ejes
    // compartian huella parcial por casualidad -- ver caso casa_toledo en
    // el test: X y Z quedaban con footprintOverlap identico (0.5) porque
    // cada uno se traslapa con Y en un eje y con el otro en cero, y solo el
    // tamano del hueco distingue cual es el verdadero vertical.
    const scored = AXES.map(axis => ({ axis, ...scoreAxisAsUp(groups, axis) }));
    const qualifying = scored.filter(s => s.footprintOverlap >= 0.3).sort((a, b) => a.gapPenalty - b.gapPenalty);
    if(qualifying.length === 0) return { axis: 'y', confidence: 'baja', reason: 'sin_indicio_de_apilamiento' };
    const best = qualifying[0];
    if(best.axis === 'y') return { axis: 'y', confidence: 'alta', reason: 'apilamiento_confirma_y' };
    // Solo se declara "detectado" (para corregir automaticamente) si el
    // hueco del candidato es realmente chico Y claramente menor que el
    // siguiente mejor candidato -- un empate/margen chico se declara
    // dudoso en vez de rotar con poca evidencia.
    const runnerUp = qualifying[1];
    const clearlySmallGap = best.gapPenalty < 0.1;
    const clearMarginOverRunnerUp = !runnerUp || (runnerUp.gapPenalty - best.gapPenalty) > 0.05;
    if(clearlySmallGap && clearMarginOverRunnerUp){
      return { axis: best.axis, confidence: 'alta', reason: 'apilamiento_detecta_eje_distinto' };
    }
    return { axis: 'y', confidence: 'baja', reason: 'apilamiento_ambiguo' };
  }

  // Una sola malla: no hay apilamiento que comparar -- senal debil de
  // respaldo, solo por tamano. Nunca se corrige automaticamente con esta
  // senal sola (confidence siempre 'baja' aqui), solo se advierte.
  const sizes = { x: size(groups[0], 'x'), y: size(groups[0], 'y'), z: size(groups[0], 'z') };
  const ySizePlausible = sizes.y >= PLAUSIBLE_HEIGHT_MIN && sizes.y <= PLAUSIBLE_HEIGHT_MAX;
  const others = AXES.filter(a => a !== 'y');
  const yIsClearlySmallest = others.every(a => sizes.y < sizes[a] * 0.6);
  if(ySizePlausible && yIsClearlySmallest) return { axis: 'y', confidence: 'alta', reason: 'unica_malla_y_plausible' };
  const candidate = others.find(a => sizes[a] >= PLAUSIBLE_HEIGHT_MIN && sizes[a] <= PLAUSIBLE_HEIGHT_MAX && sizes[a] < sizes.y * 0.6 && others.filter(o => o !== a).every(o => sizes[a] < sizes[o] * 0.6));
  if(candidate) return { axis: candidate, confidence: 'baja', reason: 'unica_malla_indicio_debil' };
  return { axis: 'y', confidence: 'baja', reason: 'unica_malla_sin_indicio' };
}

/* Con el eje vertical ya determinado, revisa si las mallas de primer nivel
   comparten huella real en los otros dos ejes (mismo edificio visto desde
   arriba) -- si dos mallas casi no se traslapan ahi, es evidencia real de
   que el archivo de origen no las alineo correctamente (ver hallazgo
   Planta_Baja/Planta_Alta arriba), nunca algo que este modulo intente
   adivinar como corregir. */
export function detectGeometryAtypical(groups, upAxis){
  if(!Array.isArray(groups) || groups.length < 2) return { atypical: false };
  const otherAxes = AXES.filter(a => a !== upAxis);
  for(let i = 0; i < groups.length; i++){
    for(let j = i + 1; j < groups.length; j++){
      const a = groups[i], b = groups[j];
      const overlaps = otherAxes.map(ax => intervalOverlapRatio(a.min[AXIS_INDEX[ax]], a.max[AXIS_INDEX[ax]], b.min[AXIS_INDEX[ax]], b.max[AXIS_INDEX[ax]]));
      const minOverlap = Math.min(...overlaps);
      if(minOverlap < 0.3){
        return { atypical: true, reason: 'huella_sin_traslape', detail: { groupA: a.name, groupB: b.name } };
      }
    }
  }
  return { atypical: false };
}

/* Punto de entrada unico: arma el objeto de diagnostico completo que
   consume Model3DPreview.jsx ("Estado del modelo"). Nunca lanza -- ante
   datos insuficientes, cada campo cae a su estado mas conservador
   (nunca "valido" sin evidencia real). */
export function diagnoseModel3D({ formatId, groups, hasRealMaterials, anyNormalsWereMissing }){
  const upAxisResult = detectUpAxis(groups || []);
  const needsRotation = upAxisResult.axis !== 'y' && upAxisResult.confidence === 'alta';
  const orientation = needsRotation
    ? { status: ORIENTATION_STATUS.CORRECTED, detectedAxis: upAxisResult.axis }
    : (upAxisResult.confidence === 'alta' ? { status: ORIENTATION_STATUS.VALID } : { status: ORIENTATION_STATUS.UNCERTAIN, detectedAxis: upAxisResult.axis !== 'y' ? upAxisResult.axis : null });

  // El eje "vertical" a usar para revisar huella en planta: si se va a
  // rotar, la huella real hoy vive en el eje detectado (antes de rotar);
  // si no, ya es Y (sea porque asi vino, o porque la confianza fue baja y
  // no se toco nada).
  const upAxisForGeometryCheck = needsRotation ? upAxisResult.axis : 'y';
  const geometryCheck = detectGeometryAtypical(groups || [], upAxisForGeometryCheck);

  return {
    orientation,
    scale: { status: (formatId === 'glb' || formatId === 'gltf') ? SCALE_STATUS.CONFIRMED : SCALE_STATUS.UNKNOWN },
    materials: { status: hasRealMaterials ? MATERIALS_STATUS.VALID : MATERIALS_STATUS.MISSING },
    normals: { status: anyNormalsWereMissing ? NORMALS_STATUS.CORRECTED : NORMALS_STATUS.VALID },
    geometry: geometryCheck.atypical ? { status: GEOMETRY_STATUS.ATYPICAL, reason: geometryCheck.reason, detail: geometryCheck.detail } : { status: GEOMETRY_STATUS.VALID },
    rotationCorrection: needsRotation ? upAxisResult.axis : null
  };
}
