import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markInterruptedOnLoad } from './aiJobsCloud.js';

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
