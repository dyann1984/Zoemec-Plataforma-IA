import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumProgressDeltas, evaluateProgressGuard, makeProgressEntry, validateProgressEntry } from './progressEntrySchema.js';

test('sumProgressDeltas suma solo los renglones del concepto pedido', () => {
  const entries = [
    { conceptoId: 'A', delta: 5 }, { conceptoId: 'B', delta: 100 }, { conceptoId: 'A', delta: 3 }
  ];
  assert.equal(sumProgressDeltas(entries, 'A'), 8);
  assert.equal(sumProgressDeltas(entries, 'B'), 100);
  assert.equal(sumProgressDeltas(entries, 'C'), 0);
});

test('evaluateProgressGuard: dentro de rango, sin advertencias', () => {
  const r = evaluateProgressGuard({ previousAccumulated: 10, delta: 5, cantidadContratada: 30 });
  assert.equal(r.nextAccumulated, 15);
  assert.equal(r.hasWarning, false);
});

test('evaluateProgressGuard: excede lo contratado -- advierte, NUNCA bloquea', () => {
  const r = evaluateProgressGuard({ previousAccumulated: 25, delta: 10, cantidadContratada: 30 });
  assert.equal(r.nextAccumulated, 35);
  assert.equal(r.hasWarning, true);
  assert.ok(r.warnings.includes('EXCEDE_CONTRATADO'));
});

test('evaluateProgressGuard: un delta negativo que deja el acumulado en negativo tambien advierte', () => {
  const r = evaluateProgressGuard({ previousAccumulated: 5, delta: -10, cantidadContratada: 30 });
  assert.equal(r.nextAccumulated, -5);
  assert.ok(r.warnings.includes('EXCESO_NEGATIVO'));
});

test('makeProgressEntry congela el P.U. del momento (nunca referencia viva)', () => {
  const e = makeProgressEntry({ projectId: 'PRO-1', conceptoId: 'CAT-1', delta: 10, pu: 250, usuario: 'ana' });
  assert.equal(e.pu, 250);
  assert.ok(e.id.startsWith('PROG-'));
});

test('validateProgressEntry exige projectId/conceptoId y delta distinto de cero', () => {
  const e = makeProgressEntry({ projectId: 'PRO-1', conceptoId: 'CAT-1', delta: 10 });
  assert.equal(validateProgressEntry(e).valid, true);
  assert.equal(validateProgressEntry({ ...e, delta: 0 }).valid, false);
  assert.equal(validateProgressEntry({ ...e, conceptoId: null }).valid, false);
});
