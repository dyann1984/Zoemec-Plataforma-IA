/* Cliente HTTP hacia /api/organizations (Fase 1: trial empresarial de 30
   dias). Capa de infraestructura delgada, mismo patron que el resto de
   src/services/*.js -- reusa authHeaders/apiPost/readJsonSafe de
   apiClient.js, nunca reimplementa el manejo de errores/token. */
import { authHeaders, apiPost, readJsonSafe } from './apiClient.js';

export async function fetchMyOrganization(){
  const res = await fetch('/api/organizations?action=me', { headers: await authHeaders() });
  const data = await readJsonSafe(res);
  if(!res.ok) throw new Error(data.error || 'No se pudo consultar tu organizacion.');
  return data; // { organization: {...}|null, membership: {...}|null }
}

export function createOrganization({ name, responsibleName }){
  return apiPost('/api/organizations', { action: 'create', name, responsibleName });
}

export function inviteMember({ email, role }){
  return apiPost('/api/organizations', { action: 'invite', email, role });
}

export function acceptInvitation({ organizationId, invitationId, token }){
  return apiPost('/api/organizations', { action: 'acceptInvite', organizationId, invitationId, token });
}

export function listOrganizationMembers(){
  return apiPost('/api/organizations', { action: 'listMembers' }); // POST-only en el backend, ver _route-organizations.mjs
}

export function disableOrganizationMember(targetUid){
  return apiPost('/api/organizations', { action: 'disableMember', targetUid });
}

// Arma el link de invitacion para copiar (nunca se envia por correo en esta
// fase -- decision explicita del brief, ver punto 10 y el plan aprobado).
export function buildInviteLink({ organizationId, invitationId, token }){
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/?invite=${encodeURIComponent(token)}&org=${encodeURIComponent(organizationId)}&inv=${encodeURIComponent(invitationId)}`;
}
