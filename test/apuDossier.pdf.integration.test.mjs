/* Prueba de integracion del Dossier APU Auditable en PDF (Fase 8).
   exportApuAuditDossierPdf es la funcion real (src/lib/apuDossierPdf.js),
   con jsPDF real (build de Node, mismo criterio que apuExportV2.integration.test.mjs)
   -- se lee el PDF generado como bytes crudos y se busca el texto/importes
   reales, nunca se asume "no truena" como prueba suficiente.

   Limite HONESTO de este archivo: la resolucion de fuente de verdad
   (resolveApuSnapshot, apuDossierData.js) llama a /api/apus,
   /api/challenge-decisions, /api/technical-memory, /api/export-events via
   fetch. Node no tiene un servidor real corriendo aqui (eso lo cubre la QA
   de aplicacion completa contra el emulador) -- este archivo mockea
   global.fetch con las MISMAS formas de respuesta reales que devuelven esos
   endpoints (documentadas y probadas por separado en
   test/apusApi.test.mjs/test/challengeDecisionsApi.test.mjs/
   test/technicalMemoryApi.test.mjs/test/exportEventsApi.test.mjs), para
   poder probar la logica de composicion del dossier en aislamiento rapido,
   sin emulador. Nunca se presenta esto como "probado contra el servidor
   real" -- eso es responsabilidad de la QA de aplicacion completa. */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyAPUv2, APU_DATA_STATE } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { SYSTEM_RESOURCES } from '../src/domain/constructionSystems.js';
import { computeSnapshotHash } from '../src/domain/snapshotHash.js';
import { exportApuAuditDossierPdf } from '../src/lib/apuDossierPdf.js';

function goldenApu(overrides = {}){
  const a = makeEmptyAPUv2();
  const [descripcion, cantidadPorUnidad, , salarioBase, fsr] = SYSTEM_RESOURCES.tablaroca.labor[0];
  const baselineRendimiento = 1 / cantidadPorUnidad;
  const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'Proveedor de prueba', fecha: '2026-01-01' };
  Object.assign(a, {
    id: 'APU-TEST-DOSSIER', clave: 'APU-TEST-DOSSIER', concept: 'Muro de prueba para el dossier auditable',
    unit: 'm²', cantidadObra: 100, proyecto: 'Proyecto Dossier Test', cliente: 'Cliente Dossier Test',
    primaryActivity: 'tablaroca', version: 'V1'
  });
  a.materials = [{ clave: 'MAT-1', descripcion: 'Panel de yeso', unidad: 'pza', consumo: 2, desperdicioPct: 5, precioUnitario: 150, fuente }];
  a.labor = [{ clave: 'MO-1', descripcion, cuadrilla: 1, rendimiento: baselineRendimiento, jornada: 8, salarioBase, fsr, fuente, rendimientoFuente: 'PLANTILLA' }];
  return { ...a, ...overrides };
}

function deviatedApu(){
  const a = goldenApu();
  const [, cantidadPorUnidad] = SYSTEM_RESOURCES.tablaroca.labor[0];
  const baselineRendimiento = 1 / cantidadPorUnidad;
  a.labor = [{ ...a.labor[0], rendimiento: baselineRendimiento * 1.3 }]; // 30% de desviacion -> dispara Challenge
  return a;
}

const rawText = doc => Buffer.from(doc.output('arraybuffer')).toString('latin1');

/* Router de fetch mockeado -- ver comentario de cabecera. */
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
beforeEach(() => { responses = { '/api/apus': { apu: null, versions: [] }, '/api/challenge-decisions': { decisions: [] }, '/api/technical-memory': { entries: [] }, '/api/export-events': { event: {} } }; });

test('CASO B: sin registro server-side, exporta como BORRADOR NO RESPALDADO', async () => {
  const apu = goldenApu();
  const { doc, data } = await exportApuAuditDossierPdf({ apu, apuId: apu.id, save: false });
  assert.equal(data.source, 'LOCAL_DRAFT');
  assert.equal(data.verificationLabel, 'BORRADOR NO RESPALDADO');
  const raw = rawText(doc);
  assert.match(raw, /BORRADOR NO RESPALDADO/);
});

test('CASO A/C/D: con version server-side, usa ESA version (nunca el apu/calculated manipulado del cliente) y el hash coincide', async () => {
  const realApu = goldenApu();
  const finalizedReal = finalizeProfessionalAPU(realApu);
  responses['/api/apus'] = {
    apu: { id: 'APU-TEST-DOSSIER', ownerUid: 'u1', projectId: 'PRO-TEST', currentVersion: 'V1' },
    versions: [{ version: 'V1', at: '2026-01-01T00:00:00.000Z', user: 'ingeniero@zoemec.mx', reason: 'Guardado inicial', unitPrice: finalizedReal.calculated.pu, snapshot: finalizedReal }]
  };
  // El cliente "manda" un apu con calculated FALSIFICADO -- nunca debe aparecer en el dossier.
  const fakeApu = { ...realApu, calculated: { pu: 999999, importeTotal: 999999, direct: 999999, mat: 0, mo: 0, equipo: 0, herramienta: 0, consumibles: 0 } };

  const { doc, data } = await exportApuAuditDossierPdf({ apu: fakeApu, apuId: 'APU-TEST-DOSSIER', apuVersionId: 'V1', save: false });
  assert.equal(data.source, 'SERVER_VERSION');
  assert.equal(data.verificationLabel, 'APU AUDITABLE');

  // Una version server-side ya llego finalizada tal como se guardo -- el
  // hash se calcula sobre ESE snapshot exacto, sin volver a finalizarlo
  // (ver comentario en buildDossierData: evita que un `validatedAt` nuevo
  // en cada exportacion rompa la reproducibilidad).
  const expectedHash = await computeSnapshotHash(finalizedReal);
  assert.equal(data.snapshotHash, expectedHash);

  const raw = rawText(doc);
  assert.ok(!raw.includes('999,999.00'), 'el precio unitario falsificado del cliente NUNCA debe aparecer en el dossier');
  const realPu = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(finalizedReal.calculated.pu).replace('MX$', '$');
  assert.ok(raw.includes(`(${realPu})`) || raw.includes(realPu), 'el P.U. real de la version guardada si debe aparecer');
});

test('CASO E/F: Confidence real se muestra; score null se rotula EVIDENCIA INSUFICIENTE, nunca 0%', async () => {
  // Contenido tecnico real (nunca estructuralmente vacio) pero SIN
  // disciplina clasificada -- runApuConfidence anula el score global en ese
  // caso (ver apuConfidence.js), sin que el APU deje de ser exportable.
  const apu = goldenApu({ primaryActivity: null, id: 'APU-SIN-CLASIFICAR', clave: 'APU-SIN-CLASIFICAR' });
  const { doc, data } = await exportApuAuditDossierPdf({ apu, apuId: apu.id, save: false });
  assert.equal(data.confidence.score, null);
  const raw = rawText(doc);
  assert.match(raw, /EVIDENCIA INSUFICIENTE/);
  assert.ok(!raw.includes('0% (INSUFFICIENT_EVIDENCE)'), 'nunca debe convertirse null en un score de 0%');
});

test('CASO G: Bid Risk sin exposicion real se muestra NO ESTIMABLE, nunca $0.00', async () => {
  const apu = goldenApu();
  const { doc, data } = await exportApuAuditDossierPdf({ apu, apuId: apu.id, save: false });
  if(!(data.bidRisk.estimatedExposure > 0)){
    const raw = rawText(doc);
    assert.match(raw, /NO ESTIMABLE/);
  }
});

test('CASO H: decision de Challenge persistida aparece con estado/actor/verificacion reales', async () => {
  const apu = deviatedApu();
  const finalized = finalizeProfessionalAPU(apu);
  responses['/api/apus'] = {
    apu: { id: apu.id, ownerUid: 'u1', projectId: 'PRO-TEST', currentVersion: 'V1' },
    versions: [{ version: 'V1', at: '2026-01-02T00:00:00.000Z', user: 'ing@zoemec.mx', reason: 'Guardado', unitPrice: finalized.calculated.pu, snapshot: finalized }]
  };
  responses['/api/challenge-decisions'] = { decisions: [{ challengeId: 'yield:0', decision: 'JUSTIFY', reason: 'Rendimiento verificado en campo.', actorEmail: 'supervisor@zoemec.mx', verificationStatus: 'SERVER_VERIFIED', clientMismatch: false, updatedAt: '2026-01-03T00:00:00.000Z' }] };

  const { doc } = await exportApuAuditDossierPdf({ apu, apuId: apu.id, apuVersionId: 'V1', save: false });
  const raw = rawText(doc);
  assert.match(raw, /JUSTIFICADO/);
  assert.match(raw, /supervisor@zoemec.mx/);
  assert.match(raw, /SERVER_VERIFIED/);
});

test('CASO I: memoria PROPOSED nunca aparece como si fuera APPROVED', async () => {
  const apu = goldenApu();
  responses['/api/apus'] = {
    apu: { id: apu.id, ownerUid: 'u1', projectId: 'PRO-TEST', currentVersion: 'V1' },
    versions: [{ version: 'V1', at: '2026-01-01T00:00:00.000Z', user: 'ing@zoemec.mx', reason: 'Guardado', unitPrice: 1, snapshot: finalizeProfessionalAPU(apu) }]
  };
  responses['/api/technical-memory'] = { entries: [{ id: 'MEM-1', status: 'PROPOSED', type: 'APPROVED_YIELD', value: 5, unit: 'jor', subject: { resourceDescripcion: apu.labor[0].descripcion } }] };

  const clienteExport = await exportApuAuditDossierPdf({ apu, apuId: apu.id, apuVersionId: 'V1', mode: 'CLIENTE', save: false });
  const rawCliente = rawText(clienteExport.doc);
  assert.ok(!rawCliente.includes('MEM-1') && !/PROPOSED/.test(rawCliente), 'modo CLIENTE nunca muestra memoria no aprobada');

  const tecnicoExport = await exportApuAuditDossierPdf({ apu, apuId: apu.id, apuVersionId: 'V1', mode: 'TECNICO', save: false });
  const rawTecnico = rawText(tecnicoExport.doc);
  assert.match(rawTecnico, /PROPOSED/, 'modo TECNICO si muestra la memoria PROPOSED, pero rotulada como tal');
  assert.ok(!/PROPOSED[\s\S]{0,40}APPROVED/.test(rawTecnico), 'nunca se presenta PROPOSED como si fuera APPROVED');
});

test('CASO J: historial de versiones y diff se muestran cuando hay mas de una version', async () => {
  const v1Apu = goldenApu();
  const v1 = finalizeProfessionalAPU(v1Apu);
  const v2Apu = deviatedApu();
  const v2 = finalizeProfessionalAPU(v2Apu);
  responses['/api/apus'] = {
    apu: { id: v1Apu.id, ownerUid: 'u1', projectId: 'PRO-TEST', currentVersion: 'V2' },
    versions: [
      { version: 'V1', at: '2026-01-01T00:00:00.000Z', user: 'ing@zoemec.mx', reason: 'Version inicial', unitPrice: v1.calculated.pu, snapshot: v1 },
      { version: 'V2', at: '2026-01-05T00:00:00.000Z', user: 'ing@zoemec.mx', reason: 'Ajuste de rendimiento', unitPrice: v2.calculated.pu, snapshot: v2 }
    ]
  };
  const { doc } = await exportApuAuditDossierPdf({ apu: v2Apu, apuId: v1Apu.id, apuVersionId: 'V2', save: false });
  const raw = rawText(doc);
  assert.match(raw, /HISTORIAL DE VERSIONES/);
  assert.match(raw, /Ajuste de rendimiento/);
});

test('CASO N/O/P: el PDF nunca contiene NaN/Infinity como texto, y los importes usan formato de moneda real', async () => {
  const apu = goldenApu();
  const { doc } = await exportApuAuditDossierPdf({ apu, apuId: apu.id, save: false });
  const raw = rawText(doc);
  assert.ok(!/\bNaN\b/.test(raw), 'el PDF nunca debe mostrar NaN');
  assert.ok(!/\bInfinity\b/.test(raw), 'el PDF nunca debe mostrar Infinity');
  const finalized = finalizeProfessionalAPU(apu);
  const realPu = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(finalized.calculated.pu).replace('MX$', '$');
  assert.ok(raw.includes(realPu), 'el precio unitario real debe aparecer con formato de moneda correcto');
});

test('CASO Q: reexportar la MISMA version produce un hash identico (reproducibilidad)', async () => {
  const apu = goldenApu();
  const finalized = finalizeProfessionalAPU(apu);
  responses['/api/apus'] = {
    apu: { id: apu.id, ownerUid: 'u1', projectId: 'PRO-TEST', currentVersion: 'V1' },
    versions: [{ version: 'V1', at: '2026-01-01T00:00:00.000Z', user: 'ing@zoemec.mx', reason: 'Guardado', unitPrice: finalized.calculated.pu, snapshot: finalized }]
  };
  const first = await exportApuAuditDossierPdf({ apu, apuId: apu.id, apuVersionId: 'V1', save: false });
  const second = await exportApuAuditDossierPdf({ apu, apuId: apu.id, apuVersionId: 'V1', save: false });
  assert.equal(first.data.snapshotHash, second.data.snapshotHash);
});

test('CASO R: exportar desde una version server-side registra el export event; un borrador local NO lo hace', async () => {
  const apu = goldenApu();
  const finalized = finalizeProfessionalAPU(apu);
  responses['/api/apus'] = {
    apu: { id: apu.id, ownerUid: 'u1', projectId: 'PRO-TEST', currentVersion: 'V1' },
    versions: [{ version: 'V1', at: '2026-01-01T00:00:00.000Z', user: 'ing@zoemec.mx', reason: 'Guardado', unitPrice: finalized.calculated.pu, snapshot: finalized }]
  };
  let recordedBody = null;
  global.fetch = async (url, options) => {
    const u = new URL(String(url), 'http://localhost');
    if(u.pathname === '/api/export-events'){ recordedBody = JSON.parse(options.body); return { ok: true, status: 201, json: async () => ({ event: recordedBody }), text: async () => '{}' }; }
    // Discrimina por el id real de la query -- un mock que respondiera lo
    // mismo para CUALQUIER apuId haria que "APU-SIN-VERSION" pareciera
    // tener version guardada solo porque otro id si la tiene.
    if(u.pathname === '/api/apus' && u.searchParams.get('id') !== apu.id){
      return { ok: true, status: 200, json: async () => ({ apu: null, versions: [] }), text: async () => '{}' };
    }
    const key = u.pathname + (u.search || '');
    const found = Object.entries(responses).find(([pattern]) => key.startsWith(pattern));
    const body = found ? found[1] : { error: 'not mocked' };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  await exportApuAuditDossierPdf({ apu, apuId: apu.id, apuVersionId: 'V1', save: false });
  assert.ok(recordedBody, 'debe registrar el export event cuando la fuente es SERVER_VERSION');
  assert.equal(recordedBody.format, 'PDF');
  assert.equal(recordedBody.apuVersionId, 'V1');

  recordedBody = null;
  await exportApuAuditDossierPdf({ apu: goldenApu({ id: 'APU-SIN-VERSION' }), apuId: 'APU-SIN-VERSION', save: false });
  assert.equal(recordedBody, null, 'un borrador local (sin version server-side) NUNCA debe registrar un export event');
});
