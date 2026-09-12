/* Fase 3 (evolucion integral Levantamiento IA): "Propuesta constructiva con
   IA" -- modulo puro, sin React/DOM/Firebase/OpenAI (mismo espiritu que
   apuSchema.js/planoReview.js): solo forma de datos, taxonomia de origen y
   normalizacion determinista del JSON crudo que devuelve el modelo. La
   llamada real a OpenAI vive en server/api-lib/_openaiApuCore.mjs.

   DATA_ORIGIN es la taxonomia pedida explicitamente en el brief (punto 8):
   DETECTADO (observable en la foto/video/3D), PROPORCIONADO (el usuario lo
   escribio/eligio, ej. dimensiones conocidas o el panel de Estilo de Fase 2),
   INFERIDO (relacion confiable a partir de datos DETECTADOS/PROPORCIONADOS,
   ej. superficie = largo x ancho), ESTIMADO (aproximacion de la IA sin
   evidencia directa, requiere validacion). NUNCA se presenta un ESTIMADO ni
   un INFERIDO como si fuera una medida exacta -- ver requiresProfessionalValidation
   y REQUIRES_VALIDATION_FIELDS mas abajo. */

export const DATA_ORIGIN = Object.freeze({
  DETECTADO: 'detectado',
  PROPORCIONADO: 'proporcionado',
  INFERIDO: 'inferido',
  ESTIMADO: 'estimado'
});

/* Punto 33 del brief ("no inventar ingenieria"): estas categorias de
   sistemaConstructivo NUNCA deben presentarse como definitivas cuando su
   contenido depende de estimaciones -- requiresProfessionalValidation se
   activa automaticamente si CUALQUIER dimension no es DETECTADO/PROPORCIONADO,
   o si cimentacion/estructura tienen contenido (siempre requieren validacion
   profesional real, sin importar la confianza de la IA). */
const CRITICAL_SYSTEM_KEYS = Object.freeze(['cimentacion', 'estructura']);

export const CONSTRUCTION_SYSTEM_KEYS = Object.freeze([
  'preliminares', 'cimentacion', 'estructura', 'muros', 'cubierta', 'instalaciones', 'acabados'
]);

function makeDimensionField(){ return { valor: null, origen: null }; }

export function makeEmptyConstructionProposal(){
  return {
    descripcion: '',
    dimensiones: {
      largo: makeDimensionField(), ancho: makeDimensionField(), altura: makeDimensionField(),
      superficie: makeDimensionField(), volumen: makeDimensionField()
    },
    sistemaConstructivo: Object.fromEntries(CONSTRUCTION_SYSTEM_KEYS.map(k => [k, []])),
    requiresProfessionalValidation: true,
    notes: []
  };
}

function normalizeDimension(raw){
  if(!raw || typeof raw !== 'object') return makeDimensionField();
  const valor = Number(raw.valor);
  const origen = Object.values(DATA_ORIGIN).includes(raw.origen) ? raw.origen : null;
  // Un valor sin origen reconocido, o sin numero valido, no es un dato --
  // nunca se inventa un origen "estimado" solo para poder mostrar el numero.
  if(!Number.isFinite(valor) || valor <= 0 || !origen) return makeDimensionField();
  return { valor, origen };
}

function normalizeSystemList(raw){
  if(!Array.isArray(raw)) return [];
  return raw.map(item => String(item || '').trim()).filter(Boolean).slice(0, 12);
}

/* true si CUALQUIER dimension capturada es INFERIDO/ESTIMADO (nunca solo
   DETECTADO/PROPORCIONADO), o si el sistema constructivo declara contenido
   en una categoria critica (cimentacion/estructura) -- estas SIEMPRE
   requieren un profesional real, sin importar que tan segura diga estar la
   IA (punto 33 del brief, "no inventar ingenieria"). */
export function computeRequiresValidation(dimensiones, sistemaConstructivo){
  const dimensionesInciertas = Object.values(dimensiones).some(d => d.valor != null && (d.origen === DATA_ORIGIN.INFERIDO || d.origen === DATA_ORIGIN.ESTIMADO));
  const tieneSistemaCritico = CRITICAL_SYSTEM_KEYS.some(key => (sistemaConstructivo[key] || []).length > 0);
  return dimensionesInciertas || tieneSistemaCritico;
}

/* Normaliza el JSON crudo que devuelve generateConstructionProposal
   (_openaiApuCore.mjs) a la forma canonica -- nunca lanza, nunca inventa un
   campo que el modelo no declaro con un origen valido. Mismo criterio que
   normalizeAIApuToV2: la IA propone, este modulo nunca "completa" datos
   faltantes con valores de relleno. */
export function normalizeConstructionProposal(raw){
  const base = makeEmptyConstructionProposal();
  if(!raw || typeof raw !== 'object') return base;

  const dimensionesRaw = raw.dimensiones || {};
  const dimensiones = {
    largo: normalizeDimension(dimensionesRaw.largo),
    ancho: normalizeDimension(dimensionesRaw.ancho),
    altura: normalizeDimension(dimensionesRaw.altura),
    superficie: normalizeDimension(dimensionesRaw.superficie),
    volumen: normalizeDimension(dimensionesRaw.volumen)
  };
  const sistemaRaw = raw.sistemaConstructivo || {};
  const sistemaConstructivo = Object.fromEntries(
    CONSTRUCTION_SYSTEM_KEYS.map(key => [key, normalizeSystemList(sistemaRaw[key])])
  );

  return {
    descripcion: String(raw.descripcion || '').trim().slice(0, 500),
    dimensiones,
    sistemaConstructivo,
    requiresProfessionalValidation: computeRequiresValidation(dimensiones, sistemaConstructivo),
    notes: Array.isArray(raw.notes) ? raw.notes.map(n => String(n || '').trim()).filter(Boolean).slice(0, 8) : []
  };
}

/* Deriva conceptos de texto (uno por elemento real del sistema
   constructivo) listos para el pipeline YA EXISTENTE de generacion de APU
   (apuGeneration.js#makeAPUFromConcept / server/api-lib/_openaiApuCore.mjs)
   -- este modulo NUNCA genera un APU el mismo, solo arma la lista de
   conceptos a partir de una propuesta ya aprobada por el usuario. Ignora
   categorias vacias; nunca inventa un concepto que la propuesta no listo. */
export function deriveApuConceptsFromProposal(proposal){
  if(!proposal?.sistemaConstructivo) return [];
  const concepts = [];
  for(const key of CONSTRUCTION_SYSTEM_KEYS){
    for(const item of proposal.sistemaConstructivo[key] || []){
      concepts.push({ categoria: key, concept: item });
    }
  }
  return concepts;
}
