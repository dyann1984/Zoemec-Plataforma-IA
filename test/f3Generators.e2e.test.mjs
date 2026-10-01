/* F3 -- NUMEROS GENERADORES persistentes (T1-T15).
   CAD real (cadModel.js) -> generadores (quantityGenerators.js, sin IA) ->
   /api/catalogo-conceptos set-generators (ruta REAL via gateway, Firestore en
   memoria) -> concepto.qty -> F2 (buildBudgetScope / computeScopedExplosion).
   Infraestructura sustituida: solo Firebase (ver test/helpers/roleParityHarness). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register('./helpers/roleParityHarness/hooks.mjs', import.meta.url);
const W = await import('./helpers/roleParityHarness/world.mjs');
const CAD = await import('../src/domain/cadModel.js');
const G = await import('../src/domain/quantityGenerators.js');
const SVC = await import('../src/features/planos/cad/cadConceptService.js');
const { buildBudgetScope } = await import('../src/domain/budgetScope.js');
const { computeScopedExplosion, EXPLOSION_SCOPE } = await import('../src/domain/explosionData.js');
const { aggregatePresupuesto } = await import('../src/domain/presupuestoAggregation.js');
const { makeEmptyAPUv2, APU_DATA_STATE } = await import('../src/domain/apuSchema.js');
const { calcAPUv2 } = await import('../src/lib/apuCalc.js');
const { exportGeneratorsExcel, exportGeneratorsPdf, buildGeneratorReport } = await import('../src/lib/generatorsExport.js');
const { default: writeXlsxFileNode } = await import('write-excel-file/node');
const { readXlsxCells } = await import('./helpers/xlsxRead.mjs');
const { apiPost, apiGetSafe } = await import('../src/services/apiClient.js');

const PLANO = 'PLANO-F3';
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);

/* ---------- fixtures CAD ---------- */
function wall(model, x1, y1, x2, y2, height, thickness = 0.12){
  return CAD.addWall(model, { x1, y1, x2, y2, height, thickness });
}
function assign(model, id, conceptId, quantityField = 'netArea', unit = 'm²'){
  return CAD.setElementAssignment(model, id, { conceptId, quantityField, unit });
}
/* Caso principal: M-01 4.50 x 2.70 con puerta 0.90 x 2.10; M-02 3.00 x 2.70. */
function mainModel(conceptId){
  let m = CAD.createEmptyCadModel();
  ({ model: m } = wall(m, 0, 0, 4.5, 0, 2.7));
  ({ model: m } = wall(m, 4.5, 0, 4.5, 3, 2.7));
  ({ model: m } = CAD.addOpening(m, { type: 'door', wallId: 'M-01', width: 0.9, height: 2.1, offset: 1 }));
  m = assign(m, 'M-01', conceptId);
  m = assign(m, 'M-02', conceptId);
  return m;
}

/* ---------- T1-T3: operaciones de muro ---------- */

test('T1 -- muro sin vanos: L x H = bruto = neto, operacion conservada', () => {
  let m = CAD.createEmptyCadModel();
  ({ model: m } = wall(m, 0, 0, 3, 0, 2.7));
  const g = G.buildGenerator(m, 'M-01', 'netArea', { planoId: PLANO });
  assert.equal(g.status, 'COMPLETO');
  assert.deepEqual(g.dimensions, { length: 3, height: 2.7 });
  assert.equal(g.operation.expression, '3.00 × 2.70');
  assert.equal(g.grossQuantity, 8.1); assert.equal(g.deductions.length, 0); assert.equal(g.netQuantity, 8.1);
  assert.equal(g.elementCode, 'M-01'); assert.equal(g.unit, 'm²'); assert.equal(g.operationType, 'AREA_MURO');
  assert.deepEqual(G.verifyGenerator(g), []);
});

test('T2 -- muro con puerta: 4.50 x 2.70 = 12.15 - P-01 0.90 x 2.10 = 1.89 -> 10.26', () => {
  const g = G.buildGenerator(mainModel('C'), 'M-01', 'netArea', { planoId: PLANO });
  assert.equal(g.grossQuantity, 12.15);
  assert.equal(g.deductions.length, 1);
  assert.equal(g.deductions[0].elementId, 'P-01');
  assert.equal(g.deductions[0].operation.expression, '0.90 × 2.10');
  assert.equal(g.deductions[0].quantity, 1.89);
  assert.equal(g.netQuantity, 10.26);
  assert.deepEqual(G.describeGenerator(g), ['M-01  4.50 × 2.70 = 12.15 m²', '      − Puerta P-01  0.90 × 2.10 = 1.89 m²', '      = 10.26 m² NETOS']);
});

test('T3 -- muro con puerta + ventana: 12.15 - 1.89 - 1.20 = 9.06', () => {
  let m = mainModel('C');
  ({ model: m } = CAD.addOpening(m, { type: 'window', wallId: 'M-01', width: 1.2, height: 1.0, sill: 0.9, offset: 2.5 }));
  const g = G.buildGenerator(m, 'M-01', 'netArea', { planoId: PLANO });
  assert.deepEqual(g.deductions.map(d => [d.elementId, d.quantity]), [['P-01', 1.89], ['V-01', 1.2]]);
  assert.equal(g.deductionsTotal, 3.09);
  assert.equal(g.netQuantity, 9.06);
});

/* ---------- T4 / T5: varios elementos, SUM = qty ---------- */

test('T4 -- varios elementos del mismo concepto: 10.26 + 8.40 + 12.15 + 9.75 = 40.56 con elementIds', () => {
  let m = mainModel('C-4');                                   // M-01 10.26 (con puerta), M-02 8.10
  m = CAD.updateWall(m, 'M-02', { height: 2.8 });              // M-02 3.00 x 2.80 = 8.40
  ({ model: m } = wall(m, 4.5, 3, 0, 3, 2.7));                 // M-03 4.50 x 2.70 = 12.15
  ({ model: m } = wall(m, 0, 3, 0, 0.0, 3.25));                // M-04 3.00 x 3.25 = 9.75
  m = assign(m, 'M-03', 'C-4'); m = assign(m, 'M-04', 'C-4');
  const gens = G.buildConceptGenerators(m, 'C-4', { planoId: PLANO });
  assert.deepEqual(gens.map(g => [g.elementId, g.netQuantity]), [['M-01', 10.26], ['M-02', 8.4], ['M-03', 12.15], ['M-04', 9.75]]);
  const agg = G.aggregateGenerators(gens, 'm²');
  assert.equal(agg.qty, 40.56);
  assert.deepEqual(agg.elementIds, ['M-01', 'M-02', 'M-03', 'M-04']);
});

/* ---------- Mundo servidor ---------- */
async function serverWorld(){
  W.seedWorld();
  W.asRole('MANAGER');
  const created = await apiPost('/api/catalogo-conceptos', { action: 'create', projectId: 'P-1', conceptos: [{ clave: 'MB-12', capitulo: 'ALBANILERIA', concept: 'Muro de block 12 cm', unit: 'm²', qty: 10.26 }] });
  return created.conceptos[0];
}
const getConcept = async id => (await apiGetSafe('/api/catalogo-conceptos?projectId=P-1')).conceptos.find(c => c.id === id);

async function createAndAssociateApu(conceptoId){
  const a = makeEmptyAPUv2();
  const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'QA', fecha: '2026-09-01' };
  Object.assign(a, { id: 'APU-MB12', clave: 'APU-MB12', concept: 'Muro de block 12 cm', unit: 'm²', cantidadObra: 10.26 });
  a.materials = [{ clave: 'BLOCK-12', descripcion: 'Block hueco 12x20x40', unidad: 'pza', consumo: 12.5, desperdicioPct: 0, precioUnitario: 15, fuente }];
  a.labor = [{ clave: 'MO-OF', descripcion: 'Oficial albañil', unidad: 'jor', cuadrilla: 1, rendimiento: 12.5, jornada: 8, salarioBase: 650, fsr: 1.5, fuente }];
  await apiPost('/api/apus', { action: 'create', id: 'APU-MB12', projectId: 'P-1', apu: a });
  await apiPost('/api/catalogo-conceptos', { action: 'associate-apu', id: conceptoId, apuId: 'APU-MB12' });
}
async function f2(conceptoId){
  const conceptos = (await apiGetSafe('/api/catalogo-conceptos?projectId=P-1')).conceptos;
  const apuDocs = (await apiGetSafe('/api/apus?projectId=P-1')).apus;
  const scope = buildBudgetScope({ conceptos, apuDocs });
  const budget = aggregatePresupuesto(scope.rows);
  const exp = computeScopedExplosion({ conceptos, apuDocs, scope: EXPLOSION_SCOPE.PRESUPUESTO });
  const row = budget.rows.find(r => r.conceptoId === conceptoId);
  const block = exp.data.materials.find(r => r.descripcion === 'Block hueco 12x20x40');
  return { row, block, pu: calcAPUv2(apuDocs.find(d => d.id === 'APU-MB12').snapshot).pu };
}

test('T5/T7/T8 + PRUEBA PRINCIPAL -- 18.36 m2 -> (M-01 4.50 -> 5.00) -> 19.71 m2, cadena GENERADORES -> qty -> Presupuesto -> Explosion', async () => {
  const c = await serverWorld();
  let model = mainModel(c.id);
  const r1 = await SVC.syncConceptGenerators({ conceptId: c.id, projectId: 'P-1', planoId: PLANO, fileName: 'planta.pdf', model, expectedRevision: 0 });
  assert.equal(r1.concepto.qty, 18.36, 'T5: concepto.qty = SUM(generadores)');
  assert.equal(r1.concepto.quantitySource, 'GENERATORS');
  assert.deepEqual(r1.concepto.elementIds, ['M-01', 'M-02']);
  assert.equal(r1.concepto.generadores.reduce((s, g) => s + g.netQuantity, 0), 18.36);
  await createAndAssociateApu(c.id);

  const before = await f2(c.id);
  close(before.row.qty, 18.36, 'presupuesto qty');
  close(before.row.importe, 18.36 * before.pu, 'presupuesto 18.36 x P.U.');
  close(before.block.cantidadFinal, 18.36 * 12.5, 'explosion 18.36 x 12.5');

  // Cambio geometrico: M-01 4.50 -> 5.00 m
  model = CAD.updateWall(model, 'M-01', { length: 5 });
  const stored = (await getConcept(c.id)).generadores;
  const fresh = G.buildConceptGenerators(model, c.id, { planoId: PLANO });
  const diff = G.diffGenerators(stored, fresh);
  assert.equal(diff.stale, true, 'T6: generador desactualizado');
  assert.deepEqual(diff.changes, [{ generatorId: `${PLANO}::M-01::netArea`, elementId: 'M-01', change: 'MODIFICADO', from: 10.26, to: 11.61 }]);
  // El cambio NO toca la cantidad economica hasta recalcular (controlado)
  assert.equal((await getConcept(c.id)).qty, 18.36);

  const concepts = (await apiGetSafe('/api/catalogo-conceptos?projectId=P-1')).conceptos;
  const preview = SVC.previewPlanoGenerators({ concepts, planoId: PLANO, projectId: 'P-1', model });
  assert.equal(preview[0].fromQty, 18.36); assert.equal(preview[0].toQty, 19.71);
  await SVC.recalculatePlanoGenerators({ projectId: 'P-1', planoId: PLANO, model, preview });

  const after = await getConcept(c.id);
  assert.equal(after.qty, 19.71, 'T7: recalcular actualiza concepto.qty');
  const m01 = after.generadores.find(g => g.elementId === 'M-01');
  assert.equal(m01.operation.expression, '5.00 × 2.70'); assert.equal(m01.grossQuantity, 13.5); assert.equal(m01.netQuantity, 11.61);
  const h = after.quantityHistory.at(-1);
  assert.deepEqual({ from: h.from, to: h.to, source: h.source, planoId: h.planoId, revision: h.revision }, { from: 18.36, to: 19.71, source: 'GENERATORS', planoId: PLANO, revision: 2 });
  assert.deepEqual(h.changes.map(x => [x.elementId, x.from, x.to]), [['M-01', 10.26, 11.61]]);
  assert.ok(h.at && h.actor, 'fecha y actor registrados');
  const audit = W.H.db._dump('catalogConceptosAudit/').filter(a => a.action === 'CATALOGO_CONCEPTO_GENERATORS_UPDATED');
  assert.deepEqual(audit.map(a => [a.previousStatus, a.newStatus]), [['10.26', '18.36'], ['18.36', '19.71']]);

  const later = await f2(c.id);
  close(later.row.importe, 19.71 * later.pu, 'T8: presupuesto 19.71 x P.U.');
  close(later.block.cantidadFinal, 19.71 * 12.5, 'T8: explosion 19.71 x 12.5');
  assert.equal(later.row.pu, before.pu, 'el APU no se regenero; P.U. igual');
});

test('Concurrencia -- revision del plano desactualizada -> 409 GENERATOR_CONFLICT, nada se escribe', async () => {
  const c = await serverWorld();
  const model = mainModel(c.id);
  await SVC.syncConceptGenerators({ conceptId: c.id, projectId: 'P-1', planoId: PLANO, model, expectedRevision: 0 });
  await assert.rejects(SVC.syncConceptGenerators({ conceptId: c.id, projectId: 'P-1', planoId: PLANO, model: CAD.updateWall(model, 'M-01', { length: 6 }), expectedRevision: 0 }),
    err => { assert.equal(err.status, 409); assert.equal(err.code, 'GENERATOR_CONFLICT'); assert.equal(err.currentRevision, 1); return true; });
  assert.equal((await getConcept(c.id)).qty, 18.36);
});

test('T9 -- concepto manual sigue funcionando sin generadores; uno con generadores no admite qty a mano (409)', async () => {
  const c = await serverWorld();
  const upd = await apiPost('/api/catalogo-conceptos', { action: 'update', id: c.id, patch: { qty: 12.5 } });
  assert.equal(upd.concepto.qty, 12.5); assert.equal(upd.concepto.quantitySource, 'MANUAL');
  assert.deepEqual(upd.concepto.generadores, []);
  await SVC.syncConceptGenerators({ conceptId: c.id, projectId: 'P-1', planoId: PLANO, model: mainModel(c.id), expectedRevision: 0 });
  await assert.rejects(apiPost('/api/catalogo-conceptos', { action: 'update', id: c.id, patch: { qty: 99 } }), err => err.status === 409 && err.code === 'QUANTITY_FROM_GENERATORS');
  const ok = await apiPost('/api/catalogo-conceptos', { action: 'update', id: c.id, patch: { concept: 'Muro de block 12 cm (renombrado)' } });
  assert.equal(ok.concepto.qty, 18.36, 'editar otros campos no altera la cantidad');
});

/* ---------- T10: incompletos ---------- */

test('T10 -- generador INCOMPLETO cuando falta una dimension requerida (no se inventa)', () => {
  let m = CAD.createEmptyCadModel();
  ({ model: m } = CAD.addWall(m, { x1: 0, y1: 0, x2: 4, y2: 0, height: 2.7 }));        // espesor DEFAULT
  const vol = G.buildGenerator(m, 'M-01', 'netVolume', { planoId: PLANO });
  assert.equal(vol.status, 'INCOMPLETO'); assert.equal(vol.netQuantity, null);
  assert.match(vol.issues[0].missing[0], /espesor/);
  ({ model: m } = CAD.addSpace(m, { points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3.5 }, { x: 0, y: 3.5 }], name: 'RECÁMARA' }));
  const area = G.buildGenerator(m, 'ESP-01', 'area', { planoId: PLANO });
  assert.equal(area.operation.expression, '4.00 × 3.50'); assert.equal(area.netQuantity, 14);
  const sVol = G.buildGenerator(m, 'ESP-01', 'volume', { planoId: PLANO });
  assert.equal(sVol.status, 'INCOMPLETO'); assert.match(sVol.issues[0].message, /altura de plafón/);
  const pending = CAD.setScale(m, { status: 'PENDIENTE' });
  assert.equal(G.buildGenerator(pending, 'M-01', 'netArea', { planoId: PLANO }).status, 'INCOMPLETO', 'escala sin confirmar');
  const agg = G.aggregateGenerators([area, sVol].map(g => ({ ...g, unit: 'm²' })), 'm²');
  assert.equal(agg.qty, 14, 'un INCOMPLETO no suma'); assert.deepEqual(agg.incomplete, ['ESP-01']);
  // espesor medido del dibujo SI permite volumen
  const m2 = CAD.updateWall(m, 'M-01', { thickness: 0.12 });
  const v2 = G.buildGenerator(m2, 'M-01', 'netVolume', { planoId: PLANO });
  assert.equal(v2.status, 'COMPLETO'); assert.equal(v2.netQuantity, G.rq(10.8 * 0.12)); assert.deepEqual(G.verifyGenerator(v2), []);
});

/* ---------- T11 / T12: persistencia y aislamiento ---------- */

test('T11 -- los generadores sobreviven serializacion y persistencia (otra sesion los lee identicos)', async () => {
  const c = await serverWorld();
  const { generators } = await SVC.syncConceptGenerators({ conceptId: c.id, projectId: 'P-1', planoId: PLANO, model: mainModel(c.id), expectedRevision: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(generators)), generators, 'JSON puro');
  W.asRole('COLLABORATOR');                                   // otro usuario / otro dispositivo de la empresa
  const read = await getConcept(c.id);
  const strip = g => ({ ...g, createdAt: undefined, updatedAt: undefined, conceptId: undefined, projectId: undefined });
  assert.deepEqual(read.generadores.map(strip), generators.map(strip));
  assert.equal(read.qty, 18.36);
  assert.equal(W.H.db._get(`catalogConceptos/${c.id}`).generadores.length, 2, 'guardado en el documento del servidor');
});

test('T12 -- aislamiento por empresa/proyecto: otra organizacion no lee ni escribe; generadores alterados se rechazan', async () => {
  const c = await serverWorld();
  await W.H.db.collection('organizations').doc('ORG-2').set({ id: 'ORG-2', name: 'Otra', status: 'CONVERTED' });
  await W.H.db.collection('organizations').doc('ORG-2').collection('members').doc('OUT-1').set({ uid: 'OUT-1', role: 'company_manager', status: 'active' });
  await W.H.db.collection('users').doc('OUT-1').set({ uid: 'OUT-1', email: 'out@harness.test', organizationId: 'ORG-2', plan: 'Gratis', active: true });
  W.H.tokens['tok-OUT-1'] = { uid: 'OUT-1', email: 'out@harness.test', email_verified: true };
  W.H.currentToken = 'tok-OUT-1';
  await assert.rejects(SVC.syncConceptGenerators({ conceptId: c.id, projectId: 'P-1', planoId: PLANO, model: mainModel(c.id) }), err => err.status === 403);
  assert.equal(await apiGetSafe('/api/catalogo-conceptos?projectId=P-1'), null, 'no puede listar el proyecto ajeno');
  W.asRole('MANAGER');
  const gens = G.buildConceptGenerators(mainModel(c.id), c.id, { planoId: PLANO });
  gens[0] = { ...gens[0], netQuantity: 99 };                   // neto que no cuadra con su operacion
  await assert.rejects(apiPost('/api/catalogo-conceptos', { action: 'set-generators', id: c.id, planoId: PLANO, generators: gens }), err => err.status === 400 && /neto/.test(err.message));
  assert.equal((await getConcept(c.id)).quantitySource, 'MANUAL', 'nada se escribio');
});

/* ---------- T13 / T14 ---------- */

test('T13 -- elemento eliminado deja de contribuir tras la actualizacion controlada (incluso hasta 0)', async () => {
  const c = await serverWorld();
  let model = mainModel(c.id);
  await SVC.syncConceptGenerators({ conceptId: c.id, projectId: 'P-1', planoId: PLANO, model, expectedRevision: 0 });
  model = CAD.deleteElement(model, 'M-02');
  let concepts = (await apiGetSafe('/api/catalogo-conceptos?projectId=P-1')).conceptos;
  let preview = SVC.previewPlanoGenerators({ concepts, planoId: PLANO, projectId: 'P-1', model });
  assert.deepEqual(preview[0].diff.changes.map(x => [x.elementId, x.change]), [['M-02', 'ELIMINADO']]);
  await SVC.recalculatePlanoGenerators({ projectId: 'P-1', planoId: PLANO, model, preview });
  let after = await getConcept(c.id);
  assert.equal(after.qty, 10.26); assert.deepEqual(after.elementIds, ['M-01']);
  assert.equal(after.quantityHistory.at(-1).changes[0].change, 'ELIMINADO');
  model = CAD.deleteElement(model, 'M-01');
  concepts = (await apiGetSafe('/api/catalogo-conceptos?projectId=P-1')).conceptos;
  preview = SVC.previewPlanoGenerators({ concepts, planoId: PLANO, projectId: 'P-1', model });
  await SVC.recalculatePlanoGenerators({ projectId: 'P-1', planoId: PLANO, model, preview });
  after = await getConcept(c.id);
  assert.equal(after.qty, 0, 'sin elementos: 0, nunca la cantidad vieja');
  assert.equal(after.quantitySource, 'GENERATORS');
});

test('T14 -- deducciones superiores al bruto: nunca negativo, INCONSISTENTE reportado', () => {
  let m = CAD.createEmptyCadModel();
  ({ model: m } = wall(m, 0, 0, 1.0, 0, 2.7));                 // bruto 2.70
  ({ model: m } = CAD.addOpening(m, { type: 'door', wallId: 'M-01', width: 0.9, height: 2.1, offset: 0 }));
  ({ model: m } = CAD.addOpening(m, { type: 'door', wallId: 'M-01', width: 0.9, height: 2.1, offset: 0.1 }));
  const g = G.buildGenerator(m, 'M-01', 'netArea', { planoId: PLANO });
  assert.equal(g.grossQuantity, 2.7); assert.equal(g.deductionsTotal, 3.78);
  assert.equal(g.netQuantity, 0); assert.equal(g.status, 'INCONSISTENTE');
  assert.equal(g.issues[0].code, 'DEDUCCIONES_EXCEDEN_BRUTO');
  assert.deepEqual(G.verifyGenerator(g), []);
  const agg = G.aggregateGenerators([g], 'm²');
  assert.equal(agg.qty, 0); assert.deepEqual(agg.inconsistent, ['M-01']);
});

/* ---------- Precision ---------- */

test('Politica de precision -- una sola cifra en CAD, generador, catalogo, presupuesto y explosion', async () => {
  const c = await serverWorld();
  let m = CAD.createEmptyCadModel();
  ({ model: m } = wall(m, 0, 0, 7.298647, 0, 2.7));            // 7.298647 x 2.7 = 19.7063469 (crudo)
  m = assign(m, 'M-01', c.id);
  const r = await SVC.syncConceptGenerators({ conceptId: c.id, projectId: 'P-1', planoId: PLANO, model: m, expectedRevision: 0 });
  const g = r.concepto.generadores[0];
  assert.equal(g.dimensions.length, 7.2986);                   // r4 de la metrica CAD
  assert.equal(g.grossQuantity, G.rq(7.2986 * 2.7));           // 19.7062 (operacion verificable a mano)
  assert.equal(r.concepto.qty, g.netQuantity, 'catalogo = generador');
  await createAndAssociateApu(c.id);
  const { row, block } = await f2(c.id);
  assert.equal(row.qty, r.concepto.qty, 'presupuesto = catalogo');
  assert.equal(block.origenes[0].cantidadConcepto, r.concepto.qty, 'explosion = catalogo');
  assert.equal(G.fmtQ(r.concepto.qty), '19.71', 'presentacion unica a 2 decimales');
});

/* ---------- T15: exportador ---------- */

test('T15 -- el exportador reproduce exactamente operaciones, deducciones, cantidades y total', async () => {
  const c = await serverWorld();
  await SVC.syncConceptGenerators({ conceptId: c.id, projectId: 'P-1', planoId: PLANO, model: mainModel(c.id), expectedRevision: 0 });
  const conceptos = (await apiGetSafe('/api/catalogo-conceptos?projectId=P-1')).conceptos;
  const [r] = buildGeneratorReport(conceptos);
  assert.equal(r.total, 18.36); assert.equal(r.cuadra, true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-f3-'));
  const cwd = process.cwd(); process.chdir(dir);
  try{
    await exportGeneratorsExcel({ conceptos, projectName: 'Casa QA', projectId: 'P-1', writeXlsxFileImpl: writeXlsxFileNode, fileName: 'gen.xlsx' });
    const cells = readXlsxCells(fs.readFileSync('gen.xlsx'));
    const byText = t => Object.entries(cells).find(([, v]) => v.str === t)?.[0];
    const rowOf = ref => ref.replace(/^[A-Z]+/, '');
    const m01 = rowOf(byText('M-01'));
    assert.equal(cells[`B${m01}`].str, '4.50 × 2.70'); assert.equal(cells[`C${m01}`].value, 12.15); assert.equal(cells[`E${m01}`].value, 10.26);
    const ded = Object.entries(cells).find(([, v]) => (v.str || '').includes('− Puerta P-01  0.90 × 2.10'));
    assert.ok(ded, 'deduccion impresa'); assert.equal(cells[`D${rowOf(ded[0])}`].value, 1.89);
    const m02 = rowOf(byText('M-02'));
    assert.equal(cells[`B${m02}`].str, '3.00 × 2.70'); assert.equal(cells[`E${m02}`].value, 8.1);
    const tot = rowOf(byText('TOTAL'));
    assert.equal(cells[`E${tot}`].value, 18.36); assert.equal(cells[`G${tot}`].str, 'Cuadra con el concepto');
  }finally{ process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true }); }
  const { doc } = exportGeneratorsPdf({ conceptos, projectName: 'Casa QA', projectId: 'P-1', save: false });
  const text = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  // F5: el PDF usa el renderizador unificado del Centro de Reportes (titulo con acento).
  for(const s of ['NÚMEROS GENERADORES', 'M-01', '4.50 × 2.70', '12.15', 'Puerta P-01', '0.90 × 2.10', '1.89', '10.26', 'M-02', '8.10', '18.36']) assert.ok(text.includes(s), `PDF contiene "${s}"`);
});
