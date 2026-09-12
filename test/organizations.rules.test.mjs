/* Pruebas de reglas de Firestore para Organizaciones / Trial Empresarial
   (Fase 1) contra el emulador local. Corren con:
     npm run test:orgrules

   Objetivo explicito del punto 18 del brief: demostrar con pruebas
   automatizadas -no solo leyendo las reglas- que la Empresa A nunca puede
   leer nada de la Empresa B (organizacion, roster, invitaciones,
   proyectos/APUs org-scoped), que un miembro deshabilitado pierde acceso de
   inmediato, y que solo el org_admin ve las invitaciones pendientes. Mismo
   patron/helpers que test/firestore.rules.test.mjs. */
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
    projectId: 'zoemec-orgrules-test',
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

// Org A: alice (org_admin, activa), carol (collaborator, activa), dave
// (collaborator, DESHABILITADO). Org B: bob (org_admin, activa) -- para
// probar aislamiento cruzado A/B.
async function seedTwoOrgs(db){
  await db.doc('organizations/orgA').set({ id: 'orgA', name: 'Empresa A', status: 'ACTIVE_TRIAL' });
  await db.doc('organizations/orgA/members/alice').set({ uid: 'alice', role: 'org_admin', status: 'active' });
  await db.doc('organizations/orgA/members/carol').set({ uid: 'carol', role: 'collaborator', status: 'active' });
  await db.doc('organizations/orgA/members/dave').set({ uid: 'dave', role: 'collaborator', status: 'disabled' });
  await db.doc('organizations/orgA/invitations/inv1').set({ email: 'nuevo@empresa-a.test', status: 'pending' });

  await db.doc('organizations/orgB').set({ id: 'orgB', name: 'Empresa B', status: 'ACTIVE_TRIAL' });
  await db.doc('organizations/orgB/members/bob').set({ uid: 'bob', role: 'org_admin', status: 'active' });
}

describe('firestore.rules — organizations (Fase 1: aislamiento entre empresas)', () => {
  it('nadie escribe organizations desde el cliente, ni un org_admin -- toda escritura pasa por _route-organizations.mjs (SDK admin)', async () => {
    await seed(seedTwoOrgs);
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('organizations/orgA').set({ name: 'Otro nombre' }));
    await assertFails(alice.doc('organizations/orgA').update({ status: 'CONVERTED' }));
  });

  it('un miembro activo SI puede leer su propia organizacion', async () => {
    await seed(seedTwoOrgs);
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('organizations/orgA').get());
  });

  it('un miembro de la Empresa B NO puede leer la organizacion de la Empresa A', async () => {
    await seed(seedTwoOrgs);
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('organizations/orgA').get());
  });

  it('un miembro deshabilitado pierde el acceso de lectura de inmediato', async () => {
    await seed(seedTwoOrgs);
    const dave = testEnv.authenticatedContext('dave').firestore();
    await assertFails(dave.doc('organizations/orgA').get());
  });

  it('un usuario que no pertenece a ninguna organizacion no puede leer ninguna', async () => {
    await seed(seedTwoOrgs);
    const eve = testEnv.authenticatedContext('eve').firestore();
    await assertFails(eve.doc('organizations/orgA').get());
    await assertFails(eve.doc('organizations/orgB').get());
  });

  // Endurecimiento de roles: super_admin ya NO depende de users/{uid}.role
  // (ver firestore.rules#isSuperAdmin) -- se simula con el custom claim, la
  // unica via que las reglas reconocen para una cuenta de prueba.
  it('un administrador real SI puede leer cualquier organizacion', async () => {
    await seed(seedTwoOrgs);
    const admin = testEnv.authenticatedContext('admin1', { super_admin: true }).firestore();
    await assertSucceeds(admin.doc('organizations/orgA').get());
    await assertSucceeds(admin.doc('organizations/orgB').get());
  });
});

describe('firestore.rules — organizations/{orgId}/members (roster del equipo)', () => {
  it('nadie escribe members desde el cliente', async () => {
    await seed(seedTwoOrgs);
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('organizations/orgA/members/carol').update({ role: 'org_admin' }));
  });

  it('un colaborador activo SI puede ver el roster de su propia empresa', async () => {
    await seed(seedTwoOrgs);
    const carol = testEnv.authenticatedContext('carol').firestore();
    await assertSucceeds(carol.doc('organizations/orgA/members/alice').get());
  });

  it('un miembro de la Empresa B NO puede ver el roster de la Empresa A', async () => {
    await seed(seedTwoOrgs);
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('organizations/orgA/members/alice').get());
    await assertFails(bob.collection('organizations/orgA/members').get());
  });

  it('un miembro deshabilitado no puede ver el roster de su propia (ex) empresa', async () => {
    await seed(seedTwoOrgs);
    const dave = testEnv.authenticatedContext('dave').firestore();
    await assertFails(dave.doc('organizations/orgA/members/alice').get());
  });
});

describe('firestore.rules — organizations/{orgId}/invitations (solo org_admin)', () => {
  it('nadie escribe invitations desde el cliente, ni un org_admin', async () => {
    await seed(seedTwoOrgs);
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('organizations/orgA/invitations/inv1').update({ status: 'revoked' }));
  });

  it('el org_admin SI puede leer las invitaciones pendientes de su empresa', async () => {
    await seed(seedTwoOrgs);
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('organizations/orgA/invitations/inv1').get());
  });

  it('un colaborador (no org_admin) NO puede leer las invitaciones, aunque sea miembro activo', async () => {
    await seed(seedTwoOrgs);
    const carol = testEnv.authenticatedContext('carol').firestore();
    await assertFails(carol.doc('organizations/orgA/invitations/inv1').get());
  });

  it('el org_admin de la Empresa B NO puede leer las invitaciones de la Empresa A', async () => {
    await seed(seedTwoOrgs);
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('organizations/orgA/invitations/inv1').get());
  });

  // Endurecimiento de roles: org_admin -> company_manager. Todas las pruebas
  // de arriba usan seedTwoOrgs (role:'org_admin', el valor LEGADO) y ya
  // demuestran que isCompanyManager() lo sigue aceptando -- esta prueba
  // adicional confirma explicitamente que el valor NUEVO ('company_manager',
  // lo unico que _route-organizations.mjs escribe desde ahora) da exactamente
  // el mismo acceso, sin necesidad de migrar los datos existentes.
  it('un responsable con el rol NUEVO (company_manager) tiene el mismo acceso que uno con el valor legado org_admin', async () => {
    await seed(async (db) => {
      await db.doc('organizations/orgC').set({ id: 'orgC', name: 'Empresa C', status: 'ACTIVE_TRIAL' });
      await db.doc('organizations/orgC/members/frank').set({ uid: 'frank', role: 'company_manager', status: 'active' });
      await db.doc('organizations/orgC/invitations/inv2').set({ email: 'nuevo@empresa-c.test', status: 'pending' });
    });
    const frank = testEnv.authenticatedContext('frank').firestore();
    await assertSucceeds(frank.doc('organizations/orgC/invitations/inv2').get());
  });
});

describe('firestore.rules — projects/apus org-scoped (Fase 1: espacio compartido del equipo)', () => {
  it('un companero de equipo (no el creador original) SI puede leer un proyecto de su misma organizacion', async () => {
    await seed(async (db) => {
      await seedTwoOrgs(db);
      await db.doc('projects/p1').set({ ownerUid: 'alice', organizationId: 'orgA', name: 'Obra compartida' });
    });
    const carol = testEnv.authenticatedContext('carol').firestore();
    await assertSucceeds(carol.doc('projects/p1').get());
  });

  it('un miembro de la Empresa B NO puede leer un proyecto de la Empresa A aunque conozca el id', async () => {
    await seed(async (db) => {
      await seedTwoOrgs(db);
      await db.doc('projects/p1').set({ ownerUid: 'alice', organizationId: 'orgA', name: 'Obra compartida' });
    });
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('projects/p1').get());
  });

  it('un miembro deshabilitado de la Empresa A pierde acceso a los proyectos de su empresa', async () => {
    await seed(async (db) => {
      await seedTwoOrgs(db);
      await db.doc('projects/p1').set({ ownerUid: 'alice', organizationId: 'orgA', name: 'Obra compartida' });
    });
    const dave = testEnv.authenticatedContext('dave').firestore();
    await assertFails(dave.doc('projects/p1').get());
  });

  it('un proyecto PERSONAL (sin organizationId) sigue siendo invisible para cualquiera que no sea su dueno, aunque pertenezca a una organizacion', async () => {
    await seed(async (db) => {
      await seedTwoOrgs(db);
      await db.doc('projects/p2').set({ ownerUid: 'eve', organizationId: null, name: 'Obra personal' });
    });
    const carol = testEnv.authenticatedContext('carol').firestore();
    await assertFails(carol.doc('projects/p2').get());
  });

  it('mismo aislamiento cruzado A/B en apus con organizationId', async () => {
    await seed(async (db) => {
      await seedTwoOrgs(db);
      await db.doc('apus/a1').set({ ownerUid: 'alice', organizationId: 'orgA', currentVersion: 'V1' });
    });
    const carol = testEnv.authenticatedContext('carol').firestore();
    await assertSucceeds(carol.doc('apus/a1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('apus/a1').get());
  });

  it('mismo aislamiento cruzado A/B en exportEvents con organizationId', async () => {
    await seed(async (db) => {
      await seedTwoOrgs(db);
      await db.doc('exportEvents/e1').set({ ownerUid: 'alice', organizationId: 'orgA', format: 'PDF' });
    });
    const carol = testEnv.authenticatedContext('carol').firestore();
    await assertSucceeds(carol.doc('exportEvents/e1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('exportEvents/e1').get());
  });
});
