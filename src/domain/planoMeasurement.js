/* Cuantificacion 2D desde plano (puntos 16-17 del spec del usuario):
   geometria pura (sin React, sin canvas, sin Firebase) para convertir un
   trazo manual sobre el plano YA CARGADO (ver PlanoTakeoff en main.jsx,
   pdfjs-dist ya renderiza la pagina a canvas) en una cantidad real, con
   calibracion de escala explicita por el usuario -- nunca una medicion
   "exacta" cuando no hay escala/cota suficiente (regla del spec, punto 15).

   Reutiliza el mismo motor de revision/seguridad que ya existe para Planos
   IA (ver src/domain/planoReview.js): produce elementos con el MISMO shape
   que la deteccion por IA, solo que fuenteEscala es REFERENCIA_USUARIO (ya
   existia en el enum, no se inventa un estado nuevo) y pasan por el mismo
   enforceScaleRule/revision humana antes de convertirse en semilla de APU
   via toApuSeed. Ningun motor nuevo, ninguna cantidad se persiste sin pasar
   por esa misma barrera. */
import { ESCALA_FUENTES, PLANO_ELEMENT_STATES, enforceScaleRule } from './planoReview.js';

/* Calibracion de escala: el usuario traza una linea de referencia sobre una
   cota/medida conocida del plano (ej. "esta linea mide 5 m" segun el propio
   dibujo) y declara la distancia real. Retorna unidades reales por pixel, o
   null si cualquiera de las dos distancias no es un numero positivo -- nunca
   se asume una escala por defecto. */
export function calibrateScale(pixelDistance, realDistance){
  const px = Number(pixelDistance);
  const real = Number(realDistance);
  if(!(px > 0) || !(real > 0)) return null;
  return real / px;
}

/* Area de un poligono en coordenadas de pixel (formula del shoelace).
   points: [[x,y], ...], minimo 3 vertices; un poligono abierto/invalido
   retorna 0 (nunca NaN ni un area negativa). */
export function polygonAreaPx(points){
  const pts = Array.isArray(points) ? points.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) : [];
  if(pts.length < 3) return 0;
  let sum = 0;
  for(let i = 0; i < pts.length; i++){
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/* Longitud de una polilinea en coordenadas de pixel (suma de segmentos). */
export function polylineLengthPx(points){
  const pts = Array.isArray(points) ? points.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) : [];
  let total = 0;
  for(let i = 1; i < pts.length; i++){
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    total += Math.hypot(x2 - x1, y2 - y1);
  }
  return total;
}

/* Convierte un trazo (poligono para area, polilinea para longitud) YA
   calibrado en un elemento con el mismo shape que produce Planos IA/Takeoff
   (server/api-lib/_planoValidate.mjs) -- listo para el mismo flujo de
   revision humana. scaleUnitsPerPixel debe venir de calibrateScale(); sin
   una escala valida (>0), NUNCA se propone una cantidad (fuenteEscala queda
   NO_DETERMINADA y enforceScaleRule la fuerza a REQUIERE_REVISION, igual que
   para una deteccion de IA sin escala). */
export function measureElement({ points, mode = 'area', scaleUnitsPerPixel, unit = 'm', tipo = 'otro', descripcion = '', pagina = null, fileName = '' } = {}){
  const scale = Number(scaleUnitsPerPixel);
  const validScale = scale > 0;
  let cantidadPropuesta = null;
  if(validScale){
    const raw = mode === 'length' ? polylineLengthPx(points) * scale : polygonAreaPx(points) * (scale * scale);
    cantidadPropuesta = Number.isFinite(raw) && raw > 0 ? Number(raw.toFixed(4)) : null;
  }
  const elemento = {
    tipo,
    descripcion,
    unidad: mode === 'length' ? unit : `${unit}²`,
    cantidadPropuesta,
    confianzaIA: null, // no aplica: es una medicion manual, no una propuesta de IA
    fuenteEscala: validScale ? ESCALA_FUENTES.REFERENCIA_USUARIO : ESCALA_FUENTES.NO_DETERMINADA,
    evidencia: 'Medición manual trazada sobre el plano, escala calibrada por el usuario.',
    origenMedicion: 'trazado_manual',
    pagina,
    fileName,
    // Mismo estado inicial "detectado, pendiente de revision humana" que usa
    // el flujo de IA -- ver PLANO_ELEMENT_STATES en planoReview.js. El nombre
    // del estado es historico (viene del flujo de IA); el motor de revision
    // no distingue el origen para decidir si algo puede convertirse en APU.
    estado: PLANO_ELEMENT_STATES.PROPUESTO_POR_IA
  };
  return enforceScaleRule(elemento);
}
