/* Solo prueba la logica pura extraible de useDraftAutosave.js -- el hook en
   si (useCloudState, useState/useEffect de React) no tiene test directo en
   este proyecto, ver useInstallPrompt.test.js. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { draftKey } from './useDraftAutosave.js';

test('draftKey: namespacea con el prefijo "draft:" para nunca colisionar con una clave de datos reales', () => {
  assert.equal(draftKey('proposal', 'LEV-123'), 'draft:proposal:LEV-123');
});

test('draftKey: entityId ausente cae a "new" (borrador de un flujo que todavia no tiene id real)', () => {
  assert.equal(draftKey('apu', null), 'draft:apu:new');
  assert.equal(draftKey('apu', undefined), 'draft:apu:new');
  assert.equal(draftKey('apu', ''), 'draft:apu:new');
});

test('draftKey: dos flujos distintos con el mismo entityId nunca comparten clave', () => {
  assert.notEqual(draftKey('proposal', 'X'), draftKey('phonescan', 'X'));
});
