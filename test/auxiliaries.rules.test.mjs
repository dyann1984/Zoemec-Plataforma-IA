/* Pruebas de reglas de Firestore para auxiliares (Fase B -- Cuantificador
   Parametrico ZOEMEC). Corren con:
     npm run test:auxrules
   Mismo patron/helpers que test/evidenceItems.rules.test.mjs. */
import { after, before, beforeEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'zoemec-auxrules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 }
  });
});
after(async () => { await testEnv?.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

async function seed(setup){
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await setup(ctx.firestore()); });
}

function baseAux(overrides = {}){
  return {
    id: 'AUX-1', clave: 'CONC-200', nombre: 'Concreto f\'c=200', unidad: 'm³', categoria: 'concreto',
    composicion: [{ desc: 'Cemento gris CPC 30R', cantidadPorUnidad: 7, unidad: 'saco', precioUnitario: 0, desperdicioPct: 3 }],
    version: 1, origen: 'USUARIO', privado: true, organizationId: null,
    activo: true, notas: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'alice',
    ...overrides
  };
}

describe('firestore.rules — auxiliares (recetas/composiciones del Cuantificador Parametrico)', () => {
  it('cualquier usuario autenticado SI puede leer un auxiliar global (organizationId:null)', async () => {
    await seed(db => db.doc('auxiliares/AUX-1').set(baseAux({ organizationId: null, createdBy: null })));
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(bob.doc('auxiliares/AUX-1').get());
  });

  it('un usuario NO autenticado no puede leer ni un auxiliar global', async () => {
    await seed(db => db.doc('auxiliares/AUX-1').set(baseAux({ organizationId: null, createdBy: null })));
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(anon.doc('auxiliares/AUX-1').get());
  });

  it('un miembro de la organizacion dueña SI puede leer su auxiliar privado; un miembro de OTRA organizacion NO', async () => {
    await seed(async (db) => {
      await db.doc('auxiliares/AUX-1').set(baseAux({ organizationId: 'orgA' }));
      await db.doc('organizations/orgA/members/carol').set({ uid: 'carol', role: 'collaborator', status: 'active' });
      await db.doc('organizations/orgB/members/dave').set({ uid: 'dave', role: 'collaborator', status: 'active' });
    });
    const carol = testEnv.authenticatedContext('carol').firestore();
    const dave = testEnv.authenticatedContext('dave').firestore();
    await assertSucceeds(carol.doc('auxiliares/AUX-1').get());
    await assertFails(dave.doc('auxiliares/AUX-1').get());
  });

  it('un miembro de una organizacion SI puede crear un auxiliar privado propio', async () => {
    await seed(db => db.doc('organizations/orgA/members/alice').set({ uid: 'alice', role: 'collaborator', status: 'active' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('auxiliares/AUX-1').set(baseAux({ organizationId: 'orgA', createdBy: 'alice' })));
  });

  it('nadie puede crear un auxiliar "privado" de una organizacion a la que no pertenece (impersonacion de organizationId)', async () => {
    await seed(db => db.doc('organizations/orgB/members/dave').set({ uid: 'dave', role: 'collaborator', status: 'active' }));
    const dave = testEnv.authenticatedContext('dave').firestore();
    await assertFails(dave.doc('auxiliares/AUX-1').set(baseAux({ organizationId: 'orgA', createdBy: 'dave' })));
  });

  it('nadie puede crear un registro con createdBy de OTRO usuario (impersonacion de autoria)', async () => {
    await seed(db => db.doc('organizations/orgA/members/alice').set({ uid: 'alice', role: 'collaborator', status: 'active' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('auxiliares/AUX-1').set(baseAux({ organizationId: 'orgA', createdBy: 'bob' })));
  });

  it('un usuario normal (no super_admin) NO puede crear un auxiliar global -- solo restaurar/sembrar la base es una operacion de administracion', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('auxiliares/AUX-1').set(baseAux({ organizationId: null, createdBy: 'alice' })));
  });

  it('un miembro de la organizacion dueña SI puede actualizar su auxiliar privado (ej. ajustar la dosificacion), pero no puede cambiarle organizationId', async () => {
    await seed(async (db) => {
      await db.doc('auxiliares/AUX-1').set(baseAux({ organizationId: 'orgA' }));
      await db.doc('organizations/orgA/members/alice').set({ uid: 'alice', role: 'collaborator', status: 'active' });
      await db.doc('organizations/orgB/members/dave').set({ uid: 'dave', role: 'collaborator', status: 'active' });
    });
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('auxiliares/AUX-1').set(baseAux({ organizationId: 'orgA', notas: 'ajustada por la empresa' })));
    await assertFails(alice.doc('auxiliares/AUX-1').set(baseAux({ organizationId: 'orgB' })));
    const dave = testEnv.authenticatedContext('dave').firestore();
    await assertFails(dave.doc('auxiliares/AUX-1').set(baseAux({ organizationId: 'orgA', notas: 'intento de otra empresa' })));
  });

  it('un miembro de la organizacion dueña SI puede borrar su auxiliar privado; un miembro de otra organizacion NO', async () => {
    await seed(async (db) => {
      await db.doc('auxiliares/AUX-1').set(baseAux({ organizationId: 'orgA' }));
      await db.doc('organizations/orgA/members/alice').set({ uid: 'alice', role: 'collaborator', status: 'active' });
      await db.doc('organizations/orgB/members/dave').set({ uid: 'dave', role: 'collaborator', status: 'active' });
    });
    const dave = testEnv.authenticatedContext('dave').firestore();
    await assertFails(dave.doc('auxiliares/AUX-1').delete());
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('auxiliares/AUX-1').delete());
  });

  it('un auxiliar global solo puede borrarlo super_admin, nunca un usuario normal de una organizacion', async () => {
    await seed(async (db) => {
      await db.doc('auxiliares/AUX-1').set(baseAux({ organizationId: null, createdBy: null }));
      await db.doc('organizations/orgA/members/alice').set({ uid: 'alice', role: 'collaborator', status: 'active' });
    });
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('auxiliares/AUX-1').delete());
  });
});
