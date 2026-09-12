/* Croquis tecnico automatico para el Cuantificador Parametrico ZOEMEC
   (Fase B). Puro: regresa descriptores de dibujo (rect/line/text/circle en
   coordenadas de "unidades de dibujo" = metros reales + margen), nunca
   JSX/SVG directamente -- src/features/quantifier/ElementSketch.jsx es
   quien los convierte a SVG. Misma TECNICA que
   src/features/levantamiento/SpaceFloorPlan2D.jsx (SVG con viewBox
   proporcional al tamano real, fuente/grosor escalados por dimension
   maxima, sin libreria de dibujo) -- pero NO el componente en si, porque
   ese esta atado a la geometria de una `Space` (habitacion rectangular con
   4 muros), no a un elemento parametrico (zapata/columna/muro).

   IMPORTANTE (pedido explicito): esto es un "detalle tecnico parametrico",
   NUNCA un plano estructural ejecutivo -- la etiqueta correspondiente vive
   en el componente de render (ElementSketch.jsx), no aqui.

   Los builders de cada elemento reciben `params` YA RESUELTOS (default o
   override, ver resolveParams en parametricElements.js) -- nunca declaran
   su propio valor por defecto por separado, para que el croquis jamas
   pueda desincronizarse de los valores que de verdad produjeron las
   cantidades del APU (unica fuente de verdad: PARAMETRIC_ELEMENTS). Solo
   buildElementSketch() (el punto de entrada publico) resuelve los
   parametros crudos del wizard antes de despachar. */
import { PARAMETRIC_ELEMENTS, resolveParams } from './parametricElements.js';

const INK = 'var(--ink,#1a1a1a)';
const MUTED = 'var(--muted,#888)';
const REBAR = 'var(--danger,#c0392b)';

function fmt(n){ return (Number(n) || 0).toFixed(2); }
function view(id, label, width, height, elements){ return { id, label, width, height, elements }; }
function dimText(x, y, text, size, fill = INK){ return { type: 'text', x, y, text, size, anchor: 'middle', fill }; }

/* Planta (largo x ancho) + Seccion (ancho x peralte, con dado simplificado
   y armado inferior indicado con puntos -- nunca una posicion de varilla
   exacta, es indicativo). */
export function buildZapataAisladaSketch(inputs = {}){
  const largo = Number(inputs.largo) || 0, ancho = Number(inputs.ancho) || 0, peralte = Number(inputs.peralte) || 0;
  if(!(largo > 0) || !(ancho > 0) || !(peralte > 0)) return [];
  const maxPlanta = Math.max(largo, ancho, 0.5);
  const padP = maxPlanta * 0.3 + 0.25;
  const fontP = maxPlanta * 0.09;
  const strokeP = maxPlanta * 0.015;

  const planta = view('planta', 'Planta', largo + padP * 2, ancho + padP * 2, [
    { type: 'rect', x: padP, y: padP, w: largo, h: ancho, fill: 'none', stroke: INK, strokeWidth: strokeP },
    dimText(padP + largo / 2, padP - padP * 0.25, `${fmt(largo)} m`, fontP),
    dimText(padP * 0.4, padP + ancho / 2, `${fmt(ancho)} m`, fontP),
    dimText(padP + largo / 2, padP + ancho / 2, 'ZAPATA AISLADA', fontP * 0.8, MUTED)
  ]);

  const dadoW = Math.min(ancho * 0.4, 0.4), dadoH = Math.max(peralte * 0.6, 0.15);
  const maxSeccion = Math.max(ancho, peralte + dadoH, 0.5);
  const padS = maxSeccion * 0.3 + 0.25;
  const fontS = maxSeccion * 0.09;
  const strokeS = maxSeccion * 0.02;
  const baseY = padS + dadoH;
  const seccion = view('seccion', 'Sección', ancho + padS * 2, peralte + dadoH + padS * 2, [
    { type: 'rect', x: padS, y: baseY, w: ancho, h: peralte, fill: 'none', stroke: INK, strokeWidth: strokeS },
    { type: 'rect', x: padS + ancho / 2 - dadoW / 2, y: padS, w: dadoW, h: dadoH, fill: 'none', stroke: INK, strokeWidth: strokeS },
    ...[0.15, 0.5, 0.85].map(t => ({ type: 'circle', cx: padS + ancho * t, cy: baseY + peralte - peralte * 0.15, r: maxSeccion * 0.018, fill: REBAR })),
    dimText(padS + ancho / 2, baseY + peralte + padS * 0.35, `${fmt(peralte)} m`, fontS),
    dimText(padS + ancho + padS * 0.55, baseY + peralte / 2, `${fmt(ancho)} m`, fontS * 0.85)
  ]);

  return [planta, seccion];
}

/* Planta (largo x ancho) + Seccion (ancho x peralte, SIN dado -- a
   diferencia de zapata_aislada, una zapata CORRIDA no tiene un pedestal
   de columna encima, es continua bajo un muro). */
export function buildZapataCorridaSketch(inputs = {}){
  const largo = Number(inputs.largo) || 0, ancho = Number(inputs.ancho) || 0, peralte = Number(inputs.peralte) || 0;
  if(!(largo > 0) || !(ancho > 0) || !(peralte > 0)) return [];
  const maxPlanta = Math.max(largo, ancho, 0.5);
  const padP = maxPlanta * 0.25 + 0.25;
  const fontP = maxPlanta * 0.07;
  const strokeP = maxPlanta * 0.012;
  const planta = view('planta', 'Planta', largo + padP * 2, ancho + padP * 2, [
    { type: 'rect', x: padP, y: padP, w: largo, h: ancho, fill: 'none', stroke: INK, strokeWidth: strokeP },
    dimText(padP + largo / 2, padP - padP * 0.25, `${fmt(largo)} m`, fontP),
    dimText(padP * 0.4, padP + ancho / 2, `${fmt(ancho)} m`, fontP),
    dimText(padP + largo / 2, padP + ancho / 2, 'ZAPATA CORRIDA', fontP * 0.85, MUTED)
  ]);

  const maxSeccion = Math.max(ancho, peralte, 0.4);
  const padS = maxSeccion * 0.35 + 0.2;
  const fontS = maxSeccion * 0.1;
  const strokeS = maxSeccion * 0.025;
  const seccion = view('seccion', 'Sección', ancho + padS * 2, peralte + padS * 2, [
    { type: 'rect', x: padS, y: padS, w: ancho, h: peralte, fill: 'none', stroke: INK, strokeWidth: strokeS },
    ...[0.15, 0.5, 0.85].map(t => ({ type: 'circle', cx: padS + ancho * t, cy: padS + peralte - peralte * 0.2, r: maxSeccion * 0.02, fill: REBAR })),
    dimText(padS + ancho / 2, padS + peralte + padS * 0.35, `${fmt(peralte)} m`, fontS),
    dimText(padS + ancho + padS * 0.55, padS + peralte / 2, `${fmt(ancho)} m`, fontS * 0.85)
  ]);
  return [planta, seccion];
}

/* Planta (largo x ancho) + Seccion delgada (espesor, con DOBLE parrilla de
   acero -- superior e inferior, la forma real de una losa de
   cimentacion). */
export function buildLosaCimentacionSketch(inputs = {}){
  const largo = Number(inputs.largo) || 0, ancho = Number(inputs.ancho) || 0, espesor = Number(inputs.espesor) || 0;
  if(!(largo > 0) || !(ancho > 0) || !(espesor > 0)) return [];
  const maxPlanta = Math.max(largo, ancho, 0.5);
  const padP = maxPlanta * 0.25 + 0.25;
  const fontP = maxPlanta * 0.07;
  const strokeP = maxPlanta * 0.012;
  const planta = view('planta', 'Planta', largo + padP * 2, ancho + padP * 2, [
    { type: 'rect', x: padP, y: padP, w: largo, h: ancho, fill: 'none', stroke: INK, strokeWidth: strokeP },
    dimText(padP + largo / 2, padP - padP * 0.25, `${fmt(largo)} m`, fontP),
    dimText(padP * 0.4, padP + ancho / 2, `${fmt(ancho)} m`, fontP),
    dimText(padP + largo / 2, padP + ancho / 2, 'LOSA DE CIMENTACIÓN', fontP * 0.85, MUTED)
  ]);

  const maxSeccion = Math.max(ancho, espesor * 4, 0.5); // espesor real de una losa suele ser mucho menor que su ancho -- se exagera x4 solo para que la seccion sea visible, nunca a escala real
  const padS = maxSeccion * 0.3 + 0.2;
  const fontS = maxSeccion * 0.08;
  const strokeS = maxSeccion * 0.02;
  const espesorDibujado = Math.max(espesor, maxSeccion * 0.08);
  const seccion = view('seccion', 'Sección (espesor exagerado para claridad)', ancho + padS * 2, espesorDibujado + padS * 2, [
    { type: 'rect', x: padS, y: padS, w: ancho, h: espesorDibujado, fill: 'none', stroke: INK, strokeWidth: strokeS },
    ...[0.1, 0.3, 0.5, 0.7, 0.9].map(t => ({ type: 'circle', cx: padS + ancho * t, cy: padS + espesorDibujado * 0.18, r: maxSeccion * 0.012, fill: REBAR })),
    ...[0.1, 0.3, 0.5, 0.7, 0.9].map(t => ({ type: 'circle', cx: padS + ancho * t, cy: padS + espesorDibujado * 0.82, r: maxSeccion * 0.012, fill: REBAR })),
    dimText(padS + ancho / 2, padS + espesorDibujado + padS * 0.35, `espesor real: ${fmt(espesor)} m`, fontS)
  ]);
  return [planta, seccion];
}

/* Seccion TRANSVERSAL trapezoidal (base mas ancha que la corona -- la
   forma real de un cimiento de piedra, nunca un rectangulo). Unico
   elemento del Cuantificador que usa el primitivo 'polygon'. */
export function buildCimientoPiedraSketch(inputs = {}){
  const anchoBase = Number(inputs.anchoBase) || 0, anchoCorona = Number(inputs.anchoCorona) || 0, altura = Number(inputs.altura) || 0;
  if(!(anchoBase > 0) || !(anchoCorona > 0) || !(altura > 0)) return [];
  const maxDim = Math.max(anchoBase, altura, 0.4);
  const pad = maxDim * 0.35 + 0.2;
  const font = maxDim * 0.1;
  const stroke = maxDim * 0.02;
  const width = anchoBase + pad * 2, height = altura + pad * 2;
  const baseY = pad + altura;
  const xBaseIzq = pad, xBaseDer = pad + anchoBase; // la base ocupa todo el ancho dibujado, es la referencia
  const xCoronaIzq = pad + (anchoBase - anchoCorona) / 2;
  const xCoronaDer = xCoronaIzq + anchoCorona;
  const points = [
    [xBaseIzq, baseY], [xBaseDer, baseY], [xCoronaDer, pad], [xCoronaIzq, pad]
  ];
  const seccion = view('seccion-transversal', 'Sección transversal (trapezoidal)', width, height, [
    { type: 'polygon', points, fill: 'none', stroke: INK, strokeWidth: stroke },
    dimText(pad + anchoBase / 2, baseY + pad * 0.35, `${fmt(anchoBase)} m (base)`, font),
    dimText(pad + anchoBase / 2, pad - pad * 0.2, `${fmt(anchoCorona)} m (corona)`, font * 0.9),
    dimText(xBaseDer + pad * 0.55, pad + altura / 2, `${fmt(altura)} m`, font * 0.85),
    dimText(pad + anchoBase / 2, pad + altura / 2, 'CIMIENTO DE PIEDRA', font * 0.75, MUTED)
  ]);
  return [seccion];
}

/* Planta unica (largo x ancho) -- una plantilla es una capa delgada sin
   seccion propia relevante (su espesor tipico, 5-10cm, no aporta nada
   visible a esta escala); se anota como texto en vez de dibujar una
   seccion casi invisible. */
export function buildPlantillaSketch(inputs = {}){
  const largo = Number(inputs.largo) || 0, ancho = Number(inputs.ancho) || 0, espesor = Number(inputs.espesor) || 0;
  if(!(largo > 0) || !(ancho > 0) || !(espesor > 0)) return [];
  const maxPlanta = Math.max(largo, ancho, 0.5);
  const pad = maxPlanta * 0.25 + 0.25;
  const font = maxPlanta * 0.07;
  const stroke = maxPlanta * 0.012;
  const planta = view('planta', 'Planta', largo + pad * 2, ancho + pad * 2, [
    { type: 'rect', x: pad, y: pad, w: largo, h: ancho, fill: 'none', stroke: INK, strokeWidth: stroke },
    dimText(pad + largo / 2, pad - pad * 0.25, `${fmt(largo)} m`, font),
    dimText(pad * 0.4, pad + ancho / 2, `${fmt(ancho)} m`, font),
    dimText(pad + largo / 2, pad + ancho / 2, `PLANTILLA (espesor ${fmt(espesor)} m)`, font * 0.85, MUTED)
  ]);
  return [planta];
}

/* Elevacion (base x altura, con varillas longitudinales + estribos
   indicados) + una pequena Seccion transversal (base x peralte, con un
   punto de armado por esquina -- indicativo, no la disposicion real). */
export function buildColumnaSketch(inputs = {}, params = {}){
  const base = Number(inputs.base) || 0, peralte = Number(inputs.peralte) || 0, altura = Number(inputs.altura) || 0;
  if(!(base > 0) || !(peralte > 0) || !(altura > 0)) return [];
  const numVarillas = Math.max(2, Number(params.numVarillasLongitudinales) || 4);
  const separacionEstribos = Number(params.separacionEstribos) || 0.20;

  const maxElev = Math.max(base, altura, 0.5);
  const padE = maxElev * 0.18 + 0.25;
  const fontE = maxElev * 0.055;
  const strokeE = maxElev * 0.012;
  const numEstribos = Math.min(20, Math.max(2, Math.round(altura / separacionEstribos)));
  const elevacionElements = [
    { type: 'rect', x: padE, y: padE, w: base, h: altura, fill: 'none', stroke: INK, strokeWidth: strokeE },
    ...Array.from({ length: Math.min(numVarillas, 6) }, (_, i) => {
      const t = Math.min(numVarillas, 6) === 1 ? 0.5 : i / (Math.min(numVarillas, 6) - 1);
      const x = padE + base * (0.12 + t * 0.76);
      return { type: 'line', x1: x, y1: padE + altura * 0.03, x2: x, y2: padE + altura * 0.97, stroke: REBAR, strokeWidth: strokeE * 0.6 };
    }),
    ...Array.from({ length: numEstribos }, (_, i) => {
      const y = padE + (i + 0.5) * (altura / numEstribos);
      return { type: 'line', x1: padE + base * 0.06, y1: y, x2: padE + base * 0.94, y2: y, stroke: REBAR, strokeWidth: strokeE * 0.4 };
    }),
    dimText(padE + base / 2, padE - padE * 0.2, `${fmt(base)} m`, fontE),
    dimText(padE - padE * 0.5, padE + altura / 2, `${fmt(altura)} m`, fontE),
    dimText(padE + base / 2, padE + altura + padE * 0.4, 'COLUMNA', fontE * 0.9, MUTED)
  ];
  const elevacion = view('elevacion', 'Elevación', base + padE * 2, altura + padE * 1.6, elevacionElements);

  const maxSec = Math.max(base, peralte, 0.3);
  const padS = maxSec * 0.35 + 0.15;
  const fontS = maxSec * 0.12;
  const strokeS = maxSec * 0.02;
  const corners = [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]];
  const seccion = view('seccion-t', 'Sección transversal', base + padS * 2, peralte + padS * 2, [
    { type: 'rect', x: padS, y: padS, w: base, h: peralte, fill: 'none', stroke: INK, strokeWidth: strokeS },
    ...corners.map(([tx, ty]) => ({ type: 'circle', cx: padS + base * tx, cy: padS + peralte * ty, r: maxSec * 0.03, fill: REBAR })),
    dimText(padS + base / 2, padS - padS * 0.25, `${fmt(base)} m`, fontS),
    dimText(padS + base + padS * 0.45, padS + peralte / 2, `${fmt(peralte)} m`, fontS * 0.85)
  ]);

  return [elevacion, seccion];
}

/* Elevacion (largo x altura) con aparejo (hiladas de block) esquematico --
   nunca dibuja una abertura en una posicion especifica que no se capturo
   (solo se conoce el area agregada de vanos, no su ubicacion real): se
   declara como nota de texto en vez de fabricar una posicion. */
export function buildMuroSketch(inputs = {}, params = {}){
  const largo = Number(inputs.largo) || 0, altura = Number(inputs.altura) || 0;
  const areaVanos = Number(inputs.areaVanos) || 0;
  if(!(largo > 0) || !(altura > 0)) return [];
  const altoBlock = Number(params.altoBlock) || 0.19;
  const espesorJunta = Number(params.espesorJunta) || 0.015;
  const maxDim = Math.max(largo, altura, 0.5);
  const pad = maxDim * 0.16 + 0.3;
  const font = maxDim * 0.05;
  const stroke = maxDim * 0.01;
  const hiladaAltura = altoBlock + espesorJunta;
  const numHiladas = Math.min(30, Math.max(1, Math.round(altura / hiladaAltura)));

  const elements = [
    { type: 'rect', x: pad, y: pad, w: largo, h: altura, fill: 'none', stroke: INK, strokeWidth: stroke },
    ...Array.from({ length: numHiladas - 1 }, (_, i) => {
      const y = pad + (i + 1) * (altura / numHiladas);
      return { type: 'line', x1: pad, y1: y, x2: pad + largo, y2: y, stroke: MUTED, strokeWidth: stroke * 0.5 };
    }),
    dimText(pad + largo / 2, pad - pad * 0.2, `${fmt(largo)} m`, font),
    dimText(pad - pad * 0.5, pad + altura / 2, `${fmt(altura)} m`, font),
    dimText(pad + largo / 2, pad + altura + pad * 0.4, 'MURO (elevación esquemática)', font * 0.85, MUTED)
  ];
  if(areaVanos > 0){
    elements.push({ type: 'text', x: pad + largo / 2, y: pad + altura + pad * 0.75, text: `Incluye ${fmt(areaVanos)} m² de vanos (posición no capturada por este cuantificador)`, size: font * 0.7, anchor: 'middle', fill: MUTED });
  }
  return [view('elevacion', 'Elevación esquemática', largo + pad * 2, altura + pad * 1.9, elements)];
}

export function buildElementSketch(elementId, inputs, params){
  const elementDef = PARAMETRIC_ELEMENTS[elementId];
  if(!elementDef) return [];
  const resolvedParams = resolveParams(elementDef.params, params);
  if(elementId === 'zapata_aislada') return buildZapataAisladaSketch(inputs);
  if(elementId === 'zapata_corrida') return buildZapataCorridaSketch(inputs);
  if(elementId === 'losa_cimentacion') return buildLosaCimentacionSketch(inputs);
  if(elementId === 'cimiento_piedra') return buildCimientoPiedraSketch(inputs);
  if(elementId === 'plantilla') return buildPlantillaSketch(inputs);
  if(elementId === 'columna') return buildColumnaSketch(inputs, resolvedParams);
  if(elementId === 'muro') return buildMuroSketch(inputs, resolvedParams);
  return [];
}
