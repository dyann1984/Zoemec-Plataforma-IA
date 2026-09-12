/* FASE 3 (aprendizaje progresivo seguro) -- adapter de Firestore para
   observaciones de precio + agregados regionales. Mismo patron que
   _priceCacheFirestoreStore.mjs: este archivo es el UNICO que conoce
   Firestore para esta fase; toda la estadistica real vive en los modulos
   puros src/domain/priceObservation.js y src/domain/priceRegionalAggregate.js
   (nunca reimplementada aqui).

   Degradacion segura (regla ya establecida en _priceIntelligenceCache.mjs):
   si escribir una observacion o recalcular un agregado falla, se registra el
   error server-side y la funcion NUNCA lanza hacia el llamador -- guardar un
   APU jamas debe fallar porque la captura de inteligencia de precios (un
   efecto secundario, no la operacion principal) tuvo un problema. */
import { getAdminDb } from './_firebaseAdmin.mjs';
import {
  buildPriceObservation, computeObservationHash, isEligibleForObservation,
} from '../../src/domain/priceObservation.js';
import {
  aggregateLevel, buildTraceabilitySummary, REGIONAL_LEVEL,
} from '../../src/domain/priceRegionalAggregate.js';
import { computeSnapshotHash } from '../../src/domain/snapshotHash.js';
import { formatLocationDisplay } from '../../src/domain/geography.js';
import { createMemoryProposal, MEMORY_SCOPE, MEMORY_TYPE, MEMORY_STATUS } from '../../src/domain/technicalMemory.js';
import { appendAudit } from './_decisionAudit.mjs';

const OBSERVATIONS_COLLECTION = 'priceObservations';
const AGGREGATES_COLLECTION = 'priceRegionalAggregates';
const MEMORY_COLLECTION = 'technicalMemory';
const MEMORY_AUDIT_COLLECTION = 'technicalMemoryAudit';

function logFailure(operation, error, context = {}){
  // Mismos campos seguros que logCacheWriteFailure (_priceIntelligenceCache.mjs):
  // NUNCA credenciales, NUNCA el service account -- solo identidad tecnica
  // publica (concepto/ubicacion) y el error.
  console.error('[PriceObservations] operacion fallida', {
    operation, error: error?.message || String(error), timestamp: new Date().toISOString(), ...context,
  });
}

async function aggregateBucketKey({ conceptoNormalizado, unidadNormalizada, moneda, country = '', state = '', city = '' }){
  const hash = await computeSnapshotHash({ concepto: conceptoNormalizado, unidad: unidadNormalizada, moneda, country, state, city });
  return `pra_${hash}`;
}

async function queryObservations(db, { conceptoNormalizado, unidadNormalizada, moneda, country, state, city }){
  let query = db.collection(OBSERVATIONS_COLLECTION)
    .where('conceptoNormalizado', '==', conceptoNormalizado)
    .where('unidadNormalizada', '==', unidadNormalizada)
    .where('moneda', '==', moneda)
    .where('country', '==', country);
  if(state !== undefined) query = query.where('state', '==', state);
  if(city !== undefined) query = query.where('city', '==', city);
  const snap = await query.get();
  return snap.docs.map(d => d.data());
}

/* recomputeAndPersistLevel: recalcula UN nivel geografico y lo guarda en su
   propio documento de agregado (bucket key = exactamente esa combinacion de
   concepto/unidad/moneda/ubicacion) -- nunca contiene organizationId (ver
   assertAggregateNeverLeaksOrgId, ya invocado dentro de aggregateLevel via
   el llamador). */
async function recomputeAndPersistLevel(db, { level, locationFilter, identity }){
  const observations = await queryObservations(db, { ...identity, ...locationFilter });
  const aggregate = aggregateLevel(observations, { level });
  const bucketKey = await aggregateBucketKey({ ...identity, ...locationFilter });
  await db.collection(AGGREGATES_COLLECTION).doc(bucketKey).set({
    bucketKey, level, ...identity, ...locationFilter,
    ...aggregate, updatedAt: new Date().toISOString(),
  });
  return { bucketKey, aggregate };
}

/* maybeProposeGlobalPrice: FASE 3, Parte 3 -- llena el hueco que
   _route-challenge-decisions.mjs (Parte 2) documenta explicitamente
   ("'precio' no tiene un valor corregido claro que proponer"). Simplifica el
   criterio de "3 buckets regionales convergiendo" del diseno original a una
   condicion equivalente y mas barata de verificar: el bucket NACIONAL mismo
   ya exige (deriveConfidence en priceRegionalAggregate.js) el DOBLE del
   minimo de organizaciones distintas para llegar a confianza ALTA -- eso ya
   es evidencia de convergencia amplia, no de una sola region. Nunca aprueba
   nada (createMemoryProposal SIEMPRE produce PROPOSED) -- solo hace visible
   la propuesta en la MemoriaTab ya existente para que un super_admin
   decida, exactamente el mismo flujo que ya usa Parte 2 de Challenge
   Decisions. Idempotente: si ya existe una propuesta (PROPOSED o APPROVED)
   para el mismo concepto+unidad, nunca crea una segunda. */
async function maybeProposeGlobalPrice(db, { nacionalAggregate, identity }){
  if(!nacionalAggregate?.usable || nacionalAggregate.confianza !== 'ALTA') return;
  const existingSnap = await db.collection(MEMORY_COLLECTION)
    .where('type', '==', MEMORY_TYPE.APPROVED_PRICE)
    .where('scope', '==', MEMORY_SCOPE.GLOBAL)
    .where('subject.resourceDescripcion', '==', identity.conceptoNormalizado)
    .where('unit', '==', identity.unidadNormalizada)
    .get();
  const alreadyProposedOrApproved = existingSnap.docs.some(d => {
    const status = d.data().status;
    return status === MEMORY_STATUS.PROPOSED || status === MEMORY_STATUS.APPROVED;
  });
  if(alreadyProposedOrApproved) return;

  const entry = createMemoryProposal({
    scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_PRICE,
    subject: { resourceDescripcion: identity.conceptoNormalizado },
    value: nacionalAggregate.mediana, unit: identity.unidadNormalizada,
    context: {},
    provenance: {
      sourceType: 'PRICE_REGIONAL_AGGREGATE', wasCorrection: false, aiSuggested: false,
      nOrganizaciones: nacionalAggregate.nOrganizaciones, nObservaciones: nacionalAggregate.nObservaciones,
    },
    tags: ['inteligencia_regional'], createdBy: 'sistema:priceRegionalAggregate',
  });
  await db.collection(MEMORY_COLLECTION).doc(entry.id).set(entry);
  await appendAudit(db, MEMORY_AUDIT_COLLECTION, {
    entryId: entry.id, action: 'PROPOSAL_CREATED', previousStatus: null, newStatus: MEMORY_STATUS.PROPOSED,
    actor: 'sistema:priceRegionalAggregate', actorEmail: null, reason: 'Convergencia nacional de precios (Fase 3)', source: 'price_regional_aggregate',
    projectId: null, apuId: null, organizationId: null,
  });
}

/* recordPriceObservation: punto de entrada llamado desde
   server/api-lib/_route-apus.mjs justo despues de guardar con exito un APU.
   `row`/`kind`/`priceField` identifican el renglon real; `organizationId`
   viene SIEMPRE del contexto de organizacion ya resuelto por el servidor
   (loadOrgContext), nunca del body. Si el renglon no es elegible
   (isEligibleForObservation) o el precio no es utilizable, no hace nada --
   nunca lanza, nunca bloquea el guardado del APU. */
export async function recordPriceObservation({
  db = null, row, kind, priceField, organizationId, location = {}, currency = 'MXN', apuId = null, projectId = null,
} = {}){
  if(!organizationId) return { recorded: false, reason: 'NO_ORGANIZATION' };
  if(!isEligibleForObservation(row)) return { recorded: false, reason: 'NOT_ELIGIBLE' };

  const database = db || getAdminDb();
  let observation;
  try{
    observation = buildPriceObservation({ row, kind, priceField, organizationId, location, currency, apuId, projectId });
  }catch(err){
    logFailure('buildPriceObservation', err, { organizationId });
    return { recorded: false, reason: 'BUILD_ERROR' };
  }
  if(!observation) return { recorded: false, reason: 'NO_USABLE_PRICE' };

  try{
    const hash = await computeObservationHash(observation);
    await database.collection(OBSERVATIONS_COLLECTION).doc(hash).set({ ...observation, observationHash: hash }, { merge: true });

    const identity = { conceptoNormalizado: observation.conceptoNormalizado, unidadNormalizada: observation.unidadNormalizada, moneda: observation.moneda };
    const { country, state, city } = observation;
    const levelJobs = [];
    if(country){
      if(city) levelJobs.push(recomputeAndPersistLevel(database, { level: REGIONAL_LEVEL.CIUDAD, locationFilter: { country, state: state || '', city }, identity }));
      if(state) levelJobs.push(recomputeAndPersistLevel(database, { level: REGIONAL_LEVEL.ESTADO, locationFilter: { country, state, city: '' }, identity }));
      // Nacional: TODAS las observaciones de ese pais para este concepto/unidad,
      // sin filtrar por estado/ciudad -- por eso no se agregan esos filtros
      // (queryObservations solo aplica state/city cuando el llamador los pasa).
      levelJobs.push(recomputeAndPersistLevel(database, { level: REGIONAL_LEVEL.NACIONAL, locationFilter: { country }, identity }));
    }
    const levelResults = await Promise.all(levelJobs);
    const nacionalResult = levelResults.find(r => r?.aggregate?.level === REGIONAL_LEVEL.NACIONAL);
    if(nacionalResult){
      await maybeProposeGlobalPrice(database, { nacionalAggregate: nacionalResult.aggregate, identity }).catch(err => logFailure('maybeProposeGlobalPrice', err, { identity }));
    }
    return { recorded: true, observationHash: hash };
  }catch(err){
    logFailure('recordPriceObservation', err, { organizationId, concepto: observation.conceptoNormalizado });
    return { recorded: false, reason: 'STORE_ERROR', error: err?.message || String(err) };
  }
}

/* lookupRegionalIntelligence: lectura para el flujo de generacion de APU
   (materialPriceIntelligence2.js) -- intenta ciudad, luego estado, luego
   nacional (misma prioridad que REGIONAL_COVERAGE), y devuelve el primer
   nivel `usable:true` que encuentre, ya con su resumen de trazabilidad
   (buildTraceabilitySummary). Nunca lanza -- una falla de lectura aqui
   significa "sin inteligencia regional disponible", jamas bloquea la
   generacion del APU. */
export async function lookupRegionalIntelligence({ db = null, conceptoNormalizado, unidadNormalizada, moneda = 'MXN', country = '', state = '', city = '' } = {}){
  if(!country || !conceptoNormalizado || !unidadNormalizada) return null;
  const database = db || getAdminDb();
  const identity = { conceptoNormalizado, unidadNormalizada, moneda };
  try{
    const candidates = [];
    if(city) candidates.push({ locationFilter: { country, state: state || '', city }, label: formatLocationDisplay({ country, state, city }) });
    if(state) candidates.push({ locationFilter: { country, state, city: '' }, label: formatLocationDisplay({ country, state }) });
    candidates.push({ locationFilter: { country }, label: formatLocationDisplay({ country }) });

    for(const candidate of candidates){
      const bucketKey = await aggregateBucketKey({ ...identity, ...candidate.locationFilter });
      const snap = await database.collection(AGGREGATES_COLLECTION).doc(bucketKey).get();
      if(!snap.exists) continue;
      const aggregate = snap.data();
      if(!aggregate.usable) continue;
      const summary = buildTraceabilitySummary(aggregate, candidate.label);
      if(summary) return { ...summary, level: aggregate.level, bucketKey };
    }
    return null;
  }catch(err){
    logFailure('lookupRegionalIntelligence', err, { conceptoNormalizado });
    return null;
  }
}
