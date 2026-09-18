/* Puente "concepto de catalogo -> elemento paramétrico sugerido" (Fase D).
   Hueco confirmado en la auditoria: el Cuantificador Parametrico
   (parametricElements.js/QuantifierWizard.jsx) no tenia ninguna forma de
   sugerirse a si mismo desde un concepto de texto -- el usuario elegia el
   elemento a mano. Este modulo NO reimplementa el cuantificador ni el
   ensamblador (parametricApuAssembler.js): solo puntua, por token, que
   elementos de PARAMETRIC_ELEMENTS coinciden con el texto del concepto, y
   NUNCA auto-selecciona -- la UI solo debe ofrecer "Generar con
   cuantificador" cuando esta funcion devuelve al menos una sugerencia.

   Acotado por capitulo (mapa CAPITULO_A_FAMILIAS): sin esto, un concepto de
   "Acabados" con la palabra suelta "muro" (ej. "aplanado en muro") podria
   sugerir el elemento parametrico "muro" (Albañileria) por puro solape de
   token, una sugerencia sin sentido para ese capitulo. El mapa es
   deliberadamente conservador -- un capitulo sin familia parametrica
   todavia implementada (Instalaciones, Acabados, etc., ver
   PARAMETRIC_FAMILIES) nunca sugiere nada, nunca inventa una familia que no
   existe. */
import { tokenize, jaccard } from '../lib/excelImport.js';
import { PARAMETRIC_ELEMENTS, PARAMETRIC_FAMILIES } from './parametricElements.js';
import { normalizeCapitulo } from './presupuestoCapitulos.js';

const DEFAULT_THRESHOLD = 0.34; // mismo umbral fuzzy_token que catalogLookup.js/apuMatchLookup.js

export const CAPITULO_A_FAMILIAS = Object.freeze({
  CIMENTACION: [PARAMETRIC_FAMILIES.CIMENTACION],
  ESTRUCTURA: [PARAMETRIC_FAMILIES.ESTRUCTURA],
  ALBANILERIA: [PARAMETRIC_FAMILIES.ALBANILERIA]
  // Preliminares/Instalaciones/Acabados/Canceleria-Carpinteria/Obras
  // exteriores/Limpieza/Otros: sin familia parametrica implementada aun --
  // deliberadamente ausentes del mapa, nunca sugieren nada.
});

/* concept: {concept|description, clave, capitulo}. Retorna [] (nunca null)
   cuando no hay ninguna familia habilitada para el capitulo o ningun
   elemento supera el umbral -- la UI trata [] como "no ofrecer el boton". */
export function suggestParametricElements(concept, { threshold = DEFAULT_THRESHOLD } = {}){
  const capitulo = normalizeCapitulo(concept?.capitulo);
  const allowedFamilies = CAPITULO_A_FAMILIAS[capitulo];
  if(!allowedFamilies || !allowedFamilies.length) return [];
  const text = concept?.concept || concept?.description || concept?.clave || '';
  const dt = tokenize(text);
  if(!dt.length) return [];
  const ranked = Object.values(PARAMETRIC_ELEMENTS)
    .filter(el => allowedFamilies.includes(el.family))
    .map(el => ({
      elementId: el.id,
      family: el.family,
      label: el.label,
      score: jaccard(dt, tokenize(`${el.label} ${el.family}`))
    }))
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score);
  return ranked;
}

export function isParametricCompatible(concept, options){
  return suggestParametricElements(concept, options).length > 0;
}
