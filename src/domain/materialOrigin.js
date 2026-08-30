/* Material & Price Intelligence 2.1 -- regla 2: cada material declara su
   origen respecto al concepto/especificacion original. Nunca convierte una
   inferencia tecnica en especificacion contractual (INFERRED_REQUIRED no es
   EXPLICIT), y nunca vuelve obligatorio algo que depende de especificacion
   (OPTIONAL no se auto-promueve). Modulo puro, sin IA ni red -- la IA puede
   PROPONER un origen (aiProposedOrigin), pero este modulo es quien valida
   esa propuesta contra el texto real del concepto y decide el valor final
   guardado en provenance; nunca confia ciegamente en lo que la IA declara. */

export const MATERIAL_ORIGIN = Object.freeze({
  EXPLICIT: 'EXPLICIT',
  INFERRED_REQUIRED: 'INFERRED_REQUIRED',
  OPTIONAL: 'OPTIONAL',
  UNRESOLVED: 'UNRESOLVED'
});

function text(value){ return String(value ?? '').trim(); }
function normalize(value){
  return text(value)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, ''); // quita acentos para comparar de forma estable
}

function substantiveWords(normText){
  return normText.split(/[^a-z0-9]+/).filter(w => w.length >= 4);
}

/* Un material es EXPLICIT cuando su descripcion (o una FRASE reconocible de
   ella) aparece literalmente en el texto del concepto -- no requiere IA: es
   una comprobacion determinista sobre texto normalizado. Deliberadamente NO
   basta con que UNA sola palabra suelta coincida (ej. "tuberia" aparece en
   casi cualquier concepto de plomeria y causaria falsos EXPLICIT en
   materiales que en realidad son inferidos, como un electrodo de soldadura
   para esa tuberia) -- se exige una coincidencia de FRASE: substring
   completo, o al menos un par de palabras sustantivas consecutivas
   (bigrama) de la descripcion presente tal cual en el concepto (cubre
   "valvula check" -> concepto "...incluye valvula check, coples..."). */
function appearsExplicitlyInConcept(description, concept){
  const normDesc = normalize(description);
  const normConcept = normalize(concept);
  if(!normDesc || !normConcept) return false;
  if(normConcept.includes(normDesc)) return true;

  const words = substantiveWords(normDesc);
  for(let i = 0; i < words.length - 1; i++){
    const bigram = `${words[i]} ${words[i + 1]}`;
    if(normConcept.includes(bigram)) return true;
  }
  return false;
}

const VALID_ORIGINS = new Set(Object.values(MATERIAL_ORIGIN));

/* classifyMaterialOrigin: determina el origen final de un material.
   Prioridad:
   1. Si aiProposedOrigin es un valor valido del enum, se respeta (la IA ya
      vio el concepto completo y puede razonar mejor que un substring match
      simple) -- PERO solo si no contradice una comprobacion determinista
      fuerte: nunca se acepta EXPLICIT propuesto por la IA si el texto no
      aparece de verdad en el concepto (evita que la IA declare "explicito"
      algo que en realidad esta infiriendo).
   2. Si no hay propuesta valida, se deriva deterministicamente:
      - aparece en el concepto -> EXPLICIT
      - technicallyRequired:true -> INFERRED_REQUIRED
      - optional:true -> OPTIONAL
      - de lo contrario -> UNRESOLVED (nunca se asume EXPLICIT ni
        INFERRED_REQUIRED sin evidencia). */
export function classifyMaterialOrigin({ description = '', concept = '', aiProposedOrigin = null, technicallyRequired = false, optional = false } = {}){
  const explicitByText = appearsExplicitlyInConcept(description, concept);

  if(aiProposedOrigin && VALID_ORIGINS.has(aiProposedOrigin)){
    if(aiProposedOrigin === MATERIAL_ORIGIN.EXPLICIT && !explicitByText){
      // La IA declaro EXPLICIT pero el texto no lo respalda: se degrada a
      // INFERRED_REQUIRED (si se marco tecnicamente necesario) o UNRESOLVED,
      // nunca se acepta una afirmacion de "especificado literalmente" sin
      // poder verificarla.
      return technicallyRequired ? MATERIAL_ORIGIN.INFERRED_REQUIRED : MATERIAL_ORIGIN.UNRESOLVED;
    }
    return aiProposedOrigin;
  }

  if(explicitByText) return MATERIAL_ORIGIN.EXPLICIT;
  if(technicallyRequired) return MATERIAL_ORIGIN.INFERRED_REQUIRED;
  if(optional) return MATERIAL_ORIGIN.OPTIONAL;
  return MATERIAL_ORIGIN.UNRESOLVED;
}

/* Etiqueta visible (UI/Excel/PDF), igual espiritu que apuDataStateLabel en
   apuSchema.js: nunca mostrar un codigo interno crudo al usuario final. */
export const MATERIAL_ORIGIN_LABEL = Object.freeze({
  [MATERIAL_ORIGIN.EXPLICIT]: 'Especificado en el concepto',
  [MATERIAL_ORIGIN.INFERRED_REQUIRED]: 'Requerido tecnicamente (inferido)',
  [MATERIAL_ORIGIN.OPTIONAL]: 'Depende de especificacion/proyecto',
  [MATERIAL_ORIGIN.UNRESOLVED]: 'Sin informacion suficiente'
});
export function materialOriginLabel(origin){
  return MATERIAL_ORIGIN_LABEL[origin] || MATERIAL_ORIGIN_LABEL[MATERIAL_ORIGIN.UNRESOLVED];
}
