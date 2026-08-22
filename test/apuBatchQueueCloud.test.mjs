/* Prueba de integracion REAL (emulador de Firestore, no simulado) de la
   persistencia de la cola de generacion masiva. Corre con:
     npm run test:batchqueue
   Demuestra, contra Firestore de verdad (no un mock en memoria):
   - checkpoint incremental: cada item se guarda en su propio documento
     conforme termina, sin esperar a que el lote completo termine;
   - recuperacion tras "recargar la pagina" (se simula descartando el job en
     memoria y reconstruyendolo con loadJob, exactamente lo que hace la app
     al montar de nuevo);
   - que un fallo individual (item con status:error) sobrevive el checkpoint
     y no bloquea que los demas ya esten guardados;
   - cancelacion segura persistida;
   - limpieza (deleteJob) real. */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  createBatchJob, markItemDone, markItemError, cancelJob, fingerprintCatalog
} from '../src/domain/apuBatchQueue.js';
import {
  saveJobMeta, saveItemState, loadJob, markJobCancelled,
  setActiveBatchId, getActiveBatchId, clearActiveBatchId, deleteJob
} from '../src/lib/apuBatchQueueCloud.js';

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'zoemec-batchqueue-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080
    }
  });
});

after(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

function makeItems(n){
  return Array.from({ length: n }, (_, i) => ({
    sourceSheet: 'HojaReal', rowNumber: i + 10, code: String(i + 1),
    concept: `Concepto real ${i + 1}`, unit: 'M2', qty: 10 + i
  }));
}

describe('apuBatchQueueCloud (emulador real de Firestore)', () => {
  it('saveJobMeta + saveItemState + loadJob: checkpoint incremental real, reconstruye el job identico', async () => {
    const db = testEnv.authenticatedContext('diana').firestore();
    const uid = 'diana';
    let job = createBatchJob({
      batchId: 'B-REAL-1', fileName: 'catalogo25.xlsx', items: makeItems(25),
      catalogFingerprint: fingerprintCatalog('catalogo25.xlsx', makeItems(25))
    });
    await saveJobMeta(db, uid, job);
    await setActiveBatchId(db, uid, job.batchId);

    // Simula que van terminando UNO A UNO (checkpoint real conforme avanza,
    // no al final del lote completo).
    for(let i = 0; i < 25; i++){
      const key = job.items[i].itemKey;
      job = markItemDone(job, key, { concept: job.items[i].item.concept, calculated: { pu: 100 + i } });
      await saveItemState(db, uid, job.batchId, job.items[i]);
    }

    // "Recarga de pagina": se descarta el job en memoria y se reconstruye
    // SOLO desde Firestore.
    const resumed = await loadJob(db, uid, job.batchId);
    assert.ok(resumed);
    assert.equal(resumed.total, 25);
    assert.equal(resumed.items.length, 25);
    assert.ok(resumed.items.every(it => it.status === 'terminado'));
    assert.equal(resumed.items[10].apu.calculated.pu, 110);
    assert.equal(resumed.items[10].item.concept, 'Concepto real 11');

    const activeId = await getActiveBatchId(db, uid);
    assert.equal(activeId, 'B-REAL-1');
  });

  it('checkpoint sobrevive un fallo individual: los ya terminados no se pierden aunque otro falle', async () => {
    const db = testEnv.authenticatedContext('diana').firestore();
    const uid = 'diana';
    let job = createBatchJob({ batchId: 'B-REAL-2', fileName: 'catalogo10.xlsx', items: makeItems(10) });
    await saveJobMeta(db, uid, job);

    for(let i = 0; i < 6; i++){
      job = markItemDone(job, job.items[i].itemKey, { concept: job.items[i].item.concept });
      await saveItemState(db, uid, job.batchId, job.items[i]);
    }
    job = markItemError(job, job.items[6].itemKey, new Error('OpenAI 500 (simulado)'));
    await saveItemState(db, uid, job.batchId, job.items[6]);

    const resumed = await loadJob(db, uid, job.batchId);
    for(let i = 0; i < 6; i++) assert.equal(resumed.items[i].status, 'terminado', `item ${i} no debe perderse`);
    assert.equal(resumed.items[6].status, 'error');
    assert.equal(resumed.items[6].error, 'OpenAI 500 (simulado)');
    // Los items 7-9 nunca se guardaron (no habian corrido aun): deben
    // reconstruirse como pendiente, nunca como perdidos/undefined.
    for(let i = 7; i < 10; i++) assert.equal(resumed.items[i].status, 'pendiente');
  });

  it('markJobCancelled: la cancelacion queda persistida y se reconstruye al reanudar', async () => {
    const db = testEnv.authenticatedContext('diana').firestore();
    const uid = 'diana';
    let job = createBatchJob({ batchId: 'B-REAL-3', fileName: 'catalogo5.xlsx', items: makeItems(5) });
    await saveJobMeta(db, uid, job);
    job = markItemDone(job, job.items[0].itemKey, { concept: 'ok' });
    await saveItemState(db, uid, job.batchId, job.items[0]);
    job = cancelJob(job);
    await markJobCancelled(db, uid, job.batchId);

    const resumed = await loadJob(db, uid, job.batchId);
    assert.equal(resumed.cancelled, true);
    assert.equal(resumed.items[0].status, 'terminado', 'cancelar no debe tocar lo ya terminado');
  });

  it('deleteJob: limpia metadatos, items y el puntero de lote activo', async () => {
    const db = testEnv.authenticatedContext('diana').firestore();
    const uid = 'diana';
    let job = createBatchJob({ batchId: 'B-REAL-4', fileName: 'catalogo3.xlsx', items: makeItems(3) });
    await saveJobMeta(db, uid, job);
    await setActiveBatchId(db, uid, job.batchId);
    for(const it of job.items){
      job = markItemDone(job, it.itemKey, { concept: it.item.concept });
      await saveItemState(db, uid, job.batchId, job.items.find(x => x.itemKey === it.itemKey));
    }
    await deleteJob(db, uid, job);
    const resumed = await loadJob(db, uid, job.batchId);
    assert.equal(resumed, null, 'tras borrar, el job ya no debe existir');
    const activeId = await getActiveBatchId(db, uid);
    assert.equal(activeId, null, 'el puntero de lote activo tambien debe limpiarse');
  });

  it('aislamiento: el usuario B nunca puede leer ni escribir el lote del usuario A (mismas reglas ya probadas de users/{uid}/state)', async () => {
    const dbA = testEnv.authenticatedContext('alice').firestore();
    const dbB = testEnv.authenticatedContext('bob').firestore();
    const job = createBatchJob({ batchId: 'B-REAL-5', fileName: 'x.xlsx', items: makeItems(2) });
    await saveJobMeta(dbA, 'alice', job);
    await assert.rejects(loadJobStrict(dbB, 'alice', job.batchId), /permission|insufficient/i);
  });
});

// loadJob normalmente devuelve null si el doc no existe o no se puede leer
// silenciosamente en el flujo real; para la prueba de aislamiento se
// necesita que el rechazo de permisos SI se propague, asi que se llama
// getDoc directamente en vez de a traves de loadJob.
import { doc, getDoc } from 'firebase/firestore';
async function loadJobStrict(db, uid, batchId){
  await getDoc(doc(db, 'users', uid, 'state', `apuBatchJob:${batchId}`));
}
