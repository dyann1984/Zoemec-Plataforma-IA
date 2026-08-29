/* Registro de eventos de exportacion del Dossier APU Auditable (Fase 8,
   regla 22 del spec): "cuando se exporte desde una version server-side,
   registrar un evento de exportacion auditable... No guardar el archivo en
   Firestore si no es necesario. Solo registrar el evento." Coleccion
   append-only (nunca update/delete) -- mismo patron plano+`action` que
   api/technical-memory.mjs/api/challenge-decisions.mjs.

   Identidad SIEMPRE de requireAuth (nunca del body). No hay accion de
   lectura publica: cada usuario solo puede listar SUS propios eventos
   (mismo criterio que projects.mjs/apus.mjs -- no es un recurso de
   moderacion compartido). */
import { requireAuth } from '../server/api-lib/_authGuard.mjs';
import { getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';
import { computeSnapshotHash } from '../src/domain/snapshotHash.js';

const COLLECTION = 'exportEvents';
const VALID_FORMATS = new Set(['PDF', 'XLSX']);
const VALID_MODES = new Set(['CLIENTE', 'TECNICO']);
const VALID_SCOPES = new Set(['APU', 'PROJECT']);

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }

/* record (Fase 8 Parte 1 + Parte 2, seccion 13 del spec): dos formas, nunca
   mezcladas -- `scope:'APU'` (por defecto, compatibilidad con Parte 1, un
   solo apuId/apuVersionId/snapshotHash) o `scope:'PROJECT'` (projectId +
   arreglos de versiones/hashes/escenarios seleccionados del dossier de
   proyecto completo). No guarda ningun archivo, solo el evento (regla 13
   explicita: "No guardar archivos en Firestore salvo necesidad real").

   FIX Fase 9 (hallazgo F-003, P1): antes este endpoint guardaba
   apuId/projectId/apuVersionId(s)/snapshotHash(es)/manifestHash EXACTAMENTE
   como los mandaba el cliente, sin verificar que el proyecto/APU referido
   perteneciera al usuario ni que el hash correspondiera a datos reales --
   un evento "auditable" que en realidad era auto-reportado. Ahora: (1) el
   proyecto/APU referido debe existir y pertenecer a authz.uid (mismo
   criterio que api/apus.mjs#handleLinkProject), (2) apuVersionId(s) y
   snapshotHash(es) se recalculan SIEMPRE server-side desde el snapshot
   ACTUAL guardado en Firestore (createApuVersion/computeSnapshotHash, nunca
   el valor que mando el cliente), (3) manifestHash (scope PROJECT) se
   recalcula con la MISMA formula que buildProjectDossierData.js -- mismo
   input determinista, distinto solo si projectId/versiones/hashes reales
   difieren de lo declarado. selectedScenarioIds/mode SI vienen del cliente
   (son metadatos de que eligio exportar, no datos que se puedan falsificar
   para ganar algo -- no representan una entidad ajena). */
async function handleRecord(req, res){
  const authz = await requireAuth(req);
  const {
    scope = 'APU', projectId, apuId, selectedScenarioIds, format, mode
  } = req.body || {};
  if(!VALID_SCOPES.has(scope)) throw httpError(400, `scope invalido: "${scope}". Valores permitidos: ${[...VALID_SCOPES].join(', ')}.`);
  if(!VALID_FORMATS.has(format)) throw httpError(400, `format invalido: "${format}". Valores permitidos: ${[...VALID_FORMATS].join(', ')}.`);
  if(!VALID_MODES.has(mode)) throw httpError(400, `mode invalido: "${mode}". Valores permitidos: ${[...VALID_MODES].join(', ')}.`);

  const db = getAdminDb();
  const docRef = db.collection(COLLECTION).doc();
  let event;
  if(scope === 'PROJECT'){
    if(!projectId) throw httpError(400, 'Falta projectId.');
    const projectSnap = await db.collection('projects').doc(String(projectId)).get();
    if(!projectSnap.exists) throw httpError(404, 'El proyecto no existe.');
    if(projectSnap.data().ownerUid !== authz.uid) throw httpError(403, 'Este proyecto pertenece a otro usuario.');
    const apusSnap = await db.collection('apus').where('projectId', '==', String(projectId)).where('ownerUid', '==', authz.uid).get();
    const realApus = apusSnap.docs.map(d => d.data()).filter(a => !a.archivedAt);
    const apuVersionIds = realApus.map(a => `${a.id}@${a.currentVersion ?? 'SIN_VERSION'}`);
    const snapshotHashes = await Promise.all(realApus.map(a => computeSnapshotHash(a.snapshot || {})));
    const scenarioIds = Array.isArray(selectedScenarioIds) ? selectedScenarioIds : [];
    const manifestHash = await computeSnapshotHash({ projectId: String(projectId), apuVersionIds, snapshotHashes, options: { mode }, selectedScenarioIds: scenarioIds });
    event = {
      id: docRef.id, ownerUid: authz.uid, actor: authz.uid, actorEmail: authz.email, scope,
      projectId: String(projectId), apuVersionIds, snapshotHashes,
      selectedScenarioIds: scenarioIds, manifestHash, format, mode, timestamp: new Date().toISOString()
    };
  }else{
    if(!apuId) throw httpError(400, 'Falta apuId.');
    const apuSnap = await db.collection('apus').doc(String(apuId)).get();
    if(!apuSnap.exists) throw httpError(404, 'El APU no existe.');
    const apuData = apuSnap.data();
    if(apuData.ownerUid !== authz.uid) throw httpError(403, 'Este APU pertenece a otro usuario.');
    const snapshotHash = await computeSnapshotHash(apuData.snapshot || {});
    event = {
      id: docRef.id, ownerUid: authz.uid, actor: authz.uid, actorEmail: authz.email, scope,
      projectId: apuData.projectId || null, apuId: String(apuId), apuVersionId: apuData.currentVersion || null,
      snapshotHash, format, mode, timestamp: new Date().toISOString()
    };
  }
  await docRef.set(event);
  res.status(201).json({ event });
}

async function handleList(req, res){
  const authz = await requireAuth(req);
  const { apuId } = req.query || {};
  const db = getAdminDb();
  let query = db.collection(COLLECTION).where('ownerUid', '==', authz.uid);
  if(apuId) query = query.where('apuId', '==', String(apuId));
  const snap = await query.get();
  res.status(200).json({ events: snap.docs.map(d => d.data()) });
}

export default async function handler(req, res){
  try{
    if(req.method === 'GET'){ await handleList(req, res); return; }
    if(req.method !== 'POST'){ res.status(405).json({ error: 'Metodo no permitido.' }); return; }
    const action = req.body?.action;
    if(action !== 'record') throw httpError(400, `Accion no reconocida: "${action}".`);
    await handleRecord(req, res);
  }catch(err){
    res.status(err.status || 400).json({ error: err.message || 'No se pudo completar la solicitud.' });
  }
}
