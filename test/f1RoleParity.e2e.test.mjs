/* F1/P0 -- Paridad de comportamiento SUPERADMIN / MANAGER / COLLABORATOR en
   la generacion de APU y el enriquecimiento de precios (T1-T7).

   Reproduce el hallazgo ejecutado en la auditoria F0: el super admin estaba
   exento del rate limit; con el MISMO input y el MISMO uso previo, un
   colaborador recibia 429 en /api/price-intelligence (evidencia y confianza
   distintas, 429 invisible y cacheado) y en /api/generate-apu (lotes
   incompletos). Codigo real del repo; solo Firebase y OpenAI sustituidos
   (ver test/helpers/roleParityHarness/world.mjs). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./helpers/roleParityHarness/hooks.mjs', import.meta.url);
const W = await import('./helpers/roleParityHarness/world.mjs');
const { enrichApuWithIntelligence2, PRICE_SEARCH_FAILED } = await import('../src/domain/materialPriceIntelligence2.js');
const { createIntelligence2RunContext } = await import('../src/domain/intelligence2Runtime.js');
const { runCatalogBatch } = await import('../src/features/catalogo/catalogBatchRunner.js');
const {
  createBatchJob, markItemRateLimited, markPendingRateLimited, retryFailedItems, summarizeJob, isJobComplete, ITEM_STATUS
} = await import('../src/domain/apuBatchQueue.js');
const { isLegalStatusTransition } = await import('../src/domain/catalogConceptoSchema.js');

const ROLES = Object.keys(W.ROLES);
const HOUR = 60 * 60 * 1000;

/* Lo que DEBE ser identico entre roles para el mismo input y el mismo uso. */
function comparable(r){
  return {
    pu: r.pu, direct: r.direct, importe: r.importe, contextHash: r.contextHash, confidence: r.confidence,
    warnings: r.warnings, piStatus: r.piStatus,
    rows: r.rows.map(x => ({ desc: x.desc, precio: x.precio, estado: x.estado, priceStatus: x.priceStatus, priceSearchStatus: x.priceSearchStatus, errCode: x.priceSearchError?.code || null }))
  };
}

test('T1 -- mismo input, sin uso previo: SUPERADMIN, MANAGER y COLLABORATOR obtienen exactamente el mismo resultado', async () => {
  const results = {};
  for(const role of ROLES){ W.seedWorld(); results[role] = await W.runOne(role, W.TARGET, 1); }
  const base = comparable(results.SUPERADMIN);
  for(const role of ROLES) assert.deepEqual(comparable(results[role]), base, `${role} difiere de SUPERADMIN`);
  assert.equal(results.SUPERADMIN.warnings.includes('ENRICHMENT_PARTIAL'), false);
  assert.ok(results.SUPERADMIN.contextHash, 'debe existir contextHash');
});

test('T2 -- mismo uso previo (4 APUs en la misma hora): mismo comportamiento para los 3 roles, incluido el 429', async () => {
  const results = {};
  for(const role of ROLES){
    W.seedWorld();
    for(let k = 0; k < 4; k++) await W.runOne(role, `Concepto previo numero ${k}`, 10 + k);
    results[role] = await W.runOne(role, W.TARGET, 99);
  }
  const base = comparable(results.SUPERADMIN);
  for(const role of ROLES) assert.deepEqual(comparable(results[role]), base, `${role} difiere de SUPERADMIN con el mismo uso previo`);
  // El super admin YA NO esta exento: tambien recibe 429 y lo ve.
  assert.ok((results.SUPERADMIN.piStatus['429'] || 0) > 0, 'el super admin debe estar sujeto al mismo limite');
  for(const role of ROLES) assert.ok(results[role].warnings.includes('ENRICHMENT_PARTIAL'), `${role}: el fallo parcial debe ser visible`);
});

test('T3 -- un resultado servido desde cache NO consume rate limit (solo las busquedas web reales cuentan)', async () => {
  W.seedWorld();
  const first = await W.runOne('MANAGER', W.TARGET, 1);
  assert.equal(first.piStatus['200'], 9);
  assert.equal(W.rateDoc('MANAGER', 'ai')?.count, 9, '9 busquedas web reales = 9 unidades');
  const webSearchesBefore = W.H.openai.responses;
  // Otro miembro, otro navegador, mismo insumos: todo sale del cache del servidor.
  const second = await W.runOne('COLLABORATOR', W.TARGET, 2);
  assert.equal(second.piStatus['200'], 9);
  assert.equal(W.H.openai.responses, webSearchesBefore, 'ninguna busqueda web nueva');
  assert.equal(W.rateDoc('COLLABORATOR', 'ai'), null, 'los CACHE_HIT del servidor no crean ni incrementan el contador');
  // Mismo usuario, navegador nuevo: tampoco consume.
  await W.runOne('MANAGER', W.TARGET, 3);
  assert.equal(W.rateDoc('MANAGER', 'ai')?.count, 9);
  assert.deepEqual(comparable(second), comparable(first), 'cache hit y busqueda real producen el mismo resultado');
});

test('T4 -- el 429 es visible, persistido, NO se cachea y se puede reintentar despues', async () => {
  W.seedWorld();
  for(let k = 0; k < 4; k++) await W.runOne('COLLABORATOR', `Concepto previo numero ${k}`, 10 + k);
  const failed = await W.runOne('COLLABORATOR', W.TARGET, 99);

  // Visible en el renglon
  const failedRows = failed.rows.filter(r => r.priceSearchStatus === PRICE_SEARCH_FAILED);
  assert.ok(failedRows.length > 0, 'debe haber renglones PRICE_SEARCH_FAILED');
  for(const r of failedRows){
    assert.equal(r.priceSearchError.code, 'RATE_LIMITED');
    assert.equal(r.priceSearchError.status, 429);
    assert.ok(r.priceSearchError.retryAfterSeconds > 0, 'retryAfterSeconds presente');
  }
  // Visible en el diagnostico
  assert.ok(failed.warnings.includes('ENRICHMENT_PARTIAL'));
  assert.equal(failed.enrichmentPartial.failedCount, failedRows.length);
  assert.equal(failed.enrichmentPartial.failedReasons[0].code, 'RATE_LIMITED');
  assert.ok(failed.enrichmentPartial.retryAfterSeconds > 0);

  // Persistido en el APU guardado (servidor)
  const saved = W.H.db._get(`apus/${failed.apuId}`).snapshot;
  assert.ok((saved.contextDiagnostics?.warnings || []).some(w => w.code === 'ENRICHMENT_PARTIAL'), 'ENRICHMENT_PARTIAL persistido');
  const savedRows = [...saved.materials, ...saved.labor, ...saved.equipment, ...saved.seguridad];
  assert.equal(savedRows.filter(r => r.priceSearchStatus === PRICE_SEARCH_FAILED).length, failedRows.length, 'estado por renglon persistido');

  // Reintento: la ventana pasa (1 h), MISMO navegador (sin limpiar cache de
  // sesion). Si el fallo se hubiera cacheado, no habria llamadas nuevas.
  W.advanceClock(HOUR + 1000);
  const retried = await W.runOne('COLLABORATOR', W.TARGET, 100, { newBrowser: false });
  assert.ok(retried.piCalls >= failedRows.length, 'los recursos fallidos se vuelven a consultar (no quedaron en cache)');
  assert.equal(retried.piStatus['429'] || 0, 0);
  assert.equal(retried.rows.filter(r => r.priceSearchStatus === PRICE_SEARCH_FAILED).length, 0);
  assert.equal(retried.warnings.includes('ENRICHMENT_PARTIAL'), false);
  assert.equal(retried.pu, failed.pu, 'el P.U. es el mismo con o sin evidencia');
});

test('T5 -- el enriquecimiento NO cambia precios, cantidades, rendimientos ni P.U. (exito, fallo total o fallo parcial)', async () => {
  W.seedWorld();
  const baseline = await W.runOne('MANAGER', W.TARGET, 1);           // todo 200
  W.seedWorld();
  for(let k = 0; k < 4; k++) await W.runOne('MANAGER', `Concepto previo numero ${k}`, 10 + k);
  const partial = await W.runOne('MANAGER', W.TARGET, 99);           // parcial 429
  assert.ok(partial.warnings.includes('ENRICHMENT_PARTIAL'));
  assert.equal(partial.pu, baseline.pu);
  assert.equal(partial.importe, baseline.importe);
  assert.deepEqual(partial.rows.map(r => r.economic), baseline.rows.map(r => r.economic));

  // Nivel unidad: enriquecimiento con busqueda exitosa (precios de mercado
  // distintos) y con busqueda que siempre falla -> campos economicos intactos.
  const apu = {
    concept: 'X', unit: 'm2', cantidadObra: 10,
    materials: [{ descripcion: 'Cemento gris', unidad: 'saco', consumo: 0.2, desperdicioPct: 3, precioUnitario: 250, fuente: { estado: 'ESTIMADO_IA' } }],
    labor: [{ descripcion: 'Oficial', unidad: 'jor', cuadrilla: 1, rendimiento: 10, salarioBase: 700, fsr: 1.7, fuente: { estado: 'ESTIMADO_IA' } }],
    equipment: [{ descripcion: 'Revolvedora', unidad: 'dia', cantidad: 1, tarifa: 600, integracion: 'POR_JORNADA', rendimientoDiario: 10, fuente: { estado: 'ESTIMADO_IA' } }],
    seguridad: []
  };
  const snapshotEconomic = a => ['materials', 'labor', 'equipment'].flatMap(k => a[k].map(r => Object.fromEntries(W.ECONOMIC_FIELDS.map(f => [f, r[f] ?? null]))));
  const before = snapshotEconomic(apu);
  W.resetSharedPriceCache(); // cada corrida con su propio cache de sesion
  const ok = await enrichApuWithIntelligence2({ aiApu: structuredClone(apu), concept: 'X', ...createIntelligence2RunContext(),
    searchFn: async ({ description }) => ({ precioRecomendado: 1, nivelEvidencia: 'MERCADO', referencias: [{ precioNormalizado: 1, match: { verdict: 'ALTO' }, tipoProducto: description }] }) });
  W.resetSharedPriceCache();
  const fail = await enrichApuWithIntelligence2({ aiApu: structuredClone(apu), concept: 'X', ...createIntelligence2RunContext(),
    searchFn: async () => { const e = new Error('limite'); e.status = 429; e.retryAfterSeconds = 120; throw e; } });
  assert.deepEqual(snapshotEconomic(ok.apu), before, 'busqueda exitosa no reemplaza el dato economico');
  assert.deepEqual(snapshotEconomic(fail.apu), before, 'busqueda fallida no altera el dato economico');
  assert.equal(W.calcAPUv2(ok.apu).pu, W.calcAPUv2(apu).pu);
  assert.equal(W.calcAPUv2(fail.apu).pu, W.calcAPUv2(apu).pu);
  assert.equal(fail.failedCount, 3);
  assert.equal(fail.failedReasons[0].code, 'RATE_LIMITED');
  assert.equal(fail.failedReasons[0].retryAfterSeconds, 120);
});

test('T6 -- super admin sujeto al limite en endpoints de empresa, sin perder funciones administrativas', async () => {
  W.seedWorld();
  // 'apu' = 30/h para TODOS los roles.
  for(const role of ROLES){
    for(let i = 0; i < 30; i++) await W.requireFeature(W.fakeReq(role), 'apu');
    await assert.rejects(W.requireFeature(W.fakeReq(role), 'apu'), err => {
      assert.equal(err.status, 429, `${role} debe recibir 429 en el intento 31`);
      assert.equal(err.code, 'RATE_LIMITED');
      assert.ok(err.retryAfterSeconds > 0 && err.retryAfterSeconds <= 3600);
      return true;
    });
  }
  // Privilegios administrativos intactos aunque el limite de datos este agotado.
  const admin = await W.requireSuperAdmin(W.fakeReq('SUPERADMIN'));
  assert.equal(admin.uid, 'SA-1');
  await assert.rejects(W.requireSuperAdmin(W.fakeReq('MANAGER')), err => err.status === 403);
  await assert.rejects(W.requireSuperAdmin(W.fakeReq('COLLABORATOR')), err => err.status === 403);
  // Plan: el super admin sigue sin limite MENSUAL de plan (bypass), solo aplica el anti-abuso.
  W.seedWorld();
  const authz = await W.requireFeature(W.fakeReq('SUPERADMIN'), 'apu');
  assert.equal(authz.plan, 'Empresa');
  // La ventana expira y el acceso vuelve para todos.
  W.seedWorld();
  for(let i = 0; i < 30; i++) await W.requireFeature(W.fakeReq('COLLABORATOR'), 'apu');
  W.advanceClock(HOUR + 1000);
  await W.requireFeature(W.fakeReq('COLLABORATOR'), 'apu');
});

test('T7 -- lote de 32 conceptos (Catalogo): mismo resultado por rol; 429 -> PENDIENTE_LIMITE con reintento, nunca ERROR ni "terminado"', async () => {
  const outcome = {};
  for(const role of ROLES){
    W.seedWorld();
    W.asRole(role);
    const created = await W.apiPost('/api/catalogo-conceptos', {
      action: 'create', projectId: 'P-1',
      conceptos: Array.from({ length: 32 }, (_, k) => ({ clave: `C-${k}`, capitulo: 'OTROS', concept: `Lote concepto ${k}`, unit: 'm2', qty: 10 }))
    });
    const targets = created.conceptos;
    const setStatus = (id, status, extra = {}) => W.apiPost('/api/catalogo-conceptos', { action: 'set-status', id, status, ...extra });
    const summary = await runCatalogBatch({
      targets, concurrency: 3, batchId: `B-${role}`, setStatus,
      generate: (c) => W.generateApuForConcepto({ concepto: c, catalog: [], project: W.PROJECT })
    });
    const docs = W.H.db._dump('catalogConceptos/');
    const byStatus = docs.reduce((a, d) => { a[d.status] = (a[d.status] || 0) + 1; return a; }, {});
    const pending = docs.filter(d => d.status === 'PENDIENTE_LIMITE');
    outcome[role] = { byStatus, rateLimited: summary.rateLimited, failed: summary.failed, generated: summary.ok + summary.review, retry: summary.retryAfterSeconds };
    // Ningun concepto PENDIENTE_LIMITE tiene APU ni aparenta estar terminado.
    for(const d of pending){
      assert.equal(d.apuId, null, 'pendiente por limite no tiene APU');
      assert.ok(d.retryAfterSeconds > 0 && d.retryAt, 'guarda cuando reintentar');
      assert.ok(d.statusError, 'guarda el motivo');
    }
    assert.equal(byStatus.ERROR || 0, 0, `${role}: un 429 nunca debe quedar como ERROR`);
    // Los APUs creados = conceptos con APU.
    assert.equal(W.H.db._dump('apus/').length, outcome[role].generated);
    // Reintento posterior: pasa la ventana y se generan los pendientes.
    W.advanceClock(HOUR + 1000);
    const retryTargets = W.H.db._dump('catalogConceptos/').filter(d => d.status === 'PENDIENTE_LIMITE');
    const retry = await runCatalogBatch({ targets: retryTargets, concurrency: 3, batchId: `R-${role}`, setStatus,
      generate: (c) => W.generateApuForConcepto({ concepto: c, catalog: [], project: W.PROJECT }) });
    assert.equal(retry.rateLimited, 0);
    assert.equal(retry.ok + retry.review, retryTargets.length, `${role}: el reintento completa los pendientes`);
  }
  assert.deepEqual(outcome.MANAGER, outcome.SUPERADMIN);
  assert.deepEqual(outcome.COLLABORATOR, outcome.SUPERADMIN);
  assert.equal(outcome.SUPERADMIN.generated, 30);
  assert.equal(outcome.SUPERADMIN.rateLimited, 2);
  assert.ok(outcome.SUPERADMIN.retry > 0);
});

test('T7b -- cola de lotes del modulo APU: 429 -> pendiente_limite (terminal para la corrida, reintentable, no cuenta como error)', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ sourceSheet: 'S', rowNumber: i + 1, code: `C${i}`, concept: `c${i}` }));
  let job = createBatchJob({ batchId: 'B', fileName: 'f', items });
  job = markItemRateLimited(job, job.items[0].itemKey, { message: 'limite', retryAfterSeconds: 90 });
  job = markPendingRateLimited(job, { message: 'limite', retryAfterSeconds: 90 });
  const s = summarizeJob(job);
  assert.equal(s.pendiente_limite, 5);
  assert.equal(s.error, 0);
  assert.equal(s.retryAfterSeconds, 90);
  assert.ok(isJobComplete(job), 'la corrida termina (no martilla el limite)');
  assert.ok(job.items.every(it => it.apu === null && it.retryAt));
  const retried = retryFailedItems(job);
  assert.ok(retried.items.every(it => it.status === ITEM_STATUS.PENDIENTE), 'reintentable');
  // Transiciones durables del concepto
  assert.equal(isLegalStatusTransition('GENERANDO', 'PENDIENTE_LIMITE'), true);
  assert.equal(isLegalStatusTransition('PENDIENTE', 'PENDIENTE_LIMITE'), true);
  assert.equal(isLegalStatusTransition('PENDIENTE_LIMITE', 'GENERANDO'), true);
  assert.equal(isLegalStatusTransition('PENDIENTE_LIMITE', 'GENERADO'), false, 'nunca "terminado" sin generar');
});
