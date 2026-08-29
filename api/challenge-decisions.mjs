/* Endpoints reales de decisiones profesionales sobre Challenge (Fase 6,
   endurecido en Fase 6.1). MANTENER/JUSTIFICAR/CORREGIR/DESCARTAR en el
   editor eran estado local (Fase 5) -- Fase 6 las hizo persistentes; Fase
   6.1 corrige dos gaps de integridad que la propia Fase 6 dejo expuestos:

   1. El impacto economico (unitImpact/projectImpact/baseline) que se
      guardaba era el que el CLIENTE ya habia calculado -- un cliente
      modificado podia mandar cualquier numero. Ahora se distinguen dos
      snapshots (ver verifyChallengeSnapshot abajo): `clientSnapshot` (lo que
      el cliente reporta, informativo) y `verifiedSnapshot` (lo que el motor
      determinista del SERVIDOR -- runApuChallenge/calcAPUv2, el mismo de
      siempre, nunca reimplementado aqui -- recalcula). `verificationStatus`
      dice honestamente cual de los dos es el que se puede confiar.

   2. CORRECT (aplicar una correccion sugerida por Challenge al APU) era
      best-effort: el APU ya se habia modificado en React antes de intentar
      registrar la decision, asi que un fallo de red podia dejar "APU
      cambiado + sin registro profesional de por que". Ahora la decision se
      registra en dos fases explicitas (`applicationStatus`), ver
      EscenariosTab#confirmApply en ZoemecIntelligencePanel.jsx: PRIMERO se
      registra PENDING_APPLICATION (si esto falla, el APU nunca se toca),
      LUEGO se aplica localmente, LUEGO se confirma APPLIED_LOCAL_ONLY.

   Por que "LOCAL_ONLY" y no un "APPLIED" simple: este proyecto HOY no tiene
   ninguna API server-side que persista el contenido del APU (confirmado por
   investigacion explicita de Fase 6.1 -- ProfessionalApuEditor.jsx#saveVersion
   solo escribe a localStorage + estado de React del padre via onSave, nunca
   a Firestore). No existe una "fuente autoritativa" del APU contra la cual
   verificar ni una operacion de guardado real con la que ser atomico. Fingir
   "APPLIED" (que sugeriria persistencia durable) seria deshonesto -- por eso
   el estado se llama explicitamente APPLIED_LOCAL_ONLY: aplicado al editor
   en memoria del cliente, nada mas. Si en el futuro existe una API real de
   guardado de APU, este es el unico lugar (mas EscenariosTab) que hay que
   cambiar para que CORRECT participe en una operacion atomica real (o un
   flujo de 2 fases contra esa API, igual que aqui).

   Identidad SIEMPRE de requireAuth (nunca del body). Cualquier usuario
   autenticado puede registrar SU propia decision; modificar una decision ya
   registrada por OTRO usuario requiere admin (regla 4/14N del spec -- no
   existe un dueno de "todas las decisiones de un APU", cada decision tiene
   un autor real). */
import { requireAuth } from '../server/api-lib/_authGuard.mjs';
import { getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';
import { appendAudit } from '../server/api-lib/_decisionAudit.mjs';
import { runApuChallenge, challengeSeverity } from '../src/domain/apuChallenge.js';

const COLLECTION = 'challengeDecisions';
const AUDIT_COLLECTION = 'challengeDecisionAudit';
const VALID_DECISIONS = new Set(['MAINTAIN', 'JUSTIFY', 'CORRECT', 'DISMISS']);
const APPLICATION_STATUSES = new Set(['PENDING_APPLICATION', 'APPLIED_LOCAL_ONLY', 'FAILED']);
const SNAPSHOT_NUMERIC_FIELDS = ['currentValue', 'baselineValue', 'unitImpact', 'projectImpact', 'deltaPct'];
const MONEY_EPSILON = 0.01;

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }
function decisionDocId(apuId, challengeId){
  return `${String(apuId)}__${String(challengeId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/* Nunca persistir NaN/Infinity/strings-monetarios como si fueran una cifra
   real (regla 14J/14K del spec). `null` explicito ("no estimable", ver
   apuChallenge.js#yieldChallenges cuando no hay cantidadObra) se conserva
   como null -- nunca se convierte en 0, que seria un numero falso mas
   peligroso que "no calculable". */
function sanitizeMoney(v){
  if(v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function sanitizeSnapshot(raw){
  if(!raw || typeof raw !== 'object') return null;
  const out = { ...raw };
  for(const field of SNAPSHOT_NUMERIC_FIELDS){
    if(field in out) out[field] = sanitizeMoney(out[field]);
  }
  return out;
}

/* NUCLEO de la correccion #1: recalcula el Challenge server-side con el
   MISMO motor determinista que usa toda la plataforma (nunca una formula
   aparte), a partir del snapshot de APU que el cliente adjunto en esta
   solicitud especifica.

   Limite honesto (investigado antes de implementar, ver comentario de
   cabecera): el CONTENIDO del APU (cantidades, insumos) no tiene hoy una
   copia independiente en el servidor -- viene del cliente en cada request,
   igual que el resto de la plataforma (ProfessionalApuEditor no tiene
   persistencia server-side todavia). Por eso SERVER_VERIFIED significa
   especificamente "estas cifras finales las produjo el motor determinista
   del SERVIDOR, no las declaro el cliente directamente" -- cierra el hueco
   real de tampering aritmetico (un cliente modificado ya no puede simplemente
   escribir projectImpact:1 en el body y que se guarde como si fuera cierto).
   NO pretende ser "verificado contra el estado real y unico del proyecto"
   porque esa fuente no existe todavia; de ahi que nunca se inventa una
   coleccion Firestore paralela de APUs solo para aparentar esa autoridad. */
function verifyChallengeSnapshot({ apuSnapshot, challengeId }){
  if(!apuSnapshot || typeof apuSnapshot !== 'object'){
    return {
      verifiedSnapshot: null,
      verificationStatus: 'UNVERIFIED_CLIENT_SNAPSHOT',
      verificationReason: 'El cliente no envio un snapshot del APU en esta solicitud; el servidor no tuvo con que recalcular.'
    };
  }
  let challenges;
  try{ ({ challenges } = runApuChallenge(apuSnapshot)); }
  catch(err){
    return {
      verifiedSnapshot: null,
      verificationStatus: 'NOT_VERIFIABLE',
      verificationReason: `El motor de Challenge no pudo procesar el snapshot de APU enviado: ${err.message}`
    };
  }
  const found = challenges.find(c => c.id === String(challengeId));
  if(!found){
    return {
      verifiedSnapshot: null,
      verificationStatus: 'NOT_VERIFIABLE',
      verificationReason: `El servidor recalculo Challenge sobre el snapshot de APU enviado, pero no reprodujo ningun hallazgo con id "${challengeId}" (puede ya no aplicar, o no corresponder a este APU).`
    };
  }
  return {
    verifiedSnapshot: {
      category: found.category, currentValue: found.currentValue, baselineValue: found.baselineValue,
      baselineSource: found.baselineSource, deltaPct: found.deltaPct,
      unitImpact: found.unitImpact, projectImpact: found.projectImpact,
      severity: challengeSeverity(found.category)
    },
    verificationStatus: 'SERVER_VERIFIED',
    verificationReason: 'Recalculado por el servidor con runApuChallenge/calcAPUv2 (mismo motor determinista de la plataforma) a partir del snapshot de APU enviado en esta solicitud.'
  };
}

/* NUCLEO de la correccion #6 (deteccion de tampering): compara lo que el
   cliente declaro contra lo que el servidor recalculo. El valor del SERVIDOR
   siempre es el que se guarda como `verifiedSnapshot` -- esta funcion nunca
   sobreescribe nada, solo detecta y documenta la discrepancia para que quede
   en el registro (nunca se descarta en silencio ni se bloquea la decision
   profesional: el ingeniero puede tener razones validas para JUSTIFICAR un
   valor que el motor calcula distinto). */
function compareSnapshots(client, server){
  if(!client || !server) return { clientMismatch: false, differences: [] };
  const differences = [];
  for(const field of SNAPSHOT_NUMERIC_FIELDS){
    const a = client[field], b = server[field];
    const differ = (a == null) !== (b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) > MONEY_EPSILON);
    if(differ) differences.push({ field, client: a ?? null, server: b ?? null });
  }
  if(client.category != null && server.category != null && String(client.category) !== String(server.category)){
    differences.push({ field: 'category', client: client.category, server: server.category });
  }
  return { clientMismatch: differences.length > 0, differences };
}

async function handleList(req, res){
  const authz = await requireAuth(req);
  const { apuId, projectId } = req.query || {};
  if(!apuId && !projectId) throw httpError(400, 'Falta apuId o projectId para listar decisiones.');
  const db = getAdminDb();
  let query = db.collection(COLLECTION);
  query = apuId ? query.where('apuId', '==', String(apuId)) : query.where('projectId', '==', String(projectId));
  const snap = await query.get();
  res.status(200).json({ decisions: snap.docs.map(d => d.data()), requestedBy: authz.uid });
}

/* RECORD (crear o actualizar la decision de un challenge especifico, regla
   12/13 -- idempotente por construccion: el id determinista apuId+challengeId
   hace que repetir la misma accion sea un upsert, nunca un duplicado).

   Verificacion server-side (correccion #1): SIEMPRE se recalcula cuando el
   cliente adjunta `apuSnapshot` en esta llamada. La 2a fase del flujo CORRECT
   (confirmar APPLIED_LOCAL_ONLY, ver cabecera) no reenvia el APU -- en ese
   punto el APU YA fue corregido en el cliente, recalcular contra el nuevo
   estado daria "ya no encuentro el hallazgo" y borraria la verificacion
   valida de la fase 1. Por eso: si esta llamada no trae apuSnapshot, se
   PRESERVA la verificacion que ya existia en el documento (nunca se degrada
   un SERVER_VERIFIED real a UNVERIFIED solo porque una llamada de
   seguimiento no volvio a mandar el APU completo). */
async function handleRecord(req, res){
  const authz = await requireAuth(req);
  const {
    apuId, projectId, challengeId, decision, reason,
    clientSnapshot: rawClientSnapshot, snapshot: legacySnapshot, // 'snapshot' = nombre de campo anterior a Fase 6.1, aceptado por compatibilidad
    apuSnapshot, requestedChange, applicationStatus
  } = req.body || {};
  if(!apuId || !challengeId) throw httpError(400, 'Faltan apuId/challengeId.');
  if(!VALID_DECISIONS.has(decision)) throw httpError(400, `Decision invalida: "${decision}". Valores permitidos: ${[...VALID_DECISIONS].join(', ')}.`);
  if(applicationStatus != null && !APPLICATION_STATUSES.has(applicationStatus)){
    throw httpError(400, `applicationStatus invalido: "${applicationStatus}". Valores permitidos: ${[...APPLICATION_STATUSES].join(', ')}.`);
  }
  const clientSnapshotInput = rawClientSnapshot || legacySnapshot || null;
  const sanitizedClientSnapshot = clientSnapshotInput ? sanitizeSnapshot(clientSnapshotInput) : null;

  const db = getAdminDb();
  const docId = decisionDocId(apuId, challengeId);
  const docRef = db.collection(COLLECTION).doc(docId);
  const auditRef = db.collection(AUDIT_COLLECTION).doc();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const existing = snap.exists ? snap.data() : null;
    // Regla 14N: un usuario sin permiso no modifica la decision ajena de otro.
    if(existing && existing.actorUid !== authz.uid && authz.role !== 'admin'){
      throw httpError(403, 'Esta decision ya fue registrada por otro usuario. Solo el autor original o un administrador puede modificarla.');
    }

    const verification = apuSnapshot
      ? verifyChallengeSnapshot({ apuSnapshot, challengeId })
      : existing
        ? { verifiedSnapshot: existing.verifiedSnapshot ?? null, verificationStatus: existing.verificationStatus || 'UNVERIFIED_CLIENT_SNAPSHOT', verificationReason: existing.verificationReason || null }
        : verifyChallengeSnapshot({ apuSnapshot: null, challengeId });
    const finalClientSnapshot = sanitizedClientSnapshot || existing?.clientSnapshot || null;
    const { clientMismatch, differences } = compareSnapshots(finalClientSnapshot, verification.verifiedSnapshot);

    const now = new Date().toISOString();
    const next = {
      id: docId, apuId: String(apuId), projectId: (projectId !== undefined ? projectId : existing?.projectId) || null, challengeId: String(challengeId),
      decision, reason: (reason !== undefined ? reason : existing?.reason) || null,
      // Dos snapshots separados (correccion #1/#4 -- nunca mezclados):
      clientSnapshot: finalClientSnapshot,
      verifiedSnapshot: verification.verifiedSnapshot,
      verificationStatus: verification.verificationStatus,
      verificationReason: verification.verificationReason,
      clientMismatch, differences,
      requestedChange: (requestedChange !== undefined ? requestedChange : existing?.requestedChange) || null,
      // Solo tiene sentido para CORRECT; null para MAINTAIN/JUSTIFY/DISMISS.
      applicationStatus: applicationStatus !== undefined ? applicationStatus : (existing?.applicationStatus ?? null),
      actorUid: authz.uid, actorEmail: authz.email,
      createdAt: existing?.createdAt || now, updatedAt: now,
      previousDecision: existing?.decision || null
    };
    tx.set(docRef, next);
    appendAudit(tx, auditRef, {
      entryId: docId, action: existing ? 'DECISION_UPDATED' : 'DECISION_RECORDED',
      previousStatus: existing?.decision || null, newStatus: decision,
      actor: authz.uid, actorEmail: authz.email, reason: reason || null, source: 'api',
      projectId: next.projectId, apuId: String(apuId), organizationId: null,
      // Trazabilidad adicional pedida en regla 12 del spec Fase 6.1: que
      // encontro Challenge (verifiedSnapshot), si el cliente mando algo
      // distinto (clientMismatch) y en que estado de aplicacion quedo.
      verificationStatus: verification.verificationStatus, clientMismatch,
      applicationStatus: next.applicationStatus
    });
    return next;
  });
  res.status(200).json({ decision: result });
}

export default async function handler(req, res){
  try{
    if(req.method === 'GET'){ await handleList(req, res); return; }
    if(req.method !== 'POST'){ res.status(405).json({ error: 'Metodo no permitido.' }); return; }
    const { action } = req.body || {};
    if(action !== 'record') throw httpError(400, `Accion no reconocida: "${action}".`);
    await handleRecord(req, res);
  }catch(err){
    res.status(err.status || 400).json({ error: err.message || 'No se pudo completar la solicitud.' });
  }
}
