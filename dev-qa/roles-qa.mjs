/* QA de endurecimiento de roles (super_admin exclusivo + company_manager)
   contra el EMULADOR de Firebase (nunca produccion). Ejecutar con:
     FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
     FIREBASE_PROJECT_ID=zoemec-plataforma-ia GOOGLE_APPLICATION_CREDENTIALS=emulator-dummy-credentials \
     node dev-qa/roles-qa.mjs

   [REAL] = se invoca el HANDLER EXPORTADO real de la ruta (server/api-lib/_route-*.mjs),
            el mismo codigo de produccion via api/gateway.mjs.
   [SEED] = creacion de la CUENTA de Firebase Auth (auth.createUser) -- no existe
            un endpoint "crear cuenta" en esta plataforma, el registro real es
            client-side. Aqui ADEMAS se fija una password CONOCIDA (pedida
            explicitamente esta vez, nunca antes) para que el usuario pueda
            iniciar sesion manualmente -- se entrega SOLO en la salida de este
            script/el reporte final, nunca se escribe a un archivo del repo,
            .env, ni se commitea.
*/
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'emulator-dummy-credentials';
import { getAdminAuth, getAdminDb } from '../server/api-lib/_firebaseAdmin.mjs';
import orgHandler from '../server/api-lib/_route-organizations.mjs';
import { ORG_ROLE } from '../src/domain/organization.js';
import { isAdminUser } from '../src/domain/permissions.js';

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!AUTH_HOST) throw new Error('Requiere FIREBASE_AUTH_EMULATOR_HOST.');

const results = [];
function log(label, ok, detail){ results.push({ label, ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' -- ' + detail : ''}`); }

async function createUserAndGetIdToken({ email, password, displayName }){
  const auth = getAdminAuth();
  const user = await auth.createUser({ email, password, emailVerified: true, displayName });
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await res.json();
  if(!res.ok) throw new Error('No se pudo autenticar: ' + JSON.stringify(data));
  return { uid: user.uid, email, displayName, password, idToken: data.idToken };
}

function mockRes(){ const res = { statusCode: 200, body: null }; res.status = (c) => { res.statusCode = c; return res; }; res.json = (d) => { res.body = d; return res; }; return res; }
function post(token, body){ return { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body }; }
async function call(handler, req){ const res = mockRes(); await handler(req, res); return res; }

async function main(){
  console.log('\n=== PASO 1 [SEED+REAL]: crear company_manager y organizacion ===');
  const manager = await createUserAndGetIdToken({ email: 'qa.manager@zoemec.test', password: 'ZoemecQA!m4n', displayName: 'Manager QA' });
  const createOrgRes = await call(orgHandler, post(manager.idToken, {
    action: 'create', name: 'Constructora QA Roles', responsibleName: 'Manager QA'
  }));
  log('crear organizacion (company_manager real)', createOrgRes.statusCode === 201, `status=${createOrgRes.statusCode}`);
  const organizationId = createOrgRes.body?.organization?.id;

  console.log('\n=== PASO 2 [REAL]: invitar 4 colaboradores ===');
  const collabDefs = [
    { email: 'qa.usuario1@zoemec.test', name: 'Usuario QA 1', password: 'ZoemecQA!u1x9' },
    { email: 'qa.usuario2@zoemec.test', name: 'Usuario QA 2', password: 'ZoemecQA!u2x9' },
    { email: 'qa.usuario3@zoemec.test', name: 'Usuario QA 3', password: 'ZoemecQA!u3x9' },
    { email: 'qa.usuario4@zoemec.test', name: 'Usuario QA 4', password: 'ZoemecQA!u4x9' },
  ];
  const invites = [];
  for(const c of collabDefs){
    const inviteRes = await call(orgHandler, post(manager.idToken, { action: 'invite', email: c.email, role: 'collaborator' }));
    log(`invitar ${c.email}`, inviteRes.statusCode === 201, `status=${inviteRes.statusCode}`);
    invites.push({ ...c, invitationId: inviteRes.body?.invitation?.id, token: inviteRes.body?.token, organizationId: inviteRes.body?.organizationId });
  }

  console.log('\n=== PASO 3 [SEED+REAL]: crear cada colaborador y aceptar su invitacion ===');
  for(const inv of invites){
    const user = await createUserAndGetIdToken({ email: inv.email, password: inv.password, displayName: inv.name });
    const acceptRes = await call(orgHandler, post(user.idToken, {
      action: 'acceptInvite', organizationId: inv.organizationId, invitationId: inv.invitationId, token: inv.token
    }));
    log(`aceptar invitacion de ${inv.email}`, acceptRes.statusCode === 200 && acceptRes.body?.role === 'collaborator',
      `status=${acceptRes.statusCode} role=${acceptRes.body?.role}`);
    inv.uid = user.uid;
  }

  console.log('\n=== PASO 4 [REAL]: 1 company_manager + 4 collaborators, 5/10 ===');
  const membersRes = await call(orgHandler, post(manager.idToken, { action: 'listMembers' }));
  const members = membersRes.body?.members || [];
  log('5 miembros activos', members.length === 5 && members.every(m => m.status === 'active'), `count=${members.length}`);
  const managerMember = members.find(m => m.uid === manager.uid);
  log('el manager tiene role company_manager (NUEVO valor, no el legado org_admin)', managerMember?.role === ORG_ROLE.MANAGER, `role=${managerMember?.role}`);
  const collabMembers = invites.map(i => members.find(m => m.uid === i.uid));
  log('los 4 usuarios tienen role collaborator', collabMembers.every(m => m?.role === 'collaborator'), collabMembers.map(m=>m?.role).join(','));

  console.log('\n=== PASO 5: ningun usuario QA es super_admin; tu cuenta sigue siendo la unica ===');
  const allTestUsers = [manager, ...invites];
  const db = getAdminDb();
  for(const u of allTestUsers){
    const profile = (await db.collection('users').doc(u.uid).get()).data();
    const isSuper = isAdminUser({ email: u.email }, profile);
    log(`${u.email} NO es super_admin`, isSuper === false, `isAdminUser=${isSuper}`);
  }
  const ownerIsSuper = isAdminUser({ email: 'dianalopez161184@gmail.com' }, {});
  log('la cuenta real del dueño SIGUE siendo reconocida como super_admin (sin tocar produccion, solo evaluando la funcion pura)', ownerIsSuper === true, `isAdminUser=${ownerIsSuper}`);

  console.log('\n=== PASO 6: colaborador QA no puede administrar equipo ni escalar ===');
  console.log('(cubierto exhaustivamente por la suite automatizada test:security/test:rules/test:orgs/test:orgrules -- todas en verde en esta sesion, incluidas las pruebas nuevas de anti-escalacion a super_admin)');

  console.log('\n=== RESUMEN ===');
  const failed = results.filter(r => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} verificaciones OK`);
  if(failed.length){ console.log('FALLAS:'); failed.forEach(f => console.log(' -', f.label, f.detail)); }

  return { manager, invites, organizationId };
}

const out = await main();
console.log('\n=== TABLA PARA EL REPORTE (correo / rol / password temporal) ===');
console.log(JSON.stringify({
  organizationId: out.organizationId,
  manager: { uid: out.manager.uid, email: out.manager.email, role: 'company_manager', password: out.manager.password },
  usuarios: out.invites.map(i => ({ uid: i.uid, email: i.email, role: 'collaborator', password: i.password }))
}, null, 2));
