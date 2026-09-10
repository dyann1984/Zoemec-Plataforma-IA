import { test } from 'node:test';
import assert from 'node:assert/strict';

// localStorage minimo para node:test (no hay DOM en este runner) -- mismo
// patron ya usado en src/domain/apuReview.test.js.
class FakeStorage{
  constructor(){ this.map = new Map(); }
  getItem(k){ return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v){ this.map.set(k, String(v)); }
  removeItem(k){ this.map.delete(k); }
}
globalThis.localStorage = new FakeStorage();

const { loadSeenServerJobIds, markServerJobSeen } = await import('./serverJobsSeen.js');

test('loadSeenServerJobIds starts empty for a user with no history', () => {
  const seen = loadSeenServerJobIds('alice');
  assert.equal(seen.size, 0);
});

test('markServerJobSeen persists and loadSeenServerJobIds reflects it', () => {
  markServerJobSeen('alice', 'job1');
  const seen = loadSeenServerJobIds('alice');
  assert.ok(seen.has('job1'));
});

test('seen ids are scoped per user (alice marking a job never affects bob)', () => {
  globalThis.localStorage = new FakeStorage();
  markServerJobSeen('alice', 'jobA');
  const bobSeen = loadSeenServerJobIds('bob');
  assert.equal(bobSeen.has('jobA'), false);
  const aliceSeen = loadSeenServerJobIds('alice');
  assert.ok(aliceSeen.has('jobA'));
});

test('markServerJobSeen never duplicates the same id twice', () => {
  globalThis.localStorage = new FakeStorage();
  markServerJobSeen('alice', 'dup');
  markServerJobSeen('alice', 'dup');
  const raw = JSON.parse(globalThis.localStorage.getItem('zoemec:alice:server-jobs-seen'));
  assert.equal(raw.filter(id => id === 'dup').length, 1);
});

test('never throws when localStorage is unavailable', () => {
  const original = globalThis.localStorage;
  // @ts-ignore
  globalThis.localStorage = undefined;
  assert.doesNotThrow(() => markServerJobSeen('alice', 'x'));
  const seen = loadSeenServerJobIds('alice');
  assert.equal(seen.size, 0);
  globalThis.localStorage = original;
});
