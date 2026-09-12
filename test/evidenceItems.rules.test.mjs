/* Pruebas de reglas de Firestore para evidenceItems (P0 -- persistencia
   real de metadata de evidencia de Levantamiento IA, independiente de si
   el Survey completo llega a guardarse). Corren con:
     npm run test:evidencerules
   Mismo patron/helpers que test/priceObservations.rules.test.mjs. */
import { after, before, beforeEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'zoemec-evidencerules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 }
  });
});
after(async () => { await testEnv?.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

async function seed(setup){
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await setup(ctx.firestore()); });
}

function baseItem(overrides = {}){
  return {
    id: 'MED-1', surveyId: 'LEV-1', projectId: null, organizationId: null,
    ownerUid: 'alice', uploadedBy: 'alice', kind: 'photo',
    storagePath: 'levantamiento-media/alice/LEV-1/photo/MED-1/foto.jpg',
    mimeType: 'image/jpeg', sizeBytes: 12345, durationSeconds: null,
    status: 'uploading', createdAt: 1, updatedAt: 1,
    ...overrides
  };
}

describe('firestore.rules — evidenceItems (metadata de evidencia, escrita al terminar cada upload)', () => {
  it('el dueño SI puede crear su propio registro de evidencia', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('evidenceItems/MED-1').set(baseItem()));
  });

  it('nadie puede crear un registro con ownerUid/uploadedBy de OTRO usuario (impersonacion)', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('evidenceItems/MED-1').set(baseItem({ ownerUid: 'bob' })));
    await assertFails(alice.doc('evidenceItems/MED-1').set(baseItem({ uploadedBy: 'bob' })));
  });

  it('un usuario NO autenticado no puede crear ni leer nada', async () => {
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(anon.doc('evidenceItems/MED-1').set(baseItem()));
    await seed(db => db.doc('evidenceItems/MED-1').set(baseItem()));
    await assertFails(anon.doc('evidenceItems/MED-1').get());
  });

  it('el dueño SI puede leer su propio registro; otro usuario sin relacion NO puede', async () => {
    await seed(db => db.doc('evidenceItems/MED-1').set(baseItem()));
    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(alice.doc('evidenceItems/MED-1').get());
    await assertFails(bob.doc('evidenceItems/MED-1').get());
  });

  it('un companero de la MISMA organizacion SI puede leer; uno de otra organizacion NO', async () => {
    await seed(async (db) => {
      await db.doc('evidenceItems/MED-1').set(baseItem({ organizationId: 'orgA' }));
      await db.doc('organizations/orgA').set({ id: 'orgA', status: 'ACTIVE_TRIAL' });
      await db.doc('organizations/orgA/members/carol').set({ uid: 'carol', role: 'collaborator', status: 'active' });
      await db.doc('organizations/orgB').set({ id: 'orgB', status: 'ACTIVE_TRIAL' });
      await db.doc('organizations/orgB/members/dave').set({ uid: 'dave', role: 'collaborator', status: 'active' });
    });
    const carol = testEnv.authenticatedContext('carol').firestore();
    const dave = testEnv.authenticatedContext('dave').firestore();
    await assertSucceeds(carol.doc('evidenceItems/MED-1').get());
    await assertFails(dave.doc('evidenceItems/MED-1').get());
  });

  it('el dueño SI puede actualizar el status (uploading -> uploaded)', async () => {
    await seed(db => db.doc('evidenceItems/MED-1').set(baseItem()));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('evidenceItems/MED-1').set(baseItem({ status: 'uploaded', updatedAt: 2 })));
  });

  it('nadie puede cambiar storagePath/surveyId/kind/ownerUid una vez creado el registro', async () => {
    await seed(db => db.doc('evidenceItems/MED-1').set(baseItem()));
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(alice.doc('evidenceItems/MED-1').set(baseItem({ storagePath: 'otra/ruta.jpg' })));
    await assertFails(alice.doc('evidenceItems/MED-1').set(baseItem({ surveyId: 'LEV-OTRO' })));
    await assertFails(alice.doc('evidenceItems/MED-1').set(baseItem({ kind: 'video' })));
    await assertFails(alice.doc('evidenceItems/MED-1').set(baseItem({ ownerUid: 'bob' })));
  });

  it('el dueño SI puede borrar su propio registro; otro usuario NO', async () => {
    await seed(db => db.doc('evidenceItems/MED-1').set(baseItem()));
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(bob.doc('evidenceItems/MED-1').delete());
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(alice.doc('evidenceItems/MED-1').delete());
  });
});
