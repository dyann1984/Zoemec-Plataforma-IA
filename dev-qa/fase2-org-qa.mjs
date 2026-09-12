/* QA de organizacion empresarial con 5 usuarios (Fase 1 -- trial de 30 dias),
   contra el EMULADOR de Firebase (nunca produccion). Ejecutar con:
     FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
     FIREBASE_PROJECT_ID=zoemec-plataforma-ia GOOGLE_APPLICATION_CREDENTIALS=emulator-dummy-credentials \
     node dev-qa/fase2-org-qa.mjs

   FLUJO REAL vs SEED -- documentado explicitamente por cada paso con [REAL]/[SEED]:
   [REAL]  = se invoca el HANDLER EXPORTADO de la ruta real (server/api-lib/_route-*.mjs),
             el mismo codigo que corre en produccion via api/gateway.mjs -- identico
             patron a los archivos test/*.test.mjs de este repo. Nunca se escribe
             directo a Firestore para simular una accion que la API ya ofrece.
   [SEED]  = creacion de la CUENTA de Firebase Auth (auth.createUser) -- esto es
             infraestructura de prueba (no existe un endpoint "crear cuenta" en esta
             plataforma: el registro real ocurre en el cliente via Firebase Auth SDK
             directo, fuera de esta API), equivalente a lo que ya hacen TODOS los
             test/*.test.mjs de este repo (createUserAndGetIdToken).
   [RULES] = verificacion via @firebase/rules-unit-testing con un contexto
             AUTENTICADO restringido (nunca Admin SDK) contra firestore.rules real --
             prueba lo que un cliente conectado directo a Firestore (sin pasar por la
             API) podria o no hacer.
*/
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';
import crypto from 'node:crypto';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';
import orgHandler from '../server/api-lib/_route-organizations.mjs';
import projectsHandler from '../server/api-lib/_route-projects.mjs';
import apusHandler from '../server/api-lib/_route-apus.mjs';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST) throw new Error('Requiere FIREBASE_AUTH_EMULATOR_HOST (emulador de Firebase Auth).');

const results = { steps: [] };
function log(label, ok, detail){
  results.steps.push({ label, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' -- ' + detail : ''}`);
}
function randomPassword(){ return crypto.randomBytes(12).toString('base64url') + 'Aa1!'; }

// [SEED] cuenta de Firebase Auth -- ver nota de cabecera: no existe endpoint API
// para "crear cuenta", el registro real es client-side (Firebase Auth SDK).
async function createUserAndGetIdToken({ email, password = randomPassword(), displayName }){
  const auth = getAdminAuth();
  const user = await auth.createUser({ email, password, emailVerified: true, displayName });
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await res.json();
  if(!res.ok) throw new Error('No se pudo autenticar: ' + JSON.stringify(data));
  return { uid: user.uid, email, displayName, idToken: data.idToken };
}

function mockRes(){
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (d) => { res.body = d; return res; };
  return res;
}
function post(token, body){ return { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body }; }
function get(token, query){ return { method: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {}, query: query || {} }; }
async function call(handler, req){ const res = mockRes(); await handler(req, res); return res; }

async function main(){
  console.log('\n=== PASO 1 [SEED+REAL]: crear administrador y organizacion ===');
  const admin = await createUserAndGetIdToken({ email: 'qa.admin@zoemec.test', displayName: 'Administrador QA' });
  const createOrgRes = await call(orgHandler, post(admin.idToken, {
    action: 'create', name: 'Constructora QA 5 Usuarios', responsibleName: 'Administrador QA'
  }));
  log('crear organizacion (company_manager real)', createOrgRes.statusCode === 201, `status=${createOrgRes.statusCode}`);
  const organizationId = createOrgRes.body?.organization?.id;
  log('trial activo 30 dias', createOrgRes.body?.organization?.status === 'ACTIVE_TRIAL' && createOrgRes.body?.organization?.daysRemaining >= 29,
    `status=${createOrgRes.body?.organization?.status} daysRemaining=${createOrgRes.body?.organization?.daysRemaining}`);
  log('maxUsers=10', createOrgRes.body?.organization?.maxUsers === 10, `maxUsers=${createOrgRes.body?.organization?.maxUsers}`);

  console.log('\n=== PASO 2 [REAL]: generar 4 invitaciones desde el Team Panel (API real, mismo endpoint) ===');
  const collaboratorDefs = [
    { email: 'qa.colaborador1@zoemec.test', name: 'Colaborador QA 1' },
    { email: 'qa.colaborador2@zoemec.test', name: 'Colaborador QA 2' },
    { email: 'qa.colaborador3@zoemec.test', name: 'Colaborador QA 3' },
    { email: 'qa.colaborador4@zoemec.test', name: 'Colaborador QA 4' },
  ];
  const invites = [];
  for(const c of collaboratorDefs){
    const inviteRes = await call(orgHandler, post(admin.idToken, { action: 'invite', email: c.email, role: 'collaborator' }));
    log(`invitar ${c.email}`, inviteRes.statusCode === 201, `status=${inviteRes.statusCode}`);
    invites.push({ ...c, invitationId: inviteRes.body?.invitation?.id, token: inviteRes.body?.token, organizationId: inviteRes.body?.organizationId });
  }

  console.log('\n=== PASO 3 [SEED+REAL]: crear cada colaborador y aceptar su invitacion ===');
  for(const inv of invites){
    const user = await createUserAndGetIdToken({ email: inv.email, displayName: inv.name });
    const acceptRes = await call(orgHandler, post(user.idToken, {
      action: 'acceptInvite', organizationId: inv.organizationId, invitationId: inv.invitationId, token: inv.token
    }));
    log(`aceptar invitacion de ${inv.email}`, acceptRes.statusCode === 200 && acceptRes.body?.role === 'collaborator',
      `status=${acceptRes.statusCode} role=${acceptRes.body?.role}`);
    inv.uid = user.uid; inv.idToken = user.idToken;
  }

  console.log('\n=== PASO 4 [REAL]: verificar que cada token es de UN SOLO USO ===');
  const first = invites[0];
  const reuseAttempt = await call(orgHandler, post(first.idToken, {
    action: 'acceptInvite', organizationId: first.organizationId, invitationId: first.invitationId, token: first.token
  }));
  log('reusar un token ya aceptado es rechazado', reuseAttempt.statusCode !== 200, `status=${reuseAttempt.statusCode} body=${JSON.stringify(reuseAttempt.body)}`);
  // Ademas: alguien MAS (sin invitacion propia) intenta usar el token de otro.
  const outsider = await createUserAndGetIdToken({ email: 'qa.outsider-token-theft@zoemec.test', displayName: 'Outsider' });
  const stolenTokenAttempt = await call(orgHandler, post(outsider.idToken, {
    action: 'acceptInvite', organizationId: invites[1].organizationId, invitationId: invites[1].invitationId, token: invites[1].token
  }));
  log('un token ya usado tampoco lo puede reclamar un tercero', stolenTokenAttempt.statusCode !== 200, `status=${stolenTokenAttempt.statusCode}`);

  console.log('\n=== PASO 5 [REAL]: listMembers -- 5/10 usuarios, mismos organizationId ===');
  const membersRes = await call(orgHandler, post(admin.idToken, { action: 'listMembers' }));
  const members = membersRes.body?.members || [];
  log('5 miembros activos', members.length === 5 && members.every(m => m.status === 'active'), `count=${members.length}`);
  const adminMember = members.find(m => m.uid === admin.uid);
  log('admin tiene role company_manager', adminMember?.role === 'company_manager', `role=${adminMember?.role}`);
  const collabMembers = invites.map(i => members.find(m => m.uid === i.uid));
  log('los 4 colaboradores tienen role collaborator', collabMembers.every(m => m?.role === 'collaborator'), collabMembers.map(m=>m?.role).join(','));

  console.log('\n=== PASO 6 [REAL]: 5/10 -- todavia se pueden invitar 5 mas (cupo) ===');
  const probeInvite = await call(orgHandler, post(admin.idToken, { action: 'invite', email: 'qa.probe-cupo@zoemec.test', role: 'collaborator' }));
  log('cupo permite una 6a invitacion (5/10 -> queda espacio para 5 mas)', probeInvite.statusCode === 201, `status=${probeInvite.statusCode}`);

  console.log('\n=== PASO 7 [REAL]: seguridad -- un colaborador NO puede administrar equipo ===');
  const c1 = invites[0];
  const inviteAsCollab = await call(orgHandler, post(c1.idToken, { action: 'invite', email: 'qa.no-deberia-existir@zoemec.test', role: 'collaborator' }));
  log('colaborador no puede invitar (403)', inviteAsCollab.statusCode === 403, `status=${inviteAsCollab.statusCode}`);
  const disableAsCollab = await call(orgHandler, post(c1.idToken, { action: 'disableMember', targetUid: invites[1].uid }));
  log('colaborador no puede deshabilitar a otro miembro (403)', disableAsCollab.statusCode === 403, `status=${disableAsCollab.statusCode}`);

  console.log('\n=== PASO 8 [REAL]: crear 2 proyectos con ubicacion estructurada ===');
  const projA = await call(projectsHandler, post(admin.idToken, {
    action: 'create', id: 'PRO-QA5-A', name: 'Proyecto A - Monterrey', client: 'Cliente QA A',
    locationCountry: 'MX', locationState: 'Nuevo León', locationCity: 'Monterrey'
  }));
  log('Proyecto A creado (Monterrey, NL, MX)', projA.statusCode === 201, `ubicacion=${projA.body?.project?.ubicacion}`);
  const projB = await call(projectsHandler, post(c1.idToken, {
    action: 'create', id: 'PRO-QA5-B', name: 'Proyecto B - Tecamac', client: 'Cliente QA B',
    locationCountry: 'MX', locationState: 'México', locationCity: 'Tecámac'
  }));
  log('Proyecto B creado por un COLABORADOR (Tecamac, Edomex, MX)', projB.statusCode === 201, `ubicacion=${projB.body?.project?.ubicacion}`);
  log('Proyecto A tiene el organizationId de la organizacion', projA.body?.project?.organizationId === organizationId, projA.body?.project?.organizationId);
  log('Proyecto B (creado por colaborador) tiene el MISMO organizationId', projB.body?.project?.organizationId === organizationId, projB.body?.project?.organizationId);

  console.log('\n=== PASO 9 [REAL]: espacio compartido -- otro colaborador ve AMBOS proyectos ===');
  const c2 = invites[1];
  const listAsC2 = await call(projectsHandler, get(c2.idToken, {}));
  const seenIds = (listAsC2.body?.projects || []).map(p => p.id);
  log('colaborador 2 ve Proyecto A y B (mismo espacio de equipo)', seenIds.includes('PRO-QA5-A') && seenIds.includes('PRO-QA5-B'), seenIds.join(','));

  console.log('\n=== PASO 10 [REAL]: colaboracion real sobre APU -- un usuario crea, otro edita ===');
  const apuFixture = {
    concept: 'Muro de block hueco de concreto 15x20x40', unit: 'm2', cantidadObra: 50,
    materials: [{ descripcion: 'Block hueco 15x20x40', consumo: 12.5, unidad: 'pza', precioUnitario: 12, fuente: { estado: 'ESTIMADO_IA' } }],
    labor: [{ descripcion: 'Albañil (oficial)', cuadrilla: 1, rendimiento: 8, salarioBase: 400, fsr: 1.85, fuente: { estado: 'ESTIMADO_IA' } }],
    equipment: [], consumables: [], seguridad: [], factores: {}
  };
  const apuCreate = await call(apusHandler, post(c2.idToken, { action: 'create', id: 'APU-QA5-1', projectId: 'PRO-QA5-A', apu: apuFixture }));
  log('colaborador 2 crea un APU en el Proyecto A', apuCreate.statusCode === 201, `status=${apuCreate.statusCode}`);
  log('APU creado hereda organizationId', apuCreate.body?.apu?.organizationId === organizationId, apuCreate.body?.apu?.organizationId);
  const c3 = invites[2];
  const editedApu = { ...apuCreate.body.apu.snapshot, cantidadObra: 75 };
  const apuEdit = await call(apusHandler, post(c3.idToken, {
    action: 'save-version', id: 'APU-QA5-1', apu: editedApu, reason: 'QA colaboracion: colaborador 3 ajusta cantidad',
    expectedParentVersionId: apuCreate.body.apu.currentVersion
  }));
  log('colaborador 3 (OTRO usuario) SI puede editar el APU que creo el colaborador 2 (equipo compartido)', apuEdit.statusCode === 200, `status=${apuEdit.statusCode}`);
  log('el cambio de colaborador 3 es visible para todos (organizationId preservado)', apuEdit.body?.apu?.organizationId === organizationId, apuEdit.body?.apu?.organizationId);

  const apuListAsAdmin = await call(apusHandler, get(admin.idToken, { id: 'APU-QA5-1' }));
  log('el admin ve la version mas reciente (cambio de colaborador 3 propagado)', apuListAsAdmin.body?.apu?.snapshot?.cantidadObra === 75, `cantidadObra=${apuListAsAdmin.body?.apu?.snapshot?.cantidadObra}`);

  console.log('\n=== PASO 11 [REAL]: aislamiento -- una organizacion DISTINTA no ve nada de esta ===');
  const otherAdmin = await createUserAndGetIdToken({ email: 'qa.other-org-admin@zoemec.test', displayName: 'Otra Empresa Admin' });
  const otherOrg = await call(orgHandler, post(otherAdmin.idToken, { action: 'create', name: 'Otra Empresa QA', responsibleName: 'Otra Empresa Admin' }));
  log('segunda organizacion creada (control)', otherOrg.statusCode === 201, `id=${otherOrg.body?.organization?.id}`);
  const listAsOtherOrg = await call(projectsHandler, get(otherAdmin.idToken, {}));
  const leaked = (listAsOtherOrg.body?.projects || []).some(p => p.id === 'PRO-QA5-A' || p.id === 'PRO-QA5-B');
  log('la otra organizacion NO ve los proyectos de Constructora QA (sin fuga)', !leaked, `projects=${(listAsOtherOrg.body?.projects||[]).map(p=>p.id).join(',')}`);
  const membersAsOtherOrgAdmin = await call(orgHandler, post(otherAdmin.idToken, { action: 'listMembers' }));
  const crossLeak = (membersAsOtherOrgAdmin.body?.members || []).some(m => m.email?.includes('zoemec.test') && invites.some(i => i.email === m.email));
  log('listMembers de la otra empresa NO trae miembros de Constructora QA (sin fuga)', !crossLeak, JSON.stringify(membersAsOtherOrgAdmin.body?.members?.map(m=>m.email)));
  const directProjectAsOtherAdmin = await call(projectsHandler, get(otherAdmin.idToken, { id: 'PRO-QA5-A' }));
  log('pedir el proyecto A por id directo desde la otra empresa es rechazado (403)', directProjectAsOtherAdmin.statusCode === 403, `status=${directProjectAsOtherAdmin.statusCode}`);

  console.log('\n=== RESUMEN ===');
  const failed = results.steps.filter(s => !s.ok);
  console.log(`${results.steps.length - failed.length}/${results.steps.length} verificaciones OK`);
  if(failed.length){ console.log('FALLAS:'); failed.forEach(f => console.log(' -', f.label, f.detail)); }

  return { admin, invites, organizationId, projA: projA.body?.project, projB: projB.body?.project };
}

const out = await main();
console.log('\n=== DATOS PARA EL REPORTE (sin passwords/tokens) ===');
console.log(JSON.stringify({
  organizationId: out.organizationId,
  admin: { uid: out.admin.uid, email: out.admin.email, displayName: out.admin.displayName },
  collaborators: out.invites.map(i => ({ uid: i.uid, email: i.email, displayName: i.name })),
  projects: [out.projA, out.projB].map(p => ({ id: p.id, name: p.name, ubicacion: p.ubicacion, organizationId: p.organizationId }))
}, null, 2));
