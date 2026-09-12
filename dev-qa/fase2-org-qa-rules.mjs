/* [RULES] Segunda mitad del QA de organizacion: verifica, contra las reglas
   REALES de Firestore (firestore.rules) y con un contexto de cliente
   AUTENTICADO restringido (nunca Admin SDK), que un colaborador no puede
   escalar privilegios escribiendo directo a Firestore -- sin pasar por la
   API. Se ejecuta DESPUES de dev-qa/fase2-org-qa.mjs (usa los mismos uids/
   organizationId reales ya creados en el emulador).

   Ejecutar con:
     node dev-qa/fase2-org-qa-rules.mjs <organizationId> <collaboratorUid> <otherOrganizationId>
*/
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

const [, , organizationId, collaboratorUid, otherOrganizationId] = process.argv;
if(!organizationId || !collaboratorUid || !otherOrganizationId){
  throw new Error('Uso: node fase2-org-qa-rules.mjs <organizationId> <collaboratorUid> <otherOrganizationId>');
}

const results = [];
function log(label, ok, detail){ results.push({ label, ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' -- ' + detail : ''}`); }

const testEnv = await initializeTestEnvironment({
  projectId: 'zoemec-plataforma-ia',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 }
});

const collab = testEnv.authenticatedContext(collaboratorUid).firestore();

console.log('\n=== [RULES] Un colaborador NO puede escalar privilegios via escritura directa a Firestore ===');

await assertFails(collab.doc(`organizations/${organizationId}`).update({ maxUsers: 999 }))
  .then(() => log('colaborador NO puede aumentar maxUsers escribiendo directo a organizations/{id}', true))
  .catch((e) => log('colaborador NO puede aumentar maxUsers escribiendo directo a organizations/{id}', false, e.message));

await assertFails(collab.doc(`organizations/${organizationId}`).update({ expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() }))
  .then(() => log('colaborador NO puede extender el trial escribiendo directo a organizations/{id}.expiresAt', true))
  .catch((e) => log('colaborador NO puede extender el trial escribiendo directo a organizations/{id}.expiresAt', false, e.message));

await assertFails(collab.doc(`organizations/${organizationId}/members/${collaboratorUid}`).update({ role: 'org_admin' }))
  .then(() => log('colaborador NO puede auto-ascenderse a org_admin en members/{uid}', true))
  .catch((e) => log('colaborador NO puede auto-ascenderse a org_admin en members/{uid}', false, e.message));

await assertFails(collab.doc(`organizations/${organizationId}/members/${collaboratorUid}`).set({ uid: collaboratorUid, role: 'org_admin', status: 'active' }))
  .then(() => log('colaborador NO puede reemplazar su propio documento de membresia', true))
  .catch((e) => log('colaborador NO puede reemplazar su propio documento de membresia', false, e.message));

// organizationId en users/{uid}: firestore.rules NO fija este campo explicitamente
// (solo protege role/plan/active) -- se prueba el comportamiento REAL, no se asume.
let userDocSelfWriteSucceeded = null;
try{
  await collab.doc(`users/${collaboratorUid}`).update({ organizationId: `${otherOrganizationId}-ATTEMPT-${Date.now()}` });
  userDocSelfWriteSucceeded = true;
}catch(e){
  userDocSelfWriteSucceeded = false;
}
log('[HALLAZGO] escritura directa de users/{uid}.organizationId', !userDocSelfWriteSucceeded,
  userDocSelfWriteSucceeded
    ? 'las reglas SI permiten que el propio usuario reescriba este campo (solo role/plan/active estan explicitamente protegidos) -- ver informe: esto NO otorga acceso real porque isActiveOrgMember() nunca lee este campo, solo la subcoleccion members (bloqueada)'
    : 'rechazado por las reglas');

// Pase lo que pase con el campo de arriba, la pertenencia REAL (lo unico que
// las reglas usan para autorizar) sigue viniendo de members/{uid}, que sigue
// bloqueada -- se confirma que el acceso de lectura a la OTRA organizacion
// sigue denegado incluso si el campo de users/{uid} fue reescrito.
await assertFails(collab.doc(`organizations/${otherOrganizationId}`).get())
  .then(() => log('aunque reescriba users/{uid}.organizationId, el colaborador SIGUE sin poder leer la otra organizacion (autorizacion real via members, no via ese campo)', true))
  .catch((e) => log('aunque reescriba users/{uid}.organizationId, el colaborador SIGUE sin poder leer la otra organizacion', false, e.message));

await assertFails(collab.collection(`organizations/${otherOrganizationId}/members`).get())
  .then(() => log('el colaborador NO puede leer el roster de la otra organizacion', true))
  .catch((e) => log('el colaborador NO puede leer el roster de la otra organizacion', false, e.message));

await assertSucceeds(collab.doc(`organizations/${organizationId}`).get())
  .then(() => log('(control) el colaborador SI puede leer su PROPIA organizacion', true))
  .catch((e) => log('(control) el colaborador SI puede leer su PROPIA organizacion', false, e.message));

console.log('\n=== RESUMEN [RULES] ===');
const failed = results.filter(r => !r.ok);
console.log(`${results.length - failed.length}/${results.length} verificaciones OK`);
if(failed.length){ failed.forEach(f => console.log(' - FALLO:', f.label, f.detail)); }

await testEnv.cleanup();
