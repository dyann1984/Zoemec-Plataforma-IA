import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildComponentTraceability } from './assetTraceability.js';

test('sin ninguna referencia, cadena vacia (nunca inventa un eslabon)', () => {
  assert.deepEqual(buildComponentTraceability(null, {}), []);
});

test('arma la cadena completa Activo -> Componente -> Construction DNA -> APU -> Concepto -> Proyecto', () => {
  const chain = buildComponentTraceability(
    { id: 'CMP-1', nombre: 'Elevador' },
    {
      asset: { id: 'AST-1', nombre: 'Torre QA' },
      constructionDnaVersion: { version: 'V2' },
      apu: { id: 'APU-1', concept: 'Elevador hidráulico' },
      concepto: { id: 'C-1', concept: 'Elevador hidráulico' },
      project: { id: 'PRO-1', name: 'Obra QA' }
    }
  );
  assert.deepEqual(chain.map(l => l.level), ['ACTIVO', 'COMPONENTE', 'CONSTRUCTION_DNA', 'APU', 'CONCEPTO', 'PROYECTO']);
  assert.equal(chain[2].label, 'Construction DNA V2');
});

test('un eslabon sin dato real (ej. sin APU vinculado) simplemente se omite, nunca se rellena con un valor falso', () => {
  const chain = buildComponentTraceability({ id: 'CMP-1', nombre: 'Muro' }, { asset: { id: 'AST-1', nombre: 'Torre' }, project: { id: 'PRO-1', name: 'Obra' } });
  assert.deepEqual(chain.map(l => l.level), ['ACTIVO', 'COMPONENTE', 'PROYECTO']);
});
