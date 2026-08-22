import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ITEM_STATUS, itemKeyOf, createBatchJob, fingerprintCatalog, selectNextBatch,
  markItemStatus, markItemError, markItemDone, retryFailedItems, cancelJob,
  summarizeJob, isJobComplete
} from './apuBatchQueue.js';

function makeItems(n, { withDuplicateKeys = false } = {}){
  return Array.from({ length: n }, (_, i) => ({
    sourceSheet: withDuplicateKeys && i % 5 === 0 ? 'HojaA' : 'HojaA',
    rowNumber: i + 10,
    code: withDuplicateKeys && i % 5 === 0 ? '387' : String(i + 1),
    concept: `Concepto ${i + 1}`,
    unit: 'M2',
    qty: 10 + i
  }));
}

test('itemKeyOf: identidad por hoja+fila+clave, nunca por contenido', () => {
  const a = { sourceSheet: 'H1', rowNumber: 12, code: '387', concept: 'X', qty: 24 };
  const b = { sourceSheet: 'H1', rowNumber: 20, code: '387', concept: 'X', qty: 11 };
  assert.notEqual(itemKeyOf(a), itemKeyOf(b), 'misma clave en filas distintas debe ser identidad distinta');
  assert.equal(itemKeyOf(a), itemKeyOf({ ...a }));
});

test('createBatchJob: arranca con N items en PENDIENTE, total correcto', () => {
  const items = makeItems(25);
  const job = createBatchJob({ batchId: 'B1', fileName: 'catalogo.xlsx', items, catalogFingerprint: 'fp' });
  assert.equal(job.total, 25);
  assert.equal(job.items.length, 25);
  assert.ok(job.items.every(it => it.status === ITEM_STATUS.PENDIENTE));
  assert.equal(job.cancelled, false);
});

test('fingerprintCatalog: mismo archivo/mismo catalogo -> mismo fingerprint; catalogo distinto -> distinto', () => {
  const itemsA = makeItems(25);
  const itemsB = makeItems(30);
  assert.equal(fingerprintCatalog('catalogo.xlsx', itemsA), fingerprintCatalog('catalogo.xlsx', itemsA));
  assert.notEqual(fingerprintCatalog('catalogo.xlsx', itemsA), fingerprintCatalog('catalogo.xlsx', itemsB));
  assert.notEqual(fingerprintCatalog('catalogoA.xlsx', itemsA), fingerprintCatalog('catalogoB.xlsx', itemsA));
});

test('selectNextBatch: respeta el limite de concurrencia y nunca relanza items ya en vuelo', () => {
  const job = createBatchJob({ batchId: 'B1', items: makeItems(10) });
  const batch1 = selectNextBatch(job, 4);
  assert.equal(batch1.length, 4);
  const inFlight = new Set(batch1.map(it => it.itemKey));
  const batch2 = selectNextBatch(job, 4, inFlight);
  assert.equal(batch2.length, 0, 'con 4 ya en vuelo y limite 4, no debe lanzar mas');
  const batch3 = selectNextBatch(job, 6, inFlight);
  assert.equal(batch3.length, 2, 'con limite 6 y 4 en vuelo, deben salir 2 nuevos, nunca repetidos');
  assert.ok(batch3.every(it => !inFlight.has(it.itemKey)));
});

test('selectNextBatch: un job cancelado nunca entrega items nuevos', () => {
  const job = cancelJob(createBatchJob({ batchId: 'B1', items: makeItems(5) }));
  assert.equal(selectNextBatch(job, 4).length, 0);
});

test('markItemError: un error NUNCA detiene el lote -- solo marca ese item, el resto sigue PENDIENTE', () => {
  let job = createBatchJob({ batchId: 'B1', items: makeItems(5) });
  const failingKey = job.items[2].itemKey;
  job = markItemError(job, failingKey, new Error('OpenAI 500'));
  const failed = job.items.find(it => it.itemKey === failingKey);
  assert.equal(failed.status, ITEM_STATUS.ERROR);
  assert.equal(failed.error, 'OpenAI 500');
  assert.equal(failed.attempts, 1);
  const others = job.items.filter(it => it.itemKey !== failingKey);
  assert.ok(others.every(it => it.status === ITEM_STATUS.PENDIENTE), 'los demas items no deben verse afectados por el error de uno solo');
});

test('markItemDone: registra el APU y distingue TERMINADO de REQUIERE_REVISION', () => {
  let job = createBatchJob({ batchId: 'B1', items: makeItems(3) });
  const key0 = job.items[0].itemKey, key1 = job.items[1].itemKey;
  job = markItemDone(job, key0, { concept: 'X', calculated: { pu: 100 } });
  job = markItemDone(job, key1, { concept: 'Y', calculated: { pu: 0 } }, { requiresReview: true });
  assert.equal(job.items.find(it => it.itemKey === key0).status, ITEM_STATUS.TERMINADO);
  assert.equal(job.items.find(it => it.itemKey === key1).status, ITEM_STATUS.REQUIERE_REVISION);
  assert.ok(job.items.find(it => it.itemKey === key0).apu);
});

test('150 conceptos, falla el 87: los 86 anteriores no se pierden y el 88 continua (simulado)', () => {
  let job = createBatchJob({ batchId: 'B150', items: makeItems(150) });
  // Simula que los primeros 86 ya terminaron bien.
  for(let i = 0; i < 86; i++){
    job = markItemDone(job, job.items[i].itemKey, { concept: job.items[i].item.concept, calculated: { pu: 50 + i } });
  }
  // El 87 (indice 86) falla.
  job = markItemError(job, job.items[86].itemKey, new Error('timeout'));
  // Los 86 ya terminados deben seguir intactos.
  for(let i = 0; i < 86; i++){
    assert.equal(job.items[i].status, ITEM_STATUS.TERMINADO, `item ${i} no debe perderse por el fallo del 87`);
  }
  assert.equal(job.items[86].status, ITEM_STATUS.ERROR);
  // El sistema debe poder continuar con el 88 (indice 87): sigue PENDIENTE, elegible.
  const next = selectNextBatch(job, 4);
  assert.ok(next.some(it => it.itemKey === job.items[87].itemKey), 'el concepto 88 debe seguir disponible para procesarse');
  const summary = summarizeJob(job);
  assert.equal(summary.terminado, 86);
  assert.equal(summary.error, 1);
  assert.equal(summary.pendiente, 150 - 86 - 1);
  assert.equal(summary.total, 150);
});

test('retryFailedItems: solo los ERROR vuelven a PENDIENTE, el resto queda intacto', () => {
  let job = createBatchJob({ batchId: 'B1', items: makeItems(5) });
  job = markItemDone(job, job.items[0].itemKey, { concept: 'ok' });
  job = markItemError(job, job.items[1].itemKey, new Error('falla 1'));
  job = markItemError(job, job.items[2].itemKey, new Error('falla 2'));
  const retried = retryFailedItems(job);
  assert.equal(retried.items[0].status, ITEM_STATUS.TERMINADO, 'un item ya terminado nunca se reintenta');
  assert.equal(retried.items[1].status, ITEM_STATUS.PENDIENTE);
  assert.equal(retried.items[2].status, ITEM_STATUS.PENDIENTE);
  assert.equal(retried.items[1].error, null);
  assert.equal(retried.items[3].status, ITEM_STATUS.PENDIENTE, 'un item que nunca corrio sigue igual');
});

test('cancelJob: cancelacion SEGURA -- nunca toca items ya terminales, solo los pendientes', () => {
  let job = createBatchJob({ batchId: 'B1', items: makeItems(5) });
  job = markItemDone(job, job.items[0].itemKey, { concept: 'ok' });
  job = markItemError(job, job.items[1].itemKey, new Error('x'));
  job = markItemStatus(job, job.items[2].itemKey, ITEM_STATUS.ANALIZANDO); // "en vuelo"
  const cancelled = cancelJob(job);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.items[0].status, ITEM_STATUS.TERMINADO, 'terminado no se toca');
  assert.equal(cancelled.items[1].status, ITEM_STATUS.ERROR, 'error no se toca');
  assert.equal(cancelled.items[2].status, ITEM_STATUS.ANALIZANDO, 'en vuelo se deja terminar, no se corrompe a medias');
  assert.equal(cancelled.items[3].status, ITEM_STATUS.CANCELADO, 'pendiente se marca cancelado');
  assert.equal(cancelled.items[4].status, ITEM_STATUS.CANCELADO);
});

test('summarizeJob / isJobComplete: progreso X/N y deteccion de lote completo', () => {
  let job = createBatchJob({ batchId: 'B1', items: makeItems(4) });
  assert.equal(isJobComplete(job), false);
  job = markItemDone(job, job.items[0].itemKey, {});
  job = markItemDone(job, job.items[1].itemKey, {});
  job = markItemError(job, job.items[2].itemKey, new Error('x'));
  assert.equal(isJobComplete(job), false);
  job = markItemDone(job, job.items[3].itemKey, {});
  assert.equal(isJobComplete(job), true);
  const summary = summarizeJob(job);
  assert.equal(summary.done, 4);
  assert.equal(summary.remaining, 0);
});

test('claves repetidas (387 x varias filas) conservan identidad independiente en la cola', () => {
  const items = makeItems(10, { withDuplicateKeys: true });
  const job = createBatchJob({ batchId: 'B1', items });
  const keys = job.items.map(it => it.itemKey);
  assert.equal(new Set(keys).size, keys.length, 'cada fila debe tener una identidad unica en la cola aunque compartan clave');
});
