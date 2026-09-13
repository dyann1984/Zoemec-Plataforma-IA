/* Fase B, punto 1: "PDF vectorial primero". Logica PURA (sin pdfjs-dist, sin
   red, sin Firebase) que clasifica primitivas YA EXTRAIDAS de un PDF
   (segmentos de linea + items de texto con su posicion) en:
     - candidatos de muro (geometria real, origin VECTOR_DETECTED)
     - candidatos de escala (ESCALA_GRAFICA / COTAS_TEXTO)
   La extraccion misma (pdfjs-dist#getOperatorList/getTextContent) vive en
   server/api-lib/_planoVectorExtract.mjs (IO), que le pasa a este modulo
   solo arreglos de numeros/strings -- separacion identica a como
   _priceIntelligenceCore.mjs (red) alimenta a priceNormalization.js (puro).

   Todas las coordenadas de entrada estan en "unidades PDF" (1 unidad = 1/72
   de pulgada, el sistema de coordenadas nativo de cualquier pagina PDF,
   independiente del zoom/DPI con que despues se renderice a canvas) -- nunca
   en pixeles de pantalla. La conversion final a unidades reales (m) ocurre
   SOLO cuando resolveScale() encuentra una fuente de escala valida. */
import { calibrateScale } from './planoMeasurement.js';
import { ESCALA_FUENTES } from './planoReview.js';

/* Un segmento decorativo (achurado, flecha de cota, textura) casi siempre
   mide unos pocos puntos PDF; un muro real en un plano arquitectonico tipico
   (1:50 a 1:100 impreso a tamano real, ver resolveGraphicScale) rara vez baja
   de esto. Umbral deliberadamente conservador (documentado, ajustable) -- no
   pretende ser universal, solo filtrar el ruido mas obvio antes de agrupar. */
export const MIN_SIGNIFICANT_SEGMENT_LENGTH_PT = 8;
export const MIN_WALL_LENGTH_PT = 20;

function segLength(seg){
  return Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
}
function segAngleRad(seg){
  return Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1);
}
function normalizeAngle(rad){
  // Una linea no tiene "sentido" (A->B es la misma linea que B->A): se
  // normaliza al rango [0, PI) para que comparar angulos no falle solo por
  // el orden en que pdfjs emitio los puntos del trazo.
  let a = rad % Math.PI;
  if(a < 0) a += Math.PI;
  return a;
}
function pointDist(ax, ay, bx, by){
  return Math.hypot(ax - bx, ay - by);
}

/* Filtra segmentos irrelevantes (demasiado cortos para ser un elemento
   constructivo real) -- nunca descarta por pagina/tipo, solo por longitud. */
export function filterSignificantSegments(segments, { minLength = MIN_SIGNIFICANT_SEGMENT_LENGTH_PT } = {}){
  return (Array.isArray(segments) ? segments : []).filter(s => segLength(s) >= minLength);
}

/* Punto 1 del pedido: decide si el PDF trae geometria vectorial aprovechable
   ANTES de gastar una llamada de vision IA. Deliberadamente simple y
   documentado: un PDF escaneado (imagen rasterizada dentro del PDF) no tiene
   operadores de trazo reales, asi que pdfjs-dist#getOperatorList nunca
   produce segmentos de linea -- `segments` llega vacio o casi vacio. */
export function hasUsableVectorGeometry(segments, { minSegments = 6 } = {}){
  return filterSignificantSegments(segments).length >= minSegments;
}

/* Agrupa segmentos en "corridas de muro": cadenas de segmentos que comparten
   un extremo (dentro de `tolerance` puntos PDF) Y son colineales (mismo
   angulo dentro de `angleToleranceRad`). Dos muros que se cruzan en una
   esquina NO se fusionan (angulos distintos) -- cada corrida recta queda
   como su propio candidato, que es exactamente como un plano arquitectonico
   real representa muros (tramos rectos entre esquinas/cruces). No intenta
   resolver espesor de muro (linea doble) ni cerrar poligonos de habitacion
   -- eso es candidato a iteracion futura, documentado como limitacion real,
   nunca simulado. */
export function groupSegmentsIntoWalls(segments, { tolerance = 3, angleToleranceRad = 0.05, minWallLength = MIN_WALL_LENGTH_PT } = {}){
  const significant = filterSignificantSegments(segments, { minLength: minWallLength });
  const used = new Array(significant.length).fill(false);
  const walls = [];

  function endpointsClose(a, b){
    return pointDist(a.x2, a.y2, b.x1, b.y1) <= tolerance || pointDist(a.x2, a.y2, b.x2, b.y2) <= tolerance
      || pointDist(a.x1, a.y1, b.x1, b.y1) <= tolerance || pointDist(a.x1, a.y1, b.x2, b.y2) <= tolerance;
  }
  function collinear(a, b){
    const diff = Math.abs(normalizeAngle(segAngleRad(a)) - normalizeAngle(segAngleRad(b)));
    return Math.min(diff, Math.PI - diff) <= angleToleranceRad;
  }

  for(let i = 0; i < significant.length; i++){
    if(used[i]) continue;
    used[i] = true;
    const chain = [significant[i]];
    let growing = true;
    while(growing){
      growing = false;
      for(let j = 0; j < significant.length; j++){
        if(used[j]) continue;
        const candidate = significant[j];
        const joinsChain = chain.some(member => endpointsClose(member, candidate) && collinear(member, candidate));
        if(joinsChain){
          chain.push(candidate);
          used[j] = true;
          growing = true;
        }
      }
    }
    const page = significant[i].page ?? null;
    const xs = chain.flatMap(s => [s.x1, s.x2]);
    const ys = chain.flatMap(s => [s.y1, s.y2]);
    const lengthPt = chain.reduce((sum, s) => sum + segLength(s), 0);
    walls.push({
      id: `vec-wall-${walls.length + 1}`,
      page,
      segments: chain.map(s => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 })),
      bbox: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
      lengthPt
    });
  }
  return walls;
}

/* ---------- Candidatos de escala (punto 2: ESCALA_GRAFICA / COTAS_TEXTO) ---------- */

const SCALE_TEXT_RE = /ESC(?:ALA)?\.?\s*1\s*[:\/]\s*(\d+(?:[.,]\d+)?)/i;
const COTA_TEXT_RE = /(\d{1,3}[.,]\d{1,2})\s*m\b|^\s*(\d{1,2}[.,]\d{2})\s*$/;

/* Escala grafica declarada en el texto del plano (ej. "ESCALA 1:50"). Asume
   que el PDF se genero a escala real de impresion (1 punto PDF = 1 punto
   fisico de papel, practica estandar de "Plot to PDF" en AutoCAD/Revit) --
   supuesto EXPLICITO y documentado, nunca oculto: si el PDF se reescalo al
   exportar (ej. "ajustar a pagina"), esta escala sera incorrecta y el
   usuario debe recalibrar manualmente (REFERENCIA_USUARIO, siempre
   disponible como ultimo recurso, nunca bloqueado). 1 punto PDF = 1/72 in =
   0.0254/72 m. */
const METERS_PER_PDF_POINT_AT_TRUE_SCALE = 0.0254 / 72;

export function detectGraphicScale(textItems){
  for(const item of (Array.isArray(textItems) ? textItems : [])){
    const match = SCALE_TEXT_RE.exec(String(item?.str || ''));
    if(match){
      const ratio = Number(String(match[1]).replace(',', '.'));
      if(Number.isFinite(ratio) && ratio > 0){
        return {
          fuente: ESCALA_FUENTES.ESCALA_GRAFICA,
          realUnitsPerPdfPoint: ratio * METERS_PER_PDF_POINT_AT_TRUE_SCALE,
          evidencia: `Escala grafica declarada en el plano: "${item.str.trim()}" (asume impresion a escala real 1:1 en el PDF).`,
          page: item.page ?? null
        };
      }
    }
  }
  return null;
}

/* Cotas de texto (ej. "4.20 m" o "4.20" junto a una linea de dimension) YA
   correlacionadas a un segmento cercano: la cota mide la longitud real de
   ESE segmento, lo que da directamente pixelDistance (longitud del segmento
   en puntos PDF) + realDistance (valor de la cota) -- exactamente el
   contrato de calibrateScale() (planoMeasurement.js), reusado tal cual, sin
   una segunda formula de escala. `maxDistancePt` limita que tan lejos puede
   estar el texto de la cota del segmento para considerarse "la misma
   medida" (una cota lejos de cualquier trazo no es evidencia utilizable). */
export function detectCotaScaleCandidates(textItems, segments, { maxDistancePt = 40 } = {}){
  const candidates = [];
  const significant = filterSignificantSegments(segments);
  for(const item of (Array.isArray(textItems) ? textItems : [])){
    const raw = String(item?.str || '').trim();
    const match = COTA_TEXT_RE.exec(raw);
    if(!match) continue;
    const realDistance = Number((match[1] || match[2]).replace(',', '.'));
    if(!(realDistance > 0)) continue;
    const cx = (item.x ?? 0) + (item.width ?? 0) / 2;
    const cy = (item.y ?? 0) + (item.height ?? 0) / 2;
    let nearest = null;
    let nearestDist = Infinity;
    for(const seg of significant){
      if((seg.page ?? null) !== (item.page ?? null)) continue;
      const mx = (seg.x1 + seg.x2) / 2, my = (seg.y1 + seg.y2) / 2;
      const d = pointDist(cx, cy, mx, my);
      if(d < nearestDist){ nearestDist = d; nearest = seg; }
    }
    if(nearest && nearestDist <= maxDistancePt){
      const pixelDistance = segLength(nearest);
      const scale = calibrateScale(pixelDistance, realDistance);
      if(scale){
        candidates.push({
          fuente: ESCALA_FUENTES.COTAS_TEXTO,
          realUnitsPerPdfPoint: scale,
          evidencia: `Cota "${raw}" detectada a ${nearestDist.toFixed(1)}pt de un trazo de ${pixelDistance.toFixed(1)}pt.`,
          page: item.page ?? null,
          segmentRef: nearest
        });
      }
    }
  }
  return candidates;
}

/* Prioridad ESTRICTA (punto 2 del pedido), nunca silenciosa: escala
   declarada > cota detectada > referencia confirmada por el usuario >
   NO_DETERMINADA. `referenciaUsuario` (si viene) es SIEMPRE
   {realUnitsPerPdfPoint, evidencia} ya calculado por calibracion manual de 2
   puntos (ver el flujo de UI, PlanoOverlayViewer) -- este resolver nunca
   calibra nada, solo decide cual fuente ya disponible gana. */
export function resolveScale({ graphicScale = null, cotaCandidates = [], referenciaUsuario = null } = {}){
  if(graphicScale) return graphicScale;
  if(Array.isArray(cotaCandidates) && cotaCandidates.length) return cotaCandidates[0];
  if(referenciaUsuario && referenciaUsuario.realUnitsPerPdfPoint > 0){
    return { fuente: ESCALA_FUENTES.REFERENCIA_USUARIO, realUnitsPerPdfPoint: referenciaUsuario.realUnitsPerPdfPoint, evidencia: referenciaUsuario.evidencia || 'Calibracion manual de 2 puntos confirmada por el usuario.', page: referenciaUsuario.page ?? null };
  }
  return { fuente: ESCALA_FUENTES.NO_DETERMINADA, realUnitsPerPdfPoint: null, evidencia: 'Sin escala declarada, cota detectada ni calibracion manual.', page: null };
}
