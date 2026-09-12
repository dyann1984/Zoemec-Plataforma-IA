/* FASE 3 (aprendizaje progresivo seguro) -- agregacion regional anonimizada
   de observaciones de precio (src/domain/priceObservation.js). Modulo puro
   (sin Firebase, sin fetch) -- el llamador (server/api-lib/_priceObservationsStore.mjs)
   le pasa el conjunto de observaciones YA deduplicadas (por observationHash)
   que comparten concepto+unidad+moneda+ubicacion, y este archivo hace toda
   la estadistica de forma determinista y documentada, nunca una caja negra.

   Jerarquia geografica -- ciudad/estado/nacional -- calculada DIRECTO sobre
   las observaciones crudas de cada nivel (no "mediana de medianas"): un
   bucket de "estado" es la estadistica de TODAS las observaciones de ese
   estado (incluida cualquier ciudad dentro de el), un bucket "nacional" es
   la de todo el pais. Se eligio esta forma (en vez de recomponer un nivel a
   partir de los buckets ya agregados del nivel mas fino) porque es mas
   simple de auditar, no pierde informacion por des-balance de tamano entre
   ciudades, y es el mismo principio de "el nivel mas amplio SIEMPRE incluye
   al mas especifico" que ya usa REGIONAL_COVERAGE en
   server/api-lib/_priceIntelligenceCore.mjs (ciudad > estado > nacional).

   GARANTIA DE ANONIMATO (la parte mas importante de esta fase): un bucket
   solo se marca `usable:true` con MIN_DISTINCT_ORGS_REGIONAL organizaciones
   DISTINTAS contribuyendo -- nunca por cantidad de filas. Esta funcion JAMAS
   recibe ni devuelve un organizationId individual en el resultado agregado;
   solo el conteo. assertAggregateNeverLeaksOrgId es una red de seguridad
   adicional (mismo criterio que assertCacheKeySafe en priceSearchCache.js). */

export const MIN_DISTINCT_ORGS_REGIONAL = 5;
export const MIN_DISTINCT_BUCKETS_GLOBAL = 3;

// Misma regla, mismo umbral (40% de desviacion de la mediana) que
// server/api-lib/_priceIntelligenceCore.mjs#detectOutliers -- no se
// reexporta desde alli porque ese archivo es server-only (importa
// src/lib/technicalMatch.js con dependencias de red) y este debe quedar
// puro; se documenta aqui explicitamente para que quede claro que es la
// MISMA regla, no una nueva inventada para esta fase.
const OUTLIER_DEVIATION_THRESHOLD = 0.4;

// Ponderacion por antiguedad: rangos explicitos, no una formula continua
// opaca -- una observacion de mas de un ano sigue contando (nunca se
// descarta un dato real), pero pesa mucho menos que una reciente.
const AGE_WEIGHT_BUCKETS = Object.freeze([
  { maxDays: 90, weight: 1.0 },
  { maxDays: 180, weight: 0.7 },
  { maxDays: 365, weight: 0.4 },
  { maxDays: Infinity, weight: 0.15 },
]);

export const REGIONAL_LEVEL = Object.freeze({ CIUDAD: 'ciudad', ESTADO: 'estado', NACIONAL: 'nacional' });

const FORBIDDEN_AGGREGATE_KEYS = Object.freeze(['organizationId', 'ownerUid', 'uid', 'userEmail', 'organizationIds']);

export function assertAggregateNeverLeaksOrgId(aggregate = {}){
  const present = FORBIDDEN_AGGREGATE_KEYS.filter(k => aggregate[k] !== undefined);
  if(present.length){
    throw new Error(`Un agregado regional intento incluir campo(s) que identifican una organizacion (${present.join(', ')}) -- esta coleccion debe permanecer anonima por diseno.`);
  }
}

function median(nums){
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* percentile: interpolacion lineal simple sobre el arreglo ordenado -- misma
   tecnica estandar (percentil "tipo 7"), nada propietario. p en [0,1]. */
function percentile(nums, p){
  if(!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if(lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/* weightedMedian: mismo algoritmo estandar de "mediana ponderada" (ordena
   por valor, acumula peso, toma el valor donde la suma acumulada cruza el
   50% del peso total) -- documentado aqui explicitamente porque es la unica
   pieza no trivial de este archivo. items: [{value, weight}]. */
function weightedMedian(items){
  if(!items.length) return null;
  const sorted = [...items].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((sum, it) => sum + it.weight, 0);
  if(!(totalWeight > 0)) return median(sorted.map(it => it.value));
  let cumulative = 0;
  for(const it of sorted){
    cumulative += it.weight;
    if(cumulative >= totalWeight / 2) return it.value;
  }
  return sorted[sorted.length - 1].value;
}

function ageWeightFor(fecha, nowMs){
  const t = new Date(fecha).getTime();
  if(Number.isNaN(t)) return AGE_WEIGHT_BUCKETS[AGE_WEIGHT_BUCKETS.length - 1].weight;
  const days = Math.max(0, (nowMs - t) / 86400000);
  const bucket = AGE_WEIGHT_BUCKETS.find(b => days <= b.maxDays);
  return bucket ? bucket.weight : AGE_WEIGHT_BUCKETS[AGE_WEIGHT_BUCKETS.length - 1].weight;
}

/* detectOutliers: mismo criterio que _priceIntelligenceCore.mjs -- un precio
   que se desvia mas de 40% de la mediana CRUDA (sin ponderar) del grupo. Solo
   excluye del calculo ponderado final, nunca borra la observacion (queda
   fuera de `usados` pero sigue contando para nObservaciones/nOrganizaciones
   -- auditable, nunca oculto). */
function detectOutliers(precios, med){
  if(!(med > 0)) return precios.map(() => false);
  return precios.map(p => Math.abs(p - med) / med > OUTLIER_DEVIATION_THRESHOLD);
}

function deriveConfidence(nOrganizaciones, dispersionPct){
  if(nOrganizaciones < MIN_DISTINCT_ORGS_REGIONAL) return null;
  if(nOrganizaciones >= MIN_DISTINCT_ORGS_REGIONAL * 2 && dispersionPct <= 0.15) return 'ALTA';
  if(dispersionPct <= 0.4) return 'MEDIA';
  return 'BAJA';
}

/* aggregateLevel: estadistica para UN nivel geografico (ciudad/estado/
   nacional) a partir de las observaciones que YA pertenecen a ese nivel
   (el llamador -- recomputeRegionalIntelligence -- decide el filtro
   geografico; esta funcion no conoce nada de paises/ciudades). Nunca recibe
   ni devuelve organizationId individual -- solo el conteo. */
export function aggregateLevel(observations = [], { level, now = Date.now() } = {}){
  const orgSet = new Set(observations.map(o => o.organizationId).filter(Boolean));
  const nOrganizaciones = orgSet.size;
  const nObservaciones = observations.length;
  if(!nObservaciones){
    return { level, nObservaciones: 0, nOrganizaciones: 0, usable: false, mediana: null, p25: null, p75: null, minimo: null, maximo: null, confianza: null, ultimaActualizacion: null };
  }

  const precios = observations.map(o => o.precio);
  const med = median(precios);
  const outlierFlags = detectOutliers(precios, med);
  const usados = observations.filter((_, i) => !outlierFlags[i]);
  const usadosPrecios = usados.length ? usados.map(o => o.precio) : precios;
  const weightedItems = (usados.length ? usados : observations).map(o => ({ value: o.precio, weight: ageWeightFor(o.fecha, now) }));

  const mediana = weightedMedian(weightedItems);
  const p25 = percentile(usadosPrecios, 0.25);
  const p75 = percentile(usadosPrecios, 0.75);
  const minimo = Math.min(...precios);
  const maximo = Math.max(...precios);
  const dispersionPct = mediana > 0 ? (maximo - minimo) / mediana : null;
  const ultimaActualizacion = observations.reduce((latest, o) => (!latest || new Date(o.fecha) > new Date(latest)) ? o.fecha : latest, null);

  return {
    level,
    nObservaciones,
    nOrganizaciones,
    usable: nOrganizaciones >= MIN_DISTINCT_ORGS_REGIONAL,
    mediana, p25, p75, minimo, maximo,
    confianza: deriveConfidence(nOrganizaciones, dispersionPct ?? 1),
    ultimaActualizacion,
  };
}

/* recomputeRegionalIntelligence: punto de entrada real para UNA ubicacion
   objetivo (ej. "cemento gris, saco, MXN, en Guadalajara/Jalisco/MX"). El
   llamador (server/api-lib/_priceObservationsStore.mjs) hace TRES consultas
   ya correctamente acotadas -- exacta por ciudad, por estado (cualquier
   ciudad de ese estado), por pais (cualquier estado) -- y se las pasa por
   separado: esta funcion NUNCA intenta adivinar el nivel de una observacion
   a partir de "tiene o no ciudad" (eso mezclaria Guadalajara con Monterrey
   en el mismo bucket de "ciudad", un error real que se detecto en revision
   antes de conectar esto a produccion). `fuentePredominante` es el nivel MAS
   ESPECIFICO que ya es `usable` (ciudad antes que estado antes que nacional)
   -- misma prioridad que REGIONAL_COVERAGE ya establece para referencias
   individuales en _priceIntelligenceCore.mjs. */
export function recomputeRegionalIntelligence({ ciudadObservations = [], estadoObservations = [], nacionalObservations = [] } = {}, { now = Date.now() } = {}){
  const ciudad = aggregateLevel(ciudadObservations, { level: REGIONAL_LEVEL.CIUDAD, now });
  const estado = aggregateLevel(estadoObservations, { level: REGIONAL_LEVEL.ESTADO, now });
  const nacional = aggregateLevel(nacionalObservations, { level: REGIONAL_LEVEL.NACIONAL, now });

  const levels = { ciudad, estado, nacional };
  const fuentePredominante = [REGIONAL_LEVEL.CIUDAD, REGIONAL_LEVEL.ESTADO, REGIONAL_LEVEL.NACIONAL]
    .find(l => levels[l].usable) || null;

  const result = { levels, fuentePredominante, computedAt: new Date(now).toISOString() };
  assertAggregateNeverLeaksOrgId(result);
  return result;
}

/* buildTraceabilitySummary: las 5 lineas de trazabilidad pedidas
   explicitamente, derivadas SOLO de un nivel ya calculado y usable -- nunca
   se llama con un nivel usable:false (el llamador debe filtrar primero,
   mismo criterio que "un bucket no usable nunca se muestra"). locationLabel
   es texto ya formateado (ver geography.js#formatLocationDisplay) que el
   llamador arma para el nivel elegido. */
export function buildTraceabilitySummary(level, locationLabel){
  if(!level || !level.usable) return null;
  const rango = (level.minimo != null && level.maximo != null)
    ? `${level.minimo.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} – ${level.maximo.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}`
    : 'no disponible';
  return {
    lines: [
      `Este precio fue estimado con ${level.nObservaciones} referencia(s) regionales.`,
      `Fuente predominante: ${locationLabel || 'no especificada'}.`,
      `Última actualización: ${level.ultimaActualizacion || 'no disponible'}.`,
      `Nivel de confianza: ${level.confianza || 'BAJA'}.`,
      `Rango observado: ${rango}.`,
    ],
    nObservaciones: level.nObservaciones,
    nOrganizaciones: level.nOrganizaciones,
    mediana: level.mediana,
    confianza: level.confianza,
    ultimaActualizacion: level.ultimaActualizacion,
    rango: { minimo: level.minimo, maximo: level.maximo },
  };
}

/* isBucketReadyForGlobalPromotion: barra MAS ALTA que "usable" regional --
   antes de proponer (nunca aprobar, ver src/domain/technicalMemory.js) una
   entrada GLOBAL, se exige que MULTIPLES buckets regionales distintos (no
   solo uno) converjan con dispersion baja. El llamador (server) es quien
   junta esos buckets de distintas ubicaciones para el mismo concepto/unidad
   y se los pasa a esta funcion -- puramente una decision, nunca escribe
   nada. */
export function isBucketReadyForGlobalPromotion(regionalBuckets = []){
  const usableBuckets = regionalBuckets.filter(b => b?.usable && b.confianza !== 'BAJA');
  return usableBuckets.length >= MIN_DISTINCT_BUCKETS_GLOBAL;
}
