/* Adapter de Firestore de Memoria Tecnica, probado contra el EMULADOR local
   (nunca produccion). Corre con:
     npm run test:memory
   que levanta el emulador de Firestore (firebase emulators:exec), ejecuta
   este archivo contra el, y lo apaga. El admin SDK (getAdminDb) enruta
   automaticamente a FIRESTORE_EMULATOR_HOST, que el CLI define solo. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreMemoryRepository } from '../server/api-lib/_technicalMemoryFirestoreAdapter.mjs';
import { MEMORY_SCOPE, MEMORY_TYPE, MEMORY_STATUS, createMemoryProposal, approveMemoryEntry } from '../src/domain/technicalMemory.js';

test('createFirestoreMemoryRepository: save + getById hace round-trip real contra el emulador', async () => {
  const repo = createFirestoreMemoryRepository();
  const entry = createMemoryProposal({ scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, value: 10 });
  await repo.save(entry);
  const fetched = await repo.getById(entry.id);
  assert.equal(fetched.id, entry.id);
  assert.equal(fetched.value, 10);
  assert.equal(fetched.status, MEMORY_STATUS.PROPOSED);
});

test('createFirestoreMemoryRepository: list filtra por status contra datos reales del emulador', async () => {
  const repo = createFirestoreMemoryRepository();
  const proposal = createMemoryProposal({ scope: MEMORY_SCOPE.PROJECT, type: MEMORY_TYPE.APPROVED_PRICE, subject: { resourceDescripcion: 'Cemento gris CPC 30R' }, value: 230, context: { projectId: 'P-EMU-1' } });
  const approved = approveMemoryEntry(proposal, { approvedBy: 'admin.gonzalez' });
  await repo.save(approved);
  const list = await repo.list({ status: MEMORY_STATUS.APPROVED, type: MEMORY_TYPE.APPROVED_PRICE });
  assert.ok(list.some(e => e.id === approved.id));
  assert.ok(list.every(e => e.status === MEMORY_STATUS.APPROVED));
});

test('createFirestoreMemoryRepository: saveMany persiste en lote', async () => {
  const repo = createFirestoreMemoryRepository();
  const entries = [
    createMemoryProposal({ scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_CREW, subject: { primaryActivity: 'block' }, value: 2 }),
    createMemoryProposal({ scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_CREW, subject: { primaryActivity: 'concreto' }, value: 3 })
  ];
  await repo.saveMany(entries);
  const fetched = await Promise.all(entries.map(e => repo.getById(e.id)));
  assert.equal(fetched[0].value, 2);
  assert.equal(fetched[1].value, 3);
});
