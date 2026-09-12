/* Pruebas de reglas de Firestore para FASE 3 (aprendizaje progresivo
   seguro) -- priceObservations (privado por organizacion) y
   priceRegionalAggregates (anonimo por diseno). Corren con:
     npm run test:pricerules
   Mismo patron/helpers que test/organizations.rules.test.mjs. */
import { after, before, beforeEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'zoemec-pricerules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080
    }
  });
});

after(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

async function seed(setup){
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setup(ctx.firestore());
  });
}

// Org A: alice (activa). Org B: bob (activa) -- para probar aislamiento
// cruzado A/B, mismo criterio que organizations.rules.test.mjs.
async function seedTwoOrgs(db){
  await db.doc('organizations/orgA').set({ id: 'orgA', name: 'Empresa A', status: 'ACTIVE_TRIAL' });
  await db.doc('organizations/orgA/members/alice').set({ uid: 'alice', role: 'company_manager', status: 'active' });
  await db.doc('organizations/orgB').set({ id: 'orgB', name: 'Empresa B', status: 'ACTIVE_TRIAL' });
  await db.doc('organizations/orgB/members/bob').set({ uid: 'bob', role: 'company_manager', status: 'active' });
}

describe('firestore.rules — priceObservations (privado por organizacion)', () => {
  it('nadie escribe priceObservations desde el cliente -- toda escritura pasa por _priceObservationsStore.mjs (SDK admin)', async () => {
    await seed(seedTwoOrgs);
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('priceObservations/obs1').set({ organizationId: 'orgA', precio: 100 }));
  });

  it('un miembro activo SI puede leer una observacion de SU PROPIA organizacion', async () => {
    await seed(async (db) => {
      await seedTwoOrgs(db);
      await db.doc('priceObservations/obs1').set({ organizationId: 'orgA', conceptoNormalizado: 'cemento', precio: 245 });
    });
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('priceObservations/obs1').get());
  });

  it('un miembro de la Empresa B NUNCA puede leer una observacion de la Empresa A, aunque conozca el id', async () => {
    await seed(async (db) => {
      await seedTwoOrgs(db);
      await db.doc('priceObservations/obs1').set({ organizationId: 'orgA', conceptoNormalizado: 'cemento', precio: 245 });
    });
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('priceObservations/obs1').get());
  });

  it('un usuario sin ninguna organizacion no puede leer ninguna observacion', async () => {
    await seed(async (db) => {
      await seedTwoOrgs(db);
      await db.doc('priceObservations/obs1').set({ organizationId: 'orgA', precio: 245 });
    });
    const eve = testEnv.authenticatedContext('eve').firestore();
    await assertFails(eve.doc('priceObservations/obs1').get());
  });

  it('un administrador real SI puede leer observaciones de cualquier organizacion', async () => {
    await seed(async (db) => {
      await seedTwoOrgs(db);
      await db.doc('priceObservations/obs1').set({ organizationId: 'orgA', precio: 245 });
    });
    const admin = testEnv.authenticatedContext('admin1', { super_admin: true }).firestore();
    await assertSucceeds(admin.doc('priceObservations/obs1').get());
  });
});

describe('firestore.rules — priceRegionalAggregates (anonimo, legible por cualquier cuenta autenticada)', () => {
  // Mismo criterio que organizations.rules.test.mjs ("nadie escribe... ni un
  // org_admin"): se prueba contra una cuenta autenticada normal, no contra
  // super_admin -- el catch-all final de firestore.rules (`allow read,
  // write: if isSuperAdmin()`) es una via de escape deliberada para TODA
  // coleccion `write:false` de este archivo (organizations, technicalMemory,
  // apus, etc.), no una particularidad de esta coleccion.
  it('ninguna cuenta autenticada normal escribe priceRegionalAggregates desde el cliente', async () => {
    const carol = testEnv.authenticatedContext('carol').firestore();
    await assertFails(carol.doc('priceRegionalAggregates/bucket1').set({ mediana: 100 }));
  });

  it('CUALQUIER cuenta autenticada puede leer un bucket agregado -- es anonimo por diseno, nunca contiene un organizationId', async () => {
    await seed(async (db) => {
      await db.doc('priceRegionalAggregates/bucket1').set({
        bucketKey: 'bucket1', conceptoNormalizado: 'cemento gris', unidadNormalizada: 'saco',
        nOrganizaciones: 7, nObservaciones: 12, usable: true, mediana: 245,
      });
    });
    const carol = testEnv.authenticatedContext('carol').firestore(); // sin organizacion, sin relacion con el dato
    await assertSucceeds(carol.doc('priceRegionalAggregates/bucket1').get());
  });

  it('una cuenta NO autenticada no puede leer nada', async () => {
    await seed(async (db) => {
      await db.doc('priceRegionalAggregates/bucket1').set({ usable: true, mediana: 245 });
    });
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(anon.doc('priceRegionalAggregates/bucket1').get());
  });
});
