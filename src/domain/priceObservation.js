/* FASE 3 (aprendizaje progresivo seguro) -- captura de observaciones reales
   de precio. Continua el hilo ya documentado en server/api-lib/_route-
   -technical-memory.mjs (Parte 0) y _route-challenge-decisions.mjs (Parte 2,
   que ya dice explicitamente: "'precio' no tiene un valor corregido claro
   que proponer" -- ese es el hueco que este archivo llena, no con
   correcciones puntuales sino con observaciones agregadas de muchos APUs
   reales).

   Modulo puro (sin Firebase, sin React, sin fetch) -- mismo criterio que
   organization.js/priceStatus.js/priceConfidence.js. La persistencia real
   vive en server/api-lib/_priceObservationsStore.mjs.

   REGLA CENTRAL ("no entrenar con cualquier dato"): isEligibleForObservation
   es la UNICA puerta de entrada -- un renglon ESTIMADO_IA, ASUMIDO o
   REQUIERE_VALIDACION nunca genera una observacion, sin importar que otro
   campo traiga. Ver src/domain/priceStatus.js#PRICE_STATUS y
   src/domain/apuSchema.js#APU_DATA_STATE (las mismas dos fuentes de verdad
   que ya usa el resto del pipeline, no se inventa un tercer vocabulario). */
import { computeSnapshotHash } from './snapshotHash.js';
import { APU_DATA_STATE } from './apuSchema.js';
import { PRICE_STATUS } from './priceStatus.js';

export const PRICE_OBSERVATION_SOURCE = Object.freeze({
  USER_INPUT: 'user_input',
  CATALOG_IMPORT: 'catalog_import',
  PRICE_INTELLIGENCE_WEB: 'price_intelligence_web',
  VERIFIED_QUOTE: 'verified_quote',
});

// Mismos dos estados que ya exige apuSchema.js#validationIssues para
// "VERIFICADO sin proveedor" -- un renglon VERIFICADO o IMPORTADO es el
// unico dato que ya paso por confirmacion humana o catalogo real (ver
// comentario de APU_DATA_STATE en apuSchema.js). PRICE_STATUS.VERIFIED_MARKET
// (Price Intelligence 2.1, con al menos una referencia web ALTO) es la
// tercera puerta de entrada, ya auditada por su propio pipeline de
// equivalencia tecnica (src/lib/technicalMatch.js).
const ELIGIBLE_FUENTE_ESTADOS = Object.freeze([APU_DATA_STATE.VERIFICADO, APU_DATA_STATE.IMPORTADO]);

// Campos que jamas deben aparecer en una observacion de precio, ni siquiera
// por error de quien construye el objeto -- mismo criterio y misma lista
// (adaptada) que FORBIDDEN_FINGERPRINT_KEYS en priceSearchCache.js.
// organizationId SI participa aqui (a diferencia del fingerprint de cache):
// una observacion es un dato PRIVADO de esa organizacion por diseno, nunca
// se comparte tal cual -- lo que nunca debe aparecer es identidad PERSONAL.
const FORBIDDEN_OBSERVATION_KEYS = Object.freeze([
  'uid', 'ownerUid', 'userEmail', 'email', 'clientName', 'client',
  'presupuesto', 'budget', 'cantidadObra', 'quantity', 'cantidad',
]);

export function assertObservationSafe(observation = {}){
  const present = FORBIDDEN_OBSERVATION_KEYS.filter(k => observation[k] !== undefined);
  if(present.length){
    throw new Error(`Observacion de precio intento incluir campo(s) prohibido(s) (identidad personal, nunca parte de una observacion de precio): ${present.join(', ')}.`);
  }
}

/* isEligibleForObservation: puerta unica de calidad. Nunca examina el
   objeto entero del renglon buscando pistas -- solo estas dos senales YA
   calculadas por el pipeline existente (priceStatus.js/materialPriceIntelligence2.js),
   exactamente igual que hace priceStatus.js#derivePriceStatus con las suyas. */
export function isEligibleForObservation(row){
  if(!row) return false;
  if(row.priceStatus === PRICE_STATUS.VERIFIED_MARKET) return true;
  return ELIGIBLE_FUENTE_ESTADOS.includes(row?.fuente?.estado);
}

/* deriveObservationSource: de que TIPO de evidencia salio este precio --
   informativo (uno de los 15 campos pedidos), nunca decide elegibilidad
   (eso ya lo resolvio isEligibleForObservation). */
export function deriveObservationSource(row){
  if(row?.fuente?.estado === APU_DATA_STATE.IMPORTADO) return PRICE_OBSERVATION_SOURCE.CATALOG_IMPORT;
  if(row?.priceStatus === PRICE_STATUS.VERIFIED_MARKET && row?.priceRecord?.selectedReference){
    return PRICE_OBSERVATION_SOURCE.PRICE_INTELLIGENCE_WEB;
  }
  if(row?.fuente?.estado === APU_DATA_STATE.VERIFICADO && row?.fuente?.proveedor){
    return PRICE_OBSERVATION_SOURCE.VERIFIED_QUOTE;
  }
  return PRICE_OBSERVATION_SOURCE.USER_INPUT;
}

// Exportado (FASE 3): server/api-lib/_priceIntelligenceCache.mjs reusa
// EXACTAMENTE esta misma normalizacion para consultar priceRegionalAggregates
// -- si la escritura (aqui) y la lectura normalizaran distinto, la misma
// descripcion/unidad nunca encontraria su propio bucket.
export function fold(value){
  return String(value ?? '').toLowerCase().normalize('NFKC').trim().replace(/\s+/g, ' ');
}

/* isoWeekBucket: agrupa una fecha en su semana ISO ("2026-W07") -- unica
   granularidad temporal usada para deduplicar (ver computeObservationHash).
   No es la fecha que se muestra al usuario (esa es observation.fecha tal
   cual), solo la unidad de "misma semana = mismo evento de captura" para que
   guardar el mismo renglon varias veces en la misma semana no multiplique
   observaciones. */
export function isoWeekBucket(dateInput){
  const d = new Date(dateInput || Date.now());
  if(Number.isNaN(d.getTime())) return null;
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  const weekNumber = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + firstDayNr) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

/* buildPriceObservation: los 13 campos estructurados pedidos (mas id logico
   via computeObservationHash, que se calcula aparte -- regla 4: el hash
   depende del objeto ya construido). Devuelve null cuando el precio no es
   utilizable ($0 o invalido, mismo criterio que priceStatus.js#derivePriceStatus)
   -- nunca una observacion con precio cero. */
export function buildPriceObservation({
  row, kind, priceField, organizationId, location = {}, currency = 'MXN',
  apuId = null, projectId = null, now = () => new Date().toISOString(),
} = {}){
  if(!organizationId) throw new Error('buildPriceObservation requiere organizationId: una observacion de precio SIEMPRE pertenece a la organizacion que la genero, nunca es anonima en este nivel (ver priceRegionalAggregate.js para el nivel que si lo es).');
  if(!row) throw new Error('buildPriceObservation requiere el renglon (row) de origen.');
  const precio = Number(row[priceField]) || 0;
  if(!(precio > 0)) return null;

  const observation = {
    conceptoNormalizado: fold(row.descripcion || ''),
    unidadNormalizada: fold(row.unidad || ''),
    moneda: String(currency || 'MXN').toUpperCase(),
    country: location.country || null,
    state: location.state || null,
    city: location.city || null,
    fecha: row.fuente?.fecha || now(),
    fuente: deriveObservationSource(row),
    proveedor: row.fuente?.proveedor || null,
    organizationId,
    tipoDato: kind,
    nivelValidacion: row.fuente?.estado || (row.priceStatus === PRICE_STATUS.VERIFIED_MARKET ? APU_DATA_STATE.VERIFICADO : APU_DATA_STATE.REQUIERE_VALIDACION),
    confianza: row.priceConfidence || null,
    precio,
    apuId,
    projectId,
    createdAt: now(),
  };
  assertObservationSafe(observation);
  return observation;
}

/* computeObservationHash: identidad de deduplicacion (regla explicita del
   brief). MISMO organizationId + concepto/unidad/ubicacion/moneda + precio
   REDONDEADO (evita duplicados por ruido de centavos) + semana ISO de la
   fecha -- volver a guardar el mismo renglon en la misma semana nunca crea
   una segunda observacion. Reutiliza computeSnapshotHash (snapshotHash.js),
   igual que ya hace priceSearchCache.js -- nunca se reimplementa hashing. */
export async function computeObservationHash(observation){
  const canonical = {
    org: observation.organizationId,
    concepto: observation.conceptoNormalizado,
    unidad: observation.unidadNormalizada,
    country: observation.country,
    state: observation.state,
    city: observation.city,
    moneda: observation.moneda,
    precioRedondeado: Math.round(observation.precio),
    semana: isoWeekBucket(observation.fecha),
  };
  const hash = await computeSnapshotHash(canonical);
  return `po_${hash}`;
}
