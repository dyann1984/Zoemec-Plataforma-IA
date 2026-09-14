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

  // FASE 2 QA (organizacion de 5 usuarios): hallazgo encontrado ejercitando el
  // flujo real de invitaciones con @firebase/rules-unit-testing -- organizationId/
  // orgRole no estaban protegidos aqui explicitamente, solo role/plan/active.
  // No otorgaba acceso real (isActiveOrgMember/isOrgAdmin en la seccion de
  // organizations solo confian en la subcoleccion members, que sigue con
  // write:false), pero se cierra por profundidad de defensa: solo el Admin SDK
  // (_route-organizations.mjs) debe poder tocar estos dos campos.
  it('usuario A no puede auto-crear su perfil ya con organizationId/orgRole declarados', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('users/alice').set({ role: 'user', plan: 'Gratis', active: true, organizationId: 'ORG-X' }));
    await assertFails(alice.doc('users/alice').set({ role: 'user', plan: 'Gratis', active: true, orgRole: 'org_admin' }));
  });

  it('usuario A no puede reescribir su propio organizationId/orgRole via update (solo el Admin SDK los fija)', async () => {
    await seed((db) => db.doc('users/alice').set({ role: 'user', plan: 'Gratis', active: true, organizationId: 'ORG-A', orgRole: 'collaborator' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('users/alice').update({ organizationId: 'ORG-B' }));
    await assertFails(alice.doc('users/alice').update({ orgRole: 'org_admin' }));
    // Un update que no toca estos campos (mismo criterio que plan/role) sigue permitido.
    await assertSucceeds(alice.doc('users/alice').update({ name: 'Alicia Actualizada' }));
  });

  it('usuario A no puede leer ni modificar el documento de usuario B', async () => {
    await seed((db) => db.doc('users/bob').set({ role: 'user', plan: 'Gratis', active: true }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('users/bob').get());
    await assertFails(alice.doc('users/bob').update({ plan: 'Empresa' }));
  });

  // Endurecimiento de roles: super_admin ya NO depende de users/{uid}.role
  // (ver isSuperAdmin() en firestore.rules) -- un admin real de prueba aqui
  // se simula con el custom claim, la unica via que las reglas reconocen.
  // Firestore ya no importa lo que diga users/admin1.role.
  it('un administrador real SI puede leer y actualizar el plan de otro usuario', async () => {
    await seed(async (db) => {
      await db.doc('users/admin1').set({ role: 'user', plan: 'Gratis', active: true });
      await db.doc('users/bob').set({ role: 'user', plan: 'Gratis', active: true });
    });
    const admin = testEnv.authenticatedContext('admin1', { super_admin: true }).firestore();
    await assertSucceeds(admin.doc('users/bob').get());
    await assertSucceeds(admin.doc('users/bob').update({ plan: 'Profesional' }));
  });
});

describe('firestore.rules — normalizacion de perfiles legacy (incidente permission-denied en login)', () => {
  /* Root cause confirmado del incidente: un documento users/{uid} sin
     role/plan/active (creado por una version anterior de ZOEMEC, o
     manualmente) no podia recibir NINGUNA escritura -- ni siquiera para
     rellenar exactamente esos 3 campos con los valores de arranque
     seguros -- porque la regla anterior exigia igualdad estricta entre el
     valor existente y el nuevo, y un campo ausente nunca es "==" a nada. */

  it('el dueno SI puede rellenar "active" cuando el documento legacy no lo trae, pero solo con el default seguro (true)', async () => {
    await seed((db) => db.doc('users/alice').set({ role: 'user', plan: 'Gratis', name: 'Alice Legacy' })); // sin "active"
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('users/alice').update({ active: true }));
  });

  it('el dueno NO puede rellenar "active" ausente con false (el unico default seguro es true)', async () => {
    await seed((db) => db.doc('users/alice').set({ role: 'user', plan: 'Gratis', name: 'Alice Legacy' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('users/alice').update({ active: false }));
  });

  it('el dueno SI puede rellenar "plan" cuando el documento legacy no lo trae, pero solo con "Gratis"', async () => {
    await seed((db) => db.doc('users/alice').set({ role: 'user', active: true, name: 'Alice Legacy' })); // sin "plan"
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('users/alice').update({ plan: 'Gratis' }));
  });

  it('el dueno NO puede rellenar "plan" ausente con un plan de pago', async () => {
    await seed((db) => db.doc('users/alice').set({ role: 'user', active: true, name: 'Alice Legacy' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('users/alice').update({ plan: 'Empresa' }));
  });

  it('el dueno SI puede rellenar "role" cuando el documento legacy no lo trae, pero solo con "user"', async () => {
    await seed((db) => db.doc('users/alice').set({ plan: 'Gratis', active: true, name: 'Alice Legacy' })); // sin "role"
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('users/alice').update({ role: 'user' }));
  });

  it('el dueno NO puede rellenar "role" ausente con "admin" (la brecha que mas importa evitar)', async () => {
    await seed((db) => db.doc('users/alice').set({ plan: 'Gratis', active: true, name: 'Alice Legacy' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('users/alice').update({ role: 'admin' }));
  });

  it('un documento legacy sin NINGUNO de los 3 campos se normaliza completo en una sola escritura con los defaults seguros', async () => {
    await seed((db) => db.doc('users/alice').set({ name: 'Alice muy legacy', email: 'alice@zoemec.test' })); // sin role/plan/active
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('users/alice').update({ role: 'user', plan: 'Gratis', active: true }));
  });

  it('un admin real con perfil legacy (role="admin" presente, "active" ausente) SI puede normalizar solo el campo faltante', async () => {
    // Nota: alice aqui YA es admin segun isAdmin() (su propio documento dice
    // role:'admin'), asi que la rama isAdmin() del "allow update" la
    // autoriza a escribir lo que sea en su propio doc -- eso es correcto
    // (un admin real puede editar cualquier perfil, incluido el suyo). La
    // proteccion real contra degradar un role/plan ya presente vive en la
    // rama NO-admin (isOwner-only), ya cubierta por "usuario A no puede
    // subir su propio plan/rol via update" (esa alice tiene role:'user', no
    // 'admin', asi que isAdmin() es false para ella y solo queda la rama
    // fieldFilledOnlyWithSafeDefault). Esta prueba solo confirma que el
    // camino de normalizacion sigue funcionando para una cuenta admin con
    // un perfil legacy incompleto.
    await seed((db) => db.doc('users/alice').set({ role: 'admin', plan: 'Empresa' })); // sin "active"
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('users/alice').update({ active: true }));
  });

  it('una cuenta desactivada a proposito (active:false YA presente) nunca se puede "normalizar" de vuelta a true', async () => {
    await seed((db) => db.doc('users/alice').set({ role: 'user', plan: 'Gratis', active: false }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('users/alice').update({ active: true }));
  });

  it('no se puede aprovechar el relleno de un campo ausente para colar un cambio no autorizado en OTRO campo ya presente', async () => {
    await seed((db) => db.doc('users/alice').set({ role: 'user', plan: 'Gratis', name: 'Alice' })); // sin "active"
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('users/alice').update({ active: true, role: 'admin' }));
  });

  it('el comportamiento previo para un documento YA completo sigue exactamente igual (sin regresion)', async () => {
    await seed((db) => db.doc('users/alice').set({ role: 'user', plan: 'Gratis', active: true }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('users/alice').update({ plan: 'Empresa' }));
    await assertFails(alice.doc('users/alice').update({ role: 'admin' }));
    await assertFails(alice.doc('users/alice').update({ active: false }));
    await assertSucceeds(alice.doc('users/alice').update({ name: 'Alice Actualizada' }));
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
      await db.doc('library/doc6').set({ ownerUid: 'bob', visibility: 'private' });
    });
    const admin = testEnv.authenticatedContext('admin1', { super_admin: true }).firestore();
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
      await db.doc('visual_requests/req4').set({ uid: 'bob', mode: 'takeoff', elementos: [] });
    });
    const admin = testEnv.authenticatedContext('admin1', { super_admin: true }).firestore();
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

describe('firestore.rules — technicalMemory / challengeDecisions (Fase 6)', () => {
  it('nadie escribe technicalMemory desde el cliente, ni el propio usuario -- toda escritura pasa por api/technical-memory.mjs (SDK admin)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('technicalMemory/m1').set({ status: 'APPROVED', value: 999 }));
  });

  // FIX Fase 9 (hallazgo F-002, P0): technicalMemory puede contener
  // APPROVED_PRICE/PREFERRED_SUPPLIER de scope PROJECT/ORGANIZATION --
  // informacion de licitacion, no "dato tecnico generico". Ninguna cuenta
  // (ni siquiera la propia, salvo admin) puede leerlo con el SDK de cliente
  // directo -- la UI real siempre lee via el endpoint (que si filtra por
  // proyecto/usuario). Antes esta prueba se llamaba "cualquier usuario
  // autenticado SI puede leer" y afirmaba `assertSucceeds`; una PoC real
  // demostro que eso permitia leer precios/proveedores de OTRA organizacion.
  it('ningun usuario NO-admin puede leer technicalMemory con el SDK de cliente directo (cierra fuga cross-tenant de precios/proveedores)', async () => {
    await seed((db) => db.doc('technicalMemory/m1').set({ status: 'PROPOSED', value: 5 }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('technicalMemory/m1').get());
  });

  it('un admin SI puede leer technicalMemory directo (via el catch-all de administrador)', async () => {
    await seed((db) => db.doc('technicalMemory/m1').set({ status: 'PROPOSED', value: 5 }));
    const admin = testEnv.authenticatedContext('admin-uid', { super_admin: true }).firestore();
    await assertSucceeds(admin.doc('technicalMemory/m1').get());
  });

  it('un usuario no autenticado no puede leer technicalMemory', async () => {
    await seed((db) => db.doc('technicalMemory/m1').set({ status: 'PROPOSED', value: 5 }));
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(anon.doc('technicalMemory/m1').get());
  });

  it('nadie escribe technicalMemoryAudit desde el cliente, y solo un admin puede leerlo', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('technicalMemoryAudit/a1').set({ action: 'APPROVED' }));
    await seed((db) => db.doc('technicalMemoryAudit/a1').set({ action: 'APPROVED' }));
    await assertFails(alice.doc('technicalMemoryAudit/a1').get());
  });

  it('nadie escribe challengeDecisions desde el cliente, ni el propio usuario', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('challengeDecisions/d1').set({ decision: 'MAINTAIN' }));
  });

  // FIX Fase 9 (hallazgo F-002, P0): mismo criterio que technicalMemory --
  // ninguna cuenta no-admin lee challengeDecisions con el SDK de cliente
  // directo (la UI real siempre pasa por el endpoint, que filtra).
  it('ningun usuario NO-admin puede leer challengeDecisions con el SDK de cliente directo', async () => {
    await seed((db) => db.doc('challengeDecisions/d1').set({ decision: 'MAINTAIN' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('challengeDecisions/d1').get());
  });

  it('nadie escribe challengeDecisionAudit desde el cliente, y solo un admin puede leerlo', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('challengeDecisionAudit/a1').set({ action: 'DECISION_RECORDED' }));
    await seed((db) => db.doc('challengeDecisionAudit/a1').set({ action: 'DECISION_RECORDED' }));
    await assertFails(alice.doc('challengeDecisionAudit/a1').get());
  });
});

describe('firestore.rules — projects / apus / apuVersions (Fase 7)', () => {
  it('nadie escribe projects desde el cliente, ni el propio dueno -- toda escritura pasa por api/projects.mjs (SDK admin)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('projects/p1').set({ ownerUid: 'alice', name: 'Obra' }));
  });

  it('el dueno real SI puede leer su propio proyecto', async () => {
    await seed((db) => db.doc('projects/p1').set({ ownerUid: 'alice', name: 'Obra' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('projects/p1').get());
  });

  it('un usuario distinto NO puede leer el proyecto de otro (dato propio, no tecnico)', async () => {
    await seed((db) => db.doc('projects/p1').set({ ownerUid: 'alice', name: 'Obra' }));
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('projects/p1').get());
  });

  it('nadie escribe projectAudit desde el cliente, y solo el dueno puede leerlo', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('projectAudit/a1').set({ action: 'PROJECT_CREATED', ownerUid: 'alice' }));
    await seed((db) => db.doc('projectAudit/a1').set({ action: 'PROJECT_CREATED', ownerUid: 'alice' }));
    await assertSucceeds(alice.doc('projectAudit/a1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('projectAudit/a1').get());
  });

  it('nadie escribe apus desde el cliente, ni el propio dueno -- toda escritura pasa por api/apus.mjs (SDK admin)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('apus/a1').set({ ownerUid: 'alice', currentVersion: 'V1' }));
  });

  it('el dueno real SI puede leer su propio APU, otro usuario no', async () => {
    await seed((db) => db.doc('apus/a1').set({ ownerUid: 'alice', currentVersion: 'V1' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('apus/a1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('apus/a1').get());
  });

  it('nadie escribe apuVersions desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('apuVersions/a1__V1').set({ ownerUid: 'alice', version: 'V1' }));
    await seed((db) => db.doc('apuVersions/a1__V1').set({ ownerUid: 'alice', version: 'V1' }));
    await assertSucceeds(alice.doc('apuVersions/a1__V1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('apuVersions/a1__V1').get());
  });

  it('nadie escribe apuAudit desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('apuAudit/a1').set({ action: 'APU_CREATED', ownerUid: 'alice' }));
    await seed((db) => db.doc('apuAudit/a1').set({ action: 'APU_CREATED', ownerUid: 'alice' }));
    await assertSucceeds(alice.doc('apuAudit/a1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('apuAudit/a1').get());
  });
});

describe('firestore.rules — planoTakeoffs / planoTakeoffVersions / planoTakeoffAudit (Fase B)', () => {
  it('nadie escribe planoTakeoffs desde el cliente -- toda escritura pasa por _route-plano-takeoffs.mjs (SDK admin)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('planoTakeoffs/pl1').set({ ownerUid: 'alice', currentVersion: 'V1' }));
  });

  it('el dueno real SI puede leer su propio plano, otro usuario no', async () => {
    await seed((db) => db.doc('planoTakeoffs/pl1').set({ ownerUid: 'alice', currentVersion: 'V1' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('planoTakeoffs/pl1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('planoTakeoffs/pl1').get());
  });

  it('nadie escribe planoTakeoffVersions desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('planoTakeoffVersions/pl1__V1').set({ ownerUid: 'alice', version: 'V1' }));
    await seed((db) => db.doc('planoTakeoffVersions/pl1__V1').set({ ownerUid: 'alice', version: 'V1' }));
    await assertSucceeds(alice.doc('planoTakeoffVersions/pl1__V1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('planoTakeoffVersions/pl1__V1').get());
  });

  it('nadie escribe planoTakeoffAudit desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('planoTakeoffAudit/a1').set({ action: 'PLANO_TAKEOFF_CREATED', ownerUid: 'alice' }));
    await seed((db) => db.doc('planoTakeoffAudit/a1').set({ action: 'PLANO_TAKEOFF_CREATED', ownerUid: 'alice' }));
    await assertSucceeds(alice.doc('planoTakeoffAudit/a1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('planoTakeoffAudit/a1').get());
  });
});

describe('firestore.rules — catalogConceptos / catalogConceptosAudit (Fase D)', () => {
  it('nadie escribe catalogConceptos desde el cliente -- toda escritura pasa por _route-catalogo-conceptos.mjs (SDK admin)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('catalogConceptos/c1').set({ ownerUid: 'alice', status: 'PENDIENTE' }));
  });

  it('el dueno real SI puede leer su propio concepto, otro usuario no', async () => {
    await seed((db) => db.doc('catalogConceptos/c1').set({ ownerUid: 'alice', status: 'PENDIENTE' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('catalogConceptos/c1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('catalogConceptos/c1').get());
  });

  it('nadie escribe catalogConceptosAudit desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('catalogConceptosAudit/a1').set({ action: 'CATALOGO_CONCEPTO_CREATED', ownerUid: 'alice' }));
    await seed((db) => db.doc('catalogConceptosAudit/a1').set({ action: 'CATALOGO_CONCEPTO_CREATED', ownerUid: 'alice' }));
    await assertSucceeds(alice.doc('catalogConceptosAudit/a1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('catalogConceptosAudit/a1').get());
  });
});

describe('firestore.rules — presupuestos / presupuestoVersions / presupuestoAudit (Fase D)', () => {
  it('nadie escribe presupuestos desde el cliente -- toda escritura pasa por _route-presupuestos.mjs (SDK admin)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('presupuestos/p1').set({ ownerUid: 'alice', currentVersion: 'V1', baselineVersion: null }));
  });

  it('el dueno real SI puede leer su propio presupuesto, otro usuario no', async () => {
    await seed((db) => db.doc('presupuestos/p1').set({ ownerUid: 'alice', currentVersion: 'V1', baselineVersion: null }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('presupuestos/p1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('presupuestos/p1').get());
  });

  it('nadie escribe presupuestoVersions desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('presupuestoVersions/p1__V1').set({ ownerUid: 'alice', version: 'V1' }));
    await seed((db) => db.doc('presupuestoVersions/p1__V1').set({ ownerUid: 'alice', version: 'V1' }));
    await assertSucceeds(alice.doc('presupuestoVersions/p1__V1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('presupuestoVersions/p1__V1').get());
  });

  it('nadie escribe presupuestoAudit desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('presupuestoAudit/a1').set({ action: 'PRESUPUESTO_CREATED', ownerUid: 'alice' }));
    await seed((db) => db.doc('presupuestoAudit/a1').set({ action: 'PRESUPUESTO_CREATED', ownerUid: 'alice' }));
    await assertSucceeds(alice.doc('presupuestoAudit/a1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('presupuestoAudit/a1').get());
  });
});

describe('firestore.rules — changeOrders / changeOrdersAudit (Fase E)', () => {
  it('nadie escribe changeOrders desde el cliente -- toda escritura pasa por _route-change-orders.mjs (SDK admin)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('changeOrders/co1').set({ ownerUid: 'alice', status: 'BORRADOR' }));
  });

  it('el dueno real SI puede leer su propia orden de cambio, otro usuario no', async () => {
    await seed((db) => db.doc('changeOrders/co1').set({ ownerUid: 'alice', status: 'BORRADOR' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('changeOrders/co1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('changeOrders/co1').get());
  });

  it('nadie escribe changeOrdersAudit desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('changeOrdersAudit/a1').set({ action: 'CHANGE_ORDER_CREATED', ownerUid: 'alice' }));
    await seed((db) => db.doc('changeOrdersAudit/a1').set({ action: 'CHANGE_ORDER_CREATED', ownerUid: 'alice' }));
    await assertSucceeds(alice.doc('changeOrdersAudit/a1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('changeOrdersAudit/a1').get());
  });
});

describe('firestore.rules — commitments / commitmentsAudit (Fase E)', () => {
  it('nadie escribe commitments desde el cliente -- toda escritura pasa por _route-commitments.mjs (SDK admin)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('commitments/c1').set({ ownerUid: 'alice', status: 'ACTIVO' }));
  });

  it('el dueno real SI puede leer su propio compromiso, otro usuario no', async () => {
    await seed((db) => db.doc('commitments/c1').set({ ownerUid: 'alice', status: 'ACTIVO' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('commitments/c1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('commitments/c1').get());
  });

  it('nadie escribe commitmentsAudit desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('commitmentsAudit/a1').set({ action: 'COMMITMENT_CREATED', ownerUid: 'alice' }));
    await seed((db) => db.doc('commitmentsAudit/a1').set({ action: 'COMMITMENT_CREATED', ownerUid: 'alice' }));
    await assertSucceeds(alice.doc('commitmentsAudit/a1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('commitmentsAudit/a1').get());
  });
});

describe('firestore.rules — progressEntries (Fase E, ledger append-only)', () => {
  it('nadie escribe progressEntries desde el cliente -- toda escritura pasa por _route-progress.mjs (SDK admin)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('progressEntries/pr1').set({ ownerUid: 'alice', delta: 10 }));
  });

  it('el dueno real SI puede leer su propio renglon de avance, otro usuario no', async () => {
    await seed((db) => db.doc('progressEntries/pr1').set({ ownerUid: 'alice', delta: 10 }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('progressEntries/pr1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('progressEntries/pr1').get());
  });
});

describe('firestore.rules — estimates / estimatesAudit (Fase E)', () => {
  it('nadie escribe estimates desde el cliente -- toda escritura pasa por _route-estimates.mjs (SDK admin)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('estimates/e1').set({ ownerUid: 'alice', status: 'BORRADOR' }));
  });

  it('el dueno real SI puede leer su propia estimacion, otro usuario no', async () => {
    await seed((db) => db.doc('estimates/e1').set({ ownerUid: 'alice', status: 'BORRADOR' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('estimates/e1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('estimates/e1').get());
  });

  it('nadie escribe estimatesAudit desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('estimatesAudit/a1').set({ action: 'ESTIMATE_CREATED', ownerUid: 'alice' }));
    await seed((db) => db.doc('estimatesAudit/a1').set({ action: 'ESTIMATE_CREATED', ownerUid: 'alice' }));
    await assertSucceeds(alice.doc('estimatesAudit/a1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('estimatesAudit/a1').get());
  });
});

describe('firestore.rules — payments (Fase E, ledger append-only)', () => {
  it('nadie escribe payments desde el cliente -- toda escritura pasa por _route-payments.mjs (SDK admin)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('payments/pa1').set({ ownerUid: 'alice', monto: 100 }));
  });

  it('el dueno real SI puede leer su propio pago, otro usuario no', async () => {
    await seed((db) => db.doc('payments/pa1').set({ ownerUid: 'alice', monto: 100 }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('payments/pa1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('payments/pa1').get());
  });
});

describe('firestore.rules — constructionDna / constructionDnaVersions / constructionDnaAudit (Fase F)', () => {
  it('nadie escribe constructionDna desde el cliente -- toda escritura pasa por _route-construction-dna.mjs (SDK admin)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('constructionDna/PRO-1').set({ ownerUid: 'alice', currentVersion: 'V1' }));
  });

  it('el dueno real SI puede leer el Construction DNA de su propio proyecto, otro usuario no', async () => {
    await seed((db) => db.doc('constructionDna/PRO-1').set({ ownerUid: 'alice', currentVersion: 'V1' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('constructionDna/PRO-1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('constructionDna/PRO-1').get());
  });

  it('nadie escribe constructionDnaVersions desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('constructionDnaVersions/PRO-1__V1').set({ ownerUid: 'alice', version: 'V1' }));
    await seed((db) => db.doc('constructionDnaVersions/PRO-1__V1').set({ ownerUid: 'alice', version: 'V1' }));
    await assertSucceeds(alice.doc('constructionDnaVersions/PRO-1__V1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('constructionDnaVersions/PRO-1__V1').get());
  });

  it('nadie escribe constructionDnaAudit desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('constructionDnaAudit/a1').set({ action: 'CONSTRUCTION_DNA_VERSION_CREATED', ownerUid: 'alice' }));
    await seed((db) => db.doc('constructionDnaAudit/a1').set({ action: 'CONSTRUCTION_DNA_VERSION_CREATED', ownerUid: 'alice' }));
    await assertSucceeds(alice.doc('constructionDnaAudit/a1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('constructionDnaAudit/a1').get());
  });
});

describe('firestore.rules — sentinelAlerts / sentinelAlertsAudit / healthHistory (Fase G)', () => {
  it('nadie escribe sentinelAlerts desde el cliente -- toda escritura pasa por _route-sentinel.mjs (SDK admin)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('sentinelAlerts/a1').set({ ownerUid: 'alice', status: 'NUEVA' }));
  });

  it('el dueno real SI puede leer su propia alerta, otro usuario no', async () => {
    await seed((db) => db.doc('sentinelAlerts/a1').set({ ownerUid: 'alice', status: 'NUEVA' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('sentinelAlerts/a1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('sentinelAlerts/a1').get());
  });

  it('nadie escribe sentinelAlertsAudit desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('sentinelAlertsAudit/a1').set({ action: 'SENTINEL_ALERT_CREATED', ownerUid: 'alice' }));
    await seed((db) => db.doc('sentinelAlertsAudit/a1').set({ action: 'SENTINEL_ALERT_CREATED', ownerUid: 'alice' }));
    await assertSucceeds(alice.doc('sentinelAlertsAudit/a1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('sentinelAlertsAudit/a1').get());
  });

  it('nadie escribe healthHistory desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('healthHistory/h1').set({ score: 80, ownerUid: 'alice' }));
    await seed((db) => db.doc('healthHistory/h1').set({ score: 80, ownerUid: 'alice' }));
    await assertSucceeds(alice.doc('healthHistory/h1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('healthHistory/h1').get());
  });
});

describe('firestore.rules — assets / assetsAudit / assetComponents / assetComponentsAudit (Fase G)', () => {
  it('nadie escribe assets desde el cliente -- toda escritura pasa por _route-assets.mjs (SDK admin)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('assets/PRO-1').set({ ownerUid: 'alice', nombre: 'x' }));
  });

  it('el dueno real SI puede leer su propio activo, otro usuario no', async () => {
    await seed((db) => db.doc('assets/PRO-1').set({ ownerUid: 'alice', nombre: 'x' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('assets/PRO-1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('assets/PRO-1').get());
  });

  it('nadie escribe assetsAudit desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('assetsAudit/a1').set({ action: 'ASSET_CREATED_FROM_PROJECT', ownerUid: 'alice' }));
    await seed((db) => db.doc('assetsAudit/a1').set({ action: 'ASSET_CREATED_FROM_PROJECT', ownerUid: 'alice' }));
    await assertSucceeds(alice.doc('assetsAudit/a1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('assetsAudit/a1').get());
  });

  it('nadie escribe assetComponents desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('assetComponents/c1').set({ ownerUid: 'alice', tipo: 'HVAC' }));
    await seed((db) => db.doc('assetComponents/c1').set({ ownerUid: 'alice', tipo: 'HVAC' }));
    await assertSucceeds(alice.doc('assetComponents/c1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('assetComponents/c1').get());
  });

  it('nadie escribe assetComponentsAudit desde el cliente; el dueno real si puede leer, otro usuario no', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('assetComponentsAudit/a1').set({ action: 'ASSET_COMPONENT_CREATED', ownerUid: 'alice' }));
    await seed((db) => db.doc('assetComponentsAudit/a1').set({ action: 'ASSET_COMPONENT_CREATED', ownerUid: 'alice' }));
    await assertSucceeds(alice.doc('assetComponentsAudit/a1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('assetComponentsAudit/a1').get());
  });
});

describe('firestore.rules — exportEvents (Fase 8)', () => {
  it('nadie escribe exportEvents desde el cliente -- toda escritura pasa por api/export-events.mjs (SDK admin)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('exportEvents/e1').set({ ownerUid: 'alice', format: 'PDF' }));
  });

  it('el dueno real SI puede leer su propio evento, otro usuario no', async () => {
    await seed((db) => db.doc('exportEvents/e1').set({ ownerUid: 'alice', format: 'PDF' }));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('exportEvents/e1').get());
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('exportEvents/e1').get());
  });
});

// Fase 2 (regionalizacion de APU): priceIntelligenceCache/priceIntelligenceUsage
// no tienen una regla propia -- caen en el catch-all `match /{document=**}`
// (solo isAdmin()). Verificacion explicita de la garantia del brief "Empresa
// A no puede consultar costos privados de Empresa B": ni siquiera con
// tenantScope.organizationId propio puede un usuario normal leer estas
// colecciones directamente desde el cliente -- toda lectura/escritura real
// pasa por el servidor (Admin SDK via /api/price-intelligence, que ya aisla
// por tenantScope+region en el fingerprint, ver priceSearchCache.test.js y
// priceIntelligenceCache.firestore.test.mjs TEST D).
describe('firestore.rules — priceIntelligenceCache / priceIntelligenceUsage (Fase 2: aislamiento regional entre organizaciones)', () => {
  it('un usuario normal de la Empresa A no puede leer un registro de cache de precios aunque sea de su propia organizacion (solo el servidor, via Admin SDK, lee esta coleccion)', async () => {
    await seed((db) => db.doc('priceIntelligenceCache/fp-empresa-a').set({
      tenantScope: { organizationId: 'ORG-A' }, region: 'Monterrey, Nuevo León, México', price: 350
    }));
    const aliceOrgA = testEnv.authenticatedContext('alice').firestore();
    await assertFails(aliceOrgA.doc('priceIntelligenceCache/fp-empresa-a').get());
  });

  it('un usuario de la Empresa B no puede leer el cache de precios regional de la Empresa A', async () => {
    await seed((db) => db.doc('priceIntelligenceCache/fp-empresa-a').set({
      tenantScope: { organizationId: 'ORG-A' }, region: 'Monterrey, Nuevo León, México', price: 350
    }));
    const bobOrgB = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bobOrgB.doc('priceIntelligenceCache/fp-empresa-a').get());
  });

  it('nadie escribe priceIntelligenceCache/priceIntelligenceUsage desde el cliente', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('priceIntelligenceCache/fp-x').set({ price: 1 }));
    await assertFails(alice.doc('priceIntelligenceUsage/u-x').set({ count: 1 }));
  });
});

// Endurecimiento de roles: super_admin (administrador GLOBAL de ZOEMEC) debe
// depender EXCLUSIVAMENTE del custom claim real de Firebase o del correo
// exacto de la unica cuenta autorizada -- nunca de un documento de Firestore.
// Estas pruebas demuestran, contra las reglas reales (nunca Admin SDK), que
// ni un colaborador ni un company_manager (responsable de su propia empresa)
// pueden fabricarse ese acceso escribiendo cualquier documento -- las reglas
// de rules-unit-testing NUNCA pueden fijar un custom claim real (eso solo lo
// hace el Admin SDK, fuera de banda), asi que cualquier intento aqui solo
// puede pasar por Firestore, que es justo lo que se cerro.
describe('firestore.rules — super_admin nunca se puede auto-asignar (Endurecimiento de roles)', () => {
  it('un colaborador no puede volverse super_admin escribiendo role:"admin" en su propio perfil', async () => {
    await seed((db) => db.doc('users/carol').set({ role: 'user', plan: 'Gratis', active: true }));
    const carol = testEnv.authenticatedContext('carol').firestore();
    await assertFails(carol.doc('users/carol').update({ role: 'admin' }));
    await assertFails(carol.doc('users/carol').update({ role: 'superadmin' }));
  });

  it('un company_manager (responsable de su propia empresa) tampoco puede volverse super_admin -- ser responsable de una empresa nunca implica administrar ZOEMEC', async () => {
    await seed(async (db) => {
      await db.doc('users/alice').set({ role: 'user', plan: 'Gratis', active: true, organizationId: 'orgA', orgRole: 'company_manager' });
      await db.doc('organizations/orgA').set({ id: 'orgA', name: 'Empresa A', status: 'ACTIVE_TRIAL' });
      await db.doc('organizations/orgA/members/alice').set({ uid: 'alice', role: 'company_manager', status: 'active' });
    });
    const alice = testEnv.authenticatedContext('alice').firestore();
    // Ni siquiera un responsable de empresa real puede leer lo que solo un
    // super admin deberia ver (payments, catch-all de administracion global).
    await assertFails(alice.doc('payments/pay1').get());
    await assertFails(alice.doc('config/platform').get());
    // Y por supuesto tampoco puede escribirse a si mismo el rol de plataforma.
    await assertFails(alice.doc('users/alice').update({ role: 'admin' }));
  });

  it('nadie puede otorgarse super_admin creando su documento de usuario ya con ese rol', async () => {
    const dave = testEnv.authenticatedContext('dave').firestore();
    await assertFails(dave.doc('users/dave').set({ role: 'admin', plan: 'Gratis', active: true }));
    await assertFails(dave.doc('users/dave').set({ role: 'superadmin', plan: 'Gratis', active: true }));
  });

  it('ningun documento de Firestore puede otorgar acceso super_admin, ni siquiera escrito por otro super_admin real (solo el custom claim o el correo exacto cuentan)', async () => {
    await seed((db) => db.doc('users/eve').set({ role: 'admin', plan: 'Gratis', active: true }));
    const eve = testEnv.authenticatedContext('eve').firestore();
    // eve tiene role:'admin' en Firestore pero NO el custom claim ni el
    // correo autorizado -- isSuperAdmin() debe seguir negandole el catch-all.
    await assertFails(eve.doc('payments/pay1').get());
    await assertFails(eve.doc('config/platform').get());
  });
});
