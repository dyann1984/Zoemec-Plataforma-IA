/* Reglas de Firestore de la Biblioteca EMPRESARIAL (P0 paridad ADMIN vs
   COLLABORATOR) contra el emulador local. Corren con:
     npm run test:orglibraryrules

   Mismo patron que test/organizations.rules.test.mjs. Verifica lo que el
   encargo pide explicitamente (regla 6 y 21):
   - responsable de la empresa: lee
   - colaborador de la empresa: lee (misma biblioteca que el responsable)
   - colaborador escribe desde el cliente: DENY
   - responsable escribe desde el cliente: DENY por diseno -- toda escritura
     pasa por _route-org-library.mjs (Admin SDK) que exige company_manager
     (probado en test/orgLibraryCore.test.mjs)
   - miembro deshabilitado: DENY
   - usuario de OTRA empresa: DENY
   - usuario sin membresia: DENY
   - auditoria: solo el responsable de ESA empresa */
import { after, before, beforeEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'zoemec-orglibrary-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 }
  });
});
after(async () => { await testEnv?.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

async function seed(){
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('organizations/orgA').set({ id: 'orgA', name: 'BIUMEC QA', status: 'CONVERTED' });
    await db.doc('organizations/orgA/members/manager').set({ uid: 'manager', role: 'company_manager', status: 'active' });
    await db.doc('organizations/orgA/members/collab').set({ uid: 'collab', role: 'collaborator', status: 'active' });
    await db.doc('organizations/orgA/members/disabled').set({ uid: 'disabled', role: 'collaborator', status: 'disabled' });
    await db.doc('organizations/orgB').set({ id: 'orgB', name: 'Empresa B', status: 'CONVERTED' });
    await db.doc('organizations/orgB/members/outsider').set({ uid: 'outsider', role: 'company_manager', status: 'active' });

    await db.doc('orgLibrary/OLIB-A1').set({ id: 'OLIB-A1', organizationId: 'orgA', description: 'Cemento CPC 30R', unit: 'saco', price: 239, status: 'ACTIVE' });
    await db.doc('orgLibrary/OLIB-B1').set({ id: 'OLIB-B1', organizationId: 'orgB', description: 'Cemento CPC 30R', unit: 'saco', price: 250, status: 'ACTIVE' });
    await db.doc('orgLibraryAudit/AUD-A1').set({ organizationId: 'orgA', action: 'ORG_LIBRARY_CREATED' });
  });
}

describe('firestore.rules — orgLibrary (biblioteca empresarial)', () => {
  it('responsable de la empresa lee su biblioteca', async () => {
    await seed();
    await assertSucceeds(testEnv.authenticatedContext('manager').firestore().doc('orgLibrary/OLIB-A1').get());
  });

  it('colaborador de la empresa lee la MISMA biblioteca que el responsable', async () => {
    await seed();
    await assertSucceeds(testEnv.authenticatedContext('collab').firestore().doc('orgLibrary/OLIB-A1').get());
    await assertSucceeds(testEnv.authenticatedContext('collab').firestore()
      .collection('orgLibrary').where('organizationId', '==', 'orgA').get());
  });

  it('colaborador NO escribe la biblioteca desde el cliente', async () => {
    await seed();
    const db = testEnv.authenticatedContext('collab').firestore();
    await assertFails(db.doc('orgLibrary/OLIB-A1').update({ price: 1 }));
    await assertFails(db.doc('orgLibrary/NEW').set({ organizationId: 'orgA', description: 'x', unit: 'pza', price: 1 }));
    await assertFails(db.doc('orgLibrary/OLIB-A1').delete());
  });

  it('responsable tampoco escribe desde el cliente: la escritura pasa por la API (Admin SDK + RBAC)', async () => {
    await seed();
    const db = testEnv.authenticatedContext('manager').firestore();
    await assertFails(db.doc('orgLibrary/OLIB-A1').update({ price: 1 }));
    await assertFails(db.doc('orgLibrary/NEW').set({ organizationId: 'orgA', description: 'x', unit: 'pza', price: 1 }));
  });

  it('miembro DESHABILITADO pierde la lectura de inmediato', async () => {
    await seed();
    await assertFails(testEnv.authenticatedContext('disabled').firestore().doc('orgLibrary/OLIB-A1').get());
  });

  it('usuario de OTRA empresa no lee la biblioteca de la empresa A', async () => {
    await seed();
    const db = testEnv.authenticatedContext('outsider').firestore();
    await assertFails(db.doc('orgLibrary/OLIB-A1').get());
    await assertFails(db.collection('orgLibrary').where('organizationId', '==', 'orgA').get());
    await assertSucceeds(db.doc('orgLibrary/OLIB-B1').get());
  });

  it('usuario autenticado sin membresia no lee ninguna biblioteca empresarial', async () => {
    await seed();
    const db = testEnv.authenticatedContext('stranger').firestore();
    await assertFails(db.doc('orgLibrary/OLIB-A1').get());
    await assertFails(db.doc('orgLibrary/OLIB-B1').get());
  });

  it('usuario anonimo no lee nada', async () => {
    await seed();
    await assertFails(testEnv.unauthenticatedContext().firestore().doc('orgLibrary/OLIB-A1').get());
  });

  it('auditoria: solo el responsable de ESA empresa', async () => {
    await seed();
    await assertSucceeds(testEnv.authenticatedContext('manager').firestore().doc('orgLibraryAudit/AUD-A1').get());
    await assertFails(testEnv.authenticatedContext('collab').firestore().doc('orgLibraryAudit/AUD-A1').get());
    await assertFails(testEnv.authenticatedContext('outsider').firestore().doc('orgLibraryAudit/AUD-A1').get());
  });
});
