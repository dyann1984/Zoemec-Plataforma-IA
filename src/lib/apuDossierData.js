/* Dossier APU Auditable (Fase 8): capa de datos pura de orquestacion, sin
   dibujar nada (ver apuDossierPdf.js/apuDossierXlsx.js para los
   renderizadores). NUNCA reimplementa un motor -- solo llama a los ya
   existentes y probados (Auditor/Challenge/Confidence/Bid Risk, Fases 1-2) y
   a las APIs autoritativas ya construidas (Memoria Tecnica y decisiones de
   Challenge, Fase 6; Proyecto/APU versionado, Fase 7).

   Regla central del spec (seccion 1): si existe una version server-side, el
   dossier se construye SIEMPRE sobre ESA version, nunca sobre el estado de
   React que el cliente pudiera tener editado o manipulado -- esto es lo que
   hace el dossier "auditable" y no solo "un PDF bonito del estado actual". */
import { finalizeProfessionalAPU } from '../domain/apuProfessional.js';
import { runApuAudit } from '../domain/apuAuditor.js';
import { runApuChallenge, challengeSeverity } from '../domain/apuChallenge.js';
import { runApuConfidence } from '../domain/apuConfidence.js';
import { runBidRisk } from '../domain/bidRisk.js';
import { computeSnapshotHash } from '../domain/snapshotHash.js';
import { apiGetSafe } from '../services/apiClient.js';

const fold = value => String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/* FUENTE DE VERDAD (regla 1 del spec). Si `apuId` tiene un documento real en
   el servidor (Fase 7), esa es la unica fuente valida -- se ignora
   cualquier `apu` que el llamador haya pasado, sin importar que tan
   reciente parezca en React (esto es lo que impide que un `calculated`
   manipulado del cliente se cuele en un dossier "auditable"). Solo cuando
   NO existe ningun registro server-side para ese id se cae, explicitamente
   marcado, al estado local. */
export async function resolveApuSnapshot({ apu, apuId, apuVersionId } = {}){
  if(apuId){
    const data = await apiGetSafe(`/api/apus?id=${encodeURIComponent(apuId)}`);
    if(data?.apu){
      const versions = Array.isArray(data.versions) ? data.versions : [];
      const target = apuVersionId
        ? versions.find(v => v.version === apuVersionId || v.id === apuVersionId)
        : versions.find(v => v.version === data.apu.currentVersion) || versions[versions.length - 1];
      if(target){
        return {
          snapshot: target.snapshot, source: 'SERVER_VERSION', verificationLabel: 'APU AUDITABLE',
          projectId: data.apu.projectId || null, apuId: data.apu.id,
          versionId: target.version, revision: target.version, createdAt: target.at || target.createdAt || null,
          createdBy: target.user || null, allVersions: versions
        };
      }
    }
  }
  // Sin registro server-side (o sin versiones todavia): borrador honesto,
  // nunca presentado como si estuviera respaldado (regla 1 del spec).
  return {
    snapshot: apu || {}, source: 'LOCAL_DRAFT', verificationLabel: 'BORRADOR NO RESPALDADO',
    projectId: null, apuId: apuId || apu?.id || null, versionId: null, revision: null,
    createdAt: null, createdBy: null, allVersions: []
  };
}

/* Decisiones de Challenge persistidas (Fase 6/6.1): se fusionan por
   challengeId con los findings recalculados sobre ESTE snapshot -- si un
   finding ya no existe (porque la version exportada ya no tiene esa
   desviacion), su decision historica no se inventa un finding nuevo, se
   omite (la decision sigue existiendo en su propio registro, solo no
   aplica a este documento en particular). */
export async function loadChallengeDecisions(apuId){
  if(!apuId) return new Map();
  const data = await apiGetSafe(`/api/challenge-decisions?apuId=${encodeURIComponent(apuId)}`);
  const map = new Map();
  (data?.decisions || []).forEach(d => map.set(d.challengeId, d));
  return map;
}

/* Memoria Tecnica del proyecto -- SIN filtrar por relevancia todavia (eso lo
   hace computeApuEngineResults, por-APU, para que el dossier de PROYECTO
   pueda pedir esta lista UNA vez y filtrarla por cada APU sin volver a
   pegarle a la red). Nunca se presenta esta lista completa como si fuera
   "memoria aplicable" -- solo es el insumo crudo. */
export async function loadProjectMemory(projectId){
  if(!projectId) return [];
  const data = await apiGetSafe(`/api/technical-memory?projectId=${encodeURIComponent(projectId)}`);
  return data?.entries || [];
}

/* Comparacion puntual entre la version exportada y su parent inmediato
   (regla 12 del spec: "tabla de cambios relevantes"). Deliberadamente NO
   reusa apu.audit (el log de auditChange de apuVersioning.js, que registra
   ediciones DENTRO de una sesion de edicion, no el diff entre dos versiones
   guardadas -- presentarlo como tal seria inexacto). Compara solo un
   conjunto pequeno y honesto de indicadores de alto nivel ya calculados por
   los motores reales (P.U., severidad de Bid Risk, desviaciones de
   Challenge) -- nunca un diff generico campo-por-campo que podria
   malinterpretar una reestructuracion de renglones como "cambio de valor". */
export function diffVersions(currentSnapshot, currentBidRisk, currentChallenge, parentEntry){
  if(!parentEntry) return null;
  const parentSnapshot = parentEntry.snapshot;
  const changes = [];
  const puBefore = Number(parentEntry.unitPrice);
  const puAfter = Number(currentSnapshot.calculated?.pu);
  if(Number.isFinite(puBefore) && Number.isFinite(puAfter) && puBefore !== puAfter){
    changes.push({ field: 'P.U.', before: puBefore, after: puAfter });
  }
  try{
    const parentChallenge = runApuChallenge(parentSnapshot);
    currentChallenge.challenges.forEach(c => {
      const before = parentChallenge.challenges.find(p => p.id === c.id);
      if(before && before.currentValue !== c.currentValue){
        changes.push({ field: `Rendimiento (${c.resourceDescripcion || c.id})`, before: before.currentValue, after: c.currentValue });
      }
    });
    const parentBidRisk = runBidRisk(parentSnapshot);
    if(parentBidRisk.severity !== currentBidRisk.severity){
      changes.push({ field: 'Bid Risk', before: parentBidRisk.severity, after: currentBidRisk.severity });
    }
  }catch{ /* parent con forma incompatible: se omite ese indicador, nunca se inventa */ }
  return { fromVersion: parentEntry.version, toVersion: null, changes };
}

/* Computo compartido por-APU (Fase 8 Parte 2): extraido de buildDossierData
   para que el dossier de PROYECTO (apuProjectDossierData.js) reuse
   exactamente el mismo calculo por cada APU del proyecto, nunca una copia
   paralela. Recibe el snapshot YA resuelto (server version o borrador) y
   las decisiones de Challenge/memoria YA cargadas -- no hace red por si
   mismo, para que el llamador (proyecto) pueda cargar esas dos cosas UNA
   vez por proyecto en vez de una vez por APU. */
export function computeApuEngineResults(snapshot, { decisionsByChallengeId = new Map(), memoryEntries = [], mode = 'TECNICO' } = {}){
  const audit = runApuAudit(snapshot);
  const challenge = runApuChallenge(snapshot);
  const confidence = runApuConfidence(snapshot, { audit, challenge });
  const bidRisk = runBidRisk(snapshot, { audit, challenge, confidence });

  const challengeFindings = challenge.challenges.map(c => ({
    ...c, severity: challengeSeverity(c.category), decision: decisionsByChallengeId.get(c.id) || null
  }));

  const resourceFolds = new Set(
    ['materials', 'labor', 'equipment', 'consumables'].flatMap(kind => (snapshot[kind] || []).map(r => fold(r.descripcion)))
  );
  const primaryActivity = snapshot.primaryActivity || null;
  const relevantMemory = memoryEntries.filter(e => {
    const subjResource = fold(e.subject?.resourceDescripcion);
    const subjActivity = e.subject?.primaryActivity;
    return (subjResource && resourceFolds.has(subjResource)) || (subjActivity && subjActivity === primaryActivity);
  });
  // Regla 10: "por defecto mostrar APPROVED. Las demas pueden ir en anexo de
  // revision interna si el usuario activa modo tecnico completo. No
  // presentar PROPOSED como conocimiento aprobado."
  const memoryApproved = relevantMemory.filter(e => e.status === 'APPROVED');
  const memoryAnnex = mode === 'TECNICO' ? relevantMemory.filter(e => e.status !== 'APPROVED') : [];

  return { audit, challenge: { ...challenge, challenges: challengeFindings }, confidence, bidRisk, memoryApproved, memoryAnnex };
}

/* Orquestador principal. `mode` ('TECNICO'|'CLIENTE') solo decide que se
   PRESENTA despues (regla 18 del spec) -- todos los motores corren siempre
   igual, nunca se duplican ni se recortan por modo. */
export async function buildDossierData({ apu, apuId, apuVersionId, projectId: projectIdHint, mode = 'TECNICO' } = {}){
  const resolved = await resolveApuSnapshot({ apu, apuId, apuVersionId });
  // Regla 23 (reproducibilidad): una version server-side ya quedo finalizada
  // en el momento en que se guardo (api/apus.mjs#createApuVersion) -- volver
  // a llamar finalizeProfessionalAPU aqui la reprocesaria con un
  // `validatedAt` NUEVO (marca de tiempo real, no determinista) en cada
  // exportacion, rompiendo el hash entre dos exportaciones de la MISMA
  // version. Solo un borrador local (nunca finalizado todavia) necesita
  // pasar por finalizeProfessionalAPU aqui.
  const snapshot = resolved.source === 'SERVER_VERSION' ? resolved.snapshot : finalizeProfessionalAPU(resolved.snapshot);
  const projectId = resolved.projectId || projectIdHint || null;
  const snapshotHash = await computeSnapshotHash(snapshot);

  const [decisionsByChallengeId, memoryEntries] = await Promise.all([
    loadChallengeDecisions(resolved.apuId),
    loadProjectMemory(projectId)
  ]);
  const { audit, challenge, confidence, bidRisk, memoryApproved, memoryAnnex } = computeApuEngineResults(snapshot, { decisionsByChallengeId, memoryEntries, mode });

  const versions = resolved.allVersions || [];
  const currentIndex = versions.findIndex(v => v.version === resolved.versionId);
  const parentEntry = currentIndex > 0 ? versions[currentIndex - 1] : null;
  const versionDiff = mode === 'TECNICO' ? diffVersions(snapshot, bidRisk, challenge, parentEntry) : null;
  if(versionDiff) versionDiff.toVersion = resolved.versionId;

  return {
    mode, snapshot, snapshotHash,
    source: resolved.source, verificationLabel: resolved.verificationLabel,
    projectId, apuId: resolved.apuId, versionId: resolved.versionId, revision: resolved.revision,
    createdAt: resolved.createdAt, createdBy: resolved.createdBy,
    audit, challenge, confidence, bidRisk,
    memoryApproved, memoryAnnex,
    versions, versionDiff
  };
}
