import { test } from 'node:test';
import assert from 'node:assert/strict';
import { field, DNA_ORIGIN, makeEmptyConstructionDna, validateConstructionDna } from './constructionDnaSchema.js';

test('field() envuelve un valor real con su origen', () => {
  const f = field(42, DNA_ORIGIN.DETECTED);
  assert.equal(f.value, 42);
  assert.equal(f.origin, 'DETECTED');
});

test('field() sin valor (null/undefined/arreglo vacio) NUNCA fabrica un origen -- value y origin quedan null', () => {
  assert.deepEqual(field(null, DNA_ORIGIN.DETECTED), { value: null, origin: null });
  assert.deepEqual(field(undefined, DNA_ORIGIN.DERIVED), { value: null, origin: null });
  assert.deepEqual(field([], DNA_ORIGIN.DETECTED), { value: null, origin: null });
});

test('makeEmptyConstructionDna arranca con las 5 secciones y todos los campos en Sin informacion', () => {
  const dna = makeEmptyConstructionDna({ id: 'DNA-1', projectId: 'PRO-1' });
  assert.equal(dna.id, 'DNA-1');
  assert.equal(dna.projectId, 'PRO-1');
  assert.ok(dna.geometria && dna.sistemaConstructivo && dna.instalaciones && dna.recursos && dna.costos);
  assert.deepEqual(dna.geometria.superficieConstruida, { value: null, origin: null });
  assert.deepEqual(dna.costos.nivelConfianza, { value: null, origin: null });
});

test('validateConstructionDna exige projectId', () => {
  const dna = makeEmptyConstructionDna({ projectId: 'PRO-1' });
  assert.equal(validateConstructionDna(dna).valid, true);
  assert.equal(validateConstructionDna({ ...dna, projectId: null }).valid, false);
});
