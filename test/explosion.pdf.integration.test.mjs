/* Prueba de integracion de la Explosion de Materiales/Mano de Obra/Maquinaria
   en PDF (Fase A). jsPDF real (build de Node); se lee el PDF generado como
   bytes crudos y se busca el texto real, mismo criterio que
   test/apuProjectDossier.pdf.integration.test.mjs. */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyAPUv2, APU_DATA_STATE } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { exportExplosionPdf } from '../src/lib/explosionPdf.js';

function apuDoc(id, { concept, cantidadObra = 100, materialPrecio = 150, materialConfidence = 60, incluirMaquinaria = false } = {}){
  const a = makeEmptyAPUv2();
  const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'Proveedor de prueba', fecha: '2026-01-01' };
  Object.assign(a, { id, clave: id, concept, unit: 'm²', cantidadObra, proyecto: 'Proyecto Explosion Test', cliente: 'Cliente Test' });
  a.materials = [{ clave: 'PANEL-YESO', descripcion: 'Panel de yeso', unidad: 'pza', consumo: 2, desperdicioPct: 5, precioUnitario: materialPrecio, fuente, priceRecord: { confidence: materialConfidence } }];
  a.labor = [{ clave: 'MO-OFICIAL', descripcion: 'Oficial tablarrocero', unidad: 'jor', cuadrilla: 1, rendimiento: 20, jornada: 8, salarioBase: 400, fsr: 1.2, fuente }];
  if(incluirMaquinaria){
    a.equipment = [{ clave: 'RETRO-1', descripcion: 'Retroexcavadora propia', unidad: 'm3', integracion: 'AMORTIZABLE', tarifa: 1500, cantidad: 1, factorUso: 1, vidaUtilDias: 1000, rendimientoDiario: 40, fuente }];
  }
  a.herramientaMenor = { modo: 'porcentaje', porcentaje: 3, detalle: [] };
  return { id, ownerUid: 'uid-test', organizationId: 'org-test', projectId: 'PRO-EXP', currentVersion: 'V1', snapshot: finalizeProfessionalAPU(a), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
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
    '/api/projects?id=PRO-EXP': { project: { id: 'PRO-EXP', name: 'Proyecto Explosion Test', client: 'Cliente Test' } },
    '/api/apus?projectId=PRO-EXP': {
      apus: [
        apuDoc('APU-1', { concept: 'Muro de tablaroca nivel 1', incluirMaquinaria: true }),
        apuDoc('APU-2', { concept: 'Muro de tablaroca nivel 2', materialPrecio: 180, materialConfidence: 90 })
      ]
    },
    '/api/export-events': { event: {} }
  };
});

test('TEST QA 12 -- PDF de Explosion incluye las 4 secciones y los conceptos de origen', async () => {
  const { doc, data } = await exportExplosionPdf({ projectId: 'PRO-EXP', save: false });
  const text = rawText(doc);
  assert.match(text, /EXPLOSION DE MATERIALES/);
  assert.match(text, /MANO DE OBRA/);
  assert.match(text, /MAQUINARIA Y EQUIPO/);
  assert.match(text, /AUXILIARES/);
  assert.ok(text.includes('Panel de yeso'));
  assert.ok(text.includes('Retroexcavadora propia'));
  assert.ok(doc.internal.getNumberOfPages() >= 5);
  assert.equal(data.materials.find(m => m.descripcion === 'Panel de yeso').apusOrigen.length, 2);
});

test('TEST QA 14 -- PDF de Explosion nunca mezcla organizaciones distintas', async () => {
  responses['/api/apus?projectId=PRO-EXP'] = {
    apus: [
      { ...apuDoc('APU-1', { concept: 'A' }), organizationId: 'org-A' },
      { ...apuDoc('APU-2', { concept: 'B' }), organizationId: 'org-B' }
    ]
  };
  await assert.rejects(() => exportExplosionPdf({ projectId: 'PRO-EXP', save: false }), /organizaciones distintas/);
});
