/* Pruebas de reglas de Firestore contra el emulador local (no contra el
   proyecto real). Corren con:
     npm run test:rules
   que levanta el emulador de Firestore, ejecuta este archivo y lo apaga.

   Objetivo explicito de la Fase 1 de remediacion de seguridad: demostrar con
   pruebas automatizadas -no solo leyendo las reglas- que un usuario A no
   puede autoasignarse rol de administrador ni plan de pago, no puede leer
   archivos privados de otro usuario B, y no puede modificar los datos de B. */
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
    projectId: 'zoemec-rules-test',
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

describe('firestore.rules — users (D1: autoasignacion de admin/plan)', () => {
  it('usuario A no puede crear su perfil con role="admin"', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('users/alice').set({ role: 'admin', plan: 'Gratis', active: true }));
  });

  it('usuario A no puede crear su perfil con plan="Empresa"', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('users/alice').set({ role: 'user', plan: 'Empresa', active: true }));
  });

  it('usuario A no puede crear su perfil con active=false para evadir controles', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('users/alice').set({ role: 'user', plan: 'Gratis', active: false }));
  });

  it('usuario A SI puede crear su perfil con los valores de arranque exactos', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('users/alice').set({ role: 'user', plan: 'Gratis', active: true }));
  });

  it('usuario A no puede crear el perfil de otro uid (B)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('users/bob').set({ role: 'user', plan: 'Gratis', active: true }));
  });

  it('usuario A no puede subir su propio plan/rol via update', async () => {
    await seed((db) => db.doc('users/alice').set({ role: 'user', plan: 'Gratis', active: true }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('users/alice').update({ plan: 'Empresa' }));
    await assertFails(alice.doc('users/alice').update({ role: 'admin' }));
  });

  it('usuario A no puede leer ni modificar el documento de usuario B', async () => {
    await seed((db) => db.doc('users/bob').set({ role: 'user', plan: 'Gratis', active: true }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('users/bob').get());
    await assertFails(alice.doc('users/bob').update({ plan: 'Empresa' }));
  });

  it('un administrador real SI puede leer y actualizar el plan de otro usuario', async () => {
    await seed(async (db) => {
      await db.doc('users/admin1').set({ role: 'admin', plan: 'Empresa', active: true });
      await db.doc('users/bob').set({ role: 'user', plan: 'Gratis', active: true });
    });
    const admin = testEnv.authenticatedContext('admin1').firestore();
    await assertSucceeds(admin.doc('users/bob').get());
    await assertSucceeds(admin.doc('users/bob').update({ plan: 'Profesional' }));
  });
});

describe('firestore.rules — library (D2: aislamiento multiusuario)', () => {
  it('usuario A no puede leer un documento privado de B', async () => {
    await seed((db) => db.doc('library/doc1').set({ ownerUid: 'bob', visibility: 'private' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('library/doc1').get());
  });

  it('usuario A SI puede leer un documento global de B', async () => {
    await seed((db) => db.doc('library/doc2').set({ ownerUid: 'bob', visibility: 'global' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('library/doc2').get());
  });

  it('usuario A SI puede leer su propio documento privado', async () => {
    await seed((db) => db.doc('library/doc3').set({ ownerUid: 'alice', visibility: 'private' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('library/doc3').get());
  });

  it('usuario A no puede crear un documento global sin ser admin', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('library/doc4').set({ ownerUid: 'alice', visibility: 'global' }));
  });

  it('usuario A no puede borrar el documento privado de B', async () => {
    await seed((db) => db.doc('library/doc5').set({ ownerUid: 'bob', visibility: 'private' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('library/doc5').delete());
  });

  it('un administrador real SI puede leer un documento privado de cualquier usuario', async () => {
    await seed(async (db) => {
      await db.doc('users/admin1').set({ role: 'admin', plan: 'Empresa', active: true });
      await db.doc('library/doc6').set({ ownerUid: 'bob', visibility: 'private' });
    });
    const admin = testEnv.authenticatedContext('admin1').firestore();
    await assertSucceeds(admin.doc('library/doc6').get());
  });
});

describe('firestore.rules — devices (fuga de PII)', () => {
  it('usuario A no puede listar/consultar toda la coleccion devices', async () => {
    await seed((db) => db.doc('devices/dev1').set({ uid: 'bob', email: 'bob@test.zoemec' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.collection('devices').get());
  });

  it('usuario A SI puede leer un deviceId especifico y conocido (uso legitimo de registro)', async () => {
    await seed((db) => db.doc('devices/dev1').set({ uid: 'bob', email: 'bob@test.zoemec' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('devices/dev1').get());
  });

  it('usuario A no puede crear un registro de dispositivo a nombre de B', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('devices/dev2').set({ uid: 'bob', email: 'bob@test.zoemec' }));
  });
});

describe('firestore.rules — payments', () => {
  it('nadie puede escribir en payments desde el cliente, ni el propio usuario', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('payments/p1').set({ uid: 'alice', plan: 'Empresa' }));
  });

  it('un usuario no-admin no puede leer sus propios pagos directo de Firestore', async () => {
    await seed((db) => db.doc('payments/p1').set({ uid: 'alice' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('payments/p1').get());
  });
});
