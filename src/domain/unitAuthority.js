/* Material & Price Intelligence 2.1 -- regla 1 del hardening: concepto,
   unidad, cantidad y clave capturados EXPLICITAMENTE por el usuario son
   AUTHORITATIVE USER INPUT. La IA nunca los sobreescribe en silencio (bug
   real observado: usuario capturo unidad "m", la IA la reemplazo por "pza"
   sin aviso). Este modulo es la UNICA puerta por la que un valor propuesto
   por IA puede llegar al draft final -- si el usuario ya capturo el campo,
   gana el usuario, punto; la propuesta de la IA sobrevive solo como
   UNIT_WARNING para que un humano decida. Modulo puro, sin IA ni red. */

const AUTHORITATIVE_FIELDS = Object.freeze(['concept', 'unit', 'qty', 'clave']);

function text(value){ return String(value ?? '').trim(); }
function hasUserValue(value){ return text(value).length > 0; }

/* Un mismatch de unidad es real solo si, tras normalizar mayusculas/acentos
   basicos, las dos cadenas difieren -- "m" vs "M" o "m2" vs "m²" no deben
   generar una advertencia falsa. */
function normalizeUnitForCompare(value){
  return text(value).toLowerCase().replace(/[²]/g, '2').replace(/[³]/g, '3').replace(/\s+/g, '');
}

/* resolveAuthoritativeInput: combina lo que el usuario capturo explicitamente
   (userInput) con lo que la IA propuso (aiProposed). Reglas:
   - Si el usuario capturo un campo (concept/unit/qty/clave), ese valor se
     conserva SIEMPRE en el resultado, sin importar que proponga la IA.
   - Si la IA propone una unidad distinta a la capturada por el usuario, se
     genera un UNIT_WARNING (nunca se aplica la propuesta automaticamente).
   - Si el usuario NO capturo un campo, se usa la propuesta de la IA tal
     cual (comportamiento actual, sin cambios: la IA sigue proponiendo todo
     lo que el usuario no especifico).
   Devuelve { resolved, unitWarning, overriddenFields } -- overriddenFields
   lista, para auditoria, que campos de la IA fueron descartados por venir
   de un campo ya capturado por el usuario. */
export function resolveAuthoritativeInput({ userInput = {}, aiProposed = {} } = {}){
  const resolved = { ...aiProposed };
  const overriddenFields = [];
  let unitWarning = null;

  for(const field of AUTHORITATIVE_FIELDS){
    const userValue = userInput[field];
    const userCaptured = field === 'qty' ? Number(userValue) > 0 : hasUserValue(userValue);
    if(!userCaptured) continue;

    const aiValue = aiProposed[field];
    const aiProvided = field === 'qty' ? Number(aiValue) > 0 : hasUserValue(aiValue);

    if(field === 'unit' && aiProvided && normalizeUnitForCompare(aiValue) !== normalizeUnitForCompare(userValue)){
      unitWarning = {
        capturedUnit: text(userValue),
        suggestedUnit: text(aiValue),
        reason: aiProposed.unitWarningReason
          ? text(aiProposed.unitWarningReason)
          : `La IA detecto una unidad tecnica distinta ("${text(aiValue)}") a la capturada por el usuario ("${text(userValue)}"). Se conservo la unidad del usuario; la decision final debe ser humana.`,
        confidence: Number.isFinite(Number(aiProposed.unitWarningConfidence)) ? Number(aiProposed.unitWarningConfidence) : null
      };
    }

    const aiDiffers = field === 'unit'
      ? aiProvided && normalizeUnitForCompare(aiValue) !== normalizeUnitForCompare(userValue)
      : aiProvided && aiValue !== userValue;
    if(aiDiffers) overriddenFields.push(field);
    resolved[field] = userValue;
  }

  return { resolved, unitWarning, overriddenFields };
}
