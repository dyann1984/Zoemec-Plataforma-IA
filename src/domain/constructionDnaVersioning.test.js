import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConstructionDnaVersion, restoreConstructionDnaVersion, diffConstructionDna } from './constructionDnaVersioning.js';
import { makeEmptyConstructionDna, field, DNA_ORIGIN } from './constructionDnaSchema.js';

test('la primera version es V1, con hash y sin cambios previos', async () => {
  const dna = makeEmptyConstructionDna({ projectId: 'PRO-1' });
  const { entry, history } = await createConstructionDnaVersion(dna, [], { user: 'ana@zoemec.test', sources: ['catalogo', 'explosion'] });
  assert.equal(entry.version, 'V1');
  assert.equal(history.length, 1);
  assert.ok(entry.hash && entry.hash.length === 64, 'SHA-256 en hex debe tener 64 caracteres');
  assert.deepEqual(entry.changes, []);
  assert.equal(entry.engineVersion, 'construction-dna-v1');
});

test('nunca se sobreescribe una version anterior -- V2 se agrega, V1 sigue intacto en el historial', async () => {
  const dnaV1 = makeEmptyConstructionDna({ projectId: 'PRO-1' });
  const first = await createConstructionDnaVersion(dnaV1, [], { user: 'ana' });
  const dnaV2 = { ...dnaV1, geometria: { ...dnaV1.geometria, muros: field([{ qty: 50, unit: 'm²' }], DNA_ORIGIN.DERIVED) } };
  const second = await createConstructionDnaVersion(dnaV2, first.history, { user: 'ana' });
  assert.equal(second.entry.version, 'V2');
  assert.equal(second.history.length, 2);
  assert.equal(second.history[0].version, 'V1');
  assert.deepEqual(second.history[0].snapshot, dnaV1, 'V1 nunca se muta al crear V2');
});

test('la nueva version registra los cambios contra la version anterior', async () => {
  const dnaV1 = makeEmptyConstructionDna({ projectId: 'PRO-1' });
  const first = await createConstructionDnaVersion(dnaV1, []);
  const dnaV2 = { ...dnaV1, costos: { ...dnaV1.costos, nivelConfianza: field({ averageScore: 80 }, DNA_ORIGIN.DERIVED) } };
  const second = await createConstructionDnaVersion(dnaV2, first.history);
  assert.equal(second.entry.changes.length, 1);
  assert.equal(second.entry.changes[0].path, 'costos.nivelConfianza');
  assert.equal(second.entry.changes[0].after.value.averageScore, 80);
});

test('diffConstructionDna detecta un cambio de origin aunque el value no cambie', () => {
  const base = makeEmptyConstructionDna({ projectId: 'PRO-1' });
  const prev = { ...base, geometria: { ...base.geometria, muros: field([{ qty: 10, unit: 'm²' }], DNA_ORIGIN.DETECTED) } };
  const next = { ...base, geometria: { ...base.geometria, muros: field([{ qty: 10, unit: 'm²' }], DNA_ORIGIN.USER_CONFIRMED) } };
  const changes = diffConstructionDna(prev, next);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].path, 'geometria.muros');
});

test('restoreConstructionDnaVersion crea una version nueva a partir de una vieja, nunca reescribe la historia', async () => {
  const dnaV1 = makeEmptyConstructionDna({ projectId: 'PRO-1' });
  const first = await createConstructionDnaVersion(dnaV1, []);
  const dnaV2 = { ...dnaV1, geometria: { ...dnaV1.geometria, niveles: field(2, DNA_ORIGIN.USER_PROVIDED) } };
  const second = await createConstructionDnaVersion(dnaV2, first.history);
  const restored = await restoreConstructionDnaVersion(first.history[0], second.history);
  assert.equal(restored.entry.version, 'V3');
  assert.equal(restored.history.length, 3);
  assert.deepEqual(restored.entry.snapshot, dnaV1);
  assert.ok(restored.entry.reason.includes('V1'));
});
