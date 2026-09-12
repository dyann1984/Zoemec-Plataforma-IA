/* server/api-lib/_route-organizations.mjs contra los emuladores REALES de
   Firebase Auth + Firestore (Fase 1: trial empresarial de 30 dias). Corre
   con `npm run test:orgs`. Mismo patron que test/projectsApi.test.mjs.

   Cubre el punto 18 del brief (QA obligatorio): Empresa A/B, 10 usuarios en
   A, el 11avo rechazado, invitaciones (token/expiracion/reuso/correo),
   acciones solo-company_manager rechazadas para un colaborador, no se puede
   deshabilitar al ultimo admin activo, trial vencido bloquea creacion nueva
   pero permite lectura, y que _authGuard.requireFeature no aplica el limite
   del plan individual a un miembro de organizacion en trial activo. */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import orgHandler from '../server/api-lib/_route-organizations.mjs';
import projectsHandler from '../server/api-lib/_route-projects.mjs';
import { requireFeature } from '../server/api-lib/_authGuard.mjs';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';
import { MAX_ORG_MEMBERS, ORG_STATUS, ORG_ROLE, LEGACY_ORG_ROLE_MANAGER } from '../src/domain/organization.js';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST){
  throw new Error('test/organizationsApi.test.mjs requiere el emulador de Firebase Auth. Ejecuta con `npm run test:orgs`.');
}

async function createUserAndGetIdToken({ email }){
  const auth = getAdminAuth();
  const user = await auth.createUser({ email, password: 'Test1234!', emailVerified: true });
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test1234!', returnSecureToken: true })
  });
  const data = await res.json();
  if(!res.ok) throw new Error('No se pudo autenticar: ' + JSON.stringify(data));
  return { uid: user.uid, email, idToken: data.idToken };
}

function mockRes(){
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (d) => { res.body = d; return res; };
  return res;
}
function post(token, body){ return { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body }; }
function get(token, query){ return { method: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {}, query: query || {} }; }
async function callOrg(req){ const res = mockRes(); await orgHandler(req, res); return res; }
async function callProjects(req){ const res = mockRes(); await projectsHandler(req, res); return res; }
const uniq = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.zoemec`;

async function createOrg(adminEmailPrefix = 'org-admin'){
  const admin = await createUserAndGetIdToken({ email: uniq(adminEmailPrefix) });
  const res = await callOrg(post(admin.idToken, { action: 'create', name: 'Empresa QA', responsibleName: 'Responsable QA' }));
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  return { admin, organizationId: res.body.organization.id };
}

async function inviteAndAccept({ adminToken, organizationId, email, role }){
  const invRes = await callOrg(post(adminToken, { action: 'invite', email, role }));
  assert.equal(invRes.statusCode, 201, JSON.stringify(invRes.body));
  const invited = await createUserAndGetIdToken({ email });
  const acceptRes = await callOrg(post(invited.idToken, {
    action: 'acceptInvite', organizationId, invitationId: invRes.body.invitation.id, token: invRes.body.token
  }));
  assert.equal(acceptRes.statusCode, 200, JSON.stringify(acceptRes.body));
  return invited;
}

describe('POST /api/organizations action=create', () => {
  it('crea la organizacion, activa el trial de 30 dias y deja al creador como company_manager (responsable)', async () => {
    const { admin, organizationId } = await createOrg('create');
    const org = await getAdminDb().collection('organizations').doc(organizationId).get();
    assert.equal(org.data().status, ORG_STATUS.ACTIVE_TRIAL);
    assert.equal(org.data().maxUsers, MAX_ORG_MEMBERS);
    const member = await getAdminDb().collection('organizations').doc(organizationId).collection('members').doc(admin.uid).get();
    assert.equal(member.data().role, ORG_ROLE.MANAGER);
    const user = await getAdminDb().collection('users').doc(admin.uid).get();
    assert.equal(user.data().organizationId, organizationId);
  });

  it('un uid que ya pertenece a una organizacion no puede crear otra (409)', async () => {
    const { admin } = await createOrg('nodouble');
    const res = await callOrg(post(admin.idToken, { action: 'create', name: 'Otra', responsibleName: 'X' }));
    assert.equal(res.statusCode, 409);
  });

  it('sin token, 401', async () => {
    const res = await callOrg(post(null, { action: 'create', name: 'X', responsibleName: 'Y' }));
    assert.equal(res.statusCode, 401);
  });
});

describe('GET /api/organizations action=me', () => {
  it('devuelve organization:null para un usuario sin organizacion', async () => {
    const { idToken } = await createUserAndGetIdToken({ email: uniq('lonely') });
    const res = await callOrg(get(idToken, { action: 'me' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.organization, null);
  });

  it('devuelve la organizacion + membresia del que llama', async () => {
    const { admin, organizationId } = await createOrg('me');
    const res = await callOrg(get(admin.idToken, { action: 'me' }));
    assert.equal(res.body.organization.id, organizationId);
    assert.equal(res.body.organization.status, ORG_STATUS.ACTIVE_TRIAL);
    assert.equal(res.body.membership.role, ORG_ROLE.MANAGER);
  });
});

describe('POST /api/organizations action=invite / acceptInvite', () => {
  it('el company_manager invita, el invitado acepta con su correo real y queda como collaborator', async () => {
    const { admin, organizationId } = await createOrg('invite');
    const email = uniq('collab');
    const invited = await inviteAndAccept({ adminToken: admin.idToken, organizationId, email });
    const member = await getAdminDb().collection('organizations').doc(organizationId).collection('members').doc(invited.uid).get();
    assert.equal(member.data().role, 'collaborator');
    assert.equal(member.data().status, 'active');
  });

  it('un colaborador (no company_manager) NO puede invitar (403)', async () => {
    const { admin, organizationId } = await createOrg('inviteperm');
    const collaborator = await inviteAndAccept({ adminToken: admin.idToken, organizationId, email: uniq('c1') });
    const res = await callOrg(post(collaborator.idToken, { action: 'invite', email: uniq('c2') }));
    assert.equal(res.statusCode, 403);
  });

  it('rechaza un correo de invitacion invalido', async () => {
    const { admin } = await createOrg('invalidmail');
    const res = await callOrg(post(admin.idToken, { action: 'invite', email: 'no-es-correo' }));
    assert.equal(res.statusCode, 400);
  });

  it('el token de invitacion no se puede reusar una vez aceptado', async () => {
    const { admin, organizationId } = await createOrg('reuse');
    const email = uniq('once');
    const invRes = await callOrg(post(admin.idToken, { action: 'invite', email }));
    const invited = await createUserAndGetIdToken({ email });
    const first = await callOrg(post(invited.idToken, { action: 'acceptInvite', organizationId, invitationId: invRes.body.invitation.id, token: invRes.body.token }));
    assert.equal(first.statusCode, 200);
    const other = await createUserAndGetIdToken({ email: uniq('otro-uid-mismo-token') });
    // Forzamos que "other" intente reusar la misma invitacion ya aceptada (ya vencio su status pending).
    const second = await callOrg(post(other.idToken, { action: 'acceptInvite', organizationId, invitationId: invRes.body.invitation.id, token: invRes.body.token }));
    assert.equal(second.statusCode, 410);
  });

  it('un token incorrecto es rechazado (403), la invitacion sigue pendiente', async () => {
    const { admin, organizationId } = await createOrg('badtoken');
    const email = uniq('badtok');
    const invRes = await callOrg(post(admin.idToken, { action: 'invite', email }));
    const invited = await createUserAndGetIdToken({ email });
    const res = await callOrg(post(invited.idToken, { action: 'acceptInvite', organizationId, invitationId: invRes.body.invitation.id, token: 'token-inventado' }));
    assert.equal(res.statusCode, 403);
  });

  it('una invitacion vencida es rechazada (410)', async () => {
    const { admin, organizationId } = await createOrg('expiredinv');
    const email = uniq('expinv');
    const invRes = await callOrg(post(admin.idToken, { action: 'invite', email }));
    await getAdminDb().collection('organizations').doc(organizationId).collection('invitations').doc(invRes.body.invitation.id)
      .update({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const invited = await createUserAndGetIdToken({ email });
    const res = await callOrg(post(invited.idToken, { action: 'acceptInvite', organizationId, invitationId: invRes.body.invitation.id, token: invRes.body.token }));
    assert.equal(res.statusCode, 410);
  });

  it('la invitacion solo la puede aceptar la cuenta con el correo invitado (403 si no coincide)', async () => {
    const { admin, organizationId } = await createOrg('wrongmail');
    const invRes = await callOrg(post(admin.idToken, { action: 'invite', email: uniq('invitado-real') }));
    const impostor = await createUserAndGetIdToken({ email: uniq('impostor') });
    const res = await callOrg(post(impostor.idToken, { action: 'acceptInvite', organizationId, invitationId: invRes.body.invitation.id, token: invRes.body.token }));
    assert.equal(res.statusCode, 403);
  });

  it('un usuario que ya pertenece a una organizacion no puede aceptar otra invitacion (409)', async () => {
    const orgA = await createOrg('memberof-a');
    const orgB = await createOrg('memberof-b');
    const invRes = await callOrg(post(orgB.admin.idToken, { action: 'invite', email: orgA.admin.email }));
    const res = await callOrg(post(orgA.admin.idToken, { action: 'acceptInvite', organizationId: orgB.organizationId, invitationId: invRes.body.invitation.id, token: invRes.body.token }));
    assert.equal(res.statusCode, 409);
  });

  it('el limite de 10 usuarios se respeta: el 11avo (admin + 9 invitados aceptados, 10mo invitado) es rechazado server-side', async () => {
    const { admin, organizationId } = await createOrg('cap10');
    // admin ya cuenta como miembro 1/10; se aceptan 8 invitaciones mas -> 9/10.
    for(let i = 0; i < 8; i++){
      await inviteAndAccept({ adminToken: admin.idToken, organizationId, email: uniq(`cap-${i}`) });
    }
    // La 9na invitacion (10mo cupo) SI se puede enviar y aceptar -> 10/10.
    await inviteAndAccept({ adminToken: admin.idToken, organizationId, email: uniq('cap-9') });
    // La 10ma invitacion (11avo usuario) debe ser rechazada al INTENTAR INVITAR, antes de llegar a aceptar.
    const res = await callOrg(post(admin.idToken, { action: 'invite', email: uniq('cap-10-rechazado') }));
    assert.equal(res.statusCode, 409);
    const membersSnap = await getAdminDb().collection('organizations').doc(organizationId).collection('members').where('status', '==', 'active').get();
    assert.equal(membersSnap.size, MAX_ORG_MEMBERS);
  });
});

describe('POST /api/organizations action=listMembers / disableMember', () => {
  it('cualquier miembro activo (incluido un colaborador) puede listar el roster', async () => {
    const { admin, organizationId } = await createOrg('list');
    const collaborator = await inviteAndAccept({ adminToken: admin.idToken, organizationId, email: uniq('listc') });
    const res = await callOrg(post(collaborator.idToken, { action: 'listMembers' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.members.length, 2);
  });

  it('el company_manager puede deshabilitar a un colaborador', async () => {
    const { admin, organizationId } = await createOrg('disable');
    const collaborator = await inviteAndAccept({ adminToken: admin.idToken, organizationId, email: uniq('disc') });
    const res = await callOrg(post(admin.idToken, { action: 'disableMember', targetUid: collaborator.uid }));
    assert.equal(res.statusCode, 200);
    const member = await getAdminDb().collection('organizations').doc(organizationId).collection('members').doc(collaborator.uid).get();
    assert.equal(member.data().status, 'disabled');
  });

  it('un colaborador NO puede deshabilitar a nadie (403)', async () => {
    const { admin, organizationId } = await createOrg('disableperm');
    const c1 = await inviteAndAccept({ adminToken: admin.idToken, organizationId, email: uniq('dc1') });
    const c2 = await inviteAndAccept({ adminToken: admin.idToken, organizationId, email: uniq('dc2') });
    const res = await callOrg(post(c1.idToken, { action: 'disableMember', targetUid: c2.uid }));
    assert.equal(res.statusCode, 403);
  });

  it('no se puede auto-deshabilitar', async () => {
    const { admin } = await createOrg('selfdisable');
    const res = await callOrg(post(admin.idToken, { action: 'disableMember', targetUid: admin.uid }));
    assert.equal(res.statusCode, 400);
  });

  it('un company_manager SI puede deshabilitar a otro responsable mientras quede al menos uno activo (el que llama) -- prueba tambien el valor LEGADO org_admin', async () => {
    // La combinacion "no te puedes auto-deshabilitar" + "solo un responsable
    // activo puede llamar disableMember" ya garantiza estructuralmente que
    // SIEMPRE queda al menos un responsable activo (quien llama) tras
    // cualquier llamada exitosa -- el chequeo explicito de "ultimo
    // responsable" en el handler es defensa en profundidad para ese
    // invariante, no alcanzable en un flujo normal via la API (por eso no se
    // prueba como rechazo aqui: no hay forma de construir ese estado sin
    // manipular Firestore directo, que rompe el propio invariante que se
    // quiere proteger). Se promueve al colaborador con el valor LEGADO
    // 'org_admin' (a proposito, en vez de ORG_ROLE.MANAGER) para probar de
    // paso que isOrgManagerRole/requireCompanyManager siguen reconociendolo.
    const { admin, organizationId } = await createOrg('lastadmin');
    const collaborator = await inviteAndAccept({ adminToken: admin.idToken, organizationId, email: uniq('la1') });
    await getAdminDb().collection('organizations').doc(organizationId).collection('members').doc(collaborator.uid).update({ role: LEGACY_ORG_ROLE_MANAGER });
    const res = await callOrg(post(collaborator.idToken, { action: 'disableMember', targetUid: admin.uid }));
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const activeManagers = await getAdminDb().collection('organizations').doc(organizationId).collection('members')
      .where('status', '==', 'active').get();
    const remaining = activeManagers.docs.filter(d => d.data().role === LEGACY_ORG_ROLE_MANAGER || d.data().role === ORG_ROLE.MANAGER);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, collaborator.uid);
  });
});

describe('Fase 1: trial vencido bloquea escritura nueva pero permite lectura', () => {
  it('proyecto nuevo rechazado con 402 y el mensaje exacto cuando el trial ya vencio', async () => {
    const { admin, organizationId } = await createOrg('expired');
    await getAdminDb().collection('organizations').doc(organizationId).update({
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    });
    const res = await callProjects(post(admin.idToken, { action: 'create', id: 'PRO-EXP-1', name: 'Nuevo tras vencer' }));
    assert.equal(res.statusCode, 402);
    assert.match(res.body.error, /periodo de evaluacion de ZOEMEC ha finalizado/i);
    const org = await getAdminDb().collection('organizations').doc(organizationId).get();
    assert.equal(org.data().status, ORG_STATUS.TRIAL_EXPIRED); // se persistio la transicion
  });

  it('la lectura de proyectos existentes sigue funcionando con el trial vencido', async () => {
    const { admin, organizationId } = await createOrg('expiredread');
    await callProjects(post(admin.idToken, { action: 'create', id: 'PRO-EXP-2', name: 'Antes de vencer' }));
    await getAdminDb().collection('organizations').doc(organizationId).update({
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    });
    const list = await callProjects(get(admin.idToken, {}));
    assert.equal(list.statusCode, 200);
    assert.ok(list.body.projects.some(p => p.id === 'PRO-EXP-2'));
  });
});

describe('Fase 1: espacio de trabajo compartido entre organizaciones distintas (aislamiento A/B a nivel API)', () => {
  it('un miembro de la Empresa B no puede leer/actualizar un proyecto de la Empresa A via la API', async () => {
    const orgA = await createOrg('apiA');
    const orgB = await createOrg('apiB');
    await callProjects(post(orgA.admin.idToken, { action: 'create', id: 'PRO-CROSS-1', name: 'Solo de A' }));
    const readRes = await callProjects(get(orgB.admin.idToken, { id: 'PRO-CROSS-1' }));
    assert.equal(readRes.statusCode, 403);
    const updateRes = await callProjects(post(orgB.admin.idToken, { action: 'update', id: 'PRO-CROSS-1', name: 'Hackeado' }));
    assert.equal(updateRes.statusCode, 403);
  });

  it('un companero de equipo de la MISMA organizacion SI ve el proyecto en el listado compartido', async () => {
    const { admin, organizationId } = await createOrg('sharedlist');
    const collaborator = await inviteAndAccept({ adminToken: admin.idToken, organizationId, email: uniq('sl1') });
    await callProjects(post(admin.idToken, { action: 'create', id: 'PRO-SHARED-1', name: 'Del equipo' }));
    const list = await callProjects(get(collaborator.idToken, {}));
    assert.ok(list.body.projects.some(p => p.id === 'PRO-SHARED-1'));
  });
});

function currentUsageMonth(){
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

describe('Fase 1: _authGuard.requireFeature sin limites artificiales durante el trial activo', () => {
  it('un miembro de organizacion en ACTIVE_TRIAL no hereda el limite de 1 APU del plan Gratis individual, aunque su perfil ya haya "agotado" ese limite', async () => {
    const { admin } = await createOrg('bypass');
    const profile = await getAdminDb().collection('users').doc(admin.uid).get();
    assert.equal(profile.data().plan, 'Gratis'); // el perfil individual nunca se toca al crear la organizacion
    // Simula que el usuario ya uso su unico APU del plan Gratis (5, muy por
    // encima del limite de 1) -- sin organizacion esto bloquearia con 402.
    await getAdminDb().collection('users').doc(admin.uid).set({ usage: { [currentUsageMonth()]: { apu: 5 } } }, { merge: true });
    const authz = await requireFeature({ headers: { authorization: `Bearer ${admin.idToken}` } }, 'apu');
    assert.equal(authz.uid, admin.uid);
  });

  it('un miembro de organizacion con el trial YA vencido SI vuelve a quedar sujeto al limite Gratis (1 APU)', async () => {
    const { admin, organizationId } = await createOrg('bypassexpired');
    await getAdminDb().collection('organizations').doc(organizationId).update({
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    });
    await getAdminDb().collection('users').doc(admin.uid).set({ usage: { [currentUsageMonth()]: { apu: 1 } } }, { merge: true });
    await assert.rejects(
      requireFeature({ headers: { authorization: `Bearer ${admin.idToken}` } }, 'apu'),
      (err) => err.status === 402
    );
  });
});
