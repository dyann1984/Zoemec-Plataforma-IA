/* ZOEMEC MEMORIA TECNICA -- pruebas del contrato de repositorio y su
   adapter in-memory (real, no un mock disfrazado -- ver comentario en
   technicalMemoryRepository.js). El adapter de Firestore se prueba aparte,
   contra el emulador local (server/api-lib/_technicalMemoryFirestoreAdapter.test.mjs). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryMemoryRepository, assertImplementsMemoryRepository } from './technicalMemoryRepository.js';
import { MEMORY_SCOPE, MEMORY_TYPE, MEMORY_STATUS, createMemoryProposal, approveMemoryEntry } from './technicalMemory.js';

test('assertImplementsMemoryRepository rechaza un adapter incompleto', () => {
  assert.throws(() => assertImplementsMemoryRepository({ list: () => {} }), /getById/);
});

test('createInMemoryMemoryRepository: save + getById hace round-trip exacto', async () => {
  const repo = createInMemoryMemoryRepository();
  const entry = createMemoryProposal({ scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, value: 10 });
  await repo.save(entry);
  const fetched = await repo.getById(entry.id);
  assert.deepEqual(fetched, entry);
});

test('createInMemoryMemoryRepository: list filtra por scope/type/status', async () => {
  const repo = createInMemoryMemoryRepository();
  const proposal = createMemoryProposal({ scope: MEMORY_SCOPE.PROJECT, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, value: 10, context: { projectId: 'P1' } });
  const approved = approveMemoryEntry(proposal, { approvedBy: 'admin.gonzalez' });
  const priceEntry = createMemoryProposal({ scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_PRICE, subject: { resourceDescripcion: 'Cemento' }, value: 230 });
  await repo.saveMany([approved, priceEntry]);

  assert.deepEqual((await repo.list({ scope: MEMORY_SCOPE.PROJECT })).map(e => e.id), [approved.id]);
  assert.deepEqual((await repo.list({ type: MEMORY_TYPE.APPROVED_PRICE })).map(e => e.id), [priceEntry.id]);
  assert.deepEqual((await repo.list({ status: MEMORY_STATUS.APPROVED })).map(e => e.id), [approved.id]);
  assert.equal((await repo.list()).length, 2);
});

test('createInMemoryMemoryRepository: save es un upsert por id (nunca duplica)', async () => {
  const repo = createInMemoryMemoryRepository();
  const entry = createMemoryProposal({ scope: MEMORY_SCOPE.GLOBAL, type: MEMORY_TYPE.APPROVED_YIELD, subject: { primaryActivity: 'acero' }, value: 10 });
  await repo.save(entry);
  const approved = approveMemoryEntry(entry, { approvedBy: 'admin.gonzalez' });
  await repo.save(approved);
  const all = await repo.list();
  assert.equal(all.length, 1);
  assert.equal(all[0].status, MEMORY_STATUS.APPROVED);
});
