/* Prueba de integracion de la Explosion de Materiales/Mano de Obra/Maquinaria
   en XLSX (Fase A). Mismo criterio de mock de fetch que
   test/apuProjectDossier.xlsx.integration.test.mjs -- el .xlsx generado se
   desempaca de verdad (fflate) y se lee el texto real de las hojas, nunca se
   asume "no truena" como prueba suficiente. */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFileNode from 'write-excel-file/node';
import { unzipSync, strFromU8 } from 'fflate';
import { makeEmptyAPUv2, APU_DATA_STATE } from '../src/domain/apuSchema.js';
import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';
import { exportExplosionExcel } from '../src/lib/explosionXlsx.js';

function apuDoc(id, { concept, cantidadObra = 100, materialPrecio = 150, materialConfidence = 60, incluirMaquinaria = false, herramientaModo = 'porcentaje' } = {}){
  const a = makeEmptyAPUv2();
  const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'Proveedor de prueba', fecha: '2026-01-01' };
  Object.assign(a, { id, clave: id, concept, unit: 'm²', cantidadObra, proyecto: 'Proyecto Explosion Test', cliente: 'Cliente Test' });
  a.materials = [{ clave: 'PANEL-YESO', descripcion: 'Panel de yeso', unidad: 'pza', consumo: 2, desperdicioPct: 5, precioUnitario: materialPrecio, fuente, priceRecord: { confidence: materialConfidence } }];
  a.labor = [{ clave: 'MO-OFICIAL', descripcion: 'Oficial tablarrocero', unidad: 'jor', cuadrilla: 1, rendimiento: 20, jornada: 8, salarioBase: 400, fsr: 1.2, fuente }];
  if(incluirMaquinaria){
    a.equipment = [
      { clave: 'RETRO-1', descripcion: 'Retroexcavadora propia', unidad: 'm3', integracion: 'AMORTIZABLE', tarifa: 1500, cantidad: 1, factorUso: 1, vidaUtilDias: 1000, rendimientoDiario: 40, fuente },
      { clave: 'ANDAMIO-1', descripcion: 'Andamio tubular', unidad: 'm2', integracion: 'POR_UNIDAD_OBRA', tarifa: 5, cantidad: 1, fuente }
    ];
  }
  a.herramientaMenor = herramientaModo === 'detalle'
    ? { modo: 'detalle', detalle: [{ clave: 'HM-1', descripcion: 'Set de herramienta manual', unidad: 'jgo', cantidad: 1, valorAdquisicion: 800, depreciacionPct: 15 }] }
    : { modo: 'porcentaje', porcentaje: 3, detalle: [] };
  const finalized = finalizeProfessionalAPU(a);
  return { id, ownerUid: 'uid-test', organizationId: 'org-test', projectId: 'PRO-EXP', currentVersion: 'V1', snapshot: finalized, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}

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
        apuDoc('APU-1', { concept: 'Muro de tablaroca nivel 1', materialPrecio: 150, materialConfidence: 40, incluirMaquinaria: true }),
        apuDoc('APU-2', { concept: 'Muro de tablaroca nivel 2', materialPrecio: 180, materialConfidence: 90, herramientaModo: 'detalle' })
      ]
    },
    '/api/export-events': { event: {} }
  };
});

function allSheetsText(zip){
  const shared = strFromU8(zip['xl/sharedStrings.xml'] || new Uint8Array());
  const sheetFiles = Object.keys(zip).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
  return shared + sheetFiles.map(f => strFromU8(zip[f])).join('\n');
}

test('TEST QA 11 -- Excel de Explosion: 4 hojas independientes, sin NaN/Infinity, material consolidado entre los 2 APU', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-explosion-xlsx-'));
  const before_ = process.cwd(); process.chdir(dir);
  try{
    const { sheets, materials, labor, machinery } = await exportExplosionExcel({ projectId: 'PRO-EXP', writeXlsxFileImpl: writeXlsxFileNode, fileName: 'explosion.xlsx' });
    assert.deepEqual(sheets.map(s => s.sheet), ['MATERIALES', 'MANO DE OBRA', 'MAQUINARIA Y EQUIPO', 'AUXILIARES']);
    // Panel de yeso: consumo=2 x cantidadObra=100 en cada APU -> 200+200=400, con 5% de merma -> 420.
    const panel = materials.find(m => m.descripcion === 'Panel de yeso');
    assert.ok(panel, 'el material consolidado deberia existir');
    assert.equal(panel.cantidadFinal, 420);
    assert.equal(panel.apusOrigen.length, 2);
    assert.equal(panel.reconciliationRule, 'MAYOR_CONFIANZA'); // 90% de confianza gana sobre 40%
    // Mano de obra del mismo oficio en los 2 APU se consolida en 1 renglon.
    assert.equal(labor.length, 1);
    // Maquinaria solo la trae APU-1; herramienta menor: 1 en detalle (APU-2) + 1 sintetica de porcentaje (APU-1).
    assert.equal(machinery.maquinaria.length, 1);
    assert.equal(machinery.equipo.length, 1);
    assert.equal(machinery.herramientaMenor.length, 2);

    const zip = unzipSync(fs.readFileSync('explosion.xlsx'));
    const text = allSheetsText(zip);
    assert.ok(!/\bNaN\b/.test(text));
    assert.ok(!/\bInfinity\b/.test(text));
    assert.match(text, /Panel de yeso/);
    assert.match(text, /Retroexcavadora propia/);
  }finally{ process.chdir(before_); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('TEST QA 14 -- nunca genera una Explosion mezclando APUs de organizaciones distintas', async () => {
  responses['/api/apus?projectId=PRO-EXP'] = {
    apus: [
      { ...apuDoc('APU-1', { concept: 'A' }), organizationId: 'org-A' },
      { ...apuDoc('APU-2', { concept: 'B' }), organizationId: 'org-B' }
    ]
  };
  await assert.rejects(() => exportExplosionExcel({ projectId: 'PRO-EXP', writeXlsxFileImpl: writeXlsxFileNode, fileName: 'explosion-mixed.xlsx' }), /organizaciones distintas/);
});

test('proyecto sin APUs guardados server-side arroja error real, nunca una Explosion vacia', async () => {
  responses['/api/apus?projectId=PRO-EXP'] = { apus: [] };
  await assert.rejects(() => exportExplosionExcel({ projectId: 'PRO-EXP', writeXlsxFileImpl: writeXlsxFileNode }), /ningun APU/);
});
