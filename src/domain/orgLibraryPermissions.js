/* RBAC de la biblioteca empresarial y derecho a funciones pagadas por
   membresia (P0 paridad ADMIN vs COLLABORATOR). Puro: recibe el orgContext
   que ya arma _orgGuard.mjs#loadOrgContext ({ organizationId, org, member,
   status }) y decide. Mismo criterio que firestore.rules
   (isActiveOrgMember / isCompanyManager) -- las dos deben mantenerse en
   sincronia.

   Separacion explicita (regla 8 del encargo):
   - LEER y USAR la biblioteca para generar APU: cualquier miembro ACTIVO.
     El rol NO interviene aqui.
   - ADMINISTRAR (crear/importar/editar/archivar): solo el responsable de la
     empresa (company_manager / legado org_admin), y solo si la organizacion
     puede crear contenido (trial activo o convertida). */
import { MEMBER_STATUS, isOrgManagerRole, canCreateContent } from './organization.js';

export function isActiveOrgMembership(orgContext){
  return Boolean(orgContext?.organizationId) && orgContext?.member?.status === MEMBER_STATUS.ACTIVE;
}

export function canReadOrgLibrary(orgContext){
  return isActiveOrgMembership(orgContext);
}

export function canManageOrgLibrary(orgContext){
  return isActiveOrgMembership(orgContext)
    && isOrgManagerRole(orgContext.member.role)
    && canCreateContent(orgContext.status);
}

/* Derecho a funciones pagadas (IA, Price Intelligence, cupo de APU) por
   pertenecer a una empresa que paga o esta en trial. Antes solo ACTIVE_TRIAL
   daba este derecho: un colaborador de una empresa CONVERTED (pagada) caia a
   su plan PERSONAL (normalmente Gratis: sin IA, 1 APU al mes) mientras el
   admin siempre era 'Empresa' -- /api/price-intelligence respondia 402 y el
   APU del colaborador se quedaba sin precios de mercado. El derecho depende
   de la MEMBRESIA ACTIVA y del estado de la organizacion, nunca del rol
   dentro de ella: un colaborador y un responsable de la misma empresa
   pagada tienen el mismo acceso a IA. No otorga ningun privilegio de
   administracion ni omite el rate limit. */
export function resolvePaidFeatureEntitlement({ isSuperAdmin = false, orgStatus = null, memberStatus = null } = {}){
  if(isSuperAdmin) return { bypassPlanLimits: true, source: 'super_admin' };
  if(memberStatus === MEMBER_STATUS.ACTIVE && canCreateContent(orgStatus)){
    return { bypassPlanLimits: true, source: 'organization' };
  }
  return { bypassPlanLimits: false, source: 'personal_plan' };
}
