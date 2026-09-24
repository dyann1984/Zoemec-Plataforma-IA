/* Carga server-side del contexto de generacion de APU (P0 paridad ADMIN vs
   COLLABORATOR). Unico lugar que decide QUE datos ve el motor de IA:
   - organizationId SIEMPRE del orgContext (token verificado ->
     users/{uid}.organizationId -> membresia real), nunca del body.
   - Acceso al proyecto con el mismo canAccessOrgScopedDoc que el resto de
     rutas (dueno individual o miembro activo de la misma organizacion).
   - Ninguna rama depende del rol del usuario: un colaborador y el
     responsable de la misma empresa cargan exactamente las mismas capas.
   La decision de precedencia/filtros vive en src/domain/apuContextResolution.js
   (pura, probada sin Firebase). */
import { canAccessOrgScopedDoc } from './_orgGuard.mjs';
import { resolveApuGenerationContext, CONTEXT_MODE } from '../../src/domain/apuContextResolution.js';
import { canReadOrgLibrary, isActiveOrgMembership } from '../../src/domain/orgLibraryPermissions.js';
import { extractAllValidatedCatalogRows } from '../../src/domain/libraryReview.js';
import { REVISION_STATUS } from '../../src/domain/apuReview.js';
import { buildProjectLocationSnapshot } from '../../src/domain/geography.js';

export const ORG_LIBRARY_COLLECTION = 'orgLibrary';
const VALIDATED_APU_STATUSES = new Set([REVISION_STATUS.REVISADO, REVISION_STATUS.VALIDADO_POR_USUARIO]);
const MAX_PERSONAL_ROWS = 5000;

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }

/* Un projectId que ya no existe (ej. id viejo guardado en el navegador) se
   trata como "sin proyecto" con advertencia visible, no como error: no
   expone datos de nadie y antes de este cambio la generacion funcionaba.
   Un proyecto que SI existe pero es ajeno sigue siendo 403. */
const PROJECT_NOT_FOUND = Symbol('PROJECT_NOT_FOUND');
async function loadProject(db, authz, orgContext, projectId){
  if(!projectId) return null;
  const snap = await db.collection('projects').doc(String(projectId)).get();
  if(!snap.exists) return PROJECT_NOT_FOUND;
  const project = snap.data();
  if(!canAccessOrgScopedDoc(project, authz, orgContext)) throw httpError(403, 'No tienes acceso a este proyecto.');
  // canAccessOrgScopedDoc solo compara organizationId: un miembro
  // DESHABILITADO conservaria acceso a los proyectos de la empresa. Aqui se
  // exige membresia activa salvo que sea el dueno individual del proyecto.
  if(project.ownerUid !== authz.uid && !isActiveOrgMembership(orgContext)){
    throw httpError(403, 'Tu acceso a esta empresa no esta activo.');
  }
  return { id: String(projectId), ...project };
}

/* Entradas activas de la biblioteca de UNA organizacion. `projectId` separa
   la capa proyecto (precios propios de ese proyecto) de la capa empresa
   (projectId null). Los precios propios de OTROS proyectos no se usan. */
export async function loadOrgLibraryLayers(db, organizationId, projectId){
  const snap = await db.collection(ORG_LIBRARY_COLLECTION).where('organizationId', '==', String(organizationId)).get();
  const entries = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => !e.archivedAt && e.status !== 'ARCHIVED' && e.status !== 'DRAFT');
  return {
    organization: entries.filter(e => !e.projectId),
    project: projectId ? entries.filter(e => String(e.projectId) === String(projectId)) : [],
    totalActive: entries.length
  };
}

async function loadGlobalLibraryRows(db){
  const snap = await db.collection('library').where('visibility', '==', 'global').get();
  return extractAllValidatedCatalogRows(snap.docs.map(d => ({ id: d.id, ...d.data() })));
}

async function loadHistoricalApuCounts(db, { organizationId, uid }){
  const query = organizationId
    ? db.collection('apus').where('organizationId', '==', String(organizationId))
    : db.collection('apus').where('ownerUid', '==', String(uid));
  const snap = await query.get();
  const apus = snap.docs.map(d => d.data()).filter(a => !a.archivedAt);
  const validated = apus.filter(a => VALIDATED_APU_STATUSES.has(a?.snapshot?.revisionStatus || a?.revisionStatus));
  return { total: apus.length, validated: validated.length };
}

/* requestedMode: 'organization' | 'personal' | null (lo que pide el cliente).
   Decision de modo efectivo:
   - Miembro activo + proyecto de SU organizacion (o sin proyecto): SIEMPRE
     'organization'. Pedir 'personal' sobre un proyecto empresarial no
     cambia el modo (regla 12: el contexto empresarial es el default
     reproducible); para sumar el catalogo personal hay que pedirlo
     explicitamente con includePersonal=true, y queda registrado.
   - Cualquier otro caso (sin organizacion, o proyecto personal): 'personal'
     -- comportamiento historico intacto, usa el catalogo que envia el
     propio usuario. */
export async function loadApuGenerationContext({
  db, authz, orgContext, projectId = null, requestedMode = null, includePersonal = false,
  clientPersonalCatalog = [], concept = '', asOf = null, maxModelRows = undefined
}){
  const loaded = await loadProject(db, authz, orgContext, projectId);
  const projectMissing = loaded === PROJECT_NOT_FOUND;
  const project = projectMissing ? null : loaded;
  const orgReadable = canReadOrgLibrary(orgContext);
  const projectInOrg = !project || (orgReadable && project.organizationId && project.organizationId === orgContext.organizationId);
  const mode = orgReadable && projectInOrg ? CONTEXT_MODE.ORGANIZATION : CONTEXT_MODE.PERSONAL;

  const region = project ? buildProjectLocationSnapshot(project).ubicacionEstructurada : null;
  const hasRegion = region && (region.country || region.state || region.city);
  const personalRows = Array.isArray(clientPersonalCatalog) ? clientPersonalCatalog.slice(0, MAX_PERSONAL_ROWS) : [];

  let orgLayers = { organization: [], project: [], totalActive: 0 };
  if(mode === CONTEXT_MODE.ORGANIZATION){
    orgLayers = await loadOrgLibraryLayers(db, orgContext.organizationId, project?.id || null);
  }
  const [globalRows, historical] = await Promise.all([
    loadGlobalLibraryRows(db),
    loadHistoricalApuCounts(db, { organizationId: mode === CONTEXT_MODE.ORGANIZATION ? orgContext.organizationId : null, uid: authz.uid })
  ]);

  return resolveApuGenerationContext({
    contextMode: mode,
    requestedMode: requestedMode || null,
    includePersonal: mode === CONTEXT_MODE.ORGANIZATION ? includePersonal === true : true,
    organizationId: mode === CONTEXT_MODE.ORGANIZATION ? orgContext.organizationId : null,
    organizationName: mode === CONTEXT_MODE.ORGANIZATION ? (orgContext.org?.name || null) : null,
    projectId: project?.id || null,
    region: hasRegion ? region : null,
    currency: project?.currency || project?.moneda || 'MXN',
    asOf,
    concept,
    layers: {
      project: orgLayers.project,
      organization: orgLayers.organization,
      personal: personalRows,
      global: globalRows
    },
    organizationLibraryCount: orgLayers.totalActive,
    historicalOrgApuCount: historical.total,
    historicalOrgApuValidatedCount: historical.validated,
    extraWarnings: projectMissing
      ? [{ code: 'PROJECT_NOT_FOUND', severity: 'MEDIA', message: `El proyecto ${projectId} no existe: se genero con el contexto de la empresa sin precios de proyecto ni region.` }]
      : [],
    ...(maxModelRows ? { maxModelRows } : {})
  });
}
