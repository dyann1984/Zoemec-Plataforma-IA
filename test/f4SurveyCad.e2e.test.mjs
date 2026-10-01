/* F4 -- LEVANTAMIENTO UNIFICADO + CAD como fuente geometrica autoritativa
   (T1-T20 + prueba principal L-001 + GEOMETRY_CHANGED + PDF multipagina).
   Cadena probada con rutas REALES via gateway (Firestore en memoria):
     /api/levantamientos -> /api/plano-takeoffs (cadModel, revision) ->
     generadores (quantityGenerators) -> /api/catalogo-conceptos
     set-generators (verificacion contra el plano persistido) -> concepto.qty
     -> F2 (buildBudgetScope / computeScopedExplosion).
   Infraestructura sustituida: solo Firebase (test/helpers/roleParityHarness).
   Nada de IA: la captura manual y el CAD no llaman a OpenAI. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./helpers/roleParityHarness/hooks.mjs', import.meta.url);
const W = await import('./helpers/roleParityHarness/world.mjs');
const CAD = await import('../src/domain/cadModel.js');
const G = await import('../src/domain/quantityGenerators.js');
const { deriveCad3D } = await import('../src/domain/cad3d.js');
const { buildCadModelFromRecognition } = await import('../src/domain/cadRecognition.js');
const { surveyToCadModel, surveyPlanoKey } = await import('../src/domain/surveyToCadModel.js');
const { makeEmptySurvey, makeEmptySpace } = await import('../src/domain/levantamientoSchema.js');
const LINK = await import('../src/domain/levantamientoCadLink.js');
const SVC = await import('../src/features/planos/cad/cadConceptService.js');
const PLANO = await import('../src/features/planos/cadPlanoCloud.js');
const { migrateLegacySurvey, listServerSurveys } = await import('../src/features/levantamiento/levantamientoCloud.js');
const { buildBudgetScope } = await import('../src/domain/budgetScope.js');
const { computeScopedExplosion, EXPLOSION_SCOPE } = await import('../src/domain/explosionData.js');
const { aggregatePresupuesto } = await import('../src/domain/presupuestoAggregation.js');
const { makeEmptyAPUv2, APU_DATA_STATE } = await import('../src/domain/apuSchema.js');
const { calcAPUv2 } = await import('../src/lib/apuCalc.js');
const { apiPost, apiGetSafe } = await import('../src/services/apiClient.js');

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);
const SPACE_ID = 'SPC-REC';
const ESP = 'ESP-01';
const LOSETA = 'Loseta ceramica 33x33';

/* ---------- utilidades ---------- */
async function rawGet(path){
  const res = await fetch(path, { headers: { authorization: `Bearer ${W.H.currentToken}` } });
  return { status: res.status, body: await res.json() };
}
const versionsOf = planoId => W.H.db._dump('planoTakeoffVersions/').filter(v => v.planoTakeoffId === planoId);
const getConcept = async id => (await apiGetSafe('/api/catalogo-conceptos?projectId=P-1')).conceptos.find(c => c.id === id);
const saveSurvey = async (survey, expectedRevision = null) => (await apiPost('/api/levantamientos', { action: 'save', survey, expectedRevision })).levantamiento;
const lengthsX = model => model.walls.filter(w => Math.abs(w.y1 - w.y2) < 1e-9).map(w => G.rq(CAD.wallLength(w)));

function manualSurvey(id = 'L-001'){
  const s = makeEmptySurvey({ id, projectId: 'P-1', name: `${id} Casa QA` });
  const space = { ...makeEmptySpace({ name: 'Recámara', length: 4, width: 3.5, height: 2.7 }), id: SPACE_ID };
  return { ...s, spaces: [space] };
}

async function addOrg2User(){
  await W.H.db.collection('organizations').doc('ORG-2').set({ id: 'ORG-2', name: 'Otra', status: 'CONVERTED' });
  await W.H.db.collection('organizations').doc('ORG-2').collection('members').doc('OUT-1').set({ uid: 'OUT-1', role: 'company_manager', status: 'active' });
  await W.H.db.collection('users').doc('OUT-1').set({ uid: 'OUT-1', email: 'out@harness.test', organizationId: 'ORG-2', plan: 'Gratis', active: true });
  W.H.tokens['tok-OUT-1'] = { uid: 'OUT-1', email: 'out@harness.test', email_verified: true };
}
const asOutsider = () => { W.H.role = 'OUT'; W.H.currentToken = 'tok-OUT-1'; };

/* Etapa 1: mundo + levantamiento manual (rev 1). */
async function stageSurvey(){
  W.seedWorld();
  W.asRole('MANAGER');
  const survey = await saveSurvey(manualSurvey());
  return { survey };
}

/* Etapa 2: CAD inicial desde la captura (plano por espacio + cadLinks). */
async function stageCad(){
  const { survey } = await stageSurvey();
  const space = survey.spaces[0];
  const { model } = surveyToCadModel(space);
  const planoId = surveyPlanoKey(survey.id, space.id);
  const plano = await PLANO.createPlano({ planoId, projectId: 'P-1', fileName: `${survey.name} · ${space.name}`, mimeType: 'application/x-zoemec-survey', cadModel: model, sourceKind: 'SURVEY', surveyId: survey.id, spaceId: space.id });
  const linked = await saveSurvey(LINK.linkSpaceToPlano(survey, space.id, planoId, { by: 'mgr@harness.test' }), survey.revision);
  return { survey: linked, planoId, plano, model };
}

async function createConcept(clave, concept, unit){
  const created = await apiPost('/api/catalogo-conceptos', { action: 'create', projectId: 'P-1', conceptos: [{ clave, capitulo: 'ACABADOS', concept, unit, qty: 1 }] });   // el catalogo exige qty > 0 al crear (manual provisional)
  return created.conceptos[0];
}

/* Etapa 3: concepto ligado al espacio ESP-01 (area) y generadores iniciales
   confirmados contra la revision persistida -> concepto.qty = 14.00. */
async function stageConfirmed14(){
  const ctx = await stageCad();
  const c = await createConcept('PISO-01', 'Piso de loseta ceramica 33x33', 'm²');
  const model = CAD.setElementAssignment(ctx.model, ESP, { conceptId: c.id, quantityField: 'area', unit: 'm²' });
  const plano = await PLANO.saveDraft({ planoId: ctx.planoId, snapshot: { ...ctx.plano.snapshot, cadModel: model }, expectedRevision: ctx.plano.revision });
  const r = await SVC.syncConceptGenerators({ conceptId: c.id, projectId: 'P-1', planoId: ctx.planoId, model, expectedRevision: 0, planoRevision: plano.revision });
  return { ...ctx, c, model, plano, confirm: r };
}

async function createAndAssociateApu(conceptoId){
  const a = makeEmptyAPUv2();
  const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'QA', fecha: '2026-09-01' };
  Object.assign(a, { id: 'APU-PISO', clave: 'APU-PISO', concept: 'Piso de loseta ceramica 33x33', unit: 'm²', cantidadObra: 14 });
  a.materials = [{ clave: 'LOS-33', descripcion: LOSETA, unidad: 'm²', consumo: 1.05, desperdicioPct: 0, precioUnitario: 180, fuente }];
  a.labor = [{ clave: 'MO-AZ', descripcion: 'Oficial azulejero', unidad: 'jor', cuadrilla: 1, rendimiento: 10, jornada: 8, salarioBase: 700, fsr: 1.5, fuente }];
  await apiPost('/api/apus', { action: 'create', id: 'APU-PISO', projectId: 'P-1', apu: a });
  await apiPost('/api/catalogo-conceptos', { action: 'associate-apu', id: conceptoId, apuId: 'APU-PISO' });
}
async function f2(conceptoId){
  const conceptos = (await apiGetSafe('/api/catalogo-conceptos?projectId=P-1')).conceptos;
  const apuDocs = (await apiGetSafe('/api/apus?projectId=P-1')).apus;
  const scope = buildBudgetScope({ conceptos, apuDocs });
  const budget = aggregatePresupuesto(scope.rows);
  const exp = computeScopedExplosion({ conceptos, apuDocs, scope: EXPLOSION_SCOPE.PRESUPUESTO });
  return {
    row: budget.rows.find(r => r.conceptoId === conceptoId),
    loseta: exp.data.materials.find(r => r.descripcion === LOSETA),
    pu: calcAPUv2(apuDocs.find(d => d.id === 'APU-PISO').snapshot).pu
  };
}

/* Etapa 4: edicion real 4.00 -> 4.50 guardada como borrador (autosave). */
async function stageEdited(){
  const ctx = await stageConfirmed14();
  const edited = CAD.resizeRectangularSpace(ctx.model, ESP, { length: 4.5 });
  const plano2 = await PLANO.saveDraft({ planoId: ctx.planoId, snapshot: { ...ctx.plano.snapshot, cadModel: edited }, expectedRevision: ctx.plano.revision });
  return { ...ctx, edited, plano2 };
}

/* ================= T1 - T6 ================= */

test('T1 -- levantamiento manual se crea en el servidor sin IA (rev 1, LEGACY_MANUAL, trazabilidad)', async () => {
  const ai0 = { ...W.H.openai };
  const { survey } = await stageSurvey();
  assert.equal(survey.id, 'L-001'); assert.equal(survey.revision, 1);
  assert.equal(survey.geometryMode, 'LEGACY_MANUAL');
  assert.equal(survey.createdBy, 'mgr@harness.test'); assert.equal(survey.updatedBy, 'mgr@harness.test');
  assert.ok(survey.createdAt && survey.updatedAt);
  const doc = W.H.db._get('levantamientos/L-001');
  assert.equal(doc.organizationId, 'ORG-1'); assert.equal(doc.projectId, 'P-1'); assert.equal(doc.ownerUid, 'MGR-1');
  assert.deepEqual({ l: doc.survey.spaces[0].length, w: doc.survey.spaces[0].width, h: doc.survey.spaces[0].height }, { l: 4, w: 3.5, h: 2.7 });
  const q = LINK.computeSurveyQuantities(survey);
  assert.equal(q.rows[0].origin, 'CAPTURA_MANUAL');
  assert.equal(q.totals.floorArea, 14); assert.equal(q.totals.perimeter, 15); assert.equal(q.totals.wallGrossArea, 40.5);
  assert.deepEqual(W.H.openai, ai0, 'la captura manual no llama a la IA');
  const audit = W.H.db._dump('levantamientosAudit/');
  assert.deepEqual(audit.map(a => a.action), ['LEVANTAMIENTO_CREADO']);
});

test('T2 -- CAD inicial desde la captura: 4 muros + ESP-01 14.00 m2, plano por espacio y cadLinks en el levantamiento', async () => {
  const { survey, planoId, plano, model } = await stageCad();
  assert.equal(planoId, 'survey:L-001:SPC-REC');
  assert.equal(model.walls.length, 4); assert.equal(model.spaces[0].id, ESP);
  assert.equal(CAD.computeSpaceMetrics(model, ESP).area, 14);
  assert.deepEqual(lengthsX(model), [4, 4]);
  assert.equal(plano.revision, 1); assert.equal(plano.sourceKind, 'SURVEY');
  assert.equal(plano.surveyId, 'L-001'); assert.equal(plano.spaceId, SPACE_ID);
  assert.equal(plano.organizationId, 'ORG-1'); assert.equal(plano.underlayStoredInCloud, false);
  assert.equal(survey.revision, 2); assert.equal(survey.geometryMode, 'CAD_AUTHORITATIVE');
  assert.equal(survey.cadLinks[SPACE_ID].planoId, planoId);
  const doc = W.H.db._get('levantamientos/L-001');
  assert.equal(doc.survey.cadPlanos, undefined, 'la geometria no se duplica dentro del levantamiento');
  assert.ok(!JSON.stringify(doc).includes('"walls"'), 'sin copias de muros en el levantamiento');
});

test('T3 -- editar la cota (Largo 4.00 -> 4.50) cambia la geometria REAL persistida', async () => {
  const { edited, plano2, planoId } = await stageEdited();
  assert.equal(CAD.computeSpaceMetrics(edited, ESP).area, 15.75);
  assert.deepEqual(lengthsX(edited), [4.5, 4.5], 'los dos muros en X se estiran');
  const dimValues = edited.dimensions.map(d => CAD.resolveDimension(edited, d).value).sort();
  assert.deepEqual(dimValues, [3.5, 3.5, 4.5, 4.5], 'las cotas ligadas siguen a los muros');
  const reloaded = await PLANO.loadPlano(planoId);
  assert.equal(reloaded.revision, plano2.revision);
  assert.deepEqual(reloaded.snapshot.cadModel, edited, 'el servidor guarda exactamente la geometria editada');
  // Longitud de un muro (panel de propiedades): mueve el nodo conectado.
  const wall = edited.walls.find(w => Math.abs(w.y1 - w.y2) < 1e-9 && Math.abs(w.y1) < 1e-9);
  const m5 = CAD.setWallLength(edited, wall.id, 5);
  const w5 = m5.walls.find(w => w.id === wall.id);
  assert.equal(G.rq(CAD.wallLength(w5)), 5);
  const end = { x: w5.x2, y: w5.y2 };
  assert.ok(m5.walls.some(w => w.id !== wall.id && ((Math.abs(w.x1 - end.x) < 1e-9 && Math.abs(w.y1 - end.y) < 1e-9) || (Math.abs(w.x2 - end.x) < 1e-9 && Math.abs(w.y2 - end.y) < 1e-9))), 'el muro conectado sigue a la esquina');
});

test('T4 -- 2D y 3D se derivan del MISMO cadModel (mismos ids, mismas medidas tras editar)', async () => {
  const { model, edited } = await stageEdited();
  const ids = m => [...m.walls.map(w => w.id), ...m.spaces.map(s => s.id)].sort();
  const before3d = deriveCad3D(model), after3d = deriveCad3D(edited);
  assert.deepEqual([...new Set(after3d.elements.map(e => e.objectId))].sort(), ids(edited), '3D usa los ids de planta');
  assert.equal(before3d.bounds.maxX, 4); assert.equal(after3d.bounds.maxX, 4.5);
  const floor = after3d.elements.find(e => e.type === 'floor');
  assert.deepEqual(floor.polygon.map(p => p.x).sort(), edited.spaces[0].points.map(p => p.x).sort());
  assert.equal(floor.height, 2.7);
  const wall2d = edited.walls.find(w => Math.abs(w.y1 - w.y2) < 1e-9);
  const pieces = after3d.elements.filter(e => e.objectId === wall2d.id);
  assert.ok(pieces.length >= 1 && pieces.every(p => p.dimensions.height === wall2d.height));
});

test('T5 -- Cuantificacion del levantamiento usa el CAD cuando existe (no la captura inicial)', async () => {
  const { survey, edited } = await stageEdited();
  assert.equal(survey.spaces[0].length, 4, 'la captura inicial se conserva');
  const q = LINK.computeSurveyQuantities(survey, { [SPACE_ID]: edited });
  assert.equal(q.rows[0].origin, 'CAD'); assert.equal(q.rows[0].planoId, 'survey:L-001:SPC-REC');
  assert.equal(q.totals.floorArea, 15.75, 'cantidad del CAD 4.50 x 3.50');
  assert.equal(q.mode, 'CAD_AUTHORITATIVE');
  const pending = LINK.computeSurveyQuantities(survey, {});
  assert.deepEqual(pending.pendingSpaces, [SPACE_ID], 'CAD no cargado: pendiente, nunca cae en silencio a la captura');
  assert.equal(pending.totals.floorArea, 0);
});

test('T6 -- sin CAD: fallback a captura manual etiquetado; MIXTO cuando conviven', async () => {
  const { survey } = await stageSurvey();
  const q = LINK.computeSurveyQuantities(survey);
  assert.deepEqual(q.origins, ['CAPTURA_MANUAL']); assert.equal(q.mode, 'LEGACY_MANUAL');
  assert.equal(q.totals.floorArea, 14);
  const two = { ...survey, spaces: [...survey.spaces, { ...makeEmptySpace({ name: 'Baño', length: 2, width: 1.5, height: 2.4 }), id: 'SPC-BANO' }] };
  const { model } = surveyToCadModel(two.spaces[0]);
  const mixed = LINK.linkSpaceToPlano(two, SPACE_ID, surveyPlanoKey(two.id, SPACE_ID));
  const qm = LINK.computeSurveyQuantities(mixed, { [SPACE_ID]: CAD.resizeRectangularSpace(model, ESP, { length: 4.5 }) });
  assert.equal(qm.mode, 'MIXTO');
  assert.deepEqual(qm.rows.map(r => [r.spaceId, r.origin, r.q.floorArea]), [[SPACE_ID, 'CAD', 15.75], ['SPC-BANO', 'CAPTURA_MANUAL', 3]]);
  assert.equal(qm.totals.floorArea, 18.75);
});

/* ================= T7 - T10 ================= */

test('T7 -- guardar geometria editada marca automaticamente "Generadores desactualizados" (14.00 -> 15.75)', async () => {
  const { c, planoId, plano2 } = await stageEdited();
  const after = await getConcept(c.id);
  assert.equal(after.generatorsStale, true);
  const st = after.generatorStaleness[planoId];
  assert.equal(st.stale, true); assert.equal(st.fromQty, 14); assert.equal(st.toQty, 15.75);
  assert.equal(st.planoRevision, plano2.revision);
  assert.deepEqual(st.changes.map(ch => [ch.elementId, ch.change, ch.from, ch.to]), [[ESP, 'MODIFICADO', 14, 15.75]]);
});

test('T8 -- concepto.qty, Presupuesto y Explosion NO cambian antes de confirmar', async () => {
  const ctx = await stageConfirmed14();
  await createAndAssociateApu(ctx.c.id);
  const before = await f2(ctx.c.id);
  const edited = CAD.resizeRectangularSpace(ctx.model, ESP, { length: 4.5 });
  await PLANO.saveDraft({ planoId: ctx.planoId, snapshot: { ...ctx.plano.snapshot, cadModel: edited }, expectedRevision: ctx.plano.revision });
  const c = await getConcept(ctx.c.id);
  assert.equal(c.qty, 14); assert.equal(c.generatorsStale, true);
  assert.equal(c.generadores[0].operation.expression, '4.00 × 3.50', 'el generador guardado sigue siendo el revisado');
  const now = await f2(ctx.c.id);
  close(now.row.qty, 14, 'presupuesto'); close(now.row.importe, before.row.importe, 'importe');
  close(now.loseta.cantidadFinal, 14 * 1.05, 'explosion');
});

test('T9 -- confirmar RECALCULAR GENERADORES actualiza concepto.qty 14.00 -> 15.75 y limpia la marca', async () => {
  const { c, planoId, edited, plano2 } = await stageEdited();
  const concepts = (await apiGetSafe('/api/catalogo-conceptos?projectId=P-1')).conceptos;
  const preview = SVC.previewPlanoGenerators({ concepts, planoId, projectId: 'P-1', model: edited });
  assert.equal(preview[0].fromQty, 14); assert.equal(preview[0].toQty, 15.75);
  const [res] = await SVC.recalculatePlanoGenerators({ projectId: 'P-1', planoId, model: edited, preview, planoRevision: plano2.revision });
  assert.equal(res.geometryVerified, true);
  const after = await getConcept(c.id);
  assert.equal(after.qty, 15.75); assert.equal(after.quantitySource, 'GENERATORS');
  assert.equal(after.generadores[0].operation.expression, '4.50 × 3.50');
  assert.equal(after.generatorsStale, false); assert.deepEqual(after.generatorStaleness, {});
  const h = after.quantityHistory.at(-1);
  assert.deepEqual({ from: h.from, to: h.to, geometryVerified: h.geometryVerified, planoRevision: h.planoRevision }, { from: 14, to: 15.75, geometryVerified: true, planoRevision: plano2.revision });
});

test('T10 -- F2 propaga 15.75 a Presupuesto y Explosion (solo via concepto.qty)', async () => {
  const ctx = await stageConfirmed14();
  await createAndAssociateApu(ctx.c.id);
  const before = await f2(ctx.c.id);
  close(before.row.qty, 14, 'presupuesto inicial');
  const edited = CAD.resizeRectangularSpace(ctx.model, ESP, { length: 4.5 });
  const p2 = await PLANO.saveDraft({ planoId: ctx.planoId, snapshot: { ...ctx.plano.snapshot, cadModel: edited }, expectedRevision: ctx.plano.revision });
  const concepts = (await apiGetSafe('/api/catalogo-conceptos?projectId=P-1')).conceptos;
  await SVC.recalculatePlanoGenerators({ projectId: 'P-1', planoId: ctx.planoId, model: edited, preview: SVC.previewPlanoGenerators({ concepts, planoId: ctx.planoId, projectId: 'P-1', model: edited }), planoRevision: p2.revision });
  const after = await f2(ctx.c.id);
  close(after.row.qty, 15.75, 'presupuesto 15.75');
  close(after.row.importe, 15.75 * after.pu, 'importe 15.75 x P.U.');
  close(after.loseta.cantidadFinal, 15.75 * 1.05, 'explosion 15.75 x 1.05');
  assert.equal(after.pu, before.pu, 'el APU no se regenero');
});

/* ================= PRUEBA PRINCIPAL ================= */

test('PRINCIPAL L-001 -- 4.00 x 3.50 = 14.00 -> 4.50 -> DESACTUALIZADO (qty 14.00) -> revision -> confirmar -> 15.75 -> Presupuesto/Explosion', async (t) => {
  const ctx = await stageConfirmed14();
  assert.equal(ctx.confirm.concepto.qty, 14); assert.equal(ctx.confirm.geometryVerified, true);
  assert.equal(ctx.confirm.concepto.generadores[0].operation.expression, '4.00 × 3.50');
  await createAndAssociateApu(ctx.c.id);
  const b0 = await f2(ctx.c.id);
  t.diagnostic(`inicial: qty=${ctx.confirm.concepto.qty} presupuesto=${b0.row.qty} importe=${b0.row.importe.toFixed(2)} explosion loseta=${b0.loseta.cantidadFinal}`);

  const edited = CAD.resizeRectangularSpace(ctx.model, ESP, { length: 4.5 });
  const p2 = await PLANO.saveDraft({ planoId: ctx.planoId, snapshot: { ...ctx.plano.snapshot, cadModel: edited }, expectedRevision: ctx.plano.revision });
  const stale = await getConcept(ctx.c.id);
  const b1 = await f2(ctx.c.id);
  assert.equal((await PLANO.loadPlano(ctx.planoId)).snapshot.cadModel.spaces[0].points.some(p => p.x === 4.5), true, 'CAD = nueva geometria');
  assert.equal(stale.generatorsStale, true, 'GENERADORES DESACTUALIZADOS');
  assert.equal(stale.qty, 14); close(b1.row.qty, 14, 'presupuesto conserva 14'); close(b1.loseta.cantidadFinal, 14.7, 'explosion conserva 14');
  t.diagnostic(`editado (rev ${p2.revision}): stale=${stale.generatorsStale} qty=${stale.qty} presupuesto=${b1.row.qty} explosion=${b1.loseta.cantidadFinal}`);

  const concepts = (await apiGetSafe('/api/catalogo-conceptos?projectId=P-1')).conceptos;
  const preview = SVC.previewPlanoGenerators({ concepts, planoId: ctx.planoId, projectId: 'P-1', model: edited });
  const oldG = stale.generadores[0], newG = G.buildConceptGenerators(edited, ctx.c.id, { planoId: ctx.planoId })[0];
  const antes = `${oldG.operation.expression} = ${G.fmtQ(oldG.netQuantity)} m²`, nuevo = `${newG.operation.expression} = ${G.fmtQ(newG.netQuantity)} m²`;
  assert.equal(antes, '4.00 × 3.50 = 14.00 m²'); assert.equal(nuevo, '4.50 × 3.50 = 15.75 m²');
  t.diagnostic(`revision: ANTES ${antes} | NUEVO ${nuevo}`);

  await SVC.recalculatePlanoGenerators({ projectId: 'P-1', planoId: ctx.planoId, model: edited, preview, planoRevision: p2.revision });
  const done = await getConcept(ctx.c.id);
  const b2 = await f2(ctx.c.id);
  assert.equal(done.qty, 15.75);
  close(b2.row.qty, 15.75, 'presupuesto'); close(b2.row.importe, 15.75 * b2.pu, 'importe'); close(b2.loseta.cantidadFinal, 15.75 * 1.05, 'explosion');
  t.diagnostic(`confirmado: qty=${done.qty} presupuesto=${b2.row.qty} importe=${b2.row.importe.toFixed(2)} explosion loseta=${b2.loseta.cantidadFinal}`);
});

/* ================= T11 - T13 ================= */

test('T11 -- persistencia: una sesion NUEVA recupera levantamiento, CAD, revision, generadores y qty solo del servidor', async () => {
  const { c, planoId, edited, plano2 } = await stageEdited();
  const concepts = (await apiGetSafe('/api/catalogo-conceptos?projectId=P-1')).conceptos;
  await SVC.recalculatePlanoGenerators({ projectId: 'P-1', planoId, model: edited, preview: SVC.previewPlanoGenerators({ concepts, planoId, projectId: 'P-1', model: edited }), planoRevision: plano2.revision });
  W.asRole('MANAGER', { newBrowser: true });                     // cerrar / reabrir sesion
  const [survey] = await listServerSurveys('P-1');
  assert.equal(survey.id, 'L-001'); assert.equal(survey.revision, 2); assert.equal(survey.cadLinks[SPACE_ID].planoId, planoId);
  const plano = await PLANO.loadPlano(planoId);
  assert.equal(plano.revision, plano2.revision);
  assert.equal(CAD.rectangularSpaceBox(plano.snapshot.cadModel.spaces[0]).length, 4.5);
  const q = LINK.computeSurveyQuantities(survey, { [SPACE_ID]: plano.snapshot.cadModel });
  assert.equal(q.totals.floorArea, 15.75);
  assert.equal((await getConcept(c.id)).qty, 15.75);
});

test('T12 -- otro miembro de la MISMA empresa (COLLABORATOR, otro navegador) recupera todo con trazabilidad', async () => {
  const { c, planoId, edited, plano2 } = await stageEdited();
  const concepts = (await apiGetSafe('/api/catalogo-conceptos?projectId=P-1')).conceptos;
  await SVC.recalculatePlanoGenerators({ projectId: 'P-1', planoId, model: edited, preview: SVC.previewPlanoGenerators({ concepts, planoId, projectId: 'P-1', model: edited }), planoRevision: plano2.revision });
  W.asRole('COLLABORATOR', { newBrowser: true });
  const project = await rawGet('/api/levantamientos?projectId=P-1');
  assert.equal(project.status, 200);
  const survey = project.body.levantamientos.find(s => s.id === 'L-001');
  assert.equal(survey.projectId, 'P-1'); assert.equal(survey.spaces[0].name, 'Recámara');
  assert.equal(survey.createdBy, 'mgr@harness.test');
  const plano = await PLANO.loadPlano(planoId);
  assert.equal(plano.revision, plano2.revision); assert.equal(plano.updatedBy, 'mgr@harness.test');
  const box = CAD.rectangularSpaceBox(plano.snapshot.cadModel.spaces[0]);
  assert.deepEqual([box.length, box.width], [4.5, 3.5]);
  const read = await getConcept(c.id);
  assert.equal(read.qty, 15.75);
  assert.equal(read.generadores[0].operation.expression, '4.50 × 3.50');
  const h = read.quantityHistory.at(-1);
  assert.deepEqual([h.from, h.to, h.planoId, h.planoRevision, h.actor], [14, 15.75, planoId, plano2.revision, 'mgr@harness.test']);
  // tambien puede seguir trabajando: guarda un borrador sobre la revision vigente
  const saved = await PLANO.saveDraft({ planoId, snapshot: plano.snapshot, expectedRevision: plano.revision });
  assert.equal(saved.revision, plano.revision + 1); assert.equal(saved.updatedBy, 'col@harness.test');
});

test('T13 -- otra empresa: 403 en levantamiento, plano, catalogo y escrituras; nada cambia', async () => {
  const { survey, planoId, plano } = await stageCad();
  await addOrg2User();
  asOutsider();
  assert.equal((await rawGet('/api/levantamientos?id=L-001')).status, 403);
  assert.equal((await rawGet('/api/levantamientos?projectId=P-1')).status, 403);
  assert.equal((await rawGet(`/api/plano-takeoffs?id=${encodeURIComponent(planoId)}`)).status, 403);
  assert.equal((await rawGet('/api/catalogo-conceptos?projectId=P-1')).status, 403);
  await assert.rejects(saveSurvey({ ...survey, name: 'hackeado' }, survey.revision), err => err.status === 403);
  await assert.rejects(PLANO.saveDraft({ planoId, snapshot: { ...plano.snapshot, cadModel: CAD.createEmptyCadModel() }, expectedRevision: plano.revision }), err => err.status === 403);
  assert.equal(W.H.db._get('levantamientos/L-001').survey.name, 'L-001 Casa QA');
  assert.equal(W.H.db._get(`planoTakeoffs/${planoId}`).revision, plano.revision);
});

/* ================= T14 - T16 ================= */

test('T14 -- concurrencia: dos usuarios sobre la misma revision -> 409 REVISION_CONFLICT, nunca sobrescritura silenciosa', async () => {
  const { survey, planoId, plano, model } = await stageCad();
  // Levantamiento
  W.asRole('COLLABORATOR');
  const bView = (await rawGet('/api/levantamientos?id=L-001')).body.levantamiento;
  W.asRole('MANAGER');
  const a = await saveSurvey({ ...survey, description: 'cambio de A' }, survey.revision);
  assert.equal(a.revision, survey.revision + 1);
  W.asRole('COLLABORATOR');
  await assert.rejects(saveSurvey({ ...bView, description: 'cambio de B' }, bView.revision), err => {
    assert.equal(err.status, 409); assert.equal(err.code, 'REVISION_CONFLICT'); assert.equal(err.currentRevision, a.revision); return true;
  });
  assert.equal(W.H.db._get('levantamientos/L-001').survey.description, 'cambio de A');
  // Plano
  W.asRole('MANAGER');
  const pa = await PLANO.saveDraft({ planoId, snapshot: { ...plano.snapshot, cadModel: CAD.resizeRectangularSpace(model, ESP, { length: 4.5 }) }, expectedRevision: plano.revision });
  W.asRole('COLLABORATOR');
  await assert.rejects(PLANO.saveDraft({ planoId, snapshot: { ...plano.snapshot, cadModel: CAD.resizeRectangularSpace(model, ESP, { width: 5 }) }, expectedRevision: plano.revision }), err => {
    assert.ok(PLANO.isRevisionConflict(err)); assert.equal(err.currentRevision, pa.revision); return true;
  });
  await assert.rejects(PLANO.saveCheckpoint({ planoId, snapshot: plano.snapshot, expectedRevision: plano.revision }), err => err.status === 409 && err.code === 'REVISION_CONFLICT');
  const stored = W.H.db._get(`planoTakeoffs/${planoId}`);
  assert.equal(stored.revision, pa.revision);
  assert.deepEqual([CAD.rectangularSpaceBox(stored.snapshot.cadModel.spaces[0]).length, CAD.rectangularSpaceBox(stored.snapshot.cadModel.spaces[0]).width], [4.5, 3.5], 'queda la geometria de A');
});

test('T15 -- 10 autosaves (save-draft) avanzan la revision sin crear 10 versiones historicas', async (t) => {
  const { planoId, plano, model } = await stageCad();
  const v0 = versionsOf(planoId).length, r0 = plano.revision;
  let rev = plano.revision, m = model;
  for(let i = 1; i <= 10; i++){
    m = CAD.resizeRectangularSpace(m, ESP, { length: 4 + i * 0.05 });
    rev = (await PLANO.saveDraft({ planoId, snapshot: { ...plano.snapshot, cadModel: m }, expectedRevision: rev })).revision;
  }
  const stored = W.H.db._get(`planoTakeoffs/${planoId}`);
  assert.equal(versionsOf(planoId).length, v0, 'ninguna version nueva');
  assert.equal(stored.revision, r0 + 10); assert.equal(stored.dirtySinceVersion, true);
  assert.equal(stored.currentVersion, plano.currentVersion);
  assert.equal(CAD.rectangularSpaceBox(stored.snapshot.cadModel.spaces[0]).length, 4.5, 'el borrador guarda la ultima edicion');
  t.diagnostic(`antes: versiones=${v0} revision=${r0} | despues de 10 autosaves: versiones=${versionsOf(planoId).length} revision=${stored.revision}`);
});

test('T16 -- "Guardar version" crea exactamente un checkpoint inmutable', async (t) => {
  const { planoId, plano, model } = await stageCad();
  let rev = plano.revision;
  for(let i = 1; i <= 3; i++) rev = (await PLANO.saveDraft({ planoId, snapshot: { ...plano.snapshot, cadModel: CAD.resizeRectangularSpace(model, ESP, { length: 4 + i * 0.1 }) }, expectedRevision: rev })).revision;
  const v0 = versionsOf(planoId).length;
  const cp = await PLANO.saveCheckpoint({ planoId, snapshot: { ...plano.snapshot, cadModel: CAD.resizeRectangularSpace(model, ESP, { length: 4.3 }) }, expectedRevision: rev, reason: 'Revision con cliente' });
  const versions = versionsOf(planoId);
  assert.equal(versions.length, v0 + 1);
  assert.equal(cp.revision, rev + 1); assert.equal(cp.dirtySinceVersion, false);
  assert.notEqual(cp.currentVersion, plano.currentVersion);
  const last = versions.find(v => v.version === cp.currentVersion);
  assert.ok(last, 'la version vigente existe como documento inmutable');
  assert.equal((await PLANO.loadPlanoVersions(planoId)).length, v0 + 1);
  t.diagnostic(`versiones antes=${v0} despues=${versions.length} (${versions.map(v => v.version).join(', ')}) revision=${cp.revision}`);
});

/* ================= T17 - T18 ================= */

test('T17 -- una dimension DEFAULT conserva su procedencia (CAD, generador persistido, advertencia)', async () => {
  const ctx = await stageCad();
  const w = ctx.model.walls[0];
  assert.equal(w.thicknessSource, 'DEFAULT', 'espesor no capturado = DEFAULT');
  assert.equal(w.heightSource, 'LEVANTAMIENTO'); assert.equal(ctx.model.spaces[0].ceilingHeightSource, 'LEVANTAMIENTO');
  const vol = G.buildGenerator(ctx.model, w.id, 'netVolume', { planoId: ctx.planoId });
  assert.equal(vol.status, 'INCOMPLETO', 'un volumen con espesor DEFAULT no se presenta como medido');
  assert.equal(vol.issues.filter(i => i.code === 'DIMENSION_POR_DEFECTO').length, 0, 'sin advertencia duplicada del espesor faltante');
  // altura DEFAULT en un plano trazado: se calcula pero lleva advertencia persistida
  const c = await createConcept('APL-01', 'Aplanado', 'm²');
  let m = CAD.createEmptyCadModel();
  ({ model: m } = CAD.addWall(m, { x1: 0, y1: 0, x2: 4, y2: 0 }));
  m = CAD.setElementAssignment(m, 'M-01', { conceptId: c.id, quantityField: 'netArea', unit: 'm²' });
  assert.equal(m.walls[0].heightSource, 'DEFAULT');
  const p = await PLANO.createPlano({ planoId: 'PLANO-TRAZADO', projectId: 'P-1', fileName: 'trazo.png', cadModel: m, sourceKind: 'PLANO_IMAGEN' });
  const r = await SVC.syncConceptGenerators({ conceptId: c.id, projectId: 'P-1', planoId: 'PLANO-TRAZADO', model: m, expectedRevision: 0, planoRevision: p.revision });
  const g = (await getConcept(c.id)).generadores[0];
  assert.equal(r.geometryVerified, true);
  assert.equal(g.status, 'COMPLETO'); assert.equal(g.usesDefaults, true);
  assert.equal(g.dimensionSources.altura, 'DEFAULT');
  const warn = g.issues.find(i => i.code === 'DIMENSION_POR_DEFECTO');
  assert.deepEqual(warn.dimensions, ['altura']); assert.equal(warn.severity, 'ADVERTENCIA');
  assert.equal((await PLANO.loadPlano('PLANO-TRAZADO')).snapshot.cadModel.walls[0].heightSource, 'DEFAULT', 'procedencia persistida');
  assert.equal(CAD.dimensionSourceLabel('DEFAULT') !== CAD.dimensionSourceLabel('USUARIO'), true);
});

test('T18 -- escala no confirmada: advertencia, cantidades no confirmadas, metodo/unidad/referencia conservados', async () => {
  const ctx = await stageCad();
  const scale = { status: 'PENDIENTE', method: 'DOS_PUNTOS', unit: 'm', value: 3.5, reference: 'Cota 3.50 del muro M-02' };
  const m = CAD.setScale(ctx.model, scale);
  const saved = await PLANO.saveDraft({ planoId: ctx.planoId, snapshot: { ...ctx.plano.snapshot, cadModel: m }, expectedRevision: ctx.plano.revision });
  const back = (await PLANO.loadPlano(ctx.planoId)).snapshot.cadModel.scale;
  assert.deepEqual({ status: back.status, method: back.method, unit: back.unit, value: back.value, reference: back.reference }, scale);
  assert.equal(saved.revision, ctx.plano.revision + 1);
  const q = LINK.computeSurveyQuantities(ctx.survey, { [SPACE_ID]: m });
  assert.deepEqual(q.unconfirmedScale, [SPACE_ID], 'advertencia de escala no confirmada');
  const g = G.buildGenerator(m, ESP, 'area', { planoId: ctx.planoId });
  assert.equal(g.status, 'INCOMPLETO'); assert.equal(g.netQuantity, null, 'no se presenta como medicion confirmada');
  assert.ok(g.issues.some(i => (i.missing || []).includes('escala confirmada del plano')));
  const ok = CAD.setScale(m, { status: 'CONFIRMADA', confirmedAt: '2026-09-26T00:00:00Z' });
  assert.deepEqual(LINK.computeSurveyQuantities(ctx.survey, { [SPACE_ID]: ok }).unconfirmedScale, []);
  assert.equal(G.buildGenerator(ok, ESP, 'area', { planoId: ctx.planoId }).netQuantity, 14);
});

/* ================= T19 - T20 ================= */

test('T19 -- eliminar un elemento: marca stale (ELIMINADO) sin tocar qty; al confirmar deja de contribuir', async () => {
  const ctx = await stageCad();
  const c = await createConcept('APL-02', 'Aplanado de muros', 'm²');
  const [wa, wb] = ctx.model.walls;
  let m = CAD.setElementAssignment(ctx.model, wa.id, { conceptId: c.id, quantityField: 'netArea', unit: 'm²' });
  m = CAD.setElementAssignment(m, wb.id, { conceptId: c.id, quantityField: 'netArea', unit: 'm²' });
  const p1 = await PLANO.saveDraft({ planoId: ctx.planoId, snapshot: { ...ctx.plano.snapshot, cadModel: m }, expectedRevision: ctx.plano.revision });
  const r = await SVC.syncConceptGenerators({ conceptId: c.id, projectId: 'P-1', planoId: ctx.planoId, model: m, expectedRevision: 0, planoRevision: p1.revision });
  const qa = G.rq(CAD.wallLength(wa) * 2.7), qb = G.rq(CAD.wallLength(wb) * 2.7);
  assert.equal(r.concepto.qty, G.rq(qa + qb));
  assert.equal(r.concepto.qty, 20.25, '4.00 x 2.70 + 3.50 x 2.70');
  const del = CAD.deleteElement(m, wb.id);
  const p2 = await PLANO.saveDraft({ planoId: ctx.planoId, snapshot: { ...ctx.plano.snapshot, cadModel: del }, expectedRevision: p1.revision });
  let cc = await getConcept(c.id);
  assert.equal(cc.qty, 20.25, 'qty intacta antes de confirmar');
  assert.deepEqual(cc.generatorStaleness[ctx.planoId].changes.map(x => [x.elementId, x.change]), [[wb.id, 'ELIMINADO']]);
  assert.equal(cc.generatorStaleness[ctx.planoId].toQty, qa);
  const concepts = (await apiGetSafe('/api/catalogo-conceptos?projectId=P-1')).conceptos;
  await SVC.recalculatePlanoGenerators({ projectId: 'P-1', planoId: ctx.planoId, model: del, preview: SVC.previewPlanoGenerators({ concepts, planoId: ctx.planoId, projectId: 'P-1', model: del }), planoRevision: p2.revision });
  cc = await getConcept(c.id);
  assert.equal(cc.qty, qa); assert.deepEqual(cc.elementIds, [wa.id]);
  assert.equal(cc.generatorsStale, false);
  assert.equal(cc.quantityHistory.at(-1).changes[0].change, 'ELIMINADO');
});

test('T20 -- migracion legacy: detecta, conserva el original y respaldo, migra sin perdida, idempotente, permite CAD nuevo', async () => {
  W.seedWorld();
  W.asRole('MANAGER');
  const base = makeEmptySurvey({ id: 'L-LEG', projectId: 'P-1', name: 'Levantamiento previo a F4' });
  const spA = { ...makeEmptySpace({ name: 'Sala', length: 5, width: 4, height: 2.6 }), id: 'SPC-SALA' };
  const spB = { ...makeEmptySpace({ name: 'Cocina', length: 3, width: 2.5, height: 2.6 }), id: 'SPC-COC' };
  const editedA = CAD.resizeRectangularSpace(surveyToCadModel(spA).model, ESP, { length: 5.5 });   // geometria editada antes de F4
  const legacy = { ...base, spaces: [spA, spB], cadPlanos: { [spA.id]: editedA }, updatedAt: 1758800000000 };
  const frozen = structuredClone(legacy);
  // 1) detectado: esta en el bloque local y no en el servidor
  assert.deepEqual(await listServerSurveys('P-1'), []);
  // 2-4) migrado
  const migrated = await migrateLegacySurvey(legacy, { user: { email: 'mgr@harness.test' } });
  assert.deepEqual(legacy, frozen, 'el original local no se modifica');
  assert.equal(migrated.migratedFrom, 'USER_BLOB'); assert.equal(migrated.hasLegacyBackup, true);
  assert.equal(migrated.geometryMode, 'MIXTO');
  const doc = W.H.db._get('levantamientos/L-LEG');
  assert.deepEqual(doc.legacyBackup.cadPlanos, frozen.cadPlanos, 'respaldo integro');
  assert.deepEqual(doc.survey.spaces, frozen.spaces, 'espacios/dimensiones/datos sin perdida');
  assert.equal(doc.survey.cadPlanos, undefined);
  const planoA = surveyPlanoKey('L-LEG', spA.id);
  assert.equal(doc.survey.cadLinks[spA.id].planoId, planoA);
  const pA = await PLANO.loadPlano(planoA);
  assert.deepEqual(pA.snapshot.cadModel, frozen.cadPlanos[spA.id], 'geometria editada migrada tal cual');
  assert.equal(pA.sourceKind, 'SURVEY');
  const q = LINK.computeSurveyQuantities(migrated, { [spA.id]: pA.snapshot.cadModel });
  assert.deepEqual(q.rows.map(r => [r.spaceId, r.origin, r.q.floorArea]), [[spA.id, 'CAD', 22], [spB.id, 'CAPTURA_MANUAL', 7.5]]);
  // 6) no se duplica al reabrir
  const counts = () => ({ lev: W.H.db._dump('levantamientos/').length, planos: W.H.db._dump('planoTakeoffs/').length, migr: W.H.db._dump('levantamientosAudit/').filter(a => a.action === 'LEVANTAMIENTO_MIGRADO').length });
  const c1 = counts();
  const again = await migrateLegacySurvey(legacy, { user: { email: 'mgr@harness.test' } });
  assert.deepEqual(counts(), c1); assert.deepEqual(c1, { lev: 1, planos: 1, migr: 1 });
  assert.equal(again.revision, migrated.revision);
  // 5) el espacio sin CAD puede generar/vincular su CAD despues de migrar
  const { model: mB } = surveyToCadModel(spB);
  const planoB = surveyPlanoKey('L-LEG', spB.id);
  await PLANO.createPlano({ planoId: planoB, projectId: 'P-1', cadModel: mB, sourceKind: 'SURVEY', surveyId: 'L-LEG', spaceId: spB.id });
  const linked = await saveSurvey(LINK.linkSpaceToPlano(migrated, spB.id, planoB), migrated.revision);
  assert.equal(linked.geometryMode, 'CAD_AUTHORITATIVE');
  assert.equal(W.H.db._get('levantamientos/L-LEG').legacyBackup.cadPlanos[spA.id].walls.length, 4, 'el respaldo sigue intacto tras guardar');
  assert.deepEqual(LINK.verifyMigration(frozen, LINK.prepareLegacyMigration(frozen)), []);
});

/* ================= Validacion de geometria en servidor ================= */

test('GEOMETRY_CHANGED -- cliente en revision N, servidor en N+1: confirmar generadores de N -> 409, nada se escribe', async () => {
  const ctx = await stageConfirmed14();
  const oldModel = ctx.model, revN = ctx.plano.revision;
  // Otro usuario cambia la geometria (N -> N+1)
  W.asRole('COLLABORATOR');
  const pN1 = await PLANO.saveDraft({ planoId: ctx.planoId, snapshot: { ...ctx.plano.snapshot, cadModel: CAD.resizeRectangularSpace(oldModel, ESP, { length: 4.5 }) }, expectedRevision: revN });
  assert.equal(pN1.revision, revN + 1);
  W.asRole('MANAGER');
  const expect409 = err => { assert.equal(err.status, 409); assert.equal(err.code, 'GEOMETRY_CHANGED'); assert.equal(err.currentRevision, revN + 1); return true; };
  // a) revision vieja
  await assert.rejects(SVC.syncConceptGenerators({ conceptId: ctx.c.id, projectId: 'P-1', planoId: ctx.planoId, model: oldModel, expectedRevision: 1, planoRevision: revN }), expect409);
  // b) revision "correcta" pero geometria vieja (elementId/geometryHash no coinciden)
  await assert.rejects(SVC.syncConceptGenerators({ conceptId: ctx.c.id, projectId: 'P-1', planoId: ctx.planoId, model: oldModel, expectedRevision: 1, planoRevision: revN + 1 }), expect409);
  // c) sin revision y geometria vieja
  await assert.rejects(SVC.syncConceptGenerators({ conceptId: ctx.c.id, projectId: 'P-1', planoId: ctx.planoId, model: oldModel, expectedRevision: 1 }), expect409);
  // d) dimensiones inventadas que no estan en el plano persistido (5.00)
  await assert.rejects(SVC.syncConceptGenerators({ conceptId: ctx.c.id, projectId: 'P-1', planoId: ctx.planoId, model: CAD.resizeRectangularSpace(oldModel, ESP, { length: 5 }), expectedRevision: 1, planoRevision: revN + 1 }), expect409);
  const c = await getConcept(ctx.c.id);
  assert.equal(c.qty, 14, 'nada se escribio'); assert.equal(c.generadores[0].operation.expression, '4.00 × 3.50');
  // e) con la geometria vigente: aceptado y verificado
  const loaded = await PLANO.loadPlano(ctx.planoId);
  const ok = await SVC.syncConceptGenerators({ conceptId: ctx.c.id, projectId: 'P-1', planoId: ctx.planoId, model: loaded.snapshot.cadModel, expectedRevision: 1, planoRevision: loaded.revision });
  assert.equal(ok.geometryVerified, true); assert.equal(ok.concepto.qty, 15.75);
});

/* ================= Carrera: marca automatica vs confirmacion ================= */

test('Carrera -- la marca automatica de desactualizacion nunca revierte una confirmacion concurrente (qty/generadores)', async () => {
  const { markGeneratorStaleness } = await import('../server/api-lib/_generatorStaleness.mjs');
  const { c, planoId, edited, plano2 } = await stageEdited();
  const planoDoc = W.H.db._get(`planoTakeoffs/${planoId}`);
  // Estado justo antes de que la marca de ESE autosave se escriba.
  const raw = W.H.db._get(`catalogConceptos/${c.id}`);
  await W.H.db.collection('catalogConceptos').doc(c.id).set({ ...raw, generatorStaleness: {}, generatorsStale: false });
  // El usuario confirma 15.75 JUSTO despues de que la marca leyo los conceptos.
  const confirm = async () => {
    const concepts = (await apiGetSafe('/api/catalogo-conceptos?projectId=P-1')).conceptos;
    await SVC.recalculatePlanoGenerators({ projectId: 'P-1', planoId, model: edited, preview: SVC.previewPlanoGenerators({ concepts, planoId, projectId: 'P-1', model: edited }), planoRevision: plano2.revision });
  };
  const wrapQuery = q => new Proxy(q, { get(t, p){
    if(p === 'where') return (...a) => wrapQuery(t.where(...a));
    if(p === 'get') return async () => { const snap = await t.get(); await confirm(); return snap; };
    const v = t[p]; return typeof v === 'function' ? v.bind(t) : v;
  } });
  const racingDb = {
    collection(name){
      const col = W.H.db.collection(name);
      if(name !== 'catalogConceptos') return col;
      return new Proxy(col, { get(t, p){ if(p === 'where') return (...a) => wrapQuery(t.where(...a)); const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } });
    },
    runTransaction: fn => W.H.db.runTransaction(fn)
  };
  await markGeneratorStaleness(racingDb, planoDoc);
  const after = await getConcept(c.id);
  assert.equal(after.qty, 15.75, 'la confirmacion concurrente se conserva');
  assert.equal(after.generadores[0].operation.expression, '4.50 × 3.50');
  assert.equal(after.generatorsStale, false, 'sin marca: los generadores ya coinciden con la geometria');
});

test('Carrera -- una marca de una revision vieja del plano no pisa el estado de una revision mas nueva', async () => {
  const { markGeneratorStaleness } = await import('../server/api-lib/_generatorStaleness.mjs');
  const { c, planoId, plano, model } = await stageConfirmed14();
  const oldDoc = W.H.db._get(`planoTakeoffs/${planoId}`);               // rev N (4.00), sin cambios
  const edited = CAD.resizeRectangularSpace(model, ESP, { length: 4.5 });
  await PLANO.saveDraft({ planoId, snapshot: { ...plano.snapshot, cadModel: edited }, expectedRevision: plano.revision });   // rev N+1 marca stale
  assert.equal((await getConcept(c.id)).generatorsStale, true);
  await markGeneratorStaleness(W.H.db, oldDoc);                           // llega tarde la evaluacion de rev N
  const after = await getConcept(c.id);
  assert.equal(after.generatorsStale, true, 'la revision vigente (N+1) manda');
  assert.equal(after.generatorStaleness[planoId].toQty, 15.75);
});

/* ================= Regresiones F4-QA (defectos hallados en navegador) ================= */

test('F4-QA -- la revision muestra la operacion ANTES/NUEVO (4.00 × 3.50 = 14.00 → 4.50 × 3.50 = 15.75)', async () => {
  const { c, planoId, edited } = await stageEdited();
  const concepts = (await apiGetSafe('/api/catalogo-conceptos?projectId=P-1')).conceptos;
  const [p] = SVC.previewPlanoGenerators({ concepts, planoId, projectId: 'P-1', model: edited });
  assert.equal(p.concepto.id, c.id);
  const ch = p.diff.changes[0];
  const before = G.generatorOperationText(p.concepto.generadores.find(g => g.generatorId === ch.generatorId), p.concepto.unit);
  const after = G.generatorOperationText(p.fresh.find(g => g.generatorId === ch.generatorId), p.concepto.unit);
  assert.equal(before, '4.00 × 3.50 = 14.00 m²');
  assert.equal(after, '4.50 × 3.50 = 15.75 m²');
  // con deducciones y sin generador (elemento eliminado)
  let m = CAD.createEmptyCadModel();
  ({ model: m } = CAD.addWall(m, { x1: 0, y1: 0, x2: 4.5, y2: 0, height: 2.7, thickness: 0.12 }));
  ({ model: m } = CAD.addOpening(m, { type: 'door', wallId: 'M-01', width: 0.9, height: 2.1, offset: 1 }));
  assert.equal(G.generatorOperationText(G.buildGenerator(m, 'M-01', 'netArea', { planoId: 'X' }), 'm²'), '4.50 × 2.70 = 12.15 − 1.89 = 10.26 m²');
  assert.equal(G.generatorOperationText(undefined, 'm²'), '— (sin elemento)');
});

test('F4-QA -- avisos del CAD en su propia fila del grid (antes quedaban recortados bajo la barra de estado)', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../src/features/planos/cad/cad.css', import.meta.url), 'utf8');
  const jsx = fs.readFileSync(new URL('../src/features/planos/cad/CadWorkspace.jsx', import.meta.url), 'utf8');
  const areas = [...css.matchAll(/grid-template-areas:([^;]+);/g)].map(x => x[1]);
  assert.ok(areas.length >= 2 && areas.every(a => a.includes('"banners')), `todas las plantillas tienen la fila banners: ${areas.join(' | ')}`);
  assert.match(css, /\.cad-banners\{[^}]*grid-area:banners/);
  const wrap = jsx.slice(jsx.indexOf('<div className="cad-banners">'), jsx.indexOf('<main className={`cad-center'));
  assert.ok(wrap.includes('Escala sin confirmar') && wrap.includes('<CadStalenessBanner'), 'ambos avisos dentro de .cad-banners');
  assert.ok(!/\n\s{4}\{scaleNeedsAction && <p className="cad-banner/.test(jsx), 'ningun aviso como hijo directo del grid');
});

test('F4-QA -- tarjeta y cabecera del levantamiento usan la regla CAD; visor con revision real del plano; recarga unica', async () => {
  const fs = await import('node:fs');
  const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  const card = read('../src/features/levantamiento/LevantamientoCard.jsx');
  assert.ok(card.includes('computeSurveyQuantities(') && !card.includes('aggregateSurveyTotals'), 'la tarjeta no usa la captura manual para espacios con CAD');
  assert.ok(read('../src/features/levantamiento/SurveyDetail.jsx').includes('onModelChange={m => setCadModels('), 'la cabecera sigue al CAD en vivo');
  assert.ok(read('../src/features/levantamiento/SurveyCadTab.jsx').includes('onModelChange?.(m)'));
  assert.ok(read('../src/features/catalogo/GeneratorsViewer.jsx').includes('last.planoRevision'), 'rev. del plano = planoRevision, no la revision de generadores');
  const hook = read('../src/features/levantamiento/levantamientoCloud.js');
  assert.ok(hook.includes('}, [uid, projectId]);') && hook.includes('inFlightRef'), 'reload depende solo de uid/proyecto y no se duplica');
  assert.ok(/migrated: \(same \? s\.migrated \|\| 0 : 0\) \+ migrated/.test(hook), 'el aviso de migracion se acumula (una recarga posterior no lo borra)');
  // la regla de la tarjeta, con datos reales: CAD 15.75 aunque la captura diga 4.00
  const { survey, edited } = await stageEdited();
  assert.equal(LINK.computeSurveyQuantities(survey, { [SPACE_ID]: edited }).totals.floorArea, 15.75);
});

/* ================= PDF multipagina (parte automatizable) ================= */

test('PDF multipagina -- la pagina elegida (2) conserva page y solo su geometria entra al modelo', () => {
  const bbox = (x0, y0, x1, y1) => ({ kind: 'bbox', bbox: { x0, y0, x1, y1 } });
  const elementos = [
    { id: 'p1-m1', tipo: 'muro', pagina: 1, geometry: bbox(0.1, 0.1, 0.12, 0.9) },
    { id: 'p2-m1', tipo: 'muro', pagina: 2, geometry: bbox(0.1, 0.1, 0.9, 0.12) },
    { id: 'p2-m2', tipo: 'muro', pagina: 2, geometry: bbox(0.1, 0.8, 0.9, 0.82) }
  ];
  const underlay = { kind: 'pdf', page: 2, widthUnits: 1000, heightUnits: 800 };
  const { model, report } = buildCadModelFromRecognition({ elementos, resolvedScale: null, pageNumber: 2, underlay });
  assert.equal(model.underlay.page, 2, 'sourcePage conservado en el modelo');
  assert.equal(report.walls, 2);
  assert.deepEqual(model.walls.map(w => w.sourceElementId).sort(), ['p2-m1', 'p2-m2'], 'ninguna geometria de la pagina 1');
  assert.notEqual(model.scale.status, 'CONFIRMADA', 'escala sin confirmar en un PDF sin referencia');
  const p1 = buildCadModelFromRecognition({ elementos, resolvedScale: null, pageNumber: 1, underlay: { ...underlay, page: 1 } });
  assert.deepEqual(p1.model.walls.map(w => w.sourceElementId), ['p1-m1']);
});
