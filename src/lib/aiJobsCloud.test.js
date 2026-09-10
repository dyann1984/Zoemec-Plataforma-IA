import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromCloudDoc, markInterruptedOnLoad, toCloudDoc } from './aiJobsCloud.js';

test('toCloudDoc/fromCloudDoc round-trips a result containing nested arrays (Firestore rejects arrays of arrays)', () => {
  const job = {
    id: 'apu-generate-1',
    type: 'apu-generate',
    status: 'completed',
    result: {
      shim: {
        id: 'APU-1',
        concept: 'Muro de block',
        materials: [['Block hueco 15x20x40', 12.5, 'pza', 16.5, 3]],
        labor: [['Oficial albañil', 0.35, 'jor', 380, 1.85]],
      },
      usedFallback: false,
    },
  };
  const cloudDoc = toCloudDoc(job);
  // El campo result nunca debe seguir siendo un array/objeto anidado en el
  // documento que se manda a Firestore -- debe ser texto.
  assert.equal(typeof cloudDoc.result, 'string');
  const restored = fromCloudDoc(cloudDoc);
  assert.deepEqual(restored.result, job.result);
  assert.deepEqual(restored.result.shim.materials, [['Block hueco 15x20x40', 12.5, 'pza', 16.5, 3]]);
});

test('toCloudDoc handles a null result without crashing', () => {
  const job = { id: 'j1', type: 'apu-generate', status: 'processing', result: null };
  const cloudDoc = toCloudDoc(job);
  assert.equal(cloudDoc.result, null);
  assert.deepEqual(fromCloudDoc(cloudDoc).result, null);
});

test('fromCloudDoc leaves an already-plain object result untouched', () => {
  // Documentos legacy (antes de este fix) guardaban result como objeto: no
  // debe tronar al leerlos, solo pasarlos tal cual.
  const raw = { id: 'j1', result: { ok: true } };
  assert.deepEqual(fromCloudDoc(raw).result, { ok: true });
});

test('fromCloudDoc never throws on a corrupted result string', () => {
  const raw = { id: 'j1', result: '{not valid json' };
  assert.equal(fromCloudDoc(raw).result, null);
});

test('markInterruptedOnLoad reclassifies a still-processing job as failed with an honest reason', () => {
  const job = { id: 'j1', status: 'processing', error: null, finishedAt: null };
  const next = markInterruptedOnLoad(job);
  assert.equal(next.status, 'failed');
  assert.ok(next.error && next.error.length > 0);
  assert.ok(next.finishedAt);
});

test('markInterruptedOnLoad reclassifies a still-pending job the same way', () => {
  const job = { id: 'j1', status: 'pending', error: null, finishedAt: null };
  const next = markInterruptedOnLoad(job);
  assert.equal(next.status, 'failed');
});

test('markInterruptedOnLoad never touches an already-terminal job', () => {
  const completed = { id: 'j1', status: 'completed', result: { ok: true }, finishedAt: 123 };
  assert.deepEqual(markInterruptedOnLoad(completed), completed);
  const failed = { id: 'j2', status: 'failed', error: 'algo real', finishedAt: 456 };
  assert.deepEqual(markInterruptedOnLoad(failed), failed);
});

test('markInterruptedOnLoad preserves an existing finishedAt instead of overwriting it', () => {
  const job = { id: 'j1', status: 'processing', finishedAt: 999 };
  const next = markInterruptedOnLoad(job);
  assert.equal(next.finishedAt, 999);
});
