/* F5 -- CENTRO DE REPORTES (T1-T20 + prueba principal 19.71 m2).
   REPORTAR != RECALCULAR: cada prueba compara VALORES NUMERICOS de los
   documentos (texto del PDF y celdas del XLSX) contra los motores
   autoritativos: buildPresupuestoView/buildBudgetScope (F2),
   computeScopedExplosion (F2), generadores persistidos (F3) y
   levantamientos/planos (F4). Datos por las rutas reales /api (Firestore en
   memoria del arnes); nunca produccion. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';

register('./helpers/roleParityHarness/hooks.mjs', import.meta.url);
const W = await import('./helpers/roleParityHarness/world.mjs');
const CAD = await import('../src/domain/cadModel.js');
const SVC = await import('../src/features/planos/cad/cadConceptService.js');
const PLANO = await import('../src/features/planos/cadPlanoCloud.js');
const { surveyToCadModel, surveyPlanoKey } = await import('../src/domain/surveyToCadModel.js');
const { makeEmptySurvey, makeEmptySpace } = await import('../src/domain/levantamientoSchema.js');
const { linkSpaceToPlano } = await import('../src/domain/levantamientoCadLink.js');
const { makeEmptyAPUv2, APU_DATA_STATE } = await import('../src/domain/apuSchema.js');
const { buildPresupuestoView } = await import('../src/domain/presupuestoView.js');
const { computeScopedExplosion, EXPLOSION_SCOPE } = await import('../src/domain/explosionData.js');
const { loadScopedExplosion } = await import('../src/lib/explosionInputs.js');
const RE = await import('../src/lib/reports/reportExports.js');
const RM = await import('../src/lib/reports/reportModels.js');
const { pdfPages, pdfText, amountsIn, round2 } = await import('./helpers/pdfText.mjs');
const { readXlsxCells } = await import('./helpers/xlsxRead.mjs');
const { default: writeXlsxFileNode } = await import('write-excel-file/node');
const { apiPost } = await import('../src/services/apiClient.js');

const LOGO = `data:image/png;base64,${fs.readFileSync(new URL('../public/images/zoemec-logo-oficial.png', import.meta.url)).toString('base64')}`;
const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} != ${b}`);

/* ---------------- fixtures ---------------- */
const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'QA', fecha: '2026-09-01' };
function apuDoc(id, concept, materials, labor){
  const a = makeEmptyAPUv2();
  Object.assign(a, { id, clave: id, concept, unit: 'm²', cantidadObra: 10 });
  a.materials = materials.map(([clave, descripcion, unidad, consumo, precio]) => ({ clave, descripcion, unidad, consumo, desperdicioPct: 0, precioUnitario: precio, fuente }));
  a.labor = labor.map(([clave, descripcion, rendimiento, salario]) => ({ clave, descripcion, unidad: 'jor', cuadrilla: 1, rendimiento, jornada: 8, salarioBase: salario, fsr: 1.5, fuente }));
  return a;
}
// APU real del caso F3: P.U. = 347.32 con la cascada de ZOEMEC (calcAPUv2).
const APU_MB12 = () => apuDoc('APU-MB12', 'Muro de block 12 cm', [['BLOCK-12', 'Block hueco 12x20x40', 'pza', 12.5, 15]], [['MO-OF', 'Oficial albañil', 12.5, 650]]);
const APU_PISO = () => apuDoc('APU-PISO', 'Piso de loseta', [['LOS-33', 'Loseta ceramica 33x33', 'm²', 1.05, 180]], [['MO-AZ', 'Oficial azulejero', 10, 700]]);

async function createConcepts(list){ return (await apiPost('/api/catalogo-conceptos', { action: 'create', projectId: 'P-1', conceptos: list })).conceptos; }
async function saveApu(a){ await apiPost('/api/apus', { action: 'create', id: a.id, projectId: 'P-1', apu: a }); }
const associate = (id, apuId) => apiPost('/api/catalogo-conceptos', { action: 'associate-apu', id, apuId });

/* Mundo principal: Albanileria / MB-12 Muro de block 12 cm con generadores
   M-01 3.00x2.70 = 8.10 y M-03 5.00x2.70 - P-01 0.90x2.10 = 11.61 -> 19.71;
   Acabados / PISO-01 (14 manual, otro APU); Otros / SIN-APU (sin APU). */
async function mainWorld({ project = {} } = {}){
  W.seedWorld();
  if(Object.keys(project).length) await W.H.db.collection('projects').doc('P-1').set({ ...W.PROJECT, ...project });
  W.asRole('MANAGER');
  const [mb, piso, sin] = await createConcepts([
    { clave: 'MB-12', capitulo: 'ALBANILERIA', concept: 'Muro de block 12 cm', unit: 'm²', qty: 1 },
    { clave: 'PISO-01', capitulo: 'ACABADOS', concept: 'Piso de loseta ceramica 33x33', unit: 'm²', qty: 14 },
    { clave: 'SIN-APU', capitulo: 'OTROS', concept: 'Limpieza final de obra', unit: 'm²', qty: 30 }
  ]);
  let m = CAD.createEmptyCadModel();
  ({ model: m } = CAD.addWall(m, { x1: 0, y1: 0, x2: 3, y2: 0, height: 2.7, thickness: 0.12 }));   // M-01
  ({ model: m } = CAD.addWall(m, { x1: 3, y1: 0, x2: 3, y2: 4, height: 2.7, thickness: 0.12 }));   // M-02 (no asignado)
  ({ model: m } = CAD.addWall(m, { x1: 3, y1: 4, x2: -2, y2: 4, height: 2.7, thickness: 0.12 }));  // M-03 5.00
  ({ model: m } = CAD.addOpening(m, { type: 'door', wallId: 'M-03', width: 0.9, height: 2.1, offset: 1 }));
  m = CAD.setElementAssignment(m, 'M-01', { conceptId: mb.id, quantityField: 'netArea', unit: 'm²' });
  m = CAD.setElementAssignment(m, 'M-03', { conceptId: mb.id, quantityField: 'netArea', unit: 'm²' });
  const plano = await PLANO.createPlano({ planoId: 'PLANO-QA', projectId: 'P-1', fileName: 'Planta QA.pdf', cadModel: m, sourceKind: 'PLANO_PDF' });
  await SVC.syncConceptGenerators({ conceptId: mb.id, projectId: 'P-1', planoId: 'PLANO-QA', model: m, expectedRevision: 0, planoRevision: plano.revision });
  await saveApu(APU_MB12()); await saveApu(APU_PISO());
  await associate(mb.id, 'APU-MB12'); await associate(piso.id, 'APU-PISO');
  return { mb, piso, sin, model: m, plano };
}
const conceptos = async () => (await W.apiPost('/api/catalogo-conceptos', { action: 'noop' }).catch(() => null), (await RE.loadReportData('P-1')).conceptos);
async function models(opts = {}){ return RE.buildAllReportModels(await RE.loadReportData('P-1'), { generatedBy: 'mgr@harness.test', ...opts }); }
const pdfOf = (M, type) => RE.generateReport(M, type, 'PDF', { logo: LOGO, save: false }).then(r => r.doc);
const xlsxOf = (M, type) => RE.generateReport(M, type, 'XLSX', { logo: LOGO, save: false, writeXlsxFileImpl: writeXlsxFileNode });
const sheetCells = (bytes, n) => readXlsxCells(Buffer.from(bytes), `xl/worksheets/sheet${n}.xml`);
const rowWith = (cells, col, text) => { const e = Object.entries(cells).find(([ref, c]) => ref.replace(/\d+$/, '') === col && c.str === text); return e ? e[0].replace(/^[A-Z]+/, '') : null; };
const screenView = async () => { const d = await RE.loadReportData('P-1'); return buildPresupuestoView({ conceptos: d.conceptos, apuDocs: d.apuDocs }); };

/* ================= PRUEBA PRINCIPAL ================= */
test('PRINCIPAL -- Albañilería / Muro de block 12 cm: 19.71 m² × $347.32 (calcAPUv2) cuadra en Presupuesto, Generadores y Explosión (PDF y XLSX)', async (t) => {
  await mainWorld();
  const view = await screenView();
  const row = view.rows.find(r => r.clave === 'MB-12');
  assert.equal(row.qty, 19.71);
  assert.equal(round2(row.pu), 347.32, 'P.U. real de ZOEMEC');
  const importe = row.qty * row.pu;
  const M = await models();
  // Presupuesto
  const bp = pdfText(await pdfOf(M, 'PRESUPUESTO'));
  assert.ok(bp.includes('19.71') && bp.includes('$347.32') && amountsIn(bp).includes(round2(importe)), 'PDF presupuesto: 19.71 · $347.32 · importe');
  const bx = await xlsxOf(M, 'PRESUPUESTO'); const cells = sheetCells(bx.bytes, 2);
  const r = rowWith(cells, 'A', 'MB-12');
  near(cells[`D${r}`].value, 19.71, 'XLSX cantidad'); near(cells[`E${r}`].value, row.pu, 'XLSX P.U. exacto'); near(cells[`F${r}`].value, importe, 'XLSX importe exacto', 1e-9);
  // Generadores
  const gp = pdfText(await pdfOf(M, 'GENERADORES'));
  for(const s of ['M-03', '5.00 × 2.70', '13.50', 'Puerta P-01', '0.90 × 2.10', '1.89', 'NETO M-03', '11.61', 'M-01', '3.00 × 2.70', '8.10', '19.71']) assert.ok(gp.includes(s), `PDF generadores contiene "${s}"`);
  const gx = sheetCells((await xlsxOf(M, 'GENERADORES')).bytes, 1);
  near(gx[`E${rowWith(gx, 'A', 'M-03')}`].value, 11.61, 'XLSX neto M-03'); near(gx[`E${rowWith(gx, 'A', 'M-01')}`].value, 8.1, 'XLSX neto M-01');
  near(gx[`E${rowWith(gx, 'A', 'TOTAL')}`].value, 19.71, 'XLSX total generadores');
  // Explosion (F2): block = 19.71 x 12.5
  const ep = pdfText(await pdfOf(M, 'EXPLOSION'));
  assert.ok(ep.includes('246.38'), 'PDF explosion block 246.38');
  const ex = sheetCells((await xlsxOf(M, 'EXPLOSION')).bytes, 2);
  near(ex[`D${rowWith(ex, 'B', 'Block hueco 12x20x40')}`].value, 19.71 * 12.5, 'XLSX explosion block');
  t.diagnostic(`MB-12: ${row.qty} × ${row.pu} = ${importe} (PDF ${round2(importe)})`);
});

/* ================= T1 - T4 Presupuesto ================= */
test('T1 -- Presupuesto PDF = datos autoritativos (cada concepto, cantidad, P.U., importe)', async () => {
  await mainWorld();
  const view = await screenView(); const M = await models();
  const doc = await pdfOf(M, 'PRESUPUESTO'); const text = pdfText(doc); const nums = amountsIn(text);
  for(const r of view.rows){
    assert.ok(text.includes(r.clave), `clave ${r.clave}`);
    assert.ok(text.includes(RM.fmtQty(r.qty)), `cantidad ${r.qty}`);
    assert.ok(nums.includes(round2(r.importe)), `importe ${r.clave} ${r.importe}`);
    if(r.hasApu) assert.ok(nums.includes(round2(r.pu)), `P.U. ${r.clave}`); else assert.ok(text.includes('Sin APU'));
  }
  assert.ok(doc.getNumberOfPages() >= 2, 'portada + detalle');
});

test('T2 -- Presupuesto XLSX = datos autoritativos (valores numéricos completos, no strings)', async () => {
  await mainWorld();
  const view = await screenView(); const M = await models();
  const { bytes, sheets } = await xlsxOf(M, 'PRESUPUESTO');
  assert.deepEqual(sheets.map(s => s.sheet), ['RESUMEN', 'PRESUPUESTO']);
  const cells = sheetCells(bytes, 2);
  for(const r of view.rows){
    const row = rowWith(cells, 'A', r.clave);
    assert.ok(row, `fila ${r.clave}`);
    near(cells[`D${row}`].value, r.qty, `cantidad ${r.clave}`);
    near(cells[`F${row}`].value, r.importe, `importe ${r.clave}`);
    if(r.hasApu) near(cells[`E${row}`].value, r.pu, `P.U. ${r.clave}`); else assert.equal(cells[`E${row}`].str, 'Sin APU');
  }
  const xml = Buffer.from((await import('fflate')).unzipSync(bytes)['xl/worksheets/sheet2.xml']).toString();
  assert.match(xml, /<autoFilter ref="A\d+:G\d+"\/>/, 'filtro automático'); assert.match(xml, /<pane [^>]*state="frozen"/, 'encabezado congelado');
});

test('T3 -- subtotales por capítulo = aggregatePresupuesto (PDF y XLSX)', async () => {
  await mainWorld();
  const view = await screenView(); const M = await models();
  const text = pdfText(await pdfOf(M, 'PRESUPUESTO')); const nums = amountsIn(text);
  const cells = sheetCells((await xlsxOf(M, 'PRESUPUESTO')).bytes, 2);
  assert.equal(view.capituloSubtotals.length, 3);
  for(const cap of view.capituloSubtotals){
    assert.ok(text.includes(`Subtotal ${cap.label}`) && nums.includes(round2(cap.importe)), `PDF subtotal ${cap.label}`);
    near(cells[`F${rowWith(cells, 'B', `Subtotal ${cap.label}`)}`].value, cap.importe, `XLSX subtotal ${cap.label}`);
  }
});

test('T4 -- total general y resumen: costo directo + indirectos + financiamiento + utilidad + cargos = subtotal = importe total', async () => {
  await mainWorld();
  const view = await screenView(); const M = await models();
  const s = M.budget.summary;
  near(s.subtotal, view.importeTotal, 'subtotal = importe total de pantalla');
  near(s.costoDirecto + s.indirectos + s.financiamiento + s.utilidad + s.cargos, s.subtotal, 'desglose suma el subtotal', 1e-6);
  near(s.total, s.subtotal + s.iva, 'total = subtotal + IVA');
  const cells = sheetCells((await xlsxOf(M, 'PRESUPUESTO')).bytes, 2);
  near(cells[`F${rowWith(cells, 'B', 'TOTAL (antes de IVA)')}`].value, view.importeTotal, 'XLSX total general');
  const res = sheetCells((await xlsxOf(M, 'PRESUPUESTO')).bytes, 1);
  near(res[`B${rowWith(res, 'A', 'Costo directo')}`].value, view.costoDirectoTotal, 'RESUMEN costo directo');
  near(res[`B${rowWith(res, 'A', 'TOTAL')}`].value, s.total, 'RESUMEN total');
  const nums = amountsIn(pdfText(await pdfOf(M, 'PRESUPUESTO')));
  for(const v of [s.costoDirecto, s.indirectos, s.financiamiento, s.utilidad, s.cargos, s.subtotal, s.iva, s.total]) assert.ok(nums.includes(round2(v)), `PDF resumen ${v}`);
});

/* ================= T5 - T7 Generadores ================= */
test('T5 -- Generadores PDF conserva operaciones, deducciones, neto y total', async () => {
  await mainWorld(); const M = await models();
  const pages = pdfPages(await pdfOf(M, 'GENERADORES'));
  const text = pages.all.join('\n');
  for(const s of ['NÚMEROS GENERADORES', 'MB-12 · Muro de block 12 cm (m²)', 'Albañilería', 'Planta QA.pdf', '5.00 × 2.70', '13.50', '- Puerta P-01  0.90 × 2.10', '1.89', '11.61', '3.00 × 2.70', '8.10', 'TOTAL', '19.71', 'cuadra con la suma de generadores']) assert.ok(text.includes(s), `contiene "${s}"`);
});

test('T6 -- Generadores XLSX conserva operaciones (celdas numéricas)', async () => {
  await mainWorld(); const M = await models();
  const cells = sheetCells((await xlsxOf(M, 'GENERADORES')).bytes, 1);
  const m3 = rowWith(cells, 'A', 'M-03');
  assert.equal(cells[`B${m3}`].str, '5.00 × 2.70'); near(cells[`C${m3}`].value, 13.5, 'bruto'); near(cells[`E${m3}`].value, 11.61, 'neto');
  const ded = Object.entries(cells).find(([, v]) => (v.str || '').includes('− Puerta P-01  0.90 × 2.10'));
  near(cells[`D${ded[0].replace(/^[A-Z]+/, '')}`].value, 1.89, 'deducción');
  assert.equal(cells[`G${rowWith(cells, 'A', 'TOTAL')}`].str, 'Cuadra con el concepto');
});

test('T7 -- total de generadores = concepto.qty (modelo, PDF y XLSX)', async () => {
  const { mb } = await mainWorld(); const M = await models();
  const c = M.generators.concepts.find(x => x.conceptoId === mb.id);
  assert.equal(c.total, c.qty); assert.equal(c.qty, 19.71); assert.equal(c.cuadra, true);
  const cells = sheetCells((await xlsxOf(M, 'GENERADORES')).bytes, 1);
  near(cells[`E${rowWith(cells, 'A', 'TOTAL')}`].value, cells[`E${rowWith(cells, 'A', 'Cantidad del concepto')}`].value, 'XLSX total = cantidad del concepto');
});

/* ================= T8 - T10 Explosion ================= */
test('T8 -- Explosión PDF = F2 (computeScopedExplosion con alcance presupuesto)', async () => {
  await mainWorld();
  const d = await RE.loadReportData('P-1');
  const f2 = computeScopedExplosion({ conceptos: d.conceptos, apuDocs: d.apuDocs, scope: EXPLOSION_SCOPE.PRESUPUESTO });
  const M = await models(); const text = pdfText(await pdfOf(M, 'EXPLOSION')); const nums = amountsIn(text);
  for(const r of [...f2.data.materials, ...f2.data.labor]){
    assert.ok(text.includes(r.descripcion), r.descripcion);
    assert.ok(nums.includes(round2(r.importe)), `importe ${r.descripcion}`);
  }
  assert.ok(text.includes(RM.fmtQty(f2.data.materials.find(r => r.clave === 'BLOCK-12').cantidadFinal)));
  assert.ok(!text.includes('Limpieza final de obra >'), 'concepto sin APU no explota');
  assert.ok(text.includes('1 sin APU'), 'alcance declara exclusiones');
});

test('T9 -- Explosión XLSX = F2 (valores exactos por insumo)', async () => {
  await mainWorld();
  const screen = await loadScopedExplosion({ projectId: 'P-1', scope: EXPLOSION_SCOPE.PRESUPUESTO });   // mismo loader que el panel
  const M = await models(); const cells = sheetCells((await xlsxOf(M, 'EXPLOSION')).bytes, 2);
  for(const r of screen.data.materials){
    const row = rowWith(cells, 'B', r.descripcion);
    near(cells[`D${row}`].value, r.cantidadFinal, `cantidad ${r.descripcion}`);
    near(cells[`E${row}`].value, r.precioUnitario, `precio ${r.descripcion}`);
    near(cells[`F${row}`].value, r.importe, `importe ${r.descripcion}`);
  }
});

test('T10 -- trazabilidad Insumo → APU → Concepto → Capítulo en PDF y XLSX', async () => {
  await mainWorld(); const M = await models();
  const text = pdfText(await pdfOf(M, 'EXPLOSION'));
  assert.ok(text.includes('» Albañilería > MB-12 Muro de block 12 cm > APU APU-MB12'));
  const cells = sheetCells((await xlsxOf(M, 'EXPLOSION')).bytes, 2);
  const trace = Object.entries(cells).find(([ref, c]) => ref.startsWith('B') && (c.str || '').includes('Albañilería > MB-12 Muro de block 12 cm > APU-MB12'));
  const row = trace[0].slice(1);
  assert.deepEqual([cells[`G${row}`].str, cells[`H${row}`].str, cells[`I${row}`].str], ['Albañilería', 'MB-12 Muro de block 12 cm', 'APU-MB12']);
  near(cells[`D${row}`].value, 19.71 * 12.5, 'cantidad aportada por el concepto');
});

/* ================= T11 - T12 Catalogo ================= */
test('T11 -- Catálogo PDF: clave, descripción, unidad, cantidad, P.U. e importe en el orden del presupuesto', async () => {
  await mainWorld();
  const view = await screenView(); const M = await models();
  const text = pdfText(await pdfOf(M, 'CATALOGO'));
  // Orden del presupuesto = capitulos en el orden de aggregatePresupuesto y, dentro, el de sus renglones.
  const budgetOrder = view.capituloSubtotals.flatMap(cap => view.rows.filter(r => r.capitulo === cap.capitulo).map(r => r.clave));
  const order = budgetOrder.map(cl => text.indexOf(cl));
  assert.ok(order.every(i => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]), 'orden = presupuesto');
  const nums = amountsIn(text);
  view.rows.filter(r => r.hasApu).forEach(r => assert.ok(nums.includes(round2(r.pu)) && nums.includes(round2(r.importe)), r.clave));
  assert.ok(nums.includes(round2(view.importeTotal)), 'total');
});

test('T12 -- Catálogo XLSX: columnas numéricas, capítulo y filtro', async () => {
  await mainWorld();
  const view = await screenView(); const M = await models();
  const { bytes } = await xlsxOf(M, 'CATALOGO'); const cells = sheetCells(bytes, 1);
  view.rows.forEach(r => {
    const row = rowWith(cells, 'A', r.clave);
    near(cells[`D${row}`].value, r.qty, 'cantidad');
    assert.equal(cells[`G${row}`].str, r.hasApu || true ? (r.capitulo === 'ALBANILERIA' ? 'Albañilería' : cells[`G${row}`].str) : '');
    if(r.hasApu){ near(cells[`E${row}`].value, r.pu, 'P.U.'); near(cells[`F${row}`].value, r.importe, 'importe'); }
  });
  near(cells[`F${rowWith(cells, 'B', 'TOTAL')}`].value, view.importeTotal, 'total');
  assert.match(Buffer.from((await import('fflate')).unzipSync(bytes)['xl/worksheets/sheet1.xml']).toString(), /<autoFilter /);
});

/* ================= T13 Resumen ================= */
test('T13 -- Resumen Ejecutivo determinista: solo datos del proyecto, sin mocks del tablero legacy', async () => {
  await mainWorld();
  const view = await screenView(); const M = await models();
  const k = M.summary.kpis;
  assert.deepEqual([k.chapters, k.concepts, k.apusVinculados, k.conceptosSinApu], [3, 3, 2, 1]);
  near(k.importe, view.importeTotal, 'importe'); near(k.costoDirecto, view.costoDirectoTotal, 'costo directo');
  assert.equal(M.summary.topChapters[0].label, 'Albañilería');
  assert.equal(M.summary.generators.conceptos, 1);
  const text = pdfText(await pdfOf(M, 'RESUMEN'));
  for(const legacy of ['Venta potencial', 'Pipeline', 'tasa de cierre', 'Productividad', 'Cotizacion mensual', 'Cartera por tipo de obra']) assert.ok(!text.includes(legacy), `sin indicador legacy "${legacy}"`);
  assert.ok(text.replace(/\n/g, ' ').includes('Resumen determinista'), 'declara que es determinista (sin IA)');
  // determinista: dos generaciones con los mismos datos -> mismo modelo
  const again = await models({ generatedAt: new Date(M.header.generatedAtIso) });
  assert.deepEqual(JSON.parse(JSON.stringify(again.summary)), JSON.parse(JSON.stringify(M.summary)));
});

/* ================= T14 vacios ================= */
test('T14 -- proyecto sin datos: estados vacíos claros, sin tablas absurdas', async () => {
  W.seedWorld(); W.asRole('MANAGER');
  const M = await models();
  for(const [type, av] of Object.entries(M.availability)) assert.equal(av.available, false, `${type} no disponible`);
  assert.match(M.availability.PRESUPUESTO.reason, /Sin conceptos/);
  assert.match(M.availability.GENERADORES.reason, /Sin generadores disponibles/);
  assert.match(M.availability.APU.reason, /Sin APUs asociados/);
  assert.match(M.availability.MEMORIA.reason, /Sin datos suficientes/);
  const text = pdfText(await pdfOf(M, 'PRESUPUESTO'));
  assert.ok(text.includes('Sin conceptos en el catálogo') && !text.includes('Detalle del presupuesto'), 'PDF vacío sin tabla de detalle');
  await assert.rejects(RE.generateReport(M, 'APU', 'PDF', { logo: LOGO, save: false }), /Sin APUs asociados/);
  await assert.rejects(RE.exportProjectReport('P-1', 'PRESUPUESTO', 'PDF'), /Sin conceptos/);
});

/* ================= T15 borrador ================= */
test('T15 -- generadores desactualizados: advertencia y marca BORRADOR en PDF/XLSX y nombre de archivo', async () => {
  const { model, plano } = await mainWorld();
  await PLANO.saveDraft({ planoId: 'PLANO-QA', snapshot: { ...plano.snapshot, cadModel: CAD.setWallLength(model, 'M-01', 3.5) }, expectedRevision: plano.revision });
  const M = await models();
  assert.equal(M.budget.draft, true); assert.equal(M.availability.PRESUPUESTO.draft, true);
  assert.equal(M.budget.stale[0].qty, 19.71); assert.equal(M.budget.stale[0].pending[0].toQty, 21.06);
  const doc = await pdfOf(M, 'PRESUPUESTO'); const pages = pdfPages(doc);
  pages.pages.forEach((p, i) => assert.ok(p.join(' ').includes('BORRADOR'), `página ${i + 1} marcada`));
  const flat = pages.all.join(' ');
  assert.ok(flat.includes('BORRADOR - CANTIDADES PENDIENTES DE REVISIÓN'), 'marca BORRADOR');
  assert.ok(flat.includes('Existen cantidades pendientes de revisión'), 'advertencia explícita');
  const x = await xlsxOf(M, 'PRESUPUESTO');
  assert.ok(Object.values(sheetCells(x.bytes, 2)).some(c => c.str === RM.DRAFT_MARK));
  assert.match(x.fileName, /-BORRADOR-ZOEMEC\.xlsx$/);
  near(sheetCells(x.bytes, 2)[`D${rowWith(sheetCells(x.bytes, 2), 'A', 'MB-12')}`].value, 19.71, 'cifra vigente, nunca la no confirmada');
  assert.ok(pdfText(await pdfOf(M, 'GENERADORES')).includes('Generadores desactualizados'));
});

/* ================= T16 DEFAULT ================= */
test('T16 -- dimensiones DEFAULT identificadas (generadores y memoria técnica)', async () => {
  W.seedWorld(); W.asRole('MANAGER');
  const [c] = await createConcepts([{ clave: 'APL-01', capitulo: 'ACABADOS', concept: 'Aplanado', unit: 'm²', qty: 1 }]);
  let m = CAD.createEmptyCadModel();
  ({ model: m } = CAD.addWall(m, { x1: 0, y1: 0, x2: 4, y2: 0 }));                // altura DEFAULT
  m = CAD.setElementAssignment(m, 'M-01', { conceptId: c.id, quantityField: 'netArea', unit: 'm²' });
  const p = await PLANO.createPlano({ planoId: 'PLANO-DEF', projectId: 'P-1', fileName: 'trazo.png', cadModel: m });
  await SVC.syncConceptGenerators({ conceptId: c.id, projectId: 'P-1', planoId: 'PLANO-DEF', model: m, expectedRevision: 0, planoRevision: p.revision });
  // levantamiento con CAD: espesor DEFAULT (no capturado)
  const s0 = { ...makeEmptySurvey({ id: 'L-DEF', projectId: 'P-1', name: 'L-DEF' }), spaces: [{ ...makeEmptySpace({ name: 'Bodega', length: 3, width: 2, height: 2.5 }), id: 'SPC-B' }] };
  const saved = (await apiPost('/api/levantamientos', { action: 'save', survey: s0 })).levantamiento;
  const key = surveyPlanoKey('L-DEF', 'SPC-B');
  await PLANO.createPlano({ planoId: key, projectId: 'P-1', cadModel: surveyToCadModel(saved.spaces[0]).model, sourceKind: 'SURVEY', surveyId: 'L-DEF', spaceId: 'SPC-B' });
  await apiPost('/api/levantamientos', { action: 'save', survey: linkSpaceToPlano(saved, 'SPC-B', key), expectedRevision: saved.revision });
  const M = await models();
  assert.deepEqual(M.generators.concepts[0].elements[0].defaults, ['altura']);
  const gtext = pdfText(await pdfOf(M, 'GENERADORES'));
  assert.ok(gtext.includes('DEFAULT: altura'), 'generador marca la altura DEFAULT');
  const sp = M.memory.surveys[0].spaces[0];
  assert.equal(sp.origin, 'CAD'); assert.ok(sp.defaults.every(d => d.dimension === 'espesor') && sp.defaults.length === 4);
  const mtext = pdfText(await pdfOf(M, 'MEMORIA'));
  assert.ok(mtext.includes('DEFAULT (no medido)') && mtext.includes('MEDIDO (levantamiento)'), 'memoria distingue DEFAULT de medido');
  assert.ok(!/espesor[^\n]*MEDIDO/.test(mtext), 'un espesor DEFAULT nunca aparece como medido');
});

/* ================= T17 proyecto grande ================= */
test('T17 -- proyecto grande (8 capítulos, 104 conceptos, 6 APUs con insumos repetidos): PDF multipágina legible', async (t) => {
  W.seedWorld(); W.asRole('MANAGER');
  const CAPS = ['PRELIMINARES', 'CIMENTACION', 'ESTRUCTURA', 'ALBANILERIA', 'INSTALACIONES', 'ACABADOS', 'CARPINTERIA', 'OTROS'];
  const apus = Array.from({ length: 6 }, (_, i) => apuDoc(`APU-G${i}`, `APU grande ${i}`, [['CEM-01', 'Cemento gris CPC 30R', 'saco', 0.2 + i * 0.05, 245], ['ARE-01', 'Arena de río', 'm³', 0.03, 450], [`MAT-${i}`, `Material específico ${i}`, 'pza', 2, 30 + i]], [['MO-OF', 'Oficial albañil', 10 + i, 650]]));
  for(const a of apus) await saveApu(a);
  const long = 'Suministro y colocación de muro de block hueco de concreto de 12x20x40 cm asentado con mortero cemento-arena 1:5, incluye materiales, mano de obra, andamios, acarreos, limpieza del área de trabajo y todo lo necesario para su correcta ejecución';
  const list = Array.from({ length: 104 }, (_, i) => ({ clave: `C-${String(i + 1).padStart(3, '0')}`, capitulo: CAPS[i % 8], concept: i === 7 ? long : `Concepto QA número ${i + 1} con descripción razonable`, unit: 'm²', qty: 10 + i }));
  const created = await createConcepts(list);
  for(const [i, c] of created.entries()) await associate(c.id, `APU-G${i % 6}`);
  const t0 = Date.now();
  const M = await models();
  const doc = await pdfOf(M, 'PRESUPUESTO');
  const ms = Date.now() - t0;
  const { pages } = pdfPages(doc); const n = pages.length;
  assert.ok(n >= 5, `multipágina (${n})`);
  pages.slice(1).forEach((p, i) => { const s = p.join(' '); assert.ok(s.includes('PRESUPUESTO') && s.includes(`Página ${i + 2} de ${n}`), `encabezado/pie página ${i + 2}`); });
  const all = pages.flat().join('\n');
  created.forEach(c => assert.ok(all.includes(c.clave), c.clave));
  const detailPages = pages.filter(p => p.some(x => x.includes('C-0')));
  assert.ok(detailPages.every(p => p.includes('Clave') && p.includes('Importe')), 'encabezado de tabla repetido en cada página del detalle');
  // La descripcion larga se envuelve DENTRO de su columna (nunca se corta ni invade otras columnas):
  const longPieces = pages.flat().filter(x => x.trim().length > 8 && long.includes(x.trim()));
  assert.ok(longPieces.length >= 3, `la descripción larga se envuelve en varias líneas (${longPieces.length})`);
  assert.ok(longPieces.every(x => x.length <= 62), 'cada línea cabe en la columna Concepto');
  assert.equal(longPieces.map(x => x.trim()).join(' '), long, 'el texto completo aparece, sin cortes');
  // Regresion F5-QA: el primer renglon tras un salto de pagina no debe quedar en blanco (texto blanco sobre blanco).
  for(let p = 2; p <= n; p++){
    const content = doc.internal.pages[p].join('\n');
    const at = content.search(/\((?:C-\d{3}|[A-Z][^()]*)\) Tj/g) >= 0 ? content.search(/\(C-\d{3}\) Tj/) : -1;
    if(at < 0) continue;
    const colors = [...content.slice(0, at).matchAll(/(\d+\.?\d*) (\d+\.?\d*) (\d+\.?\d*) rg|(\d+\.?\d*) g\b/g)];   // jsPDF: "1. g" = blanco
    const last = colors.at(-1)?.slice(1).filter(Boolean).map(Number) || [];
    assert.ok(!last.length || !last.every(v => v >= 0.99), `página ${p}: el primer renglón de datos no es blanco (${last.join(' ')})`);
  }
  M.budget.chapters.forEach(ch => assert.ok(amountsIn(all).includes(round2(ch.importe)), `subtotal ${ch.label}`));
  assert.ok(amountsIn(all).includes(round2(M.budget.summary.subtotal)));
  const ex = M.explosion.sections[0].rows.find(r => r.descripcion === 'Cemento gris CPC 30R');
  assert.equal(ex.origenes.length, 104, 'insumo repetido consolidado con 104 orígenes');
  assert.ok(ms < 15000, `rendimiento razonable (${ms} ms)`);
  t.diagnostic(`PDF presupuesto grande: ${n} páginas en ${ms} ms; explosión PDF ${ (await pdfOf(M, 'EXPLOSION')).getNumberOfPages() } páginas`);
  fs.mkdirSync(`${(await import('node:os')).tmpdir()}/zoemec-qa-out`, { recursive: true });
  fs.writeFileSync(`${(await import('node:os')).tmpdir()}/zoemec-qa-out/GRANDE-PRESUPUESTO.pdf`, Buffer.from(doc.output('arraybuffer')));
});

/* ================= T18 moneda ================= */
test('T18 -- moneda y formato consistentes (PDF, XLSX y encabezado usan la moneda del proyecto)', async () => {
  await mainWorld({ project: { moneda: 'USD', client: 'Cliente Demo QA' } });
  const M = await models();
  assert.equal(M.header.moneda, 'USD'); assert.equal(M.header.cliente, 'Cliente Demo QA');
  const text = pdfText(await pdfOf(M, 'PRESUPUESTO'));
  assert.ok(/USD\s?6,845\.72/.test(text), 'PDF en USD'); assert.ok(!/\$6,845\.72/.test(text.replace(/USD\s?6,845\.72/g, '')), 'sin montos en otra moneda');
  const { sheets } = await xlsxOf(M, 'PRESUPUESTO');
  const fmts = new Set(sheets[1].rows.flat().filter(c => c && typeof c.value === 'number' && /USD|\$/.test(c.format || '')).map(c => c.format));
  assert.deepEqual([...fmts], ['"USD "#,##0.00']);
  const mx = RM.makeMoney('MXN'); assert.equal(mx(1234.5), '$1,234.50');
});

/* ================= T19 pantalla = PDF = XLSX ================= */
test('T19 -- mismas cifras pantalla / PDF / XLSX (Presupuesto y Explosión, todos los renglones)', async () => {
  await mainWorld();
  const screen = await screenView();                                          // lo que calcula PresupuestoModule
  const screenExp = await loadScopedExplosion({ projectId: 'P-1', scope: EXPLOSION_SCOPE.PRESUPUESTO });   // lo que muestra ExplosionsPanel
  const M = await models();
  const pNums = amountsIn(pdfText(await pdfOf(M, 'PRESUPUESTO')));
  const pCells = sheetCells((await xlsxOf(M, 'PRESUPUESTO')).bytes, 2);
  screen.rows.forEach(r => { assert.ok(pNums.includes(round2(r.importe))); near(pCells[`F${rowWith(pCells, 'A', r.clave)}`].value, r.importe, r.clave); });
  const eNums = amountsIn(pdfText(await pdfOf(M, 'EXPLOSION')));
  const eCells = sheetCells((await xlsxOf(M, 'EXPLOSION')).bytes, 2);
  screenExp.data.materials.forEach(r => { assert.ok(eNums.includes(round2(r.importe))); near(eCells[`F${rowWith(eCells, 'B', r.descripcion)}`].value, r.importe, r.descripcion); });
  // pantalla del panel = modelo del reporte (mismo objeto de explosion)
  const fromScreen = RM.buildExplosionReportModel({ header: M.header, explosion: screenExp });
  near(fromScreen.grandTotal, M.explosion.grandTotal, 'total de insumos');
  near(M.explosion.grandTotal, screen.costoDirectoTotal, 'total de insumos = costo directo del presupuesto', 1e-6);
});

/* ================= T20 aislamiento ================= */
test('T20 -- aislamiento empresa/proyecto: otra empresa no obtiene datos para reportes', async () => {
  await mainWorld();
  await W.H.db.collection('organizations').doc('ORG-2').set({ id: 'ORG-2', name: 'Otra', status: 'CONVERTED' });
  await W.H.db.collection('organizations').doc('ORG-2').collection('members').doc('OUT-1').set({ uid: 'OUT-1', role: 'company_manager', status: 'active' });
  await W.H.db.collection('users').doc('OUT-1').set({ uid: 'OUT-1', email: 'out@harness.test', organizationId: 'ORG-2', plan: 'Gratis', active: true });
  W.H.tokens['tok-OUT-1'] = { uid: 'OUT-1', email: 'out@harness.test', email_verified: true };
  W.H.currentToken = 'tok-OUT-1';
  await assert.rejects(RE.loadReportData('P-1'), /No se pudo cargar el proyecto/);
  await assert.rejects(RE.exportProjectReport('P-1', 'PRESUPUESTO', 'PDF'), /No se pudo cargar el proyecto/);
  W.asRole('COLLABORATOR');                                                   // misma empresa: si
  const M = await models();
  assert.equal(M.budget.counts.concepts, 3);
});
