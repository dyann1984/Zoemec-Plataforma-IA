/* F2 -- UNA SOLA CANTIDAD ECONOMICA + trazabilidad Presupuesto/Explosion.
   Regla bajo prueba (src/domain/budgetScope.js):
     APU vinculado a concepto -> cantidad = concepto.qty (nunca apu.cantidadObra)
     APU independiente        -> cantidad = apu.cantidadObra
   Presupuesto y Explosion del presupuesto usan la MISMA poblacion de
   conceptos y la MISMA cantidad; PDF/XLSX consumen el mismo objeto calculado
   que la pantalla. */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';
import { makeEmptyAPUv2, APU_DATA_STATE } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { calcAPUv2 } from '../src/lib/apuCalc.js';
import { buildBudgetScope, buildProjectScope, SYNC_STATUS, APU_STATUS, QUANTITY_SOURCE } from '../src/domain/budgetScope.js';
import { computeScopedExplosion, computeExplosionData, EXPLOSION_SCOPE } from '../src/domain/explosionData.js';
import { aggregatePresupuesto } from '../src/domain/presupuestoAggregation.js';
import { exportExplosionExcel } from '../src/lib/explosionXlsx.js';
import { exportExplosionPdf } from '../src/lib/explosionPdf.js';
import { readXlsxCells } from './helpers/xlsxRead.mjs';

const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'Proveedor QA', fecha: '2026-09-01' };
const CEMENTO = { clave: 'CEM-CPC30R', descripcion: 'Cemento CPC 30R', unidad: 'kg', desperdicioPct: 0, precioUnitario: 4.8, fuente };

function apuDoc(id, { concept, cantidadObra, materials = [], labor = [], equipment = [], consumables = [], herramientaMenor = { modo: 'porcentaje', porcentaje: 3, detalle: [] }, archivedAt = null, currentVersion = 'V1' }){
  const a = makeEmptyAPUv2();
  Object.assign(a, { id, clave: id, concept, unit: 'm²', cantidadObra });
  a.materials = materials; a.labor = labor; a.equipment = equipment; a.consumables = consumables; a.herramientaMenor = herramientaMenor;
  return { id, ownerUid: 'uid-qa', organizationId: 'org-qa', projectId: 'PRO-F2', currentVersion, archivedAt, snapshot: finalizeProfessionalAPU(a) };
}

// APU de muro de block: composicion unitaria (por m2). cantidadObra
// historica = 50 (con la que se genero). Nunca se regenera en estas pruebas.
const APU_MURO = () => apuDoc('APU-014', {
  concept: 'Muro de block hueco 12 cm', cantidadObra: 50,
  materials: [
    { clave: 'BLOCK-12', descripcion: 'Block hueco 12x20x40', unidad: 'pza', consumo: 12.5, desperdicioPct: 0, precioUnitario: 15, fuente },
    { ...CEMENTO, consumo: 9 }
  ],
  labor: [
    { clave: 'MO-OF', descripcion: 'Oficial albañil', unidad: 'jor', cuadrilla: 1, rendimiento: 12.5, jornada: 8, salarioBase: 650, fsr: 1.5, fuente },
    { clave: 'MO-AY', descripcion: 'Ayudante general', unidad: 'jor', cuadrilla: 1, rendimiento: 12.5, jornada: 8, salarioBase: 430, fsr: 1.5, fuente }
  ],
  equipment: [{ clave: 'REV-1', descripcion: 'Revolvedora 1 saco', unidad: 'dia', integracion: 'POR_JORNADA', tarifa: 600, cantidad: 1, rendimientoDiario: 12.5, fuente }],
  consumables: [{ clave: 'DISCO-4', descripcion: 'Disco de corte 4.5 pulgadas', unidad: 'pza', consumo: 0.02, desperdicioPct: 0, precioUnitario: 45, fuente }]
});
const APU_ZAPATA = () => apuDoc('APU-001', { concept: 'Zapata aislada Z-01', cantidadObra: 1, materials: [{ ...CEMENTO, consumo: 300 }] });
const APU_APLANADO = () => apuDoc('APU-027', { concept: 'Aplanado mortero', cantidadObra: 1, materials: [{ ...CEMENTO, consumo: 5 }] });
const APU_LOTE = () => apuDoc('APU-LOTE', {
  concept: 'Proteccion temporal de area', cantidadObra: 10,
  materials: [
    { clave: 'PLAST', descripcion: 'Plastico de proteccion (lote)', unidad: 'lote', consumo: 1, desperdicioPct: 0, precioUnitario: 2000, integracion: 'POR_LOTE', fuente },
    { clave: 'CINTA', descripcion: 'Cinta de enmascarar', unidad: 'pza', consumo: 0.5, desperdicioPct: 0, precioUnitario: 20, fuente }
  ]
});
const APU_INDEP = () => apuDoc('APU-900', { concept: 'APU suelto sin concepto', cantidadObra: 7, materials: [{ ...CEMENTO, consumo: 10 }] });
const APU_ARCH = () => apuDoc('APU-ARCH', { concept: 'APU archivado', cantidadObra: 3, materials: [{ ...CEMENTO, consumo: 1000 }], archivedAt: '2026-09-01T00:00:00.000Z' });

const concepto = (id, { clave, capitulo, concept, qty, apuId = null, apuVersionId = null, archivedAt = null, unit = 'm²' }) =>
  ({ id, projectId: 'PRO-F2', clave, capitulo, concept, unit, qty, apuId, apuVersionId, archivedAt, status: apuId ? 'ASOCIADO' : 'PENDIENTE' });

function world(){
  const apuDocs = [APU_MURO(), APU_ZAPATA(), APU_APLANADO(), APU_LOTE(), APU_INDEP(), APU_ARCH()];
  const conceptos = [
    concepto('C-ZAP', { clave: 'Z-01', capitulo: 'CIMENTACION', concept: 'Zapata Z-01', qty: 2, apuId: 'APU-001', unit: 'm³' }),
    concepto('C-MURO', { clave: 'M-01', capitulo: 'ALBANILERIA', concept: 'Muro block', qty: 50, apuId: 'APU-014', apuVersionId: 'V1' }),
    concepto('C-APL', { clave: 'A-01', capitulo: 'ACABADOS', concept: 'Aplanado', qty: 40, apuId: 'APU-027' }),
    concepto('C-SIN', { clave: 'X-01', capitulo: 'OTROS', concept: 'Concepto sin APU', qty: 10 }),
    concepto('C-ARCH-APU', { clave: 'X-02', capitulo: 'OTROS', concept: 'Concepto con APU archivado', qty: 5, apuId: 'APU-ARCH' }),
    concepto('C-BORRADO', { clave: 'X-03', capitulo: 'ALBANILERIA', concept: 'Concepto eliminado', qty: 999, apuId: 'APU-014', archivedAt: '2026-09-02T00:00:00.000Z' })
  ];
  return { apuDocs, conceptos };
}

const find = (rows, desc) => rows.find(r => r.descripcion === desc);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

/* ---------- T1 / T2: misma cantidad; 50 -> 60 sin regenerar APU ---------- */

test('T1 -- Presupuesto y Explosion usan la misma cantidad (concepto.qty) y la misma poblacion', () => {
  const { apuDocs, conceptos } = world();
  const scope = buildBudgetScope({ conceptos, apuDocs });
  const budget = aggregatePresupuesto(scope.rows);
  const exp = computeScopedExplosion({ conceptos, apuDocs, scope: EXPLOSION_SCOPE.PRESUPUESTO });
  // Misma poblacion: los conceptos con APU del presupuesto == conceptos que aportan a la explosion
  const conceptosPresupuestoConApu = budget.rows.filter(r => r.hasApu).map(r => r.conceptoId).sort();
  const conceptosExplosion = [...new Set(exp.lines.map(l => l.concepto.id))].sort();
  assert.deepEqual(conceptosExplosion, conceptosPresupuestoConApu);
  // Misma cantidad por concepto
  for(const l of exp.lines){
    assert.equal(l.qty, budget.rows.find(r => r.conceptoId === l.concepto.id).qty);
    assert.equal(l.quantitySource, QUANTITY_SOURCE.CONCEPTO);
  }
  // Consistencia economica: suma de costo directo de la explosion (4 tipos) == costo directo del presupuesto
  const d = exp.data;
  const directExplosion = [...d.materials, ...d.auxiliares, ...d.labor, ...d.machinery.maquinaria, ...d.machinery.equipo, ...d.machinery.herramientaMenor].reduce((s, r) => s + r.importe, 0);
  close(directExplosion, budget.costoDirectoTotal, 'costo directo explosion vs presupuesto');
});

test('T2 -- 50 m2 -> 60 m2 cambiando SOLO concepto.qty (sin regenerar el APU): presupuesto y explosion se actualizan', () => {
  const { apuDocs, conceptos } = world();
  const muroApu = apuDocs.find(d => d.id === 'APU-014');
  const snapshotAntes = JSON.stringify(muroApu);
  const pu = calcAPUv2(muroApu.snapshot).pu;

  const antes = computeScopedExplosion({ conceptos, apuDocs, scope: EXPLOSION_SCOPE.PRESUPUESTO });
  const budgetAntes = aggregatePresupuesto(antes.budgetRows);
  assert.equal(find(antes.data.materials, 'Block hueco 12x20x40').cantidadFinal, 625);
  close(budgetAntes.rows.find(r => r.conceptoId === 'C-MURO').importe, 50 * pu, 'importe 50 m2');

  const conceptos60 = conceptos.map(c => c.id === 'C-MURO' ? { ...c, qty: 60 } : c);
  const despues = computeScopedExplosion({ conceptos: conceptos60, apuDocs, scope: EXPLOSION_SCOPE.PRESUPUESTO });
  const budgetDespues = aggregatePresupuesto(despues.budgetRows);
  assert.equal(find(despues.data.materials, 'Block hueco 12x20x40').cantidadFinal, 750, 'NO debe seguir mostrando 625');
  close(budgetDespues.rows.find(r => r.conceptoId === 'C-MURO').importe, 60 * pu, 'importe 60 m2');
  close(budgetDespues.rows.find(r => r.conceptoId === 'C-MURO').pu, pu, 'el P.U. no cambia (sin renglones POR_LOTE)');
  assert.equal(JSON.stringify(muroApu), snapshotAntes, 'el APU no se modifico/regenero');
  // Desactualizacion: CANTIDAD (no requiere regenerar), no COMPOSICION
  const sync = despues.budgetRows.find(r => r.conceptoId === 'C-MURO').sync;
  assert.equal(sync.status, SYNC_STATUS.CANTIDAD_ACTUALIZADA);
  assert.equal(sync.requiereRegenerar, false);
  assert.equal(sync.cantidadObraApu, 50);
  assert.equal(sync.cantidadConcepto, 60);
});

test('Desactualizacion: COMPOSICION_CAMBIADA se distingue de un cambio de cantidad', () => {
  const { apuDocs, conceptos } = world();
  const docs = apuDocs.map(d => d.id === 'APU-014' ? { ...d, currentVersion: 'V2' } : d);
  const row = buildBudgetScope({ conceptos, apuDocs: docs }).rows.find(r => r.conceptoId === 'C-MURO');
  assert.equal(row.sync.status, SYNC_STATUS.COMPOSICION_CAMBIADA);
  assert.equal(row.sync.versionAsociada, 'V1');
  assert.equal(row.sync.versionVigente, 'V2');
});

/* ---------- T3 / T4: independientes y poblacion ---------- */

test('T3 -- APU independiente conserva su cantidadObra (explosion de PROYECTO), etiquetado como independiente', () => {
  const { apuDocs, conceptos } = world();
  const exp = computeScopedExplosion({ conceptos, apuDocs, scope: EXPLOSION_SCOPE.PROYECTO });
  const indep = exp.lines.filter(l => l.quantitySource === QUANTITY_SOURCE.APU_INDEPENDIENTE);
  assert.deepEqual(indep.map(l => l.apuDoc.id).sort(), ['APU-900', 'APU-LOTE']);
  assert.equal(indep.find(l => l.apuDoc.id === 'APU-900').qty, 7);
  const cem = find(exp.data.materials, 'Cemento CPC 30R');
  const o = cem.origenes.find(x => x.apuId === 'APU-900');
  assert.equal(o.cantidadFinalAportada, 70, '10 kg x cantidadObra 7');
  assert.equal(o.conceptoId, null);
  // Compatibilidad: el motor con documentos APU sueltos sigue usando cantidadObra.
  const legacy = computeExplosionData([APU_INDEP()]);
  assert.equal(find(legacy.materials, 'Cemento CPC 30R').cantidadFinal, 70);
});

test('T4 -- un APU que no pertenece al presupuesto NO aparece en la explosion consolidada del presupuesto', () => {
  const { apuDocs, conceptos } = world();
  const exp = computeScopedExplosion({ conceptos, apuDocs, scope: EXPLOSION_SCOPE.PRESUPUESTO });
  const apusEnExplosion = new Set(exp.lines.map(l => l.apuDoc.id));
  assert.ok(!apusEnExplosion.has('APU-900'), 'APU independiente fuera');
  assert.ok(!apusEnExplosion.has('APU-LOTE'), 'APU sin concepto fuera');
  assert.ok(!apusEnExplosion.has('APU-ARCH'), 'APU archivado fuera');
  assert.deepEqual(exp.excluded.apusFueraDelPresupuesto.sort(), ['APU-900', 'APU-LOTE']);
  assert.deepEqual(exp.excluded.conceptosSinApu, ['C-SIN']);
  assert.deepEqual(exp.excluded.conceptosConApuNoDisponible, [{ conceptoId: 'C-ARCH-APU', apuId: 'APU-ARCH', reason: 'APU_ARCHIVADO' }]);
  assert.deepEqual(exp.excluded.conceptosArchivados, ['C-BORRADO']);
  for(const kind of ['materials', 'auxiliares', 'labor']){
    exp.data[kind].forEach(r => r.origenes.forEach(o => assert.ok(o.conceptoId, `${kind}: todo origen del presupuesto trae concepto`)));
  }
});

test('Casos 2/4/5 -- concepto sin APU, APU archivado y concepto eliminado en el presupuesto', () => {
  const { apuDocs, conceptos } = world();
  const scope = buildBudgetScope({ conceptos, apuDocs });
  const budget = aggregatePresupuesto(scope.rows);
  const sin = budget.rows.find(r => r.conceptoId === 'C-SIN');
  assert.equal(sin.hasApu, false); assert.equal(sin.importe, 0); assert.equal(sin.apuStatus, APU_STATUS.SIN_APU);
  const arch = budget.rows.find(r => r.conceptoId === 'C-ARCH-APU');
  assert.equal(arch.hasApu, false, 'APU archivado no cuenta como "tiene APU"');
  assert.equal(arch.importe, 0);
  assert.equal(arch.apuStatus, APU_STATUS.APU_NO_DISPONIBLE);
  assert.equal(arch.apuId, 'APU-ARCH', 'se conserva la referencia para trazabilidad');
  assert.equal(budget.rows.find(r => r.conceptoId === 'C-BORRADO'), undefined, 'concepto eliminado fuera del presupuesto');
  // Tampoco aporta a la explosion (qty 999 hubiera inflado todo)
  const exp = computeScopedExplosion({ conceptos, apuDocs, scope: EXPLOSION_SCOPE.PRESUPUESTO });
  assert.equal(find(exp.data.materials, 'Block hueco 12x20x40').cantidadFinal, 625);
});

/* ---------- T5-T8: los 4 tipos con la cantidad autoritativa ---------- */

function muroSolo(qty){
  const apuDocs = [APU_MURO()];
  const conceptos = [concepto('C-MURO', { clave: 'M-01', capitulo: 'ALBANILERIA', concept: 'Muro block', qty, apuId: 'APU-014' })];
  return computeScopedExplosion({ conceptos, apuDocs, scope: EXPLOSION_SCOPE.PRESUPUESTO }).data;
}

test('T5 -- materiales: consumo unitario x cantidad del concepto', () => {
  const d = muroSolo(60);
  assert.equal(find(d.materials, 'Block hueco 12x20x40').cantidadFinal, 750);
  assert.equal(find(d.materials, 'Cemento CPC 30R').cantidadFinal, 540);
  close(find(d.materials, 'Block hueco 12x20x40').importe, 750 * 15, 'importe block');
});

test('T6 -- mano de obra: jornadas = (cuadrilla/rendimiento) x cantidad del concepto', () => {
  const d = muroSolo(60);
  const of = find(d.labor, 'Oficial albañil');
  close(of.totalJornadas, 60 / 12.5, 'jornadas oficial');
  close(of.importe, (60 / 12.5) * 650 * 1.5, 'importe oficial');
  assert.equal(of.origenes[0].cantidadConcepto, 60);
});

test('T7 -- maquinaria/equipo: costo por unidad x cantidad del concepto (+ herramienta menor)', () => {
  const d = muroSolo(60);
  const rev = find(d.machinery.maquinaria, 'Revolvedora 1 saco');
  close(rev.importe, (600 / 12.5) * 60, 'revolvedora POR_JORNADA');
  const hm = d.machinery.herramientaMenor[0];
  const moPorUnidad = (1 / 12.5) * 650 * 1.5 + (1 / 12.5) * 430 * 1.5;
  close(hm.importe, moPorUnidad * 0.03 * 60, 'herramienta menor 3% MO');
});

test('T8 -- auxiliares/consumibles: misma regla de cantidad', () => {
  const d = muroSolo(60);
  close(find(d.auxiliares, 'Disco de corte 4.5 pulgadas').cantidadFinal, 0.02 * 60, 'discos');
  assert.equal(find(d.auxiliares, 'Disco de corte 4.5 pulgadas').origenes[0].conceptoId, 'C-MURO');
});

/* ---------- T9 / T11: consolidacion con trazabilidad ---------- */

test('T9 -- el mismo insumo en varios conceptos se consolida sin perder contribuciones (INSUMO -> APU -> CONCEPTO -> CAPITULO -> PROYECTO)', () => {
  const { apuDocs, conceptos } = world();
  const exp = computeScopedExplosion({ conceptos, apuDocs, scope: EXPLOSION_SCOPE.PRESUPUESTO });
  const cem = find(exp.data.materials, 'Cemento CPC 30R');
  assert.equal(cem.cantidadFinal, 1250, 'TOTAL 1,250 kg');
  const contrib = Object.fromEntries(cem.origenes.map(o => [o.capituloLabel, { apu: o.apuId, concepto: o.conceptoClave, cantidad: o.cantidadFinalAportada, proyecto: o.projectId }]));
  assert.deepEqual(contrib, {
    'Cimentación': { apu: 'APU-001', concepto: 'Z-01', cantidad: 600, proyecto: 'PRO-F2' },
    'Albañilería': { apu: 'APU-014', concepto: 'M-01', cantidad: 450, proyecto: 'PRO-F2' },
    'Acabados': { apu: 'APU-027', concepto: 'A-01', cantidad: 200, proyecto: 'PRO-F2' }
  });
  close(cem.origenes.reduce((s, o) => s + o.importeConsolidado, 0), cem.importe, 'suma de contribuciones == total');
  assert.deepEqual(cem.conceptosOrigen.sort(), ['C-APL', 'C-MURO', 'C-ZAP']);
});

test('T11 -- un mismo APU asociado a dos conceptos con cantidades distintas produce dos contribuciones correctas (caso 7: cantidad decimal)', () => {
  const apuDocs = [APU_MURO()];
  const conceptos = [
    concepto('C-N1', { clave: 'M-N1', capitulo: 'ALBANILERIA', concept: 'Muro nivel 1', qty: 50, apuId: 'APU-014' }),
    concepto('C-N2', { clave: 'M-N2', capitulo: 'ALBANILERIA', concept: 'Muro nivel 2', qty: 12.345, apuId: 'APU-014' })
  ];
  const exp = computeScopedExplosion({ conceptos, apuDocs, scope: EXPLOSION_SCOPE.PRESUPUESTO });
  const block = find(exp.data.materials, 'Block hueco 12x20x40');
  assert.equal(block.origenes.length, 2);
  close(block.origenes.find(o => o.conceptoId === 'C-N1').cantidadFinalAportada, 625, 'nivel 1');
  close(block.origenes.find(o => o.conceptoId === 'C-N2').cantidadFinalAportada, 12.345 * 12.5, 'nivel 2 decimal');
  close(block.cantidadFinal, (50 + 12.345) * 12.5, 'total');
  assert.deepEqual(block.apusOrigen, ['APU-014'], 'un solo APU de origen');
  const budget = aggregatePresupuesto(buildBudgetScope({ conceptos, apuDocs }).rows);
  const pu = calcAPUv2(apuDocs[0].snapshot).pu;
  close(budget.importeTotal, (50 + 12.345) * pu, 'presupuesto');
});

/* ---------- T12: cantidad cero y lotes ---------- */

test('T12 -- cantidad 0 no genera consumo fantasma (incluidos renglones POR_LOTE)', () => {
  const apuDocs = [APU_LOTE()];
  const conceptos = [concepto('C-PROT', { clave: 'P-01', capitulo: 'PRELIMINARES', concept: 'Proteccion', qty: 0, apuId: 'APU-LOTE' })];
  const exp = computeScopedExplosion({ conceptos, apuDocs, scope: EXPLOSION_SCOPE.PRESUPUESTO });
  exp.data.materials.forEach(r => { assert.equal(r.cantidadFinal, 0, `${r.descripcion} sin consumo`); assert.equal(r.importe, 0); });
  const budget = aggregatePresupuesto(exp.budgetRows);
  assert.equal(budget.importeTotal, 0);
});

test('POR_LOTE: el P.U. depende de la cantidad (lote repartido); presupuesto y explosion siguen cuadrando', () => {
  const apuDocs = [APU_LOTE()];
  const mk = qty => [concepto('C-PROT', { clave: 'P-01', capitulo: 'PRELIMINARES', concept: 'Proteccion', qty, apuId: 'APU-LOTE' })];
  for(const qty of [10, 25]){
    const exp = computeScopedExplosion({ conceptos: mk(qty), apuDocs, scope: EXPLOSION_SCOPE.PRESUPUESTO });
    const row = exp.budgetRows[0];
    assert.equal(row.puDependeDeCantidad, true);
    assert.equal(find(exp.data.materials, 'Plastico de proteccion (lote)').cantidadFinal, 1, 'un lote, no qty lotes');
    assert.equal(find(exp.data.materials, 'Cinta de enmascarar').cantidadFinal, 0.5 * qty);
    const directExplosion = exp.data.materials.reduce((s, r) => s + r.importe, 0) + exp.data.machinery.herramientaMenor.reduce((s, r) => s + r.importe, 0);
    close(directExplosion, row.direct * qty, `costo directo qty=${qty}`);
  }
});

test('Caso 10 -- multiples capitulos: subtotales del presupuesto cuadran con la explosion por capitulo', () => {
  const { apuDocs, conceptos } = world();
  const exp = computeScopedExplosion({ conceptos, apuDocs, scope: EXPLOSION_SCOPE.PRESUPUESTO });
  const budget = aggregatePresupuesto(exp.budgetRows);
  const d = exp.data;
  const all = [...d.materials, ...d.auxiliares, ...d.labor, ...d.machinery.maquinaria, ...d.machinery.equipo, ...d.machinery.herramientaMenor];
  const porCapitulo = {};
  all.forEach(r => r.origenes.forEach(o => { porCapitulo[o.capitulo] = (porCapitulo[o.capitulo] || 0) + (o.importeConsolidado ?? o.importeAportadoReal); }));
  for(const cap of budget.capituloSubtotals){
    if(cap.direct === 0) continue;
    close(porCapitulo[cap.capitulo] || 0, cap.direct, `capitulo ${cap.capitulo}`);
  }
});

/* ---------- T10: pantalla == XLSX == PDF ---------- */

let responses;
const originalFetch = global.fetch;
before(() => {
  global.fetch = async (url) => {
    const u = new URL(String(url), 'http://localhost');
    const key = u.pathname + (u.search || '');
    const found = Object.entries(responses).find(([pattern]) => key.startsWith(pattern));
    const body = found ? found[1] : { error: 'not mocked: ' + key };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
});
after(() => { global.fetch = originalFetch; });
beforeEach(() => {
  const { apuDocs, conceptos } = world();
  // El servidor ya filtra archivados; se mantiene el APU archivado aqui para
  // probar tambien la defensa del alcance.
  responses = {
    '/api/projects?id=PRO-F2': { project: { id: 'PRO-F2', name: 'Proyecto F2', client: 'Cliente F2' } },
    '/api/apus?projectId=PRO-F2': { apus: apuDocs },
    '/api/catalogo-conceptos?projectId=PRO-F2': { conceptos: conceptos.map(c => c.id === 'C-MURO' ? { ...c, qty: 60 } : c) },
    '/api/export-events': { event: {} }
  };
});

test('T10 -- PDF y XLSX coinciden con los datos de pantalla (mismo objeto, alcance PRESUPUESTO, 60 m2)', async () => {
  // "Pantalla": el mismo calculo que usa el panel (loadScopedExplosion -> computeScopedExplosion).
  const { loadScopedExplosion } = await import('../src/lib/explosionInputs.js');
  const screen = await loadScopedExplosion({ projectId: 'PRO-F2', scope: EXPLOSION_SCOPE.PRESUPUESTO });
  const blockScreen = find(screen.data.materials, 'Block hueco 12x20x40');
  assert.equal(blockScreen.cantidadFinal, 750);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-f2-'));
  const cwd = process.cwd(); process.chdir(dir);
  try{
    // XLSX recargando por su cuenta (mismo loader) y XLSX con el objeto de pantalla: identicos.
    const x1 = await exportExplosionExcel({ projectId: 'PRO-F2', scope: EXPLOSION_SCOPE.PRESUPUESTO, writeXlsxFileImpl: writeXlsxFileNode, fileName: 'a.xlsx' });
    const x2 = await exportExplosionExcel({ projectId: 'PRO-F2', scope: EXPLOSION_SCOPE.PRESUPUESTO, explosion: screen, writeXlsxFileImpl: writeXlsxFileNode, fileName: 'b.xlsx' });
    assert.deepEqual(x1.materials, screen.data.materials);
    assert.deepEqual(x2.materials, screen.data.materials);
    assert.deepEqual(x1.labor, screen.data.labor);
    assert.deepEqual(x1.machinery, screen.data.machinery);
    assert.deepEqual(x1.auxiliares, screen.data.auxiliares);
    // Celdas reales del archivo
    const cells = readXlsxCells(fs.readFileSync('a.xlsx'));
    const rowRef = Object.entries(cells).find(([ref, c]) => ref.startsWith('B') && c.str === 'Block hueco 12x20x40')[0].slice(1);
    assert.equal(cells[`F${rowRef}`].value, 750, 'XLSX cantidad final block = pantalla');
    assert.equal(cells[`H${rowRef}`].value, blockScreen.importe, 'XLSX importe block = pantalla');
    const allText = Object.values(cells).map(c => c.str || '').join('\n');
    assert.match(allText, /Albañilería > M-01 Muro block > APU-014 \(cant\. 60\)/, 'XLSX muestra la cadena Capitulo > Concepto > APU con la cantidad vigente');
    assert.match(allText, /Alcance: PRESUPUESTO/);
    assert.ok(!allText.includes('APU suelto sin concepto'), 'APU independiente fuera del XLSX del presupuesto');
  }finally{ process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true }); }

  const { doc, data } = await exportExplosionPdf({ projectId: 'PRO-F2', scope: EXPLOSION_SCOPE.PRESUPUESTO, explosion: screen, save: false });
  assert.deepEqual(data.materials, screen.data.materials);
  const pdfText = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  assert.ok(pdfText.includes('750.00'), 'PDF cantidad final block = 750');
  assert.ok(pdfText.includes('Muro block'), 'PDF trae el concepto de origen');
  assert.ok(!pdfText.includes('APU suelto sin concepto'));
});

test('T10b -- presupuesto sin conceptos con APU: error explicito, nunca una explosion vacia', async () => {
  responses['/api/catalogo-conceptos?projectId=PRO-F2'] = { conceptos: [concepto('C-SIN', { clave: 'X', capitulo: 'OTROS', concept: 'Sin APU', qty: 3 })] };
  await assert.rejects(() => exportExplosionPdf({ projectId: 'PRO-F2', scope: EXPLOSION_SCOPE.PRESUPUESTO, save: false }), /no tiene conceptos con APU/);
});

test('buildProjectScope nunca duplica un APU vinculado como independiente', () => {
  const { apuDocs, conceptos } = world();
  const s = buildProjectScope({ conceptos, apuDocs });
  const muroLines = s.lines.filter(l => l.apuDoc.id === 'APU-014');
  assert.equal(muroLines.length, 1);
  assert.equal(muroLines[0].quantitySource, QUANTITY_SOURCE.CONCEPTO);
});
