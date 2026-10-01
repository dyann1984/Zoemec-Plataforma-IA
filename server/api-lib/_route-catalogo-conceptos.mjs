/* Catalogo de conceptos (Fase D): eslabon persistente entre Cuantificacion y
   APU. Mismo patron de identidad/autorizacion que _route-apus.mjs
   (requireAuth siempre del token, organizationId siempre de loadOrgContext,
   nunca del body, canAccessOrgScopedDoc en cada lectura/escritura), pero SIN
   coleccion de versiones propia -- ver src/domain/catalogConceptoSchema.js:
   un concepto es esencialmente estatico (clave/capitulo/descripcion/unidad/
   cantidad/origen), asi que solo lleva documento actual + auditoria
   append-only (`catalogConceptosAudit`).

   Reubicado desde el principio bajo server/api-lib/ (nunca un archivo nuevo
   en api/, ver VERCEL_HOBBY_COMPAT.md -- api/ ya esta al limite de 12
   funciones serverless de Vercel Hobby) -- despachado por api/gateway.mjs. */
import { requireAuth } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { appendAudit } from './_decisionAudit.mjs';
import { loadOrgContext, assertOrgNotExpired, canAccessOrgScopedDoc, assertProjectAccess } from './_orgGuard.mjs';
import { buildProjectLocationSnapshot, hasAnyLocation } from '../../src/domain/geography.js';
import { makeEmptyCatalogConcepto, validateCatalogConcepto, isLegalStatusTransition, CATALOG_CONCEPTO_STATUS } from '../../src/domain/catalogConceptoSchema.js';
import { normalizeCapitulo } from '../../src/domain/presupuestoCapitulos.js';
import { verifyGenerator, aggregateGenerators, diffGenerators, QUANTITY_SOURCE_KIND, buildConceptGenerators, geometryHash } from '../../src/domain/quantityGenerators.js';

const COLLECTION = 'catalogConceptos';
const AUDIT_COLLECTION = 'catalogConceptosAudit';

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }

/* Regionalizacion (misma regla que ensureApuLocationSnapshot en
   _route-apus.mjs): ubicacion EXPLICITA que ya trae el concepto (si el
   cliente la mando) siempre gana; si no, se siembra del proyecto; si el
   proyecto tampoco tiene ubicacion estructurada, el concepto se queda SIN
   ubicacion -- nunca un default silencioso a ninguna ciudad. */
async function resolveConceptLocation(db, concepto, projectId){
  if(hasAnyLocation(concepto?.ubicacionEstructurada || {})) return concepto;
  if(!projectId) return concepto;
  const projectSnap = await db.collection('projects').doc(String(projectId)).get().catch(() => null);
  if(!projectSnap?.exists) return concepto;
  const { ubicacion, ubicacionEstructurada } = buildProjectLocationSnapshot(projectSnap.data());
  if(!hasAnyLocation(ubicacionEstructurada)) return concepto;
  return { ...concepto, ubicacionEstructurada, ubicacion: concepto?.ubicacion || ubicacion };
}

async function handleList(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  const { projectId } = req.query || {};
  if(!projectId) throw httpError(400, 'Falta projectId.');
  const db = getAdminDb();
  await assertProjectAccess(db, authz, orgContext, projectId);
  let query = orgContext
    ? db.collection(COLLECTION).where('organizationId', '==', orgContext.organizationId).where('projectId', '==', String(projectId))
    : db.collection(COLLECTION).where('ownerUid', '==', authz.uid).where('projectId', '==', String(projectId));
  const snap = await query.get();
  const conceptos = snap.docs.map(d => d.data()).filter(c => !c.archivedAt);
  res.status(200).json({ conceptos });
}

/* CREATE en lote: usado por "Agregar al catalogo" (individual o masivo,
   desde Levantamiento/PlanoTakeoff/Visual AI o captura manual). Cada
   concepto se resuelve y valida de forma independiente -- si uno viene
   invalido, se descarta con su propio motivo en `rejected` sin tumbar los
   demas (mismo criterio de "un fallo no debe perder el resto" que ya
   aplica al lote de generacion).

   DEDUPLICACION (Fase D.1, punto 1: "cree/actualice el concepto
   correspondiente sin duplicarlo"): cuando el item trae `origenElementoId`
   (identidad estable del elemento de origen, ej. `${planoTakeoffId}:${elementId}`
   o `${visualRequestId}:${elementId}` para el flujo de imagen -- ver
   toApuSeed/attachAiOrigin), se busca primero si YA existe un concepto no
   archivado de este proyecto con ese mismo origenElementoId. Si existe, se
   ACTUALIZA (clave/capitulo/descripcion/unidad/cantidad/ubicacion/origenPlano),
   preservando id/status/apuId/apuVersionId -- reenviar el mismo elemento
   (ej. tras corregir la cantidad en el plano) nunca crea un segundo
   concepto ni pisa un APU ya asociado/generado. Sin `origenElementoId`
   (captura manual, sin origen de plano) siempre crea uno nuevo -- no hay
   identidad estable contra la cual deduplicar. */
async function findExistingByOrigenElementoId(db, authz, orgContext, projectId, origenElementoId){
  if(!origenElementoId) return null;
  let query = orgContext
    ? db.collection(COLLECTION).where('organizationId', '==', orgContext.organizationId).where('projectId', '==', String(projectId))
    : db.collection(COLLECTION).where('ownerUid', '==', authz.uid).where('projectId', '==', String(projectId));
  const snap = await query.get();
  const match = snap.docs.map(d => d.data()).find(c => !c.archivedAt && c.origenElementoId === origenElementoId);
  return match || null;
}

const UPDATABLE_ON_DEDUP = [
  'clave', 'capitulo', 'concept', 'unit', 'qty', 'referencePU', 'origenPlano',
  'origenElementoId', 'origenCantidad', 'sourceType', 'sourceRecordId',
  'sourceElementId', 'planId', 'surveyId', 'confirmedAt', 'confirmedBy'
];

async function handleCreate(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { projectId, conceptos, reason } = req.body || {};
  if(!projectId || !Array.isArray(conceptos) || !conceptos.length) throw httpError(400, 'Faltan projectId/conceptos.');
  const db = getAdminDb();
  await assertProjectAccess(db, authz, orgContext, projectId);
  const organizationId = orgContext ? orgContext.organizationId : null;
  const now = new Date().toISOString();

  const toCreate = [];
  const toUpdate = [];
  const rejected = [];
  for(const raw of conceptos){
    // Tambien protege contra duplicados DENTRO del mismo lote (ej. el mismo
    // elemento enviado dos veces en una sola llamada) -- no solo contra lo
    // ya persistido, que la consulta de abajo no puede ver todavia.
    const dupInBatch = raw?.origenElementoId && (
      toCreate.find(c => c.origenElementoId === raw.origenElementoId) ||
      toUpdate.find(c => c.origenElementoId === raw.origenElementoId)
    );
    const existing = dupInBatch || await findExistingByOrigenElementoId(db, authz, orgContext, projectId, raw?.origenElementoId);
    if(existing){
      const seed = makeEmptyCatalogConcepto({ projectId: String(projectId), ...raw });
      const { valid, errors } = validateCatalogConcepto(seed);
      if(!valid){ rejected.push({ input: raw, errors }); continue; }
      const withLocation = await resolveConceptLocation(db, seed, projectId);
      const patch = {};
      UPDATABLE_ON_DEDUP.forEach(f => { if(withLocation[f] !== undefined) patch[f] = withLocation[f]; });
      // F3: un concepto alimentado por generadores conserva su cantidad
      // (solo set-generators la mueve, con trazabilidad).
      if(existing.quantitySource === QUANTITY_SOURCE_KIND.GENERATORS) delete patch.qty;
      toUpdate.push({ ...existing, ...patch, ubicacion: withLocation.ubicacion ?? existing.ubicacion, ubicacionEstructurada: withLocation.ubicacionEstructurada ?? existing.ubicacionEstructurada, updatedAt: now });
      continue;
    }
    const seed = makeEmptyCatalogConcepto({ projectId: String(projectId), ...raw });
    const { valid, errors } = validateCatalogConcepto(seed);
    if(!valid){ rejected.push({ input: raw, errors }); continue; }
    const withLocation = await resolveConceptLocation(db, seed, projectId);
    toCreate.push({ ...withLocation, ownerUid: authz.uid, organizationId, createdAt: now, updatedAt: now });
  }
  if(!toCreate.length && !toUpdate.length) throw httpError(400, `Ningun concepto valido para crear/actualizar. Motivos: ${JSON.stringify(rejected)}`);

  const batch = db.batch();
  toCreate.forEach(concepto => {
    batch.set(db.collection(COLLECTION).doc(concepto.id), concepto);
    batch.set(db.collection(AUDIT_COLLECTION).doc(), {
      entryId: concepto.id, action: 'CATALOGO_CONCEPTO_CREATED', previousStatus: null, newStatus: concepto.status,
      actor: authz.uid, actorEmail: authz.email, reason: reason || null, source: 'api',
      projectId: concepto.projectId, conceptoId: concepto.id, organizationId, ownerUid: authz.uid,
      timestamp: now
    });
  });
  toUpdate.forEach(concepto => {
    batch.set(db.collection(COLLECTION).doc(concepto.id), concepto);
    batch.set(db.collection(AUDIT_COLLECTION).doc(), {
      entryId: concepto.id, action: 'CATALOGO_CONCEPTO_DEDUP_UPDATED', previousStatus: concepto.status, newStatus: concepto.status,
      actor: authz.uid, actorEmail: authz.email, reason: reason || 'Actualizado desde el mismo elemento de origen (sin duplicar)', source: 'api',
      projectId: concepto.projectId, conceptoId: concepto.id, organizationId, ownerUid: authz.uid,
      timestamp: now
    });
  });
  await batch.commit();
  res.status(201).json({ conceptos: [...toCreate, ...toUpdate], created: toCreate.length, updated: toUpdate.length, rejected });
}

async function loadOwnedConcepto(db, authz, orgContext, id){
  const docRef = db.collection(COLLECTION).doc(String(id));
  const snap = await docRef.get();
  if(!snap.exists) throw httpError(404, 'El concepto no existe.');
  const current = snap.data();
  if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Este concepto pertenece a otro usuario.');
  return { docRef, current };
}

/* UPDATE: edicion de clave/capitulo/descripcion/unidad/cantidad ANTES de
   generar APU. Nunca toca status/apuId -- eso solo lo mueven set-status/
   associate-apu, para que un solo endpoint no mezcle dos intenciones
   distintas (editar datos del concepto vs. mover su estado de generacion). */
async function handleUpdate(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id, patch } = req.body || {};
  if(!id || !patch) throw httpError(400, 'Faltan id/patch.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const ALLOWED_FIELDS = ['clave', 'capitulo', 'concept', 'unit', 'qty', 'referencePU'];
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'El concepto no existe.');
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Este concepto pertenece a otro usuario.');
    const safePatch = {};
    ALLOWED_FIELDS.forEach(f => { if(patch[f] !== undefined) safePatch[f] = patch[f]; });
    // F3: la cantidad de un concepto alimentado por generadores SOLO la
    // mueve set-generators (con operacion, historial y auditoria); una
    // edicion directa desincronizaria la cantidad de su respaldo geometrico.
    if(safePatch.qty !== undefined && current.quantitySource === QUANTITY_SOURCE_KIND.GENERATORS && Number(safePatch.qty) !== Number(current.qty)){
      const e = httpError(409, 'La cantidad de este concepto proviene de generadores del plano: recalcula los generadores en lugar de editarla a mano.');
      e.code = 'QUANTITY_FROM_GENERATORS';
      throw e;
    }
    if(safePatch.capitulo) safePatch.capitulo = normalizeCapitulo(safePatch.capitulo);
    const next = { ...current, ...safePatch, updatedAt: new Date().toISOString() };
    const { valid, errors } = validateCatalogConcepto(next);
    if(!valid) throw httpError(400, `Concepto invalido tras la edicion: ${errors.join(' ')}`);
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'CATALOGO_CONCEPTO_UPDATED', previousStatus: current.status, newStatus: next.status,
      actor: authz.uid, actorEmail: authz.email, reason: null, source: 'api',
      projectId: next.projectId, conceptoId: next.id, organizationId: current.organizationId ?? null, ownerUid: authz.uid
    });
    return next;
  });
  res.status(200).json({ concepto: result });
}

/* SET-STATUS: transicion server-side del estado durable del concepto,
   llamada por el worker de generacion en lote (individual o masiva) despues
   de cada intento -- ver src/domain/apuBatchQueue.js/apuBatchQueueCloud.js.
   Es la fuente de verdad DURABLE del estado (a diferencia del doc efimero
   de lote, que puede borrarse cuando el usuario cierra el panel de
   progreso): el estado del concepto sobrevive aunque el lote se descarte.
   Rechaza transiciones ilegales (ver isLegalStatusTransition) para que un
   reintento fuera de orden nunca deje el concepto en un estado incoherente. */
async function handleSetStatus(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id, status, apuId, apuVersionId, error, batchId, parametric, retryAfterSeconds } = req.body || {};
  // F1/P0: PENDIENTE_LIMITE conserva el motivo y CUANDO reintentar (el
  // servidor calcula retryAt a partir de retryAfterSeconds; nunca confia en
  // una fecha del cliente).
  const isRateLimited = status === CATALOG_CONCEPTO_STATUS.PENDIENTE_LIMITE;
  const retrySeconds = isRateLimited && Number(retryAfterSeconds) > 0 ? Math.ceil(Number(retryAfterSeconds)) : null;
  if(!id || !status) throw httpError(400, 'Faltan id/status.');
  if(!Object.values(CATALOG_CONCEPTO_STATUS).includes(status)) throw httpError(400, `status desconocido: ${status}.`);
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if(!snap.exists) throw httpError(404, 'El concepto no existe.');
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Este concepto pertenece a otro usuario.');
    if(!isLegalStatusTransition(current.status, status)){
      throw httpError(409, `Transicion de estado no permitida: ${current.status} -> ${status}.`);
    }
    const next = {
      ...current, status, updatedAt: new Date().toISOString(),
      statusError: status === CATALOG_CONCEPTO_STATUS.ERROR ? String(error || 'Error desconocido')
        : isRateLimited ? String(error || 'Limite temporal de solicitudes alcanzado.') : null,
      retryAfterSeconds: isRateLimited ? retrySeconds : null,
      retryAt: isRateLimited && retrySeconds ? new Date(Date.now() + retrySeconds * 1000).toISOString() : null,
      apuId: apuId !== undefined ? apuId : current.apuId,
      apuVersionId: apuVersionId !== undefined ? apuVersionId : current.apuVersionId,
      batchId: batchId !== undefined ? batchId : current.batchId,
      parametric: parametric !== undefined ? parametric : current.parametric
    };
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'CATALOGO_CONCEPTO_STATUS_CHANGED', previousStatus: current.status, newStatus: status,
      actor: authz.uid, actorEmail: authz.email, reason: error || null, source: 'api',
      projectId: next.projectId, conceptoId: next.id, organizationId: current.organizationId ?? null, ownerUid: authz.uid
    });
    return next;
  });
  res.status(200).json({ concepto: result });
}

/* ASOCIAR APU EXISTENTE: verifica AMBAS pertenencias (concepto y APU, mismo
   criterio que handleLinkProject en _route-apus.mjs) antes de vincular.
   Estampa apuVersionId = la version VIGENTE del APU en ese momento (no
   "la ultima que exista despues" -- si el APU se vuelve a guardar mas
   tarde, el Presupuesto sigue mostrando la version que el usuario realmente
   vio y acepto al asociar, trazabilidad estable). */
async function handleAssociateApu(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id, apuId, matchConfidence, matchMethod } = req.body || {};
  if(!id || !apuId) throw httpError(400, 'Faltan id/apuId.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const apuRef = db.collection('apus').doc(String(apuId));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const [snap, apuSnap] = await Promise.all([tx.get(docRef), tx.get(apuRef)]);
    if(!snap.exists) throw httpError(404, 'El concepto no existe.');
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Este concepto pertenece a otro usuario.');
    if(!apuSnap.exists) throw httpError(404, 'El APU a asociar no existe.');
    const apu = apuSnap.data();
    if(!canAccessOrgScopedDoc(apu, authz, orgContext)) throw httpError(403, 'El APU a asociar pertenece a otro usuario.');
    const next = {
      ...current, apuId: String(apuId), apuVersionId: apu.currentVersion || null,
      matchConfidence: matchConfidence ?? null, matchMethod: matchMethod ?? 'manual',
      status: CATALOG_CONCEPTO_STATUS.ASOCIADO, statusError: null, updatedAt: new Date().toISOString()
    };
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'CATALOGO_CONCEPTO_APU_ASOCIADO', previousStatus: current.status, newStatus: next.status,
      actor: authz.uid, actorEmail: authz.email, reason: `Asociado a APU ${apuId}`, source: 'api',
      projectId: next.projectId, conceptoId: next.id, organizationId: current.organizationId ?? null, ownerUid: authz.uid
    });
    return next;
  });
  res.status(200).json({ concepto: result });
}

async function handleArchive(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id } = req.body || {};
  if(!id) throw httpError(400, 'Falta id del concepto a archivar.');
  const db = getAdminDb();
  const { docRef, current } = await (async () => {
    const snap = await db.collection(COLLECTION).doc(String(id)).get();
    if(!snap.exists) throw httpError(404, 'El concepto no existe.');
    const data = snap.data();
    if(!canAccessOrgScopedDoc(data, authz, orgContext)) throw httpError(403, 'Este concepto pertenece a otro usuario.');
    return { docRef: db.collection(COLLECTION).doc(String(id)), current: data };
  })();
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const next = { ...current, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await db.runTransaction(async (tx) => {
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'CATALOGO_CONCEPTO_ARCHIVED', previousStatus: current.status, newStatus: current.status,
      actor: authz.uid, actorEmail: authz.email, reason: null, source: 'api',
      projectId: next.projectId, conceptoId: next.id, organizationId: current.organizationId ?? null, ownerUid: authz.uid
    });
  });
  res.status(200).json({ concepto: next });
}

/* F3 -- SET-GENERATORS: reemplaza los generadores de UN plano (planoId) del
   concepto y recalcula qty = SUM(generadores) EN EL SERVIDOR con la regla
   unica de src/domain/quantityGenerators.js (el qty del cliente se ignora).
   - Cada generador se verifica aritmeticamente (bruto = producto de
     dimensiones, neto = bruto - deducciones, nunca negativo).
   - Concurrencia: generatorRevisions[planoId] + expectedRevision -> 409
     GENERATOR_CONFLICT (mismo patron que save-version de APU/Presupuesto).
   - Historial: quantityHistory (valor anterior/nuevo, plano, revision,
     cambios por elemento, actor, fecha) + auditoria append-only.
   Los generadores de OTROS planos del mismo concepto se conservan. */
const MAX_GENERATORS_PER_CONCEPT = 500;
const MAX_QUANTITY_HISTORY = 50;
async function handleSetGenerators(req, res){
  const authz = await requireAuth(req);
  const orgContext = await loadOrgContext(authz.uid);
  assertOrgNotExpired(orgContext);
  const { id, planoId, generators, expectedRevision, reason, planoRevision = null } = req.body || {};
  if(!id || !planoId || !Array.isArray(generators)) throw httpError(400, 'Faltan id/planoId/generators.');
  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc(String(id));
  const planoRef = db.collection('planoTakeoffs').doc(String(planoId));
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const [snap, planoSnap] = await Promise.all([tx.get(docRef), tx.get(planoRef)]);
    if(!snap.exists) throw httpError(404, 'El concepto no existe.');
    const current = snap.data();
    if(!canAccessOrgScopedDoc(current, authz, orgContext)) throw httpError(403, 'Este concepto pertenece a otro usuario.');
    if(current.archivedAt) throw httpError(409, 'El concepto esta archivado.');
    /* F4 -- VALIDACION CONTRA LA GEOMETRIA PERSISTIDA: si el plano vive en
       el servidor, los generadores se RECONSTRUYEN aqui desde su cadModel
       vigente y deben coincidir (elementId + geometryHash) con los que el
       usuario reviso; si no, 409 GEOMETRY_CHANGED (revisar/recalcular).
       Lo que se guarda son los generadores construidos por el SERVIDOR. */
    let serverBuilt = null;
    if(planoSnap.exists){
      const plano = planoSnap.data();
      if(!canAccessOrgScopedDoc(plano, authz, orgContext)) throw httpError(403, 'El plano pertenece a otra empresa.');
      if(plano.projectId && String(plano.projectId) !== String(current.projectId)) throw httpError(400, 'El plano y el concepto pertenecen a proyectos distintos.');
      const geometryChanged = (detail) => { const e = httpError(409, `La geometria del plano cambio desde que se prepararon estos generadores (${detail}). Revisa los cambios y vuelve a recalcular.`); e.code = 'GEOMETRY_CHANGED'; e.currentRevision = Number(plano.revision || 0); return e; };
      if(planoRevision != null && Number(planoRevision) !== Number(plano.revision || 0)) throw geometryChanged(`revision ${planoRevision} vs ${Number(plano.revision || 0)}`);
      serverBuilt = buildConceptGenerators(plano.snapshot?.cadModel, String(id), { planoId: String(planoId), projectId: current.projectId, fileName: plano.fileName || '', sourceRevision: Number(plano.revision || 0) });
      const key = list => JSON.stringify(list.map(g => [g.generatorId, geometryHash(g)]).sort());
      if(key(serverBuilt) !== key(generators)) throw geometryChanged('los elementos o sus medidas no coinciden con el plano guardado');
    }
    const sourceGenerators = serverBuilt || generators;
    const revisions = { ...(current.generatorRevisions || {}) };
    const currentRev = Number(revisions[planoId] || 0);
    if(expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== currentRev){
      const e = httpError(409, `Conflicto de generadores: esperabas la revision ${expectedRevision} del plano, pero la vigente es ${currentRev}. Recarga antes de recalcular.`);
      e.code = 'GENERATOR_CONFLICT'; e.currentRevision = currentRev;
      throw e;
    }
    const now = new Date().toISOString();
    const previousForPlano = (current.generadores || []).filter(g => g.planoId === planoId);
    const prevById = new Map(previousForPlano.map(g => [g.generatorId, g]));
    const incoming = sourceGenerators.map(g => ({
      ...g, planoId: String(planoId), conceptId: String(id), projectId: current.projectId,
      createdAt: prevById.get(g.generatorId)?.createdAt || g.createdAt || now, updatedAt: now
    }));
    const invalid = incoming.map(g => ({ generatorId: g.generatorId, errors: verifyGenerator(g) })).filter(x => x.errors.length);
    if(invalid.length) throw httpError(400, `Generadores invalidos: ${JSON.stringify(invalid)}`);
    if(incoming.some(g => g.planoId !== String(planoId))) throw httpError(400, 'Todos los generadores deben pertenecer al plano indicado.');
    const merged = [...(current.generadores || []).filter(g => g.planoId !== planoId), ...incoming];
    if(merged.length > MAX_GENERATORS_PER_CONCEPT) throw httpError(400, `Demasiados generadores (${merged.length} > ${MAX_GENERATORS_PER_CONCEPT}).`);
    const agg = aggregateGenerators(merged, current.unit);
    const diff = diffGenerators(previousForPlano, incoming);
    const nextRev = currentRev + 1;
    revisions[planoId] = nextRev;
    const historyEntry = {
      at: now, from: Number(current.qty) || 0, to: agg.qty,
      fromSource: current.quantitySource || QUANTITY_SOURCE_KIND.MANUAL, source: QUANTITY_SOURCE_KIND.GENERATORS,
      planoId: String(planoId), revision: nextRev, changes: diff.changes, actor: authz.email || authz.uid, reason: reason || null
    };
    const next = {
      ...current,
      quantitySource: QUANTITY_SOURCE_KIND.GENERATORS,
      generadores: merged,
      elementIds: agg.elementIds,
      qty: agg.qty,
      generatorRevisions: revisions,
      generatorSummary: { counted: agg.countedElementIds, incomplete: agg.incomplete, inconsistent: agg.inconsistent, unitMismatch: agg.unitMismatch },
      quantityHistory: [...(current.quantityHistory || []), historyEntry].slice(-MAX_QUANTITY_HISTORY),
      updatedAt: now
    };
    // F4: confirmar limpia la marca automatica de desactualizacion de este plano.
    const staleMap = { ...(current.generatorStaleness || {}) };
    delete staleMap[planoId];
    next.generatorStaleness = staleMap;
    next.generatorsStale = Object.values(staleMap).some(x => x?.stale);
    historyEntry.geometryVerified = Boolean(serverBuilt);
    historyEntry.planoRevision = serverBuilt ? Number(planoSnap.data().revision || 0) : null;
    const { valid, errors } = validateCatalogConcepto(next);
    if(!valid) throw httpError(400, `Concepto invalido tras recalcular generadores: ${errors.join(' ')}`);
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: next.id, action: 'CATALOGO_CONCEPTO_GENERATORS_UPDATED', previousStatus: String(historyEntry.from), newStatus: String(historyEntry.to),
      actor: authz.uid, actorEmail: authz.email, reason: reason || `Generadores del plano ${planoId} (rev ${nextRev})`, source: 'api',
      projectId: next.projectId, conceptoId: next.id, organizationId: current.organizationId ?? null, ownerUid: authz.uid,
      planoId: String(planoId), revision: nextRev, changes: diff.changes
    });
    return { concepto: next, diff, aggregate: agg, geometryVerified: Boolean(serverBuilt) };
  });
  res.status(200).json(result);
}

const ACTIONS = { create: handleCreate, update: handleUpdate, 'set-status': handleSetStatus, 'associate-apu': handleAssociateApu, archive: handleArchive, 'set-generators': handleSetGenerators };

export default async function handler(req, res){
  try{
    if(req.method === 'GET'){ await handleList(req, res); return; }
    if(req.method !== 'POST'){ res.status(405).json({ error: 'Metodo no permitido.' }); return; }
    const action = req.body?.action;
    const run = ACTIONS[action];
    if(!run) throw httpError(400, `Accion no reconocida: "${action}".`);
    await run(req, res);
  }catch(err){
    const body = { error: err.message || 'No se pudo completar la solicitud.' };
    if(err.code) body.code = err.code;
    if(err.currentRevision !== undefined) body.currentRevision = err.currentRevision; // F3: 409 GENERATOR_CONFLICT
    res.status(err.status || 400).json(body);
  }
}
