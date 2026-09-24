import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeEmptyOrgLibraryEntry, validateOrgLibraryEntry, orgLibraryEntryKey, resolutionKey,
  planOrgLibraryImport, personalRowToOrgCandidate, ORG_LIBRARY_TYPE
} from './orgLibrarySchema.js';
import { catalogDedupeKey } from './libraryReview.js';

test('orgLibraryEntryKey reutiliza catalogDedupeKey de la Biblioteca y agrega la region', () => {
  const key = orgLibraryEntryKey({ description: 'Cemento CPC 30R', unit: 'Saco', region: 'Estado de México' });
  assert.equal(key, `${catalogDedupeKey({ desc: 'cemento cpc 30r', unidad: 'saco' })}|region:estado de mexico`);
  assert.equal(orgLibraryEntryKey({ code: 'CEM-01', description: 'x', unit: 'saco' }), 'clave:cem-01|region:');
});

test('misma identidad aunque cambien acentos, mayusculas y alias de unidad', () => {
  assert.equal(
    orgLibraryEntryKey({ description: 'Arena de Río', unit: 'm3', region: 'Toluca' }),
    orgLibraryEntryKey({ description: 'arena de rio', unit: 'M³', region: 'toluca' })
  );
  assert.equal(resolutionKey({ description: 'Arena de Río', unit: 'm3' }), resolutionKey({ description: 'ARENA DE RIO', unit: 'm³' }));
});

test('otra region = otra identidad (nunca se considera duplicado)', () => {
  assert.notEqual(
    orgLibraryEntryKey({ description: 'Cemento', unit: 'saco', region: 'Toluca' }),
    orgLibraryEntryKey({ description: 'Cemento', unit: 'saco', region: 'Monterrey' })
  );
});

test('makeEmptyOrgLibraryEntry + validate', () => {
  const e = makeEmptyOrgLibraryEntry({ organizationId: 'ORG-1', description: 'Block 12', unit: 'pza', price: 14.5 });
  assert.equal(validateOrgLibraryEntry(e).valid, true);
  assert.equal(e.projectId, null);
  assert.equal(validateOrgLibraryEntry({ ...e, organizationId: null }).valid, false);
  assert.equal(validateOrgLibraryEntry({ ...e, unit: '' }).valid, false);
});

test('personalRowToOrgCandidate conserva trazabilidad y marca el origen de la copia', () => {
  const c = personalRowToOrgCandidate(
    { desc: 'Oficial albañil', unidad: 'jor', precio: 650, tipo: 'mano de obra', traceability: { sourceDocName: 'Tabulador 2026', validatedAt: '2026-06-01' } },
    { organizationId: 'ORG-1', fromUid: 'ADMIN-1', region: 'Toluca' }
  );
  assert.equal(c.organizationId, 'ORG-1');
  assert.equal(c.type, ORG_LIBRARY_TYPE.LABOR);
  assert.equal(c.source, 'Tabulador 2026');
  assert.equal(c.date, '2026-06-01');
  assert.equal(c.region, 'Toluca');
  assert.deepEqual(c.origin, { kind: 'personal-import', fromUid: 'ADMIN-1', fromKey: 'zoemec-catalogo' });
});

const cand = (description, unit, price, date, extra = {}) => makeEmptyOrgLibraryEntry({ organizationId: 'ORG-1', description, unit, price, date, ...extra });

test('planOrgLibraryImport: crear / actualizar / sin cambio / conflicto / invalido / duplicado en lote', () => {
  const existing = [
    { ...cand('Cemento CPC 30R', 'saco', 239, '2026-06-01'), id: 'E-CEM' },
    { ...cand('Arena', 'm³', 450, '2026-08-01'), id: 'E-ARE' },
    { ...cand('Grava', 'm³', 520, '2026-08-01'), id: 'E-GRA' }
  ];
  const plan = planOrgLibraryImport([
    cand('Block 12', 'pza', 14.5, '2026-09-01'),           // nuevo
    cand('Cemento CPC 30R', 'saco', 245, '2026-09-01'),    // mas reciente y distinto -> update
    cand('Arena', 'm³', 450, '2026-09-01'),                // mismo precio -> unchanged
    cand('Grava', 'm³', 480, '2026-01-01'),                // mas viejo y distinto -> conflicto, gana empresa
    cand('Sin precio', 'pza', 0, '2026-09-01'),            // invalido
    cand('Block 12', 'pza', 15, '2026-09-10')              // duplicado en lote, gana el mas reciente
  ], existing);
  assert.equal(plan.summary.toCreate, 1);
  assert.equal(plan.toCreate[0].price, 15, 'del duplicado en lote gana el mas reciente');
  assert.equal(plan.summary.toUpdate, 1);
  assert.deepEqual({ id: plan.toUpdate[0].existingId, from: plan.toUpdate[0].from, to: plan.toUpdate[0].to }, { id: 'E-CEM', from: 239, to: 245 });
  assert.equal(plan.summary.unchanged, 1);
  assert.equal(plan.summary.conflicts, 1);
  assert.equal(plan.conflicts[0].resolution, 'KEEP_ORGANIZATION');
  assert.equal(plan.summary.invalid, 1);
  assert.equal(plan.summary.duplicatesInBatch, 1);
});

test('planOrgLibraryImport es determinista y no muta sus entradas', () => {
  const input = [cand('B', 'pza', 2, '2026-09-01'), cand('A', 'pza', 1, '2026-09-01')];
  const snapshot = JSON.stringify(input);
  const p1 = planOrgLibraryImport(input, []);
  const p2 = planOrgLibraryImport([...input].reverse(), []);
  assert.deepEqual(p1.toCreate.map(c => c.description), p2.toCreate.map(c => c.description));
  assert.equal(JSON.stringify(input), snapshot);
});
