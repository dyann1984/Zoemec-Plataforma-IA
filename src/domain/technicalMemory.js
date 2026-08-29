/* ZOEMEC MEMORIA TECNICA EMPRESARIAL (Fase 4): reutiliza decisiones
   profesionales aprobadas sin convertir automaticamente una correccion
   puntual en una regla universal. Logica pura (sin Firebase, sin React) --
   opera sobre arreglos de entradas que el llamador provee y devuelve
   (mismo patron que apuVersioning.js/apuReconciliation.js), la persistencia
   real vive en technicalMemoryRepository.js.

   NO duplica Auditor/Challenge/Confidence: expone evidencia (findApplicableMemory/
   buildMemoryEvidence) que esos modulos pueden CONSUMIR via un parametro
   opcional -- ninguno de ellos importa este archivo (evita dependencia
   circular; ver runApuConfidence#options.memoryBoost y
   runApuChallenge#options.memoryBaselines en apuConfidence.js/apuChallenge.js).

   Unica excepcion, en un solo sentido (regla 10 del spec -- "Scenario puede
   usar memoria si se pasa explicitamente"): este archivo SI puede importar
   CHANGE_TYPE de apuScenario.js para ofrecer buildScenarioChangeFromMemory,
   una funcion de conveniencia que traduce una resolucion de memoria ya
   calculada a un `change` listo para createScenario. apuScenario.js nunca
   importa este archivo de vuelta -- no hay ciclo. */
import { CHANGE_TYPE } from './apuScenario.js';

export const MEMORY_SCOPE = Object.freeze({ GLOBAL: 'GLOBAL', ORGANIZATION: 'ORGANIZATION', PROJECT: 'PROJECT', USER: 'USER' });

export const MEMORY_STATUS = Object.freeze({
  DRAFT: 'DRAFT', PROPOSED: 'PROPOSED', APPROVED: 'APPROVED',
  REJECTED: 'REJECTED', SUPERSEDED: 'SUPERSEDED', ARCHIVED: 'ARCHIVED'
});

// Los 13 tipos minimos pedidos (regla 2 del spec), un identificador por
// tipo -- ninguno inventa un campo nuevo del modelo de APU, todos describen
// una DECISION sobre datos que ya existen en apuSchema.js/apuGeneration.js.
export const MEMORY_TYPE = Object.freeze({
  APPROVED_YIELD: 'APPROVED_YIELD', // rendimiento aprobado
  APPROVED_CREW: 'APPROVED_CREW', // cuadrilla aprobada
  APPROVED_PRICE: 'APPROVED_PRICE', // precio aprobado
  PREFERRED_SUPPLIER: 'PREFERRED_SUPPLIER', // proveedor preferido
  APPROVED_WASTE: 'APPROVED_WASTE', // desperdicio aprobado
  RESOURCE_COMPOSITION: 'RESOURCE_COMPOSITION', // composicion de recursos
  CONSTRUCTION_METHOD: 'CONSTRUCTION_METHOD', // metodo constructivo
  RESOURCE_SUBSTITUTE: 'RESOURCE_SUBSTITUTE', // recurso sustituto
  VALIDATED_ASSUMPTION: 'VALIDATED_ASSUMPTION', // supuesto validado
  APPROVED_APU: 'APPROVED_APU', // APU aprobado
  PROFESSIONAL_CORRECTION: 'PROFESSIONAL_CORRECTION', // correccion profesional
  RECOMMENDATION_REJECTED: 'RECOMMENDATION_REJECTED', // rechazo de recomendacion
  REVIEW_CRITERION: 'REVIEW_CRITERION' // criterio de revision
});

// Prioridad de resolucion (regla 5 del spec): PROJECT es lo mas especifico
// y confiable para ESTE trabajo (terreno/cliente/equipo real); ORGANIZATION
// es politica curada de la empresa, mas amplia pero aun revisada;
// USER es el habito/historial de UNA persona -- mas especifico que GLOBAL
// pero menos autoritativo que una politica de organizacion (un habito
// individual no aprobado por la empresa no deberia pesar mas que la
// politica de la empresa); GLOBAL es el piso generico de la plataforma.
const SCOPE_PRIORITY = [MEMORY_SCOPE.PROJECT, MEMORY_SCOPE.ORGANIZATION, MEMORY_SCOPE.USER, MEMORY_SCOPE.GLOBAL];

const fold = value => String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const stamp = () => new Date().toISOString();
const clone = value => structuredClone(value);
let counter = 0;
const newId = () => `MEM-${Date.now().toString(36).toUpperCase()}-${(counter++).toString(36).toUpperCase()}`;

function assertValid(condition, message){
  if(!condition) throw new Error(message);
}

/* CORRECCION -> MEMORY PROPOSAL (regla 7 del spec): nunca crea una entrada
   ya APPROVED, sin importar quien la genero (un humano corrigiendo un APU,
   o una sugerencia derivada de IA) -- siempre PROPOSED, requiere revision
   humana explicita despues (approveMemoryEntry/rejectMemoryEntry). */
export function createMemoryProposal({
  scope, type, subject = {}, value, unit = null, context = {}, provenance = {},
  tags = [], createdBy = 'usuario', at = stamp()
} = {}){
  assertValid(Object.values(MEMORY_SCOPE).includes(scope), `Scope de memoria invalido: ${scope}`);
  assertValid(Object.values(MEMORY_TYPE).includes(type), `Tipo de memoria invalido: ${type}`);
  assertValid(value !== undefined, 'Una propuesta de memoria requiere un valor.');
  if(scope === MEMORY_SCOPE.PROJECT) assertValid(context.projectId, 'Una entrada PROJECT requiere context.projectId.');
  if(scope === MEMORY_SCOPE.ORGANIZATION) assertValid(context.organizationId, 'Una entrada ORGANIZATION requiere context.organizationId.');
  if(scope === MEMORY_SCOPE.USER) assertValid(context.userId, 'Una entrada USER requiere context.userId.');
  return {
    id: newId(), scope, type, subject: clone(subject), value, unit, context: clone(context),
    // "sugerido por IA" NUNCA se trata como "validado" (regla 4 del spec):
    // sourceType es la unica bandera de procedencia, humanApproved siempre
    // arranca en false y solo approveMemoryEntry puede ponerlo en true.
    provenance: { apuId: null, projectId: context.projectId || null, userId: createdBy,
      sourceType: 'MANUAL', wasCorrection: false, wasFromHistorical: false, aiSuggested: false,
      humanApproved: false, ...provenance },
    confidence: null, status: MEMORY_STATUS.PROPOSED,
    createdAt: at, createdBy, approvedAt: null, approvedBy: null,
    supersedes: null, supersededBy: null, tags: [...tags]
  };
}

/* Puente explicito "correccion de un profesional en un APU real" -> propuesta
   de memoria (regla 7). NUNCA se auto-aprueba -- el resultado siempre queda
   PROPOSED, exactamente como createMemoryProposal, pero con provenance
   marcada wasCorrection:true y ligada al APU/proyecto de origen (regla 4:
   "de que APU/proyecto salio"). */
export function proposeMemoryFromCorrection({ apu, field, previousValue, newValue, scope, type, subject, context = {}, createdBy = 'usuario', at = stamp() } = {}){
  return createMemoryProposal({
    scope, type, subject, value: newValue, context,
    provenance: { apuId: apu?.id || apu?.clave || null, projectId: context.projectId || null,
      userId: createdBy, sourceType: 'HUMAN_CORRECTION', wasCorrection: true, previousValue, field },
    tags: ['correccion'], createdBy, at
  });
}

function requireStatus(entry, expected, action){
  assertValid(entry.status === expected, `No se puede ${action} una entrada en estado ${entry.status} (se esperaba ${expected}).`);
}

export function approveMemoryEntry(entry, { approvedBy, at = stamp() } = {}){
  requireStatus(entry, MEMORY_STATUS.PROPOSED, 'aprobar');
  assertValid(approvedBy, 'approveMemoryEntry requiere approvedBy.');
  return { ...clone(entry), status: MEMORY_STATUS.APPROVED, approvedAt: at, approvedBy,
    provenance: { ...entry.provenance, humanApproved: true } };
}

export function rejectMemoryEntry(entry, { rejectedBy, reason = null, at = stamp() } = {}){
  requireStatus(entry, MEMORY_STATUS.PROPOSED, 'rechazar');
  assertValid(rejectedBy, 'rejectMemoryEntry requiere rejectedBy.');
  return { ...clone(entry), status: MEMORY_STATUS.REJECTED, approvedAt: null, approvedBy: null,
    rejectedBy, rejectedAt: at, rejectionReason: reason };
}

/* Versionado y reversibilidad (regla 11): NUNCA un update destructivo de una
   entrada aprobada. Crea una entrada NUEVA (nueva version, PROPOSED -- debe
   pasar su propia revision) y marca la anterior SUPERSEDED, nunca la borra
   ni la muta in-place. Devuelve AMBAS -- el historial completo se conserva
   siempre. */
export function supersedeMemoryEntry(previousEntry, nextProposalInput, { at = stamp() } = {}){
  requireStatus(previousEntry, MEMORY_STATUS.APPROVED, 'reemplazar (supersede)');
  const nextEntry = createMemoryProposal({ ...nextProposalInput, at });
  const supersededEntry = { ...clone(previousEntry), status: MEMORY_STATUS.SUPERSEDED, supersededBy: nextEntry.id, supersededAt: at };
  return { supersededEntry, nextEntry: { ...nextEntry, supersedes: previousEntry.id } };
}

export function archiveMemoryEntry(entry, { archivedBy, reason = null, at = stamp() } = {}){
  assertValid(entry.status !== MEMORY_STATUS.ARCHIVED, 'La entrada ya esta ARCHIVED.');
  return { ...clone(entry), status: MEMORY_STATUS.ARCHIVED, archivedAt: at, archivedBy, archiveReason: reason };
}

/* Coincidencia de subject (regla 5: deterministica cuando hay clave exacta,
   nunca fuzzy matching agresivo). resourceId (clave) tiene prioridad sobre
   descripcion normalizada; si el subject de la entrada no declara ningun
   identificador de recurso, se interpreta como aplicable a TODO el subject
   de esa disciplina (ej. una entrada de APPROVED_APU sin resourceId). */
function subjectMatches(entrySubject = {}, querySubject = {}){
  if(querySubject.primaryActivity != null && entrySubject.primaryActivity != null
    && fold(entrySubject.primaryActivity) !== fold(querySubject.primaryActivity)) return false;
  if(entrySubject.resourceId != null) return querySubject.resourceId != null && entrySubject.resourceId === querySubject.resourceId;
  if(entrySubject.resourceDescripcion != null) return querySubject.resourceDescripcion != null && fold(entrySubject.resourceDescripcion) === fold(querySubject.resourceDescripcion);
  return true;
}

// Contexto (regla 5/6): cada clave que la entrada DECLARA debe coincidir
// exactamente con la query. Una entrada que no declara una clave de
// contexto se interpreta como generica para ese scope (ej. GLOBAL nunca
// declara projectId).
function contextMatches(entryContext = {}, queryContext = {}){
  return Object.entries(entryContext).every(([key, value]) => {
    if(value == null) return true;
    return queryContext[key] === value;
  });
}

function isEligible(entry, { type, subject, context }){
  if(entry.status !== MEMORY_STATUS.APPROVED) return false;
  if(entry.type !== type) return false;
  if(!subjectMatches(entry.subject, subject)) return false;
  if(!contextMatches(entry.context, context)) return false;
  return true;
}

/* Recupera candidatos aplicables (regla 5), incluyendo los NO aprobados
   (PROPOSED/DRAFT) que igual coinciden en subject/type/contexto -- esos se
   devuelven como `weakCandidates`, nunca como regla aplicada (regla 5:
   "si solo existe una similitud debil, devolver candidato, no regla
   aplicada"). */
export function findApplicableMemory(entries = [], query = {}){
  const eligible = entries.filter(e => isEligible(e, query));
  const weakCandidates = entries.filter(e =>
    e.status !== MEMORY_STATUS.APPROVED && e.status !== MEMORY_STATUS.REJECTED && e.status !== MEMORY_STATUS.SUPERSEDED && e.status !== MEMORY_STATUS.ARCHIVED
    && e.type === query.type && subjectMatches(e.subject, query.subject || {}) && contextMatches(e.context, query.context || {}));
  return { eligible, weakCandidates };
}

/* Resolucion (regla 6): elige por prioridad de scope (SCOPE_PRIORITY), pero
   NUNCA borra las demas fuentes -- quedan en `alternatives`. Si hay mas de
   una entrada APPROVED en el MISMO scope ganador (conflicto real, regla 14:
   "conflicto en mismo scope se reporta") nunca se elige por orden de
   arreglo: se desempata de forma DOCUMENTADA y determinista (aprobacion mas
   reciente gana) y el conflicto se reporta explicitamente en `conflicts`. */
export function resolveTechnicalMemory(entries = [], query = {}){
  const { eligible, weakCandidates } = findApplicableMemory(entries, query);
  if(!eligible.length){
    return { selectedValue: null, selectedSource: null, alternatives: [], conflicts: [], candidates: weakCandidates, reason: 'NO_APPROVED_MEMORY_FOUND' };
  }
  const bestScope = SCOPE_PRIORITY.find(scope => eligible.some(e => e.scope === scope));
  const atBestScope = eligible.filter(e => e.scope === bestScope);
  const conflicts = atBestScope.length > 1 ? [...atBestScope] : [];
  const winner = [...atBestScope].sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt))[0];
  const alternatives = eligible.filter(e => e.id !== winner.id);
  return {
    selectedValue: winner.value,
    selectedSource: { scope: winner.scope, entryId: winner.id, approvedAt: winner.approvedAt, approvedBy: winner.approvedBy, unit: winner.unit },
    alternatives: alternatives.map(e => ({ scope: e.scope, entryId: e.id, value: e.value, approvedAt: e.approvedAt })),
    conflicts: conflicts.length > 1 ? conflicts.map(e => ({ entryId: e.id, value: e.value, approvedAt: e.approvedAt, approvedBy: e.approvedBy })) : [],
    candidates: weakCandidates,
    reason: conflicts.length > 1
      ? `Conflicto: ${conflicts.length} entradas APPROVED en scope ${bestScope} para el mismo subject; se selecciono la de aprobacion mas reciente (${winner.approvedAt}).`
      : `Scope ${bestScope} tiene prioridad y no hay conflicto.`
  };
}

/* Evidencia consumible por Confidence/Challenge (regla 8/9) SIN que esos
   modulos importen este archivo -- el llamador (una capa de orquestacion,
   o directamente el codigo de pruebas/futura UI) resuelve la memoria aqui y
   pasa el resultado ya normalizado como parametro opcional. */
export function buildMemoryEvidence(entries, queries = []){
  const yieldApprovedFold = new Set();
  const laborBaselines = {};
  queries.forEach(query => {
    const resolution = resolveTechnicalMemory(entries, query);
    if(!resolution.selectedValue || !query.subject) return;
    const key = query.subject.resourceId || fold(query.subject.resourceDescripcion || '');
    if(!key) return;
    if(query.type === MEMORY_TYPE.APPROVED_YIELD){
      yieldApprovedFold.add(fold(query.subject.resourceDescripcion || key));
      laborBaselines[fold(query.subject.resourceDescripcion || key)] = {
        rendimiento: resolution.selectedValue, sourceLabel: `Memoria tecnica aprobada (${resolution.selectedSource.scope.toLowerCase()})`
      };
    }
  });
  return { yieldApprovedFold, laborBaselines };
}

/* Regla 10 del spec: "Scenario Engine debe poder usar una memoria como
   fuente de override, SI SE PASA EXPLICITAMENTE. NO modificar el APU base."
   Esta funcion NO modifica nada -- solo traduce una resolucion de memoria
   YA calculada (resolveTechnicalMemory) a un `change` listo para
   createScenario (apuScenario.js), reusando su mecanismo existente de
   "mode:absolute" en vez de inventar una ruta de aplicacion paralela.
   Devuelve null si la memoria no tiene un valor aprobado que aplicar (nunca
   fabrica un change desde una resolucion vacia). */
export function buildScenarioChangeFromMemory(resolution, { changeType, selector, reason, source = 'memoria_tecnica' } = {}){
  if(!resolution || resolution.selectedValue == null) return null;
  return {
    type: changeType || CHANGE_TYPE.PRICE_ABSOLUTE_CHANGE,
    selector, mode: 'absolute', value: resolution.selectedValue,
    reason: reason || `Aplicado desde memoria tecnica aprobada (${resolution.selectedSource.scope}, entrada ${resolution.selectedSource.entryId}).`,
    source
  };
}
