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

  /* RC4 (Biblioteca): contentInsumos/contentText/insumosReview/driveParentPath
     se agregaron como campos NUEVOS del mismo documento library/{docId}, sin
     tocar las reglas. Esta prueba confirma que ese agregado no debilito el
     aislamiento ya probado arriba: un documento privado con estos campos
     reales (extraccion + revision humana pendiente) sigue siendo ilegible
     para un usuario que no es su dueno ni admin. */
  it('usuario A no puede leer contentInsumos/insumosReview de un documento privado de B (RC4)', async () => {
    await seed((db) => db.doc('library/doc7').set({
      ownerUid: 'bob',
      visibility: 'private',
      contentInsumos: [{ desc: 'Cemento portland tipo I', unidad: 'bulto', precio: 180 }],
      insumosReview: [{ index: 0, state: 'PROPUESTO', validatedBy: null, validatedAt: null }],
      driveParentPath: ['06 - FASAR OPUS']
    }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('library/doc7').get());
    await assertFails(alice.doc('library/doc7').update({ insumosReview: [{ index: 0, state: 'VALIDADO', validatedBy: 'alice', validatedAt: '2026-08-21' }] }));
  });
});

describe('firestore.rules — visual_requests (RC4 Fase 2: Planos IA / Takeoff reutiliza esta coleccion)', () => {
  /* Takeoff (api/visual-ai.mjs, action:'takeoff'/'reviewElement') persiste
     elementos/evidencia/estados de revision como campos nuevos del mismo
     documento visual_requests -- Opcion A aprobada, cero cambios a estas
     reglas. Esta prueba confirma que, con esos campos nuevos, el aislamiento
     ya existente sigue vigente: un plano ajeno (con su evidencia y
     cantidades) no es legible ni editable por otro usuario. */
  it('usuario A no puede leer los elementos de un analisis de plano de B', async () => {
    await seed((db) => db.doc('visual_requests/req1').set({
      uid: 'bob', mode: 'takeoff', takeoffSchemaVersion: 1,
      elementos: [{ tipo: 'muro', descripcion: 'Muro de block', cantidadPropuesta: 126.4, unidad: 'm²', estado: 'PROPUESTO_POR_IA' }]
    }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('visual_requests/req1').get());
  });

  it('usuario A SI puede leer su propio analisis de plano', async () => {
    await seed((db) => db.doc('visual_requests/req2').set({ uid: 'alice', mode: 'takeoff', takeoffSchemaVersion: 1, elementos: [] }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('visual_requests/req2').get());
  });

  it('un usuario no-admin no puede editar directamente (via SDK cliente) ni su propio analisis: la revision humana solo pasa por el servidor autenticado', async () => {
    await seed((db) => db.doc('visual_requests/req3').set({ uid: 'alice', mode: 'takeoff', elementos: [] }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('visual_requests/req3').update({ elementos: [{ estado: 'VALIDADO_POR_USUARIO' }] }));
  });

  it('un administrador real SI puede leer el analisis de plano de cualquier usuario', async () => {
    await seed(async (db) => {
      await db.doc('users/admin1').set({ role: 'admin', plan: 'Empresa', active: true });
      await db.doc('visual_requests/req4').set({ uid: 'bob', mode: 'takeoff', elementos: [] });
    });
    const admin = testEnv.authenticatedContext('admin1').firestore();
    await assertSucceeds(admin.doc('visual_requests/req4').get());
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
