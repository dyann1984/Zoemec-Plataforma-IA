/* /api/org-library -- Biblioteca EMPRESARIAL (P0 paridad ADMIN vs
   COLLABORATOR). Despachado por api/gateway.mjs (sin funcion serverless
   nueva, ver VERCEL_HOBBY_COMPAT.md). Solo autentica y despacha: la logica
   y el RBAC viven en _orgLibraryCore.mjs.

   GET  ?projectId=&includeArchived=      -> { entries }         (miembro activo)
   POST action=context-preview            -> { context }         (miembro activo)
   POST action=create                     -> { created, rejected } (responsable)
   POST action=update                     -> { entry }           (responsable)
   POST action=archive                    -> { entry }           (responsable)
   POST action=import-preview             -> { preview }         (responsable)
   POST action=import-commit              -> { result }          (responsable) */
import { requireAuth } from './_authGuard.mjs';
import { getAdminDb } from './_firebaseAdmin.mjs';
import { loadOrgContext, assertOrgNotExpired } from './_orgGuard.mjs';
import {
  listOrgLibrary, previewApuContext, createOrgLibraryEntries, updateOrgLibraryEntry,
  archiveOrgLibraryEntry, previewPersonalImport, commitPersonalImport
} from './_orgLibraryCore.mjs';

function httpError(status, message){ const e = new Error(message); e.status = status; return e; }

export default async function handler(req, res){
  try{
    const authz = await requireAuth(req);
    const orgContext = await loadOrgContext(authz.uid);
    const db = getAdminDb();
    const actor = authz.email || authz.uid;

    if(req.method === 'GET'){
      const { projectId = null, includeArchived } = req.query || {};
      const entries = await listOrgLibrary(db, { orgContext, projectId, includeArchived: includeArchived === 'true' });
      res.status(200).json({ entries, organizationId: orgContext?.organizationId || null });
      return;
    }
    if(req.method !== 'POST'){ res.status(405).json({ error: 'Metodo no permitido.' }); return; }

    const body = req.body || {};
    switch(body.action){
      case 'context-preview': {
        const context = await previewApuContext(db, {
          authz, orgContext, projectId: body.projectId || null, concept: body.concept || '',
          includePersonal: body.includePersonal === true, clientPersonalCatalog: body.catalog || [],
          includeCatalog: body.includeCatalog === true
        });
        res.status(200).json({ context });
        return;
      }
      case 'create': {
        assertOrgNotExpired(orgContext);
        const result = await createOrgLibraryEntries(db, { orgContext, actor, entries: body.entries || [], projectId: body.projectId || null });
        res.status(201).json(result);
        return;
      }
      case 'update': {
        assertOrgNotExpired(orgContext);
        const entry = await updateOrgLibraryEntry(db, { orgContext, actor, id: body.id, patch: body.patch || {} });
        res.status(200).json({ entry });
        return;
      }
      case 'archive': {
        assertOrgNotExpired(orgContext);
        const entry = await archiveOrgLibraryEntry(db, { orgContext, actor, id: body.id });
        res.status(200).json({ entry });
        return;
      }
      case 'import-preview': {
        const preview = await previewPersonalImport(db, { orgContext, authz, rows: body.rows || [], region: body.region || '' });
        res.status(200).json({ preview });
        return;
      }
      case 'import-commit': {
        assertOrgNotExpired(orgContext);
        const result = await commitPersonalImport(db, { orgContext, authz, actor, rows: body.rows || [], region: body.region || '', applyUpdates: body.applyUpdates === true });
        res.status(200).json({ result });
        return;
      }
      default:
        throw httpError(400, `Accion no reconocida: "${body.action}".`);
    }
  }catch(err){
    const body = { error: err.message || 'No se pudo completar la solicitud.' };
    if(err.code) body.code = err.code;
    res.status(err.status || 400).json(body);
  }
}
