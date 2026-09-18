import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMaterialExplosion, buildAuxiliariesExplosion, summarizeMaterialExplosion } from './materialExplosion.js';
import { RECONCILIATION_RULE } from './explosionEngine.js';

function makeApu({ id, organizationId = 'org-1', projectId = 'proj-1', cantidadObra = 1, materials = [], consumables = [] }){
  return {
    id, organizationId, projectId,
    snapshot: { clave: `APU-${id}`, concept: `Concepto ${id}`, cantidadObra, materials, consumables, labor: [], equipment: [], herramientaMenor: { modo: 'porcentaje', porcentaje: 0, detalle: [] } }
  };
}
function materialRow(overrides = {}){
  return {
    clave: 'CEM-CPC30R', descripcion: 'Cemento CPC 30R', unidad: 'bulto',
    consumo: 1, desperdicioPct: 0, precioUnitario: 200,
    priceRecord: { confidence: 60 }, fuente: { estado: 'ESTIMADO_IA', region: 'CDMX' },
    ...overrides
  };
}

test('TEST QA 1 -- un solo APU: cantidad y precio pasan directo', () => {
  const apu = makeApu({ id: '1', cantidadObra: 10, materials: [materialRow({ consumo: 2 })] });
  const rows = buildMaterialExplosion([apu]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cantidadBase, 20); // 2 x 10
  assert.equal(rows[0].importe, 20 * 200);
  assert.deepEqual(rows[0].apusOrigen, ['1']);
});

test('TEST QA 2 -- varios APU con materiales distintos: no se fusionan', () => {
  const apu1 = makeApu({ id: '1', materials: [materialRow({ clave: 'CEM-CPC30R', descripcion: 'Cemento' })] });
  const apu2 = makeApu({ id: '2', materials: [materialRow({ clave: 'VAR-3-8', descripcion: 'Varilla 3/8', unidad: 'kg', precioUnitario: 18 })] });
  const rows = buildMaterialExplosion([apu1, apu2]);
  assert.equal(rows.length, 2);
});

test('TEST QA 3 -- material repetido en 20 APU se consolida en UNA fila (ejemplo del cemento)', () => {
  const apus = Array.from({ length: 20 }, (_, i) => makeApu({
    id: String(i), cantidadObra: 1,
    materials: [materialRow({ consumo: 7.5 })] // 20 x 7.5 = 150 bultos
  }));
  const rows = buildMaterialExplosion(apus);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cantidadBase, 150);
  assert.equal(rows[0].apusOrigen.length, 20);
  assert.equal(rows[0].origenes.length, 20);
});

test('TEST QA 4 -- mismo material con precios distintos: conserva cada origen + regla usada, nunca silenciosa', () => {
  const apu1 = makeApu({ id: '1', cantidadObra: 5, materials: [materialRow({ consumo: 1, precioUnitario: 250, priceRecord: { confidence: 40 } })] });
  const apu2 = makeApu({ id: '2', cantidadObra: 5, materials: [materialRow({ consumo: 1, precioUnitario: 300, priceRecord: { confidence: 85 } })] });
  const rows = buildMaterialExplosion([apu1, apu2]);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.reconciliationRule, RECONCILIATION_RULE.MAYOR_CONFIANZA);
  assert.equal(row.precioUnitario, 300); // gano la mayor confianza
  // Se conserva el precio REAL de cada origen para auditoria:
  const preciosPorOrigen = row.origenes.map(o => o.precioUnitario).sort((a, b) => a - b);
  assert.deepEqual(preciosPorOrigen, [250, 300]);
});

test('TEST QA 5 -- mismo nombre con unidad distinta NUNCA se fusiona sin conversion explicita', () => {
  const apuBulto = makeApu({ id: '1', materials: [materialRow({ unidad: 'bulto' })] });
  const apuKg = makeApu({ id: '2', materials: [materialRow({ unidad: 'kg' })] });
  const rows = buildMaterialExplosion([apuBulto, apuKg]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.unidad).sort(), ['bulto', 'kg']);
});

test('TEST QA 9 -- el desperdicio se aplica UNA sola vez, incluso consolidando varios APU', () => {
  // 2 APU, mismo material, consumo=10 c/u, desperdicio=10%, cantidadObra=1
  // cantidadFinal esperada: 10*1.10 + 10*1.10 = 22 (nunca 10*1.10*1.10)
  const apu1 = makeApu({ id: '1', materials: [materialRow({ consumo: 10, desperdicioPct: 10 })] });
  const apu2 = makeApu({ id: '2', materials: [materialRow({ consumo: 10, desperdicioPct: 10 })] });
  const rows = buildMaterialExplosion([apu1, apu2]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cantidadBase, 20);
  assert.equal(rows[0].cantidadFinal, 22);
});

test('TEST QA 10 -- la suma del desglose por concepto reconcilia EXACTO contra el total consolidado', () => {
  const apu1 = makeApu({ id: '1', cantidadObra: 3, materials: [materialRow({ consumo: 4, desperdicioPct: 5, precioUnitario: 210, priceRecord: { confidence: 50 } })] });
  const apu2 = makeApu({ id: '2', cantidadObra: 7, materials: [materialRow({ consumo: 4, desperdicioPct: 5, precioUnitario: 190, priceRecord: { confidence: 90 } })] });
  const apu3 = makeApu({ id: '3', cantidadObra: 2, materials: [materialRow({ consumo: 4, desperdicioPct: 5, precioUnitario: 205, priceRecord: { confidence: 10 } })] });
  const rows = buildMaterialExplosion([apu1, apu2, apu3]);
  const row = rows[0];
  const sumaDesglose = row.origenes.reduce((s, o) => s + o.importeConsolidado, 0);
  assert.equal(sumaDesglose, row.importe);
});

test('material POR_LOTE: la cantidad NO se multiplica de nuevo por cantidadObra', () => {
  const apu = makeApu({ id: '1', cantidadObra: 50, materials: [materialRow({ consumo: 100, desperdicioPct: 0, precioUnitario: 2, integracion: 'POR_LOTE' })] });
  const rows = buildMaterialExplosion([apu]);
  assert.equal(rows[0].cantidadFinal, 100); // el lote completo, no 100*50
  assert.equal(rows[0].importe, 200);
});

test('buildAuxiliariesExplosion consolida consumables por separado de materials', () => {
  const apu = makeApu({
    id: '1', cantidadObra: 2,
    materials: [materialRow()],
    consumables: [{ clave: 'DISCO-CORTE', descripcion: 'Disco de corte', unidad: 'pza', consumo: 1, desperdicioPct: 0, precioUnitario: 50, priceRecord: { confidence: 50 } }]
  });
  const materials = buildMaterialExplosion([apu]);
  const auxiliares = buildAuxiliariesExplosion([apu]);
  assert.equal(materials.length, 1);
  assert.equal(auxiliares.length, 1);
  assert.equal(auxiliares[0].descripcion, 'Disco de corte');
});

test('summarizeMaterialExplosion agrega totales de presentacion', () => {
  const apu = makeApu({ id: '1', materials: [materialRow()] });
  const rows = buildMaterialExplosion([apu]);
  const summary = summarizeMaterialExplosion(rows);
  assert.equal(summary.totalMateriales, 1);
  assert.equal(summary.importeTotal, rows[0].importe);
});

test('TEST QA 14 (defensa en profundidad) -- nunca consolida APUs de organizaciones distintas', () => {
  const apu1 = makeApu({ id: '1', organizationId: 'org-A', materials: [materialRow()] });
  const apu2 = makeApu({ id: '2', organizationId: 'org-B', materials: [materialRow()] });
  assert.throws(() => buildMaterialExplosion([apu1, apu2]), /organizaciones distintas/);
});
