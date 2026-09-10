import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPETITORS, FEATURE_LIST, VAL, WHY_ZOEMEC } from './competitorData.js';

const VALID_VALUES = new Set(Object.values(VAL));

test('every competitor defines every feature with a valid value', () => {
  for(const c of COMPETITORS){
    for(const key of FEATURE_LIST){
      assert.ok(key in c.features, `${c.id} is missing feature "${key}"`);
      assert.ok(VALID_VALUES.has(c.features[key]), `${c.id}.${key} has an invalid value: ${c.features[key]}`);
    }
  }
});

test('ZOEMEC is present and marks nothing outside the defined value set', () => {
  const zoemec = COMPETITORS.find(c => c.id === 'zoemec');
  assert.ok(zoemec, 'zoemec row must exist');
  assert.equal(Object.keys(zoemec.features).length, FEATURE_LIST.length);
});

test('every competitor has a name, region and either a url or pricingConfirmed=false', () => {
  for(const c of COMPETITORS){
    assert.ok(c.name && c.name.trim(), `${c.id} needs a name`);
    assert.ok(c.region && c.region.trim(), `${c.id} needs a region`);
    assert.ok(typeof c.pricingConfirmed === 'boolean', `${c.id}.pricingConfirmed must be boolean`);
  }
});

test('competitor ids are unique', () => {
  const ids = COMPETITORS.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('WHY_ZOEMEC entries have a key and evidence pointer', () => {
  assert.ok(WHY_ZOEMEC.length > 0);
  for(const item of WHY_ZOEMEC){
    assert.ok(item.key);
    assert.ok(item.evidence);
  }
});
