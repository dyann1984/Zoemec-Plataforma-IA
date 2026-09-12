/* Fase 2 (evolucion integral Levantamiento IA -> Propuesta con IA): "Estilo y
   materiales" -- preferencias que el usuario declara DESPUES de cargar
   evidencia (foto/video/3D), antes de pedir una propuesta con IA. Modulo
   puro, sin React/DOM/Firebase (mismo espiritu que levantamientoMedia.js):
   solo constantes y funciones deterministas, testeables con node --test.

   Deliberadamente SIN logica de IA todavia -- esta fase solo captura y
   guarda la preferencia del usuario en el propio Survey (PROPORCIONADO,
   nunca INFERIDO/ESTIMADO: es una eleccion explicita, no una deteccion).
   El unico consumidor real de este dato hoy es Fase 3 (Propuesta con IA),
   que lo pasara como contexto al prompt -- este modulo no sabe nada de eso,
   solo define la forma y las opciones. */

export const STYLE_COLOR_OPTIONS = Object.freeze([
  'blanco', 'gris', 'negro', 'beige', 'azul', 'verde'
]);

export const STYLE_MATERIAL_OPTIONS = Object.freeze([
  'concreto', 'block', 'ladrillo', 'madera', 'piedra', 'acero', 'vidrio', 'tablaroca'
]);

export const ARCHITECTURAL_STYLE_OPTIONS = Object.freeze([
  'moderno', 'minimalista', 'industrial', 'contemporaneo', 'residencial', 'comercial'
]);

/* customColorHex: cuando el usuario elige "personalizado" en vez de (o
   ademas de) un color de STYLE_COLOR_OPTIONS -- ambos pueden coexistir
   (ej. "blanco" + un acento personalizado), nunca se excluyen entre si. */
export function makeEmptyStylePreferences(){
  return {
    colors: [],
    customColorHex: null,
    materials: [],
    acabado: '',
    estilo: null
  };
}

function normalizeStringArray(list, validOptions){
  if(!Array.isArray(list)) return [];
  const valid = new Set(validOptions);
  const seen = new Set();
  const result = [];
  for(const raw of list){
    const value = String(raw || '').trim().toLowerCase();
    if(!value || !valid.has(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/* Normaliza cualquier entrada (ej. la que viene de un formulario controlado
   por el usuario) a la forma canonica -- nunca lanza, nunca inventa un
   valor que el usuario no eligio. Colores/materiales desconocidos o
   duplicados se descartan en silencio (mismo criterio que
   validateScanMediaFile: la UI ya restringe las opciones, esto es la
   ultima defensa, no un lugar para reportar errores de UX). */
export function normalizeStylePreferences(raw){
  const base = makeEmptyStylePreferences();
  if(!raw || typeof raw !== 'object') return base;
  const customColorHex = HEX_COLOR_RE.test(String(raw.customColorHex || '')) ? raw.customColorHex.toLowerCase() : null;
  const estilo = ARCHITECTURAL_STYLE_OPTIONS.includes(raw.estilo) ? raw.estilo : null;
  return {
    colors: normalizeStringArray(raw.colors, STYLE_COLOR_OPTIONS),
    customColorHex,
    materials: normalizeStringArray(raw.materials, STYLE_MATERIAL_OPTIONS),
    acabado: String(raw.acabado || '').trim().slice(0, 200),
    estilo
  };
}

/* true si el usuario declaro AL MENOS una preferencia real -- distingue
   "nunca abrio el panel de estilo" (stylePreferences null en el Survey) de
   "lo abrio y no eligio nada" (objeto vacio pero presente); ambos casos
   deben tratarse igual para el resto del sistema (sin evidencia de estilo),
   pero esta funcion es la unica fuente de verdad de esa decision. */
export function hasAnyStylePreference(prefs){
  if(!prefs) return false;
  return prefs.colors.length > 0 || Boolean(prefs.customColorHex) || prefs.materials.length > 0
    || Boolean(prefs.acabado) || Boolean(prefs.estilo);
}
