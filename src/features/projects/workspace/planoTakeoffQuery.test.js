import test from 'node:test';
import assert from 'node:assert/strict';
import { filterProjectPlanoTakeoffs } from './planoTakeoffQuery.js';

test('filterProjectPlanoTakeoffs: conserva solo el proyecto activo', () => {
  const takeoffs = [
    { id: 'A', projectId: 'P1' },
    { id: 'B', projectId: 'P2' },
    { id: 'C', projectId: 'P1' }
  ];
  assert.deepEqual(filterProjectPlanoTakeoffs(takeoffs, 'P1').map(item => item.id), ['A', 'C']);
  assert.deepEqual(filterProjectPlanoTakeoffs(takeoffs, 'P3'), []);
});

test('filterProjectPlanoTakeoffs: no muta la colección fuente', () => {
  const takeoffs = [{ id: 'A', projectId: 'P1', snapshot: { elementos: [] } }];
  const result = filterProjectPlanoTakeoffs(takeoffs, 'P1');
  assert.notStrictEqual(result, takeoffs);
  assert.deepEqual(takeoffs, [{ id: 'A', projectId: 'P1', snapshot: { elementos: [] } }]);
});
