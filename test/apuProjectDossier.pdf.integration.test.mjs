/* Prueba de integracion del Dossier de Proyecto/Multi-APU en PDF (Fase 8
   Parte 2). jsPDF real (build de Node); se lee el PDF generado como bytes
   crudos y se busca el texto real, nunca se asume "no truena" como prueba
   suficiente. Mismo limite HONESTO documentado en
   test/apuDossier.pdf.integration.test.mjs: se mockea la capa HTTP
   (/api/projects, /api/apus, /api/challenge-decisions,
   /api/technical-memory, /api/export-events) con las MISMAS formas de
   respuesta reales ya probadas por separado -- la QA de aplicacion
   completa contra el emulador real cubre el resto. */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyAPUv2, APU_DATA_STATE } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { SYSTEM_RESOURCES } from '../src/domain/constructionSystems.js';
import { exportProjectDossierPdf } from '../src/lib/apuProjectDossierPdf.js';
import { buildProjectDossierData } from '../src/lib/apuProjectDossierData.js';

function apuFor(id, concept, overrides = {}){
  const a = makeEmptyAPUv2();
  const [descripcion, cantidadPorUnidad, , salarioBase, fsr] = SYSTEM_RESOURCES.tablaroca.labor[0];
  const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'Proveedor de prueba', fecha: '2026-01-01' };
  Object.assign(a, {
    id, clave: id, concept, unit: 'm²', cantidadObra: 100,
    proyecto: 'Proyecto Multi-APU Test', cliente: 'Cliente Multi-APU Test',
    primaryActivity: 'tablaroca', version: 'V1'
  });
  a.materials = [{ clave: 'MAT-1', descripcion: 'Panel de yeso', unidad: 'pza', consumo: 2, desperdicioPct: 5, precioUnitario: 150, fuente }];
  a.labor = [{ clave: 'MO-1', descripcion, cuadrilla: 1, rendimiento: 1 / cantidadPorUnidad, jornada: 8, salarioBase, fsr, fuente, rendimientoFuente: 'PLANTILLA' }];
  Object.assign(a, overrides);
  return finalizeProfessionalAPU(a);
}

function threeApuDocs(){
  return [
    { id: 'APU-1', ownerUid: 'uid-test', projectId: 'PRO-3', currentVersion: 'V1', snapshot: apuFor('APU-1', 'Demolicion de muro existente'), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'APU-2', ownerUid: 'uid-test', projectId: 'PRO-3', currentVersion: 'V1', snapshot: apuFor('APU-2', 'Acarreo de escombro a 5km'), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'APU-3', ownerUid: 'uid-test', projectId: 'PRO-3', currentVersion: 'V1', snapshot: apuFor('APU-3', 'Firme de concreto f\'c=200'), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
  ];
}

const rawText = doc => Buffer.from(doc.output('arraybuffer')).toString('latin1');

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
  responses = {
    '/api/projects?id=PRO-3': { project: { id: 'PRO-3', name: 'Proyecto Multi-APU Test', client: 'Cliente Multi-APU Test' } },
    '/api/apus?projectId=PRO-3': { apus: threeApuDocs() },
    '/api/challenge-decisions': { decisions: [] },
    '/api/technical-memory': { entries: [] },
    '/api/export-events': { event: {} }
  };
});

test('CASO: PDF de proyecto con 3 APUs incluye PORTADA/RESUMEN/RANKING y DETALLE de cada APU', async () => {
  const { doc, data } = await exportProjectDossierPdf({ projectId: 'PRO-3', save: false });
  assert.equal(data.apuEntries.length, 3);
  const text = rawText(doc);
  assert.match(text, /DOSSIER DE PROYECTO/);
  assert.match(text, /RESUMEN EJECUTIVO DEL PROYECTO/);
  assert.match(text, /RANKING DE RIESGO/);
  assert.match(text, /TOP FINDINGS/);
  assert.match(text, /DISTRIBUCION DE CONFIDENCE/);
  assert.match(text, /ANEXO TECNICO/);
  ['Demolicion', 'Acarreo', 'Firme'].forEach(fragment => {
    assert.ok(text.includes(fragment), `falta el concepto "${fragment}" en el PDF`);
  });
  assert.ok(doc.internal.getNumberOfPages() > 5);
});

test('CASO: sin escenarios seleccionados, la seccion ESCENARIOS lo indica explicitamente (nunca se omite en silencio)', async () => {
  const { doc } = await exportProjectDossierPdf({ projectId: 'PRO-3', save: false });
  const text = rawText(doc);
  assert.match(text, /ESCENARIOS SELECCIONADOS/);
  assert.match(text, /Sin escenarios seleccionados/);
});

test('CASO: escenario seleccionado aparece rotulado como simulacion, nunca como si modificara el APU base', async () => {
  const selectedScenarios = [{ scenarioId: 'SC-1', name: 'Sube precio de panel', apuId: 'APU-1', changes: [{ type: 'RESOURCE_PRICE_OVERRIDE', mode: 'absolute', value: 180, selector: { kind: 'materials', descripcion: 'Panel de yeso' } }] }];
  const { doc } = await exportProjectDossierPdf({ projectId: 'PRO-3', selectedScenarios, save: false });
  const text = rawText(doc);
  assert.match(text, /SIMULACION/);
  assert.match(text, /NO MODIFICA EL APU BASE/);
});

test('CASO: manifest hash del PDF coincide con el calculado por buildProjectDossierData para el mismo conjunto', async () => {
  const data = await buildProjectDossierData({ projectId: 'PRO-3' });
  const { data: pdfData } = await exportProjectDossierPdf({ projectId: 'PRO-3', save: false });
  assert.equal(pdfData.dossierManifest.manifestHash, data.dossierManifest.manifestHash);
});

test('CASO: numeracion de paginas "Pagina N de TOTAL" presente y consistente', async () => {
  const { doc } = await exportProjectDossierPdf({ projectId: 'PRO-3', save: false });
  const total = doc.internal.getNumberOfPages();
  const text = rawText(doc);
  assert.match(text, new RegExp(`Pagina 1 de ${total}`));
});
