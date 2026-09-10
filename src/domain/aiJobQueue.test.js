import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOB_STATUS,
  activeJobs,
  createJob,
  isTerminalJobStatus,
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
  markJobSeen,
  unseenJobsOfType,
} from './aiJobQueue.js';

test('createJob starts pending, unseen, with no result/error', () => {
  const job = createJob({ id: 'j1', type: 'apu-generate', label: 'Muro de block' });
  assert.equal(job.status, JOB_STATUS.PENDING);
  assert.equal(job.seen, false);
  assert.equal(job.result, null);
  assert.equal(job.error, null);
});

test('markJobProcessing sets startedAt once and keeps it on repeated calls', () => {
  let job = createJob({ id: 'j1', type: 'apu-generate' });
  job = markJobProcessing(job);
  const firstStart = job.startedAt;
  assert.equal(job.status, JOB_STATUS.PROCESSING);
  assert.ok(firstStart);
  job = markJobProcessing(job);
  assert.equal(job.startedAt, firstStart);
});

test('markJobCompleted stores the result and clears any previous error', () => {
  let job = createJob({ id: 'j1', type: 'apu-generate' });
  job = markJobProcessing(job);
  job = markJobFailed(job, new Error('temporal'));
  assert.equal(job.status, JOB_STATUS.FAILED);
  job = markJobCompleted(job, { apu: { concept: 'Muro' } });
  assert.equal(job.status, JOB_STATUS.COMPLETED);
  assert.equal(job.error, null);
  assert.deepEqual(job.result, { apu: { concept: 'Muro' } });
  assert.equal(job.seen, false);
});

test('markJobFailed stores a string error message, never the raw Error object', () => {
  let job = createJob({ id: 'j1', type: 'apu-generate' });
  job = markJobFailed(job, new Error('la IA no respondio'));
  assert.equal(typeof job.error, 'string');
  assert.equal(job.error, 'la IA no respondio');
});

test('isTerminalJobStatus is true only for completed/failed', () => {
  assert.equal(isTerminalJobStatus(JOB_STATUS.PENDING), false);
  assert.equal(isTerminalJobStatus(JOB_STATUS.PROCESSING), false);
  assert.equal(isTerminalJobStatus(JOB_STATUS.COMPLETED), true);
  assert.equal(isTerminalJobStatus(JOB_STATUS.FAILED), true);
});

test('unseenJobsOfType filters by type, terminal status, and unseen, newest first', () => {
  const jobs = {
    a: { ...createJob({ id: 'a', type: 'apu-generate' }), status: JOB_STATUS.COMPLETED, seen: false, finishedAt: 1000 },
    b: { ...createJob({ id: 'b', type: 'apu-generate' }), status: JOB_STATUS.COMPLETED, seen: false, finishedAt: 2000 },
    c: { ...createJob({ id: 'c', type: 'apu-generate' }), status: JOB_STATUS.COMPLETED, seen: true, finishedAt: 3000 },
    d: { ...createJob({ id: 'd', type: 'takeoff' }), status: JOB_STATUS.COMPLETED, seen: false, finishedAt: 4000 },
    e: { ...createJob({ id: 'e', type: 'apu-generate' }), status: JOB_STATUS.PROCESSING, seen: false },
  };
  const result = unseenJobsOfType(jobs, 'apu-generate');
  assert.deepEqual(result.map(j => j.id), ['b', 'a']);
});

test('unseenJobsOfType with no type returns unseen terminal jobs of any type', () => {
  const jobs = {
    a: { ...createJob({ id: 'a', type: 'apu-generate' }), status: JOB_STATUS.COMPLETED, seen: false, finishedAt: 1 },
    d: { ...createJob({ id: 'd', type: 'takeoff' }), status: JOB_STATUS.FAILED, seen: false, finishedAt: 2 },
  };
  const result = unseenJobsOfType(jobs);
  assert.equal(result.length, 2);
});

test('markJobSeen flips seen to true without touching status/result', () => {
  let job = createJob({ id: 'j1', type: 'apu-generate' });
  job = markJobCompleted(job, { ok: true });
  job = markJobSeen(job);
  assert.equal(job.seen, true);
  assert.equal(job.status, JOB_STATUS.COMPLETED);
});

test('activeJobs returns only pending/processing jobs', () => {
  const jobs = {
    a: { ...createJob({ id: 'a' }), status: JOB_STATUS.PENDING },
    b: { ...createJob({ id: 'b' }), status: JOB_STATUS.PROCESSING },
    c: { ...createJob({ id: 'c' }), status: JOB_STATUS.COMPLETED },
    d: { ...createJob({ id: 'd' }), status: JOB_STATUS.FAILED },
  };
  assert.deepEqual(activeJobs(jobs).map(j => j.id).sort(), ['a', 'b']);
});
