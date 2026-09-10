import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionCoordinator } from './authSessionCoordinator.js';

function deferred(){
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test('two concurrent calls for the SAME uid execute the builder exactly once', async () => {
  const coordinator = createSessionCoordinator();
  let calls = 0;
  const gate = deferred();
  const taskFn = async () => {
    calls++;
    await gate.promise;
    return { status: 'ok', calls };
  };

  const p1 = coordinator.run('uid-1', taskFn);
  const p2 = coordinator.run('uid-1', taskFn); // simula onAuthStateChanged llegando mientras login() ya esta corriendo
  await Promise.resolve(); // deja correr el microtask que arranca taskFn()
  await Promise.resolve();
  assert.equal(calls, 1, 'taskFn ya deberia haber arrancado exactamente una vez, no dos, a pesar de las dos llamadas a run()');

  gate.resolve();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(calls, 1, 'una segunda llamada concurrente para el mismo uid NUNCA debe re-ejecutar el builder');
  assert.equal(r1, r2, 'ambos llamadores deben recibir exactamente el mismo resultado (misma promesa)');
});

test('a THIRD call after the first finished starts a fresh execution (not stuck on stale state)', async () => {
  const coordinator = createSessionCoordinator();
  let calls = 0;
  const taskFn = async () => { calls++; return { calls }; };

  const first = await coordinator.run('uid-1', taskFn);
  assert.equal(first.calls, 1);

  const second = await coordinator.run('uid-1', taskFn);
  assert.equal(second.calls, 2, 'una vez resuelta la primera, la siguiente transicion de auth debe poder ejecutar de nuevo');
});

test('two concurrent calls for DIFFERENT uids never share a result (no cross-account leak)', async () => {
  const coordinator = createSessionCoordinator();
  const gateA = deferred();
  const seen = [];
  const taskFor = (uid, gate) => async () => { await gate.promise; seen.push(uid); return { uid }; };

  const pA = coordinator.run('uid-A', taskFor('uid-A', gateA));
  const pB = coordinator.run('uid-B', async () => ({ uid: 'uid-B' })); // resuelve de inmediato, cuenta distinta

  const resultB = await pB;
  assert.equal(resultB.uid, 'uid-B');

  gateA.resolve();
  const resultA = await pA;
  assert.equal(resultA.uid, 'uid-A');
});

test('isRunning() reflects whether a build is currently in flight', async () => {
  const coordinator = createSessionCoordinator();
  const gate = deferred();
  assert.equal(coordinator.isRunning(), false);
  const p = coordinator.run('uid-1', async () => { await gate.promise; return 'done'; });
  assert.equal(coordinator.isRunning(), true);
  gate.resolve();
  await p;
  assert.equal(coordinator.isRunning(), false);
});

test('if the builder throws, the coordinator propagates the error to ALL concurrent waiters and then recovers', async () => {
  const coordinator = createSessionCoordinator();
  let calls = 0;
  const gate = deferred();
  const taskFn = async () => {
    calls++;
    await gate.promise;
    throw new Error('profile load failed');
  };

  const p1 = coordinator.run('uid-1', taskFn);
  const p2 = coordinator.run('uid-1', taskFn);
  gate.resolve();

  await assert.rejects(p1, /profile load failed/);
  await assert.rejects(p2, /profile load failed/);
  assert.equal(calls, 1, 'el fallo tampoco debe haber disparado una segunda ejecucion concurrente');

  // Tras el fallo, una nueva transicion para el mismo uid debe poder reintentar.
  const p3 = coordinator.run('uid-1', async () => 'recovered');
  assert.equal(await p3, 'recovered');
});
