import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPresupuestoVersion, restorePresupuestoVersion } from './presupuestoVersioning.js';

test('primer guardado produce V1', () => {
  const built = createPresupuestoVersion({ importeTotal: 100 }, [], { user: 'ana' });
  assert.equal(built.history.length, 1);
  assert.equal(built.history[0].version, 'V1');
  assert.equal(built.snapshot.importeTotal, 100);
});

test('guardados sucesivos incrementan version y nunca sobreescriben el historial previo', () => {
  const v1 = createPresupuestoVersion({ importeTotal: 100 }, [], { user: 'ana' });
  const v2 = createPresupuestoVersion({ importeTotal: 200 }, v1.history, { user: 'ana' });
  assert.equal(v2.history.length, 2);
  assert.equal(v2.history[1].version, 'V2');
  assert.equal(v2.history[0].snapshot.importeTotal, 100);
  assert.equal(v2.history[1].snapshot.importeTotal, 200);
});

test('restaurar una version anterior crea una version NUEVA identica, no borra nada', () => {
  const v1 = createPresupuestoVersion({ importeTotal: 100 }, [], { user: 'ana' });
  const v2 = createPresupuestoVersion({ importeTotal: 200 }, v1.history, { user: 'ana' });
  const restored = restorePresupuestoVersion(v2.history[0], v2.history, { user: 'ana' });
  assert.equal(restored.history.length, 3);
  assert.equal(restored.history[2].version, 'V3');
  assert.equal(restored.snapshot.importeTotal, 100);
  assert.equal(restored.history[0].version, 'V1'); // intacta
  assert.equal(restored.history[1].version, 'V2'); // intacta
});

test('restaurar sin snapshot lanza', () => {
  assert.throws(() => restorePresupuestoVersion({ version: 'V1' }, []));
});

test('el snapshot se clona -- mutar el original no afecta el historial guardado', () => {
  const original = { importeTotal: 100, rows: [{ x: 1 }] };
  const built = createPresupuestoVersion(original, [], { user: 'ana' });
  original.rows[0].x = 999;
  assert.equal(built.history[0].snapshot.rows[0].x, 1);
});
