import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanoTakeoffVersion, restorePlanoTakeoffVersion } from './planoTakeoffVersioning.js';

test('createPlanoTakeoffVersion: primer guardado produce V1', () => {
  const { snapshot, history } = createPlanoTakeoffVersion({ elementos: [] }, [], { user: 'diana' });
  assert.equal(history.length, 1);
  assert.equal(history[0].version, 'V1');
  assert.deepEqual(snapshot, { elementos: [] });
});

test('createPlanoTakeoffVersion: nunca sobreescribe, siempre agrega V{n+1}', () => {
  const first = createPlanoTakeoffVersion({ elementos: [] }, [], { user: 'diana' });
  const second = createPlanoTakeoffVersion({ elementos: [{ id: 'a' }] }, first.history, { user: 'diana' });
  assert.equal(second.history.length, 2);
  assert.equal(second.history[1].version, 'V2');
  assert.equal(first.history[0].version, 'V1'); // la version anterior sigue intacta
});

test('createPlanoTakeoffVersion: clona el snapshot, no conserva referencia mutable', () => {
  const original = { elementos: [{ id: 'a' }] };
  const { history } = createPlanoTakeoffVersion(original, [], {});
  original.elementos.push({ id: 'b' });
  assert.equal(history[0].snapshot.elementos.length, 1);
});

test('restorePlanoTakeoffVersion: crea una version NUEVA identica a la restaurada, nunca borra las intermedias', () => {
  const v1 = createPlanoTakeoffVersion({ elementos: [{ id: 'a' }] }, [], {});
  const v2 = createPlanoTakeoffVersion({ elementos: [{ id: 'a' }, { id: 'b' }] }, v1.history, {});
  const restored = restorePlanoTakeoffVersion(v1.history[0], v2.history, {});
  assert.equal(restored.history.length, 3);
  assert.equal(restored.history[2].version, 'V3');
  assert.deepEqual(restored.snapshot, { elementos: [{ id: 'a' }] });
});

test('restorePlanoTakeoffVersion: exige snapshot en la entrada', () => {
  assert.throws(() => restorePlanoTakeoffVersion({}, []));
});
