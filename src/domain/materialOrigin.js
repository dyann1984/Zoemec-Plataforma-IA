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

/* Hotfix 2.1.1 -- BUG B del live test: "tuberia PVC hidraulica" y "cedula
   40" quedaban UNRESOLVED aunque aparecian literalmente en el concepto.
   Causa raiz real (confirmada, no solo bigramas fragiles):
     1. El filtro previo por longitud (>=4) descartaba palabras cortas pero
        significativas como "pvc" -- si esa palabra se sentaba ENTRE dos
        palabras clave de la descripcion ("tuberia [pvc] hidraulica"), el
        bigrama "tuberia hidraulica" dejaba de ser adyacente en el
        concepto y el match fallaba.
     2. normConcept.includes(bigram) comparaba el bigrama (sin puntuacion)
        contra el texto CRUDO del concepto (con comas/puntos intactos):
        "...1 pulgada, cedula 40..." nunca contiene el substring literal
        "pulgada cedula" por la coma de por medio, aunque para cualquier
        lector humano son la misma frase.
   Reemplazo: normalizacion linguistica real (sin acentos, sin puntuacion,
   singular/plural) + comparacion por PALABRAS SIGNIFICATIVAS (stopwords
   excluidas por lista explicita, no por longitud) en vez de bigramas
   fragiles. Sigue siendo determinista -- ninguna similitud difusa,
   ninguna distancia de edicion, solo interseccion de conjuntos de
   palabras ya normalizadas -- y sigue exigiendo mayoria de las palabras
   significativas de la descripcion (nunca una sola palabra generica como
   "tuberia" sola, ver STOPWORDS/EXPLICIT_COVERAGE_THRESHOLD abajo). */
const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'y', 'e', 'o', 'u', 'en', 'con', 'para', 'por', 'a', 'al', 'que',
  'su', 'sus', 'sin', 'entre', 'sobre', 'como', 'se', 'segun', 'cuando'
]);

/* singularize: reduccion morfologica minima y explicita (no un stemmer
   generico) -- solo para que "conexiones"/"conexion", "hidraulicas"/
   "hidraulica" o "necesarias"/"necesaria" comparen igual. Deliberadamente
   conservadora (exige longitud minima antes de recortar) para no mutilar
   palabras cortas reales ("gas", "mas", "tres"). */
function singularize(word){
  if(word.length > 5 && word.endsWith('es')) return word.slice(0, -2);
  if(word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function tokenize(normText){
  return normText.split(/[^a-z0-9]+/).filter(Boolean);
}

function significantWords(normText){
  return tokenize(normText)
    .filter(w => !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .map(singularize);
}

// Mas de la mitad de las palabras significativas de la descripcion deben
// aparecer, literalmente (ya normalizadas), en el concepto. Para
// descripciones de 1-2 palabras esto exige, en la practica, TODAS las
// palabras -- preserva la proteccion original contra un falso EXPLICIT por
// una sola palabra generica compartida (ej. "tuberia" en "electrodo de
// soldadura para tuberia": 1 de 4 palabras significativas, 25% < umbral).
const EXPLICIT_COVERAGE_THRESHOLD = 0.5;

/* Un material es EXPLICIT cuando su descripcion aparece, literalmente o en
   su mayoria de palabras significativas, en el texto del concepto -- no
   requiere IA: es una comprobacion determinista sobre texto normalizado.
   Cubre tanto una frase identica completa ("valvula check" -> concepto
   "...incluye valvula check, coples...") como una descripcion mas
   elaborada generada por IA que agrega calificadores que el concepto no
   repite palabra por palabra (ej. descripcion "Pegamento solvente para
   PVC" contra un concepto que solo dice "...incluye pegamento..."). */
function appearsExplicitlyInConcept(description, concept){
  const normDesc = normalize(description);
  const normConcept = normalize(concept);
  if(!normDesc || !normConcept) return false;
  if(normConcept.includes(normDesc)) return true; // frase completa identica (camino rapido)

  const descWords = significantWords(normDesc);
  if(!descWords.length) return false;
  const conceptWords = new Set(significantWords(normConcept));
  const matched = descWords.filter(w => conceptWords.has(w)).length;
  return matched / descWords.length > EXPLICIT_COVERAGE_THRESHOLD;
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
